import mongoose from "mongoose";
import Product from "../Products/Products.js";
import Order from "./Orders.js";
import { triggerRmaEmails } from "./order.emails.js";
import { createReturnOrder } from "../shiprocket/shiprocket.return.js";
import { buildReverseShiprocketPayload } from "../shiprocket/shiprocket.reverse.payload.js";
import Customer from "../Customer/Customer.js";
import { Mailer } from "../nodemailer/mailer.js";
import { sendCustomerCreditWhatsapp } from "../fast2sms/fast2sms.whatsapp.js";
import {
  createExchangeOrderFromRmaInternal,
} from "./OrderController.js";

/* ============================================================
   RMA POLICY
============================================================ */
const RMA_POLICY = {
  windowDays: 7,
  exchange: { firstFree: true, secondFee: 199 },
  countExchangeStatuses: [
    "requested",
    "approved",
    "pickup_scheduled",
    "picked",
    "in_transit",
    "received",
    "qc_pass",
    "qc_fail",
    "replacement_shipped",
    "closed",
  ],
};

/* ============================================================
   HELPERS
============================================================ */
const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));

const badRequest = (res, message) => res.status(400).json({ message });
const notFound = (res, message) => res.status(404).json({ message });

const normalize = (s) => String(s || "").trim().toLowerCase();

const daysDiff = (fromDate, toDate) => {
  const a = new Date(fromDate).getTime();
  const b = new Date(toDate).getTime();
  return Math.floor((a - b) / (1000 * 60 * 60 * 24));
};

const isWithinRmaWindow = (deliveredAt) => {
  if (!deliveredAt) return false;
  const diff = daysDiff(Date.now(), deliveredAt);
  return diff >= 0 && diff <= RMA_POLICY.windowDays;
};

// count previous exchanges (excluding rejected)
const countPreviousExchanges = (order) =>
  (order?.rmas || []).filter((r) => {
    if (!r) return false;
    if (r.type !== "exchange") return false;
    if (r.status === "rejected") return false;
    return RMA_POLICY.countExchangeStatuses.includes(r.status);
  }).length;

const computeExchangeFee = (exchangeCountSoFar) => {
  if (RMA_POLICY.exchange.firstFree && exchangeCountSoFar === 0) return 0;
  return Number(RMA_POLICY.exchange.secondFee || 0);
};

// Remaining qty per orderLineId
const computeRemainingQtyByLineId = (order) => {
  const purchased = new Map();
  (order.items || []).forEach((it) =>
    purchased.set(String(it.lineId), Number(it.quantity || 0))
  );

  const used = new Map();
  (order.rmas || []).forEach((r) => {
    if (!r || r.status === "rejected") return;
    (r.items || []).forEach((ri) => {
      const k = String(ri.orderLineId);
      used.set(k, (used.get(k) || 0) + Number(ri.quantity || 0));
    });
  });

  const remaining = new Map();
  for (const [k, bought] of purchased.entries()) {
    remaining.set(k, Math.max(0, bought - (used.get(k) || 0)));
  }
  return remaining;
};

// Build RMA item snapshots (lineId based)
const buildRmaItemsSnapshots = (order, rmaItems) => {
  const out = [];
  const orderItems = order.items || [];

  for (const ri of rmaItems || []) {
    const lineId = String(ri?.orderLineId || "").trim();
    const qty = Number(ri?.quantity);

    if (!lineId) throw new Error("orderLineId missing in RMA items");
    if (!Number.isFinite(qty) || qty < 1)
      throw new Error("Invalid quantity in RMA items");

    const index = orderItems.findIndex((it) => String(it.lineId) === lineId);
    if (index === -1)
      throw new Error(`Order item not found for orderLineId: ${lineId}`);

    const orderItem = orderItems[index];

    out.push({
      orderLineId: lineId,
      orderItemIndex: index,
      quantity: qty,
      productId: orderItem.productId || null,
      productCode: orderItem?.productSnapshot?.productCode || "",
      title: orderItem?.productSnapshot?.title || "",
      variantSku: orderItem?.variant?.sku || "",
    });
  }

  return out;
};

const makeRmaNumber = () =>
  "RMA-" +
  Date.now().toString().slice(-6) +
  "-" +
  Math.floor(Math.random() * 90 + 10);

