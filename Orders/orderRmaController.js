import mongoose from "mongoose";
import Product from "../Products/Products.js";
import Order from "./Orders.js";
import { triggerRmaEmails } from "./order.emails.js";

import Customer from "../Customer/Customer.js";
import { Mailer } from "../nodemailer/mailer.js";
import { sendCustomerCreditWhatsapp } from "../fast2sms/fast2sms.whatsapp.js";
import {
  createExchangeOrderFromRmaInternal,
} from "./orderController.js";

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

const calculateRmaRefundAmount = (order, rma) => {
  const savedAmount = Number(rma?.refund?.amount);

  if (Number.isFinite(savedAmount) && savedAmount > 0) {
    return Math.round(savedAmount * 100) / 100;
  }

  const orderItems = Array.isArray(order?.items)
    ? order.items
    : [];

  const rmaItems = Array.isArray(rma?.items)
    ? rma.items
    : [];

  if (!rmaItems.length) return 0;

  let amount = 0;
  const quantities = new Map();

  for (const item of rmaItems) {
    const lineId = String(item?.orderLineId || "").trim();

    let index = lineId
      ? orderItems.findIndex(
        (line) => String(line?.lineId || "") === lineId
      )
      : -1;

    // Legacy fallback only when no stable line ID exists.
    if (
      index < 0 &&
      !lineId &&
      Number.isInteger(item?.orderItemIndex)
    ) {
      index = item.orderItemIndex;
    }

    const matched = orderItems[index];

    if (!matched) return 0;

    const orderedQty = Number(matched.quantity);
    const returnQty = Number(item.quantity);
    const lineSubtotal = Number(matched.subtotal);

    if (
      !Number.isInteger(orderedQty) ||
      !Number.isInteger(returnQty) ||
      orderedQty <= 0 ||
      returnQty <= 0 ||
      !Number.isFinite(lineSubtotal) ||
      lineSubtotal < 0
    ) {
      return 0;
    }

    const totalReturned =
      (quantities.get(index) || 0) + returnQty;

    if (totalReturned > orderedQty) return 0;

    quantities.set(index, totalReturned);

    // Uses the purchased line subtotal, including its
    // allocated discount, proportionate to returned quantity.
    amount += (lineSubtotal / orderedQty) * returnQty;
  }

  return Math.round(amount * 100) / 100;
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
      adminNote = "",
      allowException = false,
      exceptionReason = "",
      items,
      exchangeTo,
      media = [],
    } = req.body || {};

    const isAdminCreation =
      req.isAdminRmaCreation === true;

    const isAdminException =
      isAdminCreation &&
      req.allowRmaException === true &&
      allowException === true;

    console.log("📦 [CREATE RMA] Request:", {
      orderId,
      type,
      reason,
      isAdminCreation,
      isAdminException,
      mediaCount: Array.isArray(media)
        ? media.length
        : 0,
    });

    if (!isObjectId(orderId)) {
      return badRequest(
        res,
        "Invalid order id"
      );
    }

    if (
      !Array.isArray(items) ||
      !items.length
    ) {
      return badRequest(
        res,
        "RMA items missing"
      );
    }

    if (
      !["return", "exchange"].includes(type)
    ) {
      return badRequest(
        res,
        "Invalid RMA type"
      );
    }

    if (
      isAdminException &&
      !String(exceptionReason || "").trim()
    ) {
      return badRequest(
        res,
        "Exception reason is required"
      );
    }

    /* ============================================================
       QC MEDIA
    ============================================================ */

    const normalizedMedia = Array.isArray(media)
      ? media
        .filter((item) =>
          String(item?.url || "").trim()
        )
        .map((item) => ({
          url: String(item.url).trim(),

          publicId: String(
            item?.publicId || ""
          ).trim(),

          resourceType:
            String(
              item?.resourceType || "image"
            )
              .trim()
              .toLowerCase() === "video"
              ? "video"
              : "image",

          evidenceType: String(
            item?.evidenceType || ""
          )
            .trim()
            .toLowerCase(),

          uploadedAt: new Date(),
        }))
      : [];

    /*
     * Customer return requires front, back and
     * tag images. Admin RMA does not require media.
     */
    if (
      type === "return" &&
      !isAdminCreation
    ) {
      const requiredEvidence = [
        "front",
        "back",
        "tag",
      ];

      const hasAllImages =
        requiredEvidence.every(
          (evidenceType) =>
            normalizedMedia.some(
              (item) =>
                item.evidenceType ===
                evidenceType &&
                item.resourceType ===
                "image" &&
                item.url
            )
        );

      if (!hasAllImages) {
        return badRequest(
          res,
          "Front, back and tag images are required for return QC"
        );
      }

      const orderedMedia =
        requiredEvidence.map(
          (evidenceType) =>
            normalizedMedia.find(
              (item) =>
                item.evidenceType ===
                evidenceType
            )
        );

      normalizedMedia.splice(
        0,
        normalizedMedia.length,
        ...orderedMedia
      );
    }

    const order =
      await Order.findById(orderId);

    if (!order) {
      return notFound(
        res,
        "Order not found"
      );
    }

    if (
      order.fulfillmentStatus !==
      "delivered"
    ) {
      return badRequest(
        res,
        "Return/Exchange allowed only for delivered orders"
      );
    }

    /* ============================================================
       DELIVERY DATE + RMA WINDOW
       Admin exception bypasses date validation
    ============================================================ */

    const deliveredAt =
      order?.fulfillmentDates
        ?.deliveredAt ||
      order?.shipment?.deliveredAt ||
      order?.trackingDetails?.deliveredAt;

    if (!isAdminException) {
      if (!deliveredAt) {
        return badRequest(
          res,
          "Delivery date missing. Cannot create RMA."
        );
      }

      const deliveredTime =
        new Date(deliveredAt).getTime();

      if (
        !Number.isFinite(deliveredTime)
      ) {
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
        RMA_POLICY.windowDays *
        24 *
        60 *
        60 *
        1000;

      if (now > expiresAt) {
        return badRequest(
          res,
          `Return/Exchange window expired. Allowed within ${RMA_POLICY.windowDays} days.`
        );
      }
    }

    /* ============================================================
       VALIDATE ITEMS
    ============================================================ */

    const remaining =
      computeRemainingQtyByLineId(order);

    for (const item of items) {
      const lineId = String(
        item?.orderLineId || ""
      ).trim();

      const quantity = Number(
        item?.quantity || 0
      );

      const remainingQuantity =
        remaining.get(lineId);

      if (!lineId) {
        return badRequest(
          res,
          "orderLineId missing"
        );
      }

      if (remainingQuantity == null) {
        return badRequest(
          res,
          `Invalid orderLineId: ${lineId}`
        );
      }

      if (
        !Number.isFinite(quantity) ||
        quantity < 1
      ) {
        return badRequest(
          res,
          "Invalid RMA quantity"
        );
      }

      if (
        quantity > remainingQuantity
      ) {
        return badRequest(
          res,
          `Qty exceeds remaining for lineId: ${lineId}`
        );
      }
    }

    const rmaItemsSnapshots =
      buildRmaItemsSnapshots(
        order,
        items
      );

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
      const exchange =
        exchangeTo || {};

      const productId = String(
        exchange?.productId || ""
      ).trim();

      if (!isObjectId(productId)) {
        return badRequest(
          res,
          "exchangeTo.productId missing/invalid for exchange"
        );
      }

      let resolvedVariantId =
        String(
          exchange?.variantId || ""
        ).trim();

      let resolvedVariantSku =
        String(
          exchange?.variantSku || ""
        ).trim();

      const attributes =
        Array.isArray(
          exchange?.attributes
        )
          ? exchange.attributes
          : [];

      const wantedAttributes =
        normalizeWantedAttrs(
          attributes
        );

      if (!wantedAttributes.size) {
        return badRequest(
          res,
          "exchangeTo.attributes missing size for exchange"
        );
      }

      if (
        !isObjectId(resolvedVariantId)
      ) {
        const product =
          await Product.findById(
            productId
          )
            .select("variants")
            .lean();

        if (!product) {
          return notFound(
            res,
            "Exchange product not found"
          );
        }

        const matchedVariant =
          findVariantByAttrs(
            product?.variants || [],
            wantedAttributes
          );

        if (!matchedVariant?._id) {
          return badRequest(
            res,
            "No matching variant found for exchangeTo.attributes"
          );
        }

        resolvedVariantId = String(
          matchedVariant._id
        );

        if (matchedVariant?.sku) {
          resolvedVariantSku =
            String(
              matchedVariant.sku
            );
        }
      }

      if (
        !isObjectId(resolvedVariantId)
      ) {
        return badRequest(
          res,
          "exchangeTo.variantId missing for exchange"
        );
      }

      const previousExchanges =
        countPreviousExchanges(order);

      const amount =
        computeExchangeFee(
          previousExchanges
        );

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
        variantId:
          resolvedVariantId,
        variantSku:
          resolvedVariantSku,
        attributes,
        note: String(
          exchange?.note || ""
        ).trim(),
      };
    }

    /* ============================================================
       CREATE RMA
    ============================================================ */

    const rmaNumber =
      makeRmaNumber();

    order.rmas =
      order.rmas || [];

    order.rmas.push({
      rmaNumber,
      type,
      reason,

      customerNote: String(
        customerNote || ""
      ).trim(),

      adminNote: isAdminCreation
        ? String(
          adminNote || ""
        ).trim()
        : "",

      allowException:
        isAdminException,

      exceptionReason:
        isAdminException
          ? String(
            exceptionReason || ""
          ).trim()
          : "",

      exceptionAllowedAt:
        isAdminException
          ? new Date()
          : null,

      exceptionAllowedBy:
        isAdminException &&
          isObjectId(req.user?._id)
          ? req.user._id
          : null,

      items:
        rmaItemsSnapshots,

      media:
        normalizedMedia,

      status: "requested",
      resolution: "pending",

      isApproved: false,
      isFulfilled: false,

      isExchangeOrderCreated:
        false,

      fee,
      exchangeRequest,
    });

    order.fulfillmentStatus =
      type === "exchange"
        ? "exchange_requested"
        : "return_requested";

    await order.save();

    const created =
      order.rmas[
      order.rmas.length - 1
      ];

    console.log(
      "✅ [CREATE RMA] Created:",
      {
        orderNumber:
          order.orderNumber,

        rmaNumber:
          created?.rmaNumber,

        isAdminCreation,
        isAdminException,

        mediaCount:
          created?.media
            ?.length || 0,
      }
    );

    /* ============================================================
       EMAIL
    ============================================================ */

    try {
      triggerRmaEmails({
        order: order.toObject(),
        rma: created,
        policy: RMA_POLICY,
      });
    } catch (error) {
      console.error(
        "⚠️ [CREATE RMA] triggerRmaEmails failed:",
        error?.message || error
      );
    }

    return res
      .status(201)
      .json({
        success: true,

        message:
          isAdminException
            ? "Exception RMA created"
            : "RMA created",

        rma: created,
        orderId: order._id,
        order,
        policy: RMA_POLICY,
      });
  } catch (error) {
    console.error(
      "❌ Create RMA Error:",
      error
    );

    return res
      .status(500)
      .json({
        success: false,
        message:
          error?.message ||
          "Server error",
      });
  }
};