const safeDate = (v) => {
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

const attrKey = (a) => normalize(a?.key || a?.attributeName || a?.name || "");
const attrVal = (a) => normalize(a?.value || a?.val || "");

const normalizeWantedAttrs = (attrs = []) => {
  const wanted = {};
  (attrs || []).forEach((a) => {
    const k = attrKey(a);
    const v = attrVal(a);
    if (k && v) wanted[k] = v;
  });
  return wanted;
};

const variantAttrMap = (variant) => {
  const map = {};
  const attrs = Array.isArray(variant?.attributes) ? variant.attributes : [];
  attrs.forEach((a) => {
    const k = attrKey(a);
    const v = attrVal(a);
    if (k && v) map[k] = v;
  });
  return map;
};

const findVariantByAttrs = (variants = [], wantedAttrs = {}) => {
  const keys = Object.keys(wantedAttrs || {});
  if (!keys.length) return null;

  for (const v of variants || []) {
    const m = variantAttrMap(v);
    let ok = true;
    for (const k of keys) {
      if (m[k] !== wantedAttrs[k]) { ok = false; break; }
    }
    if (ok) return v;
  }
  return null;
};

/* ============================================================
   ✅ CREATE RMA
============================================================ */
export const createRma = async (req, res) => {
  try {
    const orderId = req.params.id;

    const {
      type = "return",
      reason = "other",
      customerNote = "",
      items,
      exchangeTo,
      media = [], // ✅ NEW
    } = req.body || {};

    console.log("📦 [CREATE RMA] Request:", {
      orderId,
      type,
      reason,
      mediaCount: Array.isArray(media) ? media.length : 0,
    });

    if (!isObjectId(orderId)) {
      return badRequest(res, "Invalid order id");
    }

    if (!Array.isArray(items) || !items.length) {
      return badRequest(res, "RMA items missing");
    }

    if (!["return", "exchange"].includes(type)) {
      return badRequest(res, "Invalid RMA type");
    }

    /* ============================================================
       ✅ QC MEDIA
    ============================================================ */

    const normalizedMedia = Array.isArray(media)
      ? media
        .filter((m) => String(m?.url || "").trim())
        .map((m) => ({
          url: String(m.url).trim(),
          publicId: String(m?.publicId || "").trim(),
          resourceType:
            String(m?.resourceType || "image").trim().toLowerCase() ===
              "video"
              ? "video"
              : "image",
          evidenceType: String(m?.evidenceType || "")
            .trim()
            .toLowerCase(),
          uploadedAt: new Date(),
        }))
      : [];

    /*
     * Return requires:
     * front + back + tag
     *
     * Exchange is intentionally not forced here yet,
     * so existing exchange flow does not break.
     */
    if (type === "return") {
      const requiredEvidence = ["front", "back", "tag"];

      const hasAllImages = requiredEvidence.every((evidenceType) =>
        normalizedMedia.some(
          (m) =>
            m.evidenceType === evidenceType &&
            m.resourceType === "image" &&
            m.url
        )
      );

      if (!hasAllImages) {
        return badRequest(
          res,
          "Front, back and tag images are required for return QC"
        );
      }

      // Keep exactly one image of each required type
      const orderedMedia = requiredEvidence.map((evidenceType) =>
        normalizedMedia.find(
          (m) => m.evidenceType === evidenceType
        )
      );

      normalizedMedia.splice(
        0,
        normalizedMedia.length,
        ...orderedMedia
      );
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return notFound(res, "Order not found");
    }

    if (order.fulfillmentStatus !== "delivered") {
      return badRequest(
        res,
        "Return/Exchange allowed only for delivered orders"
      );
    }

    /* ============================================================
       DELIVERY DATE + RMA WINDOW
    ============================================================ */

    const deliveredAt =
      order?.fulfillmentDates?.deliveredAt ||
      order?.shipment?.deliveredAt ||
      order?.trackingDetails?.deliveredAt;

    if (!deliveredAt) {
      return badRequest(
        res,
        "Delivery date missing. Cannot create RMA."
      );
    }

    const deliveredTime = new Date(deliveredAt).getTime();

    if (!Number.isFinite(deliveredTime)) {
      return badRequest(
        res,
        "Invalid delivery date. Cannot create RMA."
      );
    }

    const now = Date.now();

    if (deliveredTime > now) {
      return badRequest(
        res,
        "Invalid delivery date. Delivery date cannot be in the future."
      );
    }

    const expiresAt =
      deliveredTime +
      RMA_POLICY.windowDays * 24 * 60 * 60 * 1000;

    if (now > expiresAt) {
      return badRequest(
        res,
        `Return/Exchange window expired. Allowed within ${RMA_POLICY.windowDays} days.`
      );
    }

    /* ============================================================
       VALIDATE ITEMS
    ============================================================ */

    const remaining = computeRemainingQtyByLineId(order);

    for (const ri of items) {
      const lineId = String(
        ri?.orderLineId || ""
      ).trim();

      const qty = Number(ri?.quantity || 0);
      const rem = remaining.get(lineId);

      if (!lineId) {
        return badRequest(
          res,
          "orderLineId missing"
        );
      }

      if (rem == null) {
        return badRequest(
          res,
          `Invalid orderLineId: ${lineId}`
        );
      }

      if (!Number.isFinite(qty) || qty < 1) {
        return badRequest(
          res,
          "Invalid RMA quantity"
        );
      }

      if (qty > rem) {
        return badRequest(
          res,
          `Qty exceeds remaining for lineId: ${lineId}`
        );
      }
    }

    const rmaItemsSnapshots =
      buildRmaItemsSnapshots(order, items);

    let fee = {
      amount: 0,
      currency: "INR",
      status: "waived",
    };

    let exchangeRequest = null;

    /* ============================================================
       EXCHANGE
    ============================================================ */

    if (type === "exchange") {
      const ex = exchangeTo || {};

      const productId = String(
        ex?.productId || ""
      ).trim();

      if (!isObjectId(productId)) {
        return badRequest(
          res,
          "exchangeTo.productId missing/invalid for exchange"
        );
      }

      let resolvedVariantId = String(
        ex?.variantId || ""
      ).trim();

      let resolvedVariantSku = String(
        ex?.variantSku || ""
      ).trim();

      const attrs = Array.isArray(ex?.attributes)
        ? ex.attributes
        : [];

      const wanted = normalizeWantedAttrs(attrs);

      if (!wanted.size) {
        return badRequest(
          res,
          "exchangeTo.attributes missing size for exchange"
        );
      }

      if (!isObjectId(resolvedVariantId)) {
        const prod = await Product.findById(productId)
          .select("variants")
          .lean();

        if (!prod) {
          return notFound(
            res,
            "Exchange product not found"
          );
        }

        const matched = findVariantByAttrs(
          prod?.variants || [],
          wanted
        );

        if (!matched?._id) {
          return badRequest(
            res,
            "No matching variant found for exchangeTo.attributes"
          );
        }

        resolvedVariantId =
          String(matched._id);

        if (matched?.sku) {
          resolvedVariantSku =
            String(matched.sku);
        }
      }

      if (!isObjectId(resolvedVariantId)) {
        return badRequest(
          res,
          "exchangeTo.variantId missing for exchange"
        );
      }

      const prevExchanges =
        countPreviousExchanges(order);

      const amount =
        computeExchangeFee(prevExchanges);

      fee = {
        amount,
        currency: "INR",
        status:
          amount > 0
            ? "unpaid"
            : "waived",
      };

      exchangeRequest = {
        productId,
        variantId: resolvedVariantId,
        variantSku: resolvedVariantSku,
        attributes: attrs,
        note: String(ex?.note || ""),
      };
    }

    /* ============================================================
       CREATE RMA
    ============================================================ */

    const rmaNumber = makeRmaNumber();

    order.rmas = order.rmas || [];

    order.rmas.push({
      rmaNumber,
      type,
      reason,
      customerNote,

      items: rmaItemsSnapshots,

      // ✅ SAVE QC IMAGES
      media: normalizedMedia,

      status: "requested",
      resolution: "pending",

      isApproved: false,
      isFulfilled: false,
      isExchangeOrderCreated: false,

      fee,
      exchangeRequest,
    });

    order.fulfillmentStatus =
      type === "exchange"
        ? "exchange_requested"
        : "return_requested";

    await order.save();

    const created =
      order.rmas[order.rmas.length - 1];

    console.log("✅ [CREATE RMA] Created:", {
      orderNumber: order.orderNumber,
      rmaNumber: created?.rmaNumber,
      mediaCount: created?.media?.length || 0,
    });

    /* ============================================================
       EMAIL
    ============================================================ */

    try {
      triggerRmaEmails({
        order: order.toObject(),
        rma: created,
        policy: RMA_POLICY,
      });
    } catch (e) {
      console.error(
        "⚠️ [CREATE RMA] triggerRmaEmails failed:",
        e?.message || e
      );
    }

    return res.status(201).json({
      success: true,
      message: "RMA created",
      rma: created,
      orderId: order._id,
      order,
      policy: RMA_POLICY,
    });
  } catch (err) {
    console.error(
      "❌ Create RMA Error:",
      err
    );

    return res.status(500).json({
      success: false,
      message:
        err?.message || "Server error",
    });
  }
};


/* ============================================================
   ✅ UPDATE RMA (Admin)
============================================================ */
export const updateRma = async (req, res) => {
  try {
    const { id, rmaNumber } = req.params;

    if (!isObjectId(id)) {
      return badRequest(res, "Invalid order id");
    }

    if (!rmaNumber) {
      return badRequest(res, "rmaNumber missing");
    }

    const order = await Order.findById(id);

    if (!order) {
      return notFound(res, "Order not found");
    }

    const rma = (order.rmas || []).find(
      (r) =>
        String(r?.rmaNumber) ===
        String(rmaNumber)
    );

    if (!rma) {
      return notFound(res, "RMA not found");
    }

    const prevStatus = String(rma.status || "");
    const prevResolution = String(rma.resolution || "");
    const prevFeeStatus = String(rma?.fee?.status || "");
    const prevFeeAmount = Number(rma?.fee?.amount || 0);

    const {
      status,
      adminNote,
      resolution,
      refund,
      reverseShipment,
      fee,
      isFulfilled,
    } = req.body || {};

    const requestedStatus = normalize(status);

    /* ---------------------------------------------------------
       Approval must ONLY happen through approveRma controller
    --------------------------------------------------------- */
    if (requestedStatus === "approved") {
      return badRequest(
        res,
        "Use the dedicated RMA approval endpoint"
      );
    }

    /* ---------------------------------------------------------
       Actions requiring approval
    --------------------------------------------------------- */
    const postApprovalStatuses = [
      "pickup_scheduled",
      "picked",
      "in_transit",
      "received",
      "qc_pass",
      "qc_fail",
      "refund_initiated",
      "refund_completed",
      "replacement_shipped",
      "closed",
    ];

    const requiresApproval =
      postApprovalStatuses.includes(requestedStatus) ||
      refund != null ||
      reverseShipment != null ||
      typeof isFulfilled === "boolean";

    if (
      requiresApproval &&
      rma.isApproved !== true
    ) {
      return badRequest(
        res,
        "RMA must be approved before performing this action"
      );
    }

    /* ---------------------------------------------------------
       Fee update
    --------------------------------------------------------- */
    if (fee && typeof fee === "object") {
      rma.fee = rma.fee || {
        amount: 0,
        currency: "INR",
        status: "waived",
      };

      if (fee.amount != null) {
        rma.fee.amount = Number(fee.amount || 0);
      }

      if (fee.currency != null) {
        rma.fee.currency =
          String(fee.currency || "INR");
      }

      if (fee.status != null) {
        rma.fee.status =
          normalize(fee.status || "waived");
      }
    }

    /* ---------------------------------------------------------
       Exchange fee safety
    --------------------------------------------------------- */
    if (
      rma.type === "exchange" &&
      Number(rma?.fee?.amount || 0) > 0 &&
      normalize(rma?.fee?.status) !== "paid"
    ) {
      const blockedStatuses = [
        "pickup_scheduled",
        "picked",
        "in_transit",
        "received",
        "qc_pass",
        "qc_fail",
        "replacement_shipped",
        "closed",
      ];

      if (
        requestedStatus &&
        blockedStatuses.includes(requestedStatus)
      ) {
        return badRequest(
          res,
          "Exchange fee unpaid. Cannot proceed until paid."
        );
      }
    }

    /* ---------------------------------------------------------
       Main status
    --------------------------------------------------------- */
    if (requestedStatus === "rejected") {
      rma.status = "rejected";
      rma.isApproved = false;
      rma.statusUpdatedAt = new Date();
    } else if (status) {
      rma.status = requestedStatus;
      rma.statusUpdatedAt = new Date();
    }

    /* ---------------------------------------------------------
       Admin note
    --------------------------------------------------------- */
    if (adminNote != null) {
      rma.adminNote =
        String(adminNote || "");
    }

    /* ---------------------------------------------------------
       Resolution
    --------------------------------------------------------- */
    if (resolution) {
      rma.resolution =
        normalize(resolution);
    }

    /* ---------------------------------------------------------
       Fulfilled
    --------------------------------------------------------- */
    if (typeof isFulfilled === "boolean") {
      rma.isFulfilled = isFulfilled;
    }

    /* ---------------------------------------------------------
       Refund
    --------------------------------------------------------- */
    if (refund && typeof refund === "object") {
      rma.refund = rma.refund || {};

      if (refund.amount != null) {
        rma.refund.amount =
          Number(refund.amount || 0);
      }

      if (refund.mode != null) {
        rma.refund.mode =
          String(refund.mode || "");
      }

      if (refund.status != null) {
        rma.refund.status =
          String(refund.status || "");
      }

      if (refund.referenceId != null) {
        rma.refund.referenceId =
          String(refund.referenceId || "");
      }
    }

    /* ---------------------------------------------------------
       Reverse shipment manual updates
    --------------------------------------------------------- */
    if (
      reverseShipment &&
      typeof reverseShipment === "object"
    ) {
      rma.reverseShipment =
        rma.reverseShipment || {};

      [
        "orderId",
        "shipmentId",
        "awb",
        "courierName",
        "trackingUrl",
      ].forEach((field) => {
        if (reverseShipment[field] != null) {
          rma.reverseShipment[field] =
            String(reverseShipment[field] || "");
        }
      });

      [
        "pickupScheduledAt",
        "pickedAt",
        "receivedAt",
      ].forEach((field) => {
        if (reverseShipment[field] != null) {
          rma.reverseShipment[field] =
            safeDate(reverseShipment[field]);
        }
      });
    }

    order.markModified("rmas");

    await order.save();

    const didStatusChange =
      status &&
      prevStatus !== String(rma.status || "");

    const didResolutionChange =
      resolution &&
      prevResolution !==
      String(rma.resolution || "");

    const didFeeChange =
      fee &&
      (
        prevFeeStatus !==
        String(rma?.fee?.status || "") ||
        prevFeeAmount !==
        Number(rma?.fee?.amount || 0)
      );

    if (
      didStatusChange ||
      didResolutionChange ||
      didFeeChange
    ) {
      try {
        triggerRmaEmails({
          order: order.toObject(),
          rma:
            typeof rma.toObject === "function"
              ? rma.toObject()
              : rma,
          policy: RMA_POLICY,
        });
      } catch (e) {
        console.error(
          "⚠️ [UPDATE RMA] triggerRmaEmails failed:",
          e?.message || e
        );
      }
    }

    return res.status(200).json({
      success: true,
      message: "RMA updated",
      rma,
      order,
    });
  } catch (err) {
    console.error(
      "❌ Update RMA Error:",
      err
    );

    return res.status(500).json({
      success: false,
      message:
        err?.message ||
        "RMA update failed",
    });
  }
};

/* ============================================================
   ✅ GET RMAs by Order
============================================================ */
export const getRmasByOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).lean();

    if (!order) {
      return notFound(res, "Order not found");
    }

    const rmas = (order.rmas || []).map((rma) => ({
      ...rma,

      // RMA
      // RMA
      isApproved: rma?.isApproved === true,
      isFulfilled: Boolean(rma?.isFulfilled),
      // Order status
      fulfillmentStatus:
        order?.fulfillmentStatus || "",

      fulfillmentDates:
        order?.fulfillmentDates || null,

      // Refund automation
      eligibleForRefund:
        order?.eligibleForRefund === true,

      isRefunded:
        order?.isRefunded === true,

      refundSummary:
        order?.refundSummary || null,

      refundEligibleAmount:
        Number(
          order?.refundSummary?.eligibleAmount ||
          rma?.refund?.amount ||
          0
        ),

      // Reverse pickup automation
      returnPickupCompleted:
        Boolean(
          order?.fulfillmentDates
            ?.returnPickupCompletedAt ||
          order?.fulfillmentStatus ===
          "return_pickup_completed"
        ),

      returnPickupCompletedAt:
        order?.fulfillmentDates
          ?.returnPickupCompletedAt || null,
    }));

    return res.status(200).json({
      rmas,
    });
  } catch (err) {
    return res.status(500).json({
      message: err.message || "Server error",
    });
  }
};;

/* ============================================================
   ✅ GET single RMA
============================================================ */
export const getRmaByNumber = async (req, res) => {
  try {
    const order = await Order.findById(
      req.params.id
    ).lean();

    if (!order) {
      return notFound(res, "Order not found");
    }

    const rma = (order.rmas || []).find(
      (item) =>
        String(item.rmaNumber) ===
        String(req.params.rmaNumber)
    );

    if (!rma) {
      return notFound(res, "RMA not found");
    }

    return res.status(200).json({
      rma: {
        ...rma,

        // RMA
        isFulfilled:
          Boolean(rma?.isFulfilled),

        // Order status
        fulfillmentStatus:
          order?.fulfillmentStatus || "",

        fulfillmentDates:
          order?.fulfillmentDates || null,

        // Refund automation
        eligibleForRefund:
          order?.eligibleForRefund === true,

        isRefunded:
          order?.isRefunded === true,

        refundSummary:
          order?.refundSummary || null,

        refundEligibleAmount:
          Number(
            order?.refundSummary
              ?.eligibleAmount ||
            rma?.refund?.amount ||
            0
          ),

        // Reverse pickup automation
        returnPickupCompleted:
          Boolean(
            order?.fulfillmentDates
              ?.returnPickupCompletedAt ||
            order?.fulfillmentStatus ===
            "return_pickup_completed"
          ),

        returnPickupCompletedAt:
          order?.fulfillmentDates
            ?.returnPickupCompletedAt || null,
      },
    });
  } catch (err) {
    return res.status(500).json({
      message: err.message || "Server error",
    });
  }
};