/* ============================================================
   ✅ CREATE RMA (ADMIN — PHOTOS OPTIONAL)
   Supports both return and exchange
============================================================ */
/* ============================================================
   ✅ CREATE RMA (ADMIN)
   - Photos optional
   - Supports return and exchange
   - Can bypass RMA date window using allowException
============================================================ */
export const createAdminController = async (
  req,
  res
) => {
  try {
    const allowException =
      req.body?.allowException === true;

    /*
     * Internal server flags.
     * Customer cannot enable these through normal createRma route.
     */
    req.isAdminRmaCreation = true;
    req.allowRmaException = allowException;

    return await createRma(req, res);
  } catch (error) {
    console.error(
      "❌ Create Admin RMA Error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error?.message ||
        "Unable to create admin RMA",
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

      refundEligibleAmount: calculateRmaRefundAmount(order, rma),

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

        refundEligibleAmount: calculateRmaRefundAmount(order, rma),

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
          calculateRmaRefundAmount(order, rma);
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
  let session;

  const fail = (statusCode, message) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    throw error;
  };

  const lower = (value) =>
    String(value || "").trim().toLowerCase();

  const number = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const round = (value) =>
    Math.round(value * 100) / 100;

  try {
    const { id, rmaNumber } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      fail(400, "Invalid order ID");
    }

    const requestedDeduction = Number(
      req.body?.deduction ?? 0
    );

    if (
      !Number.isFinite(requestedDeduction) ||
      requestedDeduction < 0 ||
      requestedDeduction > 100
    ) {
      fail(400, "Deduction must be between ₹0 and ₹100");
    }

    session = await Order.db.startSession();

    let result;
    let notification;

    await session.withTransaction(async () => {
      // Transaction callbacks can retry.
      result = null;
      notification = null;

      const order = await Order.findById(id).session(session);

      if (!order) {
        fail(404, "Order not found");
      }

      const rma = order.rmas?.find(
        (item) =>
          String(item?.rmaNumber) === String(rmaNumber)
      );

      if (!rma) {
        fail(404, "RMA not found");
      }

      if (
        lower(rma.refund?.status) === "completed" ||
        lower(rma.status) === "refund_completed"
      ) {
        fail(409, "This RMA is already refunded");
      }

      if (lower(rma.refund?.status) === "initiated") {
        fail(409, "A refund is already initiated for this RMA");
      }

      if (lower(rma.type) !== "return") {
        fail(400, "Wallet refund is available for return RMAs");
      }

      if (rma.isApproved !== true) {
        fail(400, "RMA must be approved before refund");
      }

      if (rma.isFulfilled === true) {
        fail(400, "This RMA is already fulfilled");
      }

      const pickupCompleted =
        rma.returnPickupCompleted === true ||
        Boolean(rma.reverseShipment?.pickedAt) ||
        ["picked", "in_transit", "received"].includes(
          lower(rma.reverseShipment?.status)
        );

      if (!pickupCompleted) {
        fail(400, "Return pickup is not completed");
      }

      // Use the saved RMA-specific amount.
      // Do not substitute the full order amount for a partial return.
      const eligibleAmount = calculateRmaRefundAmount(
        order,
        rma
      );

      if (eligibleAmount <= 0) {
        fail(
          400,
          "Set a valid refund amount on this RMA before crediting"
        );
      }

      const deduction = round(
        Math.min(requestedDeduction, eligibleAmount)
      );

      const refundAmount = round(
        eligibleAmount - deduction
      );

      if (refundAmount <= 0) {
        fail(400, "Refund amount is zero after deduction");
      }

      const customer = await Customer.findById(
        order.customerId
      ).session(session);

      if (!customer) {
        fail(404, "Customer not found");
      }

      customer.credits = customer.credits || {};

      const logs = Array.isArray(customer.credits.logs)
        ? customer.credits.logs
        : [];

      // Additional check for an existing credit for this RMA.
      const existingCredit = logs.find(
        (log) =>
          log.transactionType === "credit" &&
          log.type === "refund" &&
          String(log.orderId || "") === String(order._id) &&
          String(log.notes || "").split(" | ")[0] ===
          `RMA ${rma.rmaNumber}`
      );

      if (existingCredit) {
        fail(
          409,
          "A wallet credit already exists for this RMA. Verify its refund record before retrying."
        );
      }

      const now = new Date();

      const creditId =
        `CR-${new mongoose.Types.ObjectId().toString()}`;

      const newBalance = round(
        number(customer.credits.balance) + refundAmount
      );

      const log = {
        creditId,
        transactionType: "credit",
        type: "refund",
        amount: refundAmount,
        balanceAfterTransaction: newBalance,
        reason: "RMA refund",
        notes:
          `RMA ${rma.rmaNumber} | ` +
          `Eligible ₹${eligibleAmount} | ` +
          `Deduction ₹${deduction} | Wallet credit`,
        orderId: order._id,
        orderNumber: order.orderNumber,
        addedBy: "admin",
        createdAt: now,
      };

      customer.credits.balance = newBalance;

      customer.credits.totalCredited = round(
        number(customer.credits.totalCredited) + refundAmount
      );

      customer.credits.totalRefundCredits = round(
        number(customer.credits.totalRefundCredits) +
        refundAmount
      );

      customer.credits.lastCreditAt = now;
      customer.credits.logs = [log, ...logs].slice(0, 300);

      customer.analytics = customer.analytics || {};

      customer.analytics.walletCreditsEarned = round(
        number(customer.analytics.walletCreditsEarned) +
        refundAmount
      );

      rma.refund = {
        amount: refundAmount,
        mode: "manual",
        status: "completed",
        referenceId: creditId,
      };

      rma.returnPickupCompleted = true;
      rma.status = "refund_completed";
      rma.eligibleForRefund = false;

      // Fulfillment remains a separate manual action.
      customer.markModified("credits");
      customer.markModified("analytics");
      order.markModified("rmas");

      await customer.save({ session });
      await order.save({ session });

      const plainRma = rma.toObject();

      result = {
        success: true,
        message: `₹${refundAmount} refunded to customer credit`,
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
        rma: {
          ...plainRma,
          orderId: order._id,
          orderNumber: order.orderNumber,
          refundEligibleAmount: calculateRmaRefundAmount(order, rma),          isRefunded: true,
        },
      };

      notification = {
        email: customer.email,
        phone: customer.phone,
        name: customer.name || "Customer",
        amount: refundAmount,
        balance: newBalance,
        orderNumber: order.orderNumber,
        creditId,
        creditedAt: now,
      };
    });

    // Run only after the transaction commits.
    // Promise wrappers also catch synchronous notification errors.
    const jobs = [];

    if (notification?.email) {
      jobs.push(
        Promise.resolve().then(() =>
          Mailer.sendCustomerCreditCredited({
            to: notification.email,
            name: notification.name,
            amount: notification.amount,
            balance: notification.balance,
            orderNumber: notification.orderNumber,
            creditId: notification.creditId,
            reason: "Refund",
            creditedAt: notification.creditedAt,
            ctaUrl:
              `${process.env.CLIENT_URL || "https://oatclub.in"}/account`,
          })
        )
      );
    }

    if (notification?.phone) {
      jobs.push(
        Promise.resolve().then(() =>
          sendCustomerCreditWhatsapp({
            phone: notification.phone,
            customerName: notification.name,
            amount: notification.amount,
            creditId: notification.creditId,
          })
        )
      );
    }

    void Promise.allSettled(jobs).then((results) => {
      results.forEach((item) => {
        if (item.status === "rejected") {
          console.error(
            "RMA refund notification failed:",
            item.reason?.message || item.reason
          );
        }
      });
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("RMA Credit Refund Error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Refund failed",
    });
  } finally {
    if (session) {
      await session.endSession().catch((error) => {
        console.error("Refund session cleanup failed:", error);
      });
    }
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
      (item) =>
        String(item?.rmaNumber) ===
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

    /* Approve RMA only */
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

    /* Exchange only: create replacement order */
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
            adminId: req.user?._id || "admin",
          });
      } catch (error) {
        exchangeOrderError =
          error?.message ||
          "Exchange order creation failed";

        console.error(
          "Exchange order creation failed:",
          error
        );
      }
    }

    const freshOrder = await Order.findById(
      order._id
    ).lean();

    const freshRma = (
      freshOrder?.rmas || []
    ).find(
      (item) =>
        String(item?.rmaNumber) ===
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
        "RMA approval email failed:",
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
      pickupRequired: true,
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
    console.error("Approve RMA Error:", error);

    return res.status(500).json({
      success: false,
      message:
        error?.message ||
        "Failed to approve RMA",
    });
  }
};