/* ============================================================
   ✅ GET All RMAs (Admin)
============================================================ */
/* ============================================================
   ✅ GET All RMAs (Admin)
============================================================ */
export const getAllRmasAdmin = async (req, res) => {
  try {
    const {
      status,
      type,
      search,
      isFulfilled,
    } = req.query;

    const match = {
      rmas: { $exists: true, $ne: [] },
    };

    if (status) {
      match["rmas.status"] = normalize(status);
    }

    if (type) {
      match["rmas.type"] = normalize(type);
    }

    if (isFulfilled === "true") {
      match["rmas.isFulfilled"] = true;
    }

    if (isFulfilled === "false") {
      match["rmas.isFulfilled"] = { $ne: true };
    }

    const orders = await Order.find(match)
      .populate(
        "customerId",
        "name email phone payoutDetails credits"
      )
      .sort({ createdAt: -1 })
      .lean();

    const allRmas = [];

    for (const order of orders) {
      for (const rma of order.rmas || []) {
        if (
          status &&
          normalize(rma?.status) !== normalize(status)
        ) {
          continue;
        }

        if (
          type &&
          normalize(rma?.type) !== normalize(type)
        ) {
          continue;
        }

        if (
          isFulfilled === "true" &&
          rma?.isFulfilled !== true
        ) {
          continue;
        }

        if (
          isFulfilled === "false" &&
          rma?.isFulfilled === true
        ) {
          continue;
        }

        if (search) {
          const q = normalize(search);

          const values = [
            order.orderNumber,
            rma.rmaNumber,
            order.customerId?.name,
            order.customerId?.email,
            order.customerId?.phone,
            order.shippingAddressSnapshot?.fullName,
            order.shippingAddressSnapshot?.email,
            order.shippingAddressSnapshot?.phone,
          ]
            .filter(Boolean)
            .map(normalize);

          if (!values.some((v) => v.includes(q))) {
            continue;
          }
        }

        // ✅ RMA-level pickup
        const returnPickupCompletedAt =
          rma?.reverseShipment?.pickedAt || null;

        const returnPickupCompleted =
          rma?.returnPickupCompleted === true;

        // ✅ RMA-level refund
        const eligibleForRefund =
          rma?.eligibleForRefund === true;

        const refundEligibleAmount =
          Number(rma?.refund?.amount || 0);

        allRmas.push({
          ...rma,

          // RMA
          // RMA
          isApproved:
            rma?.isApproved === true,

          // RMA
          isApproved:
            rma?.isApproved === true,

          isFulfilled:
            rma?.isFulfilled === true,

          isExchangeOrderCreated:
            rma?.isExchangeOrderCreated === true,

          returnPickupCompleted,
          returnPickupCompletedAt,

          eligibleForRefund,
          refundEligibleAmount,

          // Exchange
          hasExchangeOrder:
            order?.hasExchangeOrder === true,

          isExchangeOrder:
            order?.isExchangeOrder === true,

          // Order
          orderId: order._id,
          orderNumber: order.orderNumber,

          // Customer
          customer:
            order.customerId || null,

          shippingAddressSnapshot:
            order.shippingAddressSnapshot || null,

          // Items
          orderItems:
            order.items || [],

          // Money
          subtotal:
            Number(order.subtotal || 0),

          discount:
            Number(order.discount || 0),

          shippingFee:
            Number(order.shippingFee || 0),

          tax:
            Number(order.tax || 0),

          totalAmount:
            Number(order.totalAmount || 0),

          finalPayable:
            Number(order.finalPayable || 0),

          currency:
            order.currency || "INR",

          // Payment
          paymentMethod:
            order.paymentMethod || "",

          paymentStatus:
            order.paymentStatus || "",

          // Order fulfillment stays separate
          fulfillmentStatus:
            order.fulfillmentStatus || "",

          fulfillmentDates:
            order.fulfillmentDates || null,

          // Order-level refund summary
          refundSummary:
            order?.refundSummary || null,

          isRefunded:
            rma?.refund?.status === "completed" ||
            order?.isRefunded === true,

          // Shipping
          shipment:
            order.shipment || null,

          trackingDetails:
            order.trackingDetails || null,

          // Dates
          orderDate:
            order.orderDate || order.createdAt,

          orderCreatedAt:
            order.createdAt,
        });
      }
    }

    allRmas.sort(
      (a, b) =>
        new Date(b.createdAt || 0).getTime() -
        new Date(a.createdAt || 0).getTime()
    );

    return res.status(200).json({
      rmas: allRmas,
      count: allRmas.length,
    });
  } catch (err) {
    console.error(
      "❌ Fetch All RMAs Error:",
      err
    );

    return res.status(500).json({
      message:
        err.message || "Server error",
    });
  }
};


export const refundRmaToCredit = async (req, res) => {
  try {
    const { id, rmaNumber } = req.params;

    const order = await Order.findById(id);

    if (!rma) {
      return res.status(404).json({
        message: "RMA not found",
      });
    }

    if (rma.isApproved !== true) {
      return res.status(400).json({
        success: false,
        message: "RMA must be approved before refund",
      });
    }

    const rma = order.rmas?.find(
      (x) => String(x?.rmaNumber) === String(rmaNumber)
    );

    if (!rma) {
      return res.status(404).json({
        message: "RMA not found",
      });
    }

    if (!rma.returnPickupCompleted) {
      return res.status(400).json({
        message: "Return pickup is not completed",
      });
    }

    if (!rma.eligibleForRefund) {
      return res.status(400).json({
        message: "RMA is not eligible for refund",
      });
    }

    if (rma.refund?.status === "completed") {
      return res.status(400).json({
        message: "This RMA is already refunded",
      });
    }

    const eligibleAmount = Number(
      rma?.refund?.amount || 0
    );

    const requestedDeduction = Math.max(
      0,
      Number(req.body?.deduction || 0)
    );

    const deduction = Math.min(
      requestedDeduction,
      eligibleAmount
    );

    const refundAmount = Math.max(
      0,
      eligibleAmount - deduction
    );

    if (refundAmount <= 0) {
      return res.status(400).json({
        message: "Refund amount is zero after deduction",
      });
    }

    const customer = await Customer.findById(
      order.customerId
    );

    if (!customer) {
      return res.status(404).json({
        message: "Customer not found",
      });
    }

    customer.credits = customer.credits || {};

    customer.credits.balance = Number(
      customer.credits.balance || 0
    );

    customer.credits.totalCredited = Number(
      customer.credits.totalCredited || 0
    );

    customer.credits.totalRefundCredits = Number(
      customer.credits.totalRefundCredits || 0
    );

    customer.credits.logs = Array.isArray(
      customer.credits.logs
    )
      ? customer.credits.logs
      : [];

    const now = new Date();

    const creditId =
      `CR-${Date.now()}-${Math.floor(
        Math.random() * 10000
      )}`;

    const newBalance =
      customer.credits.balance + refundAmount;

    customer.credits.balance = newBalance;
    customer.credits.totalCredited += refundAmount;
    customer.credits.totalRefundCredits += refundAmount;
    customer.credits.lastCreditAt = now;

    customer.credits.logs.unshift({
      creditId,
      transactionType: "credit",
      type: "refund",

      amount: refundAmount,
      balanceAfterTransaction: newBalance,

      reason: "RMA refund",

      notes:
        deduction > 0
          ? `RMA ${rma.rmaNumber} | ₹${deduction} deduction`
          : `RMA ${rma.rmaNumber} | No deduction`,

      orderId: order._id,
      orderNumber: order.orderNumber,

      addedBy: "admin",
      createdAt: now,
    });

    customer.credits.logs =
      customer.credits.logs.slice(0, 300);

    /* ==============================
       RMA REFUND COMPLETE
    ============================== */

    rma.refund.amount = refundAmount;
    rma.refund.mode = "source";
    rma.refund.status = "completed";
    rma.refund.referenceId = creditId;

    rma.status = "refund_completed";
    rma.eligibleForRefund = false;

    await customer.save();
    await order.save();

    /* ==============================
       NOTIFICATIONS
    ============================== */

    const jobs = [];

    if (customer.email) {
      jobs.push(
        Mailer.sendCustomerCreditCredited({
          to: customer.email,
          name: customer.name || "Customer",

          amount: refundAmount,
          balance: newBalance,

          orderNumber: order.orderNumber,
          creditId,

          reason: "Refund",
          creditedAt: now,

          ctaUrl:
            `${process.env.CLIENT_URL || "https://oatclub.in"}/account`,
        })
      );
    }

    if (customer.phone) {
      jobs.push(
        sendCustomerCreditWhatsapp({
          phone: customer.phone,

          customerName:
            customer.name || "Customer",

          amount: refundAmount,
          creditId,
        })
      );
    }

    if (jobs.length) {
      Promise.allSettled(jobs).catch(() => { });
    }

    return res.status(200).json({
      success: true,

      message:
        `₹${refundAmount} refunded to customer credit`,

      refund: {
        eligibleAmount,
        deduction,
        refundAmount,
        creditId,
        status: "completed",
      },

      credits: {
        balance: newBalance,
      },
    });
  } catch (err) {
    console.error(
      "❌ RMA Credit Refund Error:",
      err
    );

    return res.status(500).json({
      message:
        err.message || "Refund failed",
    });
  }
};


/* ============================================================
   ✅ APPROVE RMA
   - Admin approval gate
   - Reverse pickup starts ONLY after approval
============================================================ */
/* ============================================================
   ✅ APPROVE RMA
   RETURN:
   - approve
   - reverse pickup

   EXCHANGE:
   - approve
   - reverse pickup
   - create duplicate -E order
============================================================ */
export const approveRma = async (req, res) => {
  try {
    const { id, rmaNumber } = req.params;

    if (!isObjectId(id)) {
      return badRequest(res, "Invalid order id");
    }

    const order = await Order.findById(id);

    if (!order) {
      return notFound(res, "Order not found");
    }

    const rma = (order.rmas || []).find(
      (r) =>
        String(r?.rmaNumber) ===
        String(rmaNumber)
    );

    if (!rma) {
      return notFound(res, "RMA not found");
    }

    if (rma.status === "rejected") {
      return badRequest(
        res,
        "Rejected RMA cannot be approved"
      );
    }

    if (
      rma.type === "exchange" &&
      Number(rma?.fee?.amount || 0) > 0 &&
      normalize(rma?.fee?.status) !== "paid"
    ) {
      return badRequest(
        res,
        "Exchange fee must be paid before approval"
      );
    }

    /* ========================================================
       1. APPROVE RMA
    ======================================================== */

    if (rma.isApproved !== true) {
      rma.isApproved = true;
      rma.status = "approved";
      rma.statusUpdatedAt = new Date();

      if (req.body?.adminNote != null) {
        rma.adminNote = String(
          req.body.adminNote || ""
        );
      }

      order.markModified("rmas");
      await order.save();
    }

    /* ========================================================
       2. CREATE REVERSE PICKUP
       BOTH RETURN + EXCHANGE
    ======================================================== */

    let pickupResult = {
      success: false,
      alreadyCreated: false,
    };

    const alreadyBooked =
      rma?.reverseShipment?.orderId ||
      rma?.reverseShipment?.shipmentId ||
      rma?.reverseShipment?.awb;

    if (alreadyBooked) {
      pickupResult = {
        success: true,
        alreadyCreated: true,
        awb: rma?.reverseShipment?.awb || "",
      };
    } else {
      try {
        const payload =
          buildReverseShiprocketPayload({
            order,
            rma,
          });

        // ✅ QC OFF
        payload.order_items = (
          payload.order_items || []
        ).map(
          ({
            qc_enable,
            qc_product_name,
            qc_brand,
            qc_product_image,
            ...item
          }) => item
        );

        const result =
          await createReturnOrder(payload);

        const reverseOrderId = String(
          result?.order_id ||
          result?.id ||
          ""
        );

        const shipmentId = String(
          result?.shipment_id ||
          result?.shipment?.id ||
          ""
        );

        const awb = String(
          result?.awb_code ||
          result?.awb ||
          result?.shipment?.awb_code ||
          ""
        );

        if (!reverseOrderId && !shipmentId) {
          throw new Error(
            result?.message ||
            result?.error ||
            "Reverse pickup creation failed"
          );
        }

        const now = new Date();

        rma.reverseShipment =
          rma.reverseShipment || {};

        rma.reverseShipment.provider =
          "shiprocket";

        rma.reverseShipment.orderId =
          reverseOrderId;

        rma.reverseShipment.shipmentId =
          shipmentId;

        rma.reverseShipment.awb = awb;

        rma.reverseShipment.courierName =
          String(
            result?.courier_name ||
            result?.courier ||
            ""
          );

        rma.reverseShipment.trackingUrl =
          String(
            result?.tracking_url || ""
          );

        rma.reverseShipment.status =
          awb
            ? "pickup_scheduled"
            : "return_order_created";

        rma.reverseShipment.pickupScheduledAt =
          awb ? now : null;

        rma.reverseShipment.lastSyncedAt = now;

        if (awb) {
          rma.status = "pickup_scheduled";
        }

        order.markModified("rmas");
        await order.save();

        pickupResult = {
          success: true,
          alreadyCreated: false,
          orderId: reverseOrderId,
          shipmentId,
          awb,
        };
      } catch (error) {
        console.error(
          "⚠️ Reverse pickup creation failed:",
          error?.response?.data ||
          error?.message ||
          error
        );

        rma.reverseShipment =
          rma.reverseShipment || {};

        rma.reverseShipment.status =
          "booking_failed";

        rma.reverseShipment.bookingError = {
          step: "create_return_order",
          message:
            error?.response?.data?.message ||
            error?.message ||
            "Reverse pickup failed",
          occurredAt: new Date(),
        };

        order.markModified("rmas");
        await order.save();

        pickupResult = {
          success: false,
          error:
            error?.response?.data?.message ||
            error?.message ||
            "Reverse pickup failed",
        };
      }
    }

    /* ========================================================
       3. EXCHANGE ONLY → CREATE -E ORDER
    ======================================================== */

    let exchangeOrder = null;
    let exchangeOrderError = null;

    if (
      rma.type === "exchange" &&
      rma.isExchangeOrderCreated !== true
    ) {
      try {
        exchangeOrder =
          await createExchangeOrderFromRmaInternal({
            orderId: order._id,
            rmaNumber: rma.rmaNumber,
            adminId:
              req.user?._id || "admin",
          });

        console.log(
          "✅ Exchange replacement created:",
          exchangeOrder?.orderNumber
        );
      } catch (error) {
        exchangeOrderError =
          error?.message ||
          "Exchange order creation failed";

        console.error(
          "⚠️ Exchange order creation failed:",
          error
        );
      }
    }

    /* ========================================================
       4. RETURN DOES NOTHING ELSE
    ======================================================== */

    const freshOrder = await Order.findById(
      order._id
    ).lean();

    const freshRma = (
      freshOrder?.rmas || []
    ).find(
      (x) =>
        String(x?.rmaNumber) ===
        String(rmaNumber)
    );

    try {
      triggerRmaEmails({
        order: freshOrder,
        rma: freshRma,
        policy: RMA_POLICY,
      });
    } catch (error) {
      console.error(
        "⚠️ RMA approval email failed:",
        error?.message || error
      );
    }

    return res.status(200).json({
      success: true,

      message:
        rma.type === "exchange"
          ? "Exchange RMA approved"
          : "Return RMA approved",

      type: rma.type,

      rma: freshRma,

      reversePickup: pickupResult,

      exchangeOrder:
        rma.type === "exchange"
          ? exchangeOrder
          : null,

      exchangeOrderError:
        rma.type === "exchange"
          ? exchangeOrderError
          : null,
    });
  } catch (error) {
    console.error(
      "❌ Approve RMA Error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error?.message ||
        "Failed to approve RMA",
    });
  }
};
