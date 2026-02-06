import mongoose from "mongoose";
import Order from "./Orders.js";
import { triggerRmaEmails } from "./order.emails.js";
import Product from "../Products/Products.js";

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
    } = req.body;

    console.log("📦 [CREATE RMA] Request:", { orderId, type, reason });

    if (!isObjectId(orderId)) return badRequest(res, "Invalid order id");
    if (!Array.isArray(items) || !items.length)
      return badRequest(res, "RMA items missing");
    if (!["return", "exchange"].includes(type))
      return badRequest(res, "Invalid RMA type");

    const order = await Order.findById(orderId);
    if (!order) return notFound(res, "Order not found");

    console.log("✅ [CREATE RMA] Order found:", {
      orderNumber: order?.orderNumber,
      fulfillmentStatus: order?.fulfillmentStatus,
      customerEmail: order?.shippingAddressSnapshot?.email,
    });

    if (order.fulfillmentStatus !== "delivered") {
      return badRequest(res, "Return/Exchange allowed only for delivered orders");
    }

    const deliveredAt = order?.trackingDetails?.deliveredAt;
    if (!deliveredAt) {
      return badRequest(
        res,
        "Delivery date missing (deliveredAt). Cannot create RMA."
      );
    }

    if (!isWithinRmaWindow(deliveredAt)) {
      return badRequest(
        res,
        `Return/Exchange window expired. Allowed within ${RMA_POLICY.windowDays} days.`
      );
    }

    const remaining = computeRemainingQtyByLineId(order);
    for (const ri of items) {
      const lineId = String(ri?.orderLineId || "").trim();
      const qty = Number(ri?.quantity || 0);
      const rem = remaining.get(lineId);

      if (!lineId) return badRequest(res, "orderLineId missing");
      if (rem == null) return badRequest(res, `Invalid orderLineId: ${lineId}`);
      if (!Number.isFinite(qty) || qty < 1)
        return badRequest(res, "Invalid RMA quantity");
      if (qty > rem)
        return badRequest(res, `Qty exceeds remaining for lineId: ${lineId}`);
    }

    const rmaItemsSnapshots = buildRmaItemsSnapshots(order, items);

    let fee = { amount: 0, currency: "INR", status: "waived" };
    let exchangeRequest = null;

    // ✅ helpers (keep local to avoid touching global helpers)
    const normalize = (s) => String(s || "").trim().toLowerCase();
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
          if (m[k] !== wantedAttrs[k]) {
            ok = false;
            break;
          }
        }
        if (ok) return v;
      }
      return null;
    };

    if (type === "exchange") {
      const ex = exchangeTo || {};
      const productId = String(ex?.productId || "").trim();
      if (!isObjectId(productId))
        return badRequest(res, "exchangeTo.productId missing/invalid for exchange");

      // ✅ AUTO resolve variantId from product variants + attributes (size)
      let resolvedVariantId = String(ex?.variantId || "").trim();
      let resolvedVariantSku = String(ex?.variantSku || "").trim();
      const attrs = Array.isArray(ex?.attributes) ? ex.attributes : [];
      const wanted = normalizeWantedAttrs(attrs);

      if (!wanted.size)
        return badRequest(res, "exchangeTo.attributes missing size for exchange");

      if (!isObjectId(resolvedVariantId)) {
        // IMPORTANT: ensure you have Product model imported at file top:
        // import Product from "../Products/Products.js";
        const prod = await Product.findById(productId).select("variants").lean();
        if (!prod) return notFound(res, "Exchange product not found");

        const matched = findVariantByAttrs(prod?.variants || [], wanted);
        if (!matched?._id)
          return badRequest(res, "No matching variant found for exchangeTo.attributes");

        resolvedVariantId = String(matched._id);
        if (matched?.sku) resolvedVariantSku = String(matched.sku);
      }

      if (!isObjectId(resolvedVariantId))
        return badRequest(res, "exchangeTo.variantId missing for exchange");

      const prevExchanges = countPreviousExchanges(order);
      const amount = computeExchangeFee(prevExchanges);

      fee = {
        amount,
        currency: "INR",
        status: amount > 0 ? "unpaid" : "waived",
      };

      exchangeRequest = {
        productId,
        variantId: resolvedVariantId,
        variantSku: resolvedVariantSku,
        attributes: attrs,
        note: String(ex?.note || ""),
      };
    }

    const rmaNumber = makeRmaNumber();

    order.rmas = order.rmas || [];
    order.rmas.push({
      rmaNumber,
      type,
      reason,
      customerNote,
      items: rmaItemsSnapshots,
      status: "requested",
      resolution: "pending",
      fee,
      exchangeRequest,
    });

    // Update order status
    order.fulfillmentStatus =
      type === "exchange" ? "exchange_requested" : "return_requested";

    await order.save();
    const created = order.rmas[order.rmas.length - 1];

    console.log("✅ [CREATE RMA] RMA Created:", {
      orderNumber: order.orderNumber,
      rmaNumber: created?.rmaNumber,
      customerEmail: order?.shippingAddressSnapshot?.email,
    });

    // ✅ Trigger emails
    try {
      console.log("📩 [CREATE RMA] Triggering RMA emails...");
      triggerRmaEmails({
        order: order.toObject(),
        rma: created,
        policy: RMA_POLICY,
      });
    } catch (e) {
      console.error("⚠️ [CREATE RMA] triggerRmaEmails failed:", e?.message || e);
    }

    return res.status(201).json({
      message: "RMA created",
      rma: created,
      orderId: order._id,
      order,
      policy: RMA_POLICY,
    });
  } catch (err) {
    console.error("❌ Create RMA Error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};


/* ============================================================
   ✅ UPDATE RMA (Admin)
============================================================ */
export const updateRma = async (req, res) => {
  try {
    const orderId = req.params.id;
    const rmaNumber = String(req.params.rmaNumber || "").trim();

    if (!isObjectId(orderId)) return badRequest(res, "Invalid order id");
    if (!rmaNumber) return badRequest(res, "rmaNumber missing");

    const order = await Order.findById(orderId);
    if (!order) return notFound(res, "Order not found");

    const idx = (order.rmas || []).findIndex((r) => String(r.rmaNumber) === rmaNumber);
    if (idx === -1) return notFound(res, "RMA not found");

    const rma = order.rmas[idx];

    const prevStatus = String(rma.status || "");
    const prevResolution = String(rma.resolution || "");
    const prevFeeStatus = String(rma?.fee?.status || "");
    const prevFeeAmount = Number(rma?.fee?.amount || 0);

    const { status, adminNote, resolution, refund, reverseShipment, fee } = req.body;

    // Fee update
    if (fee && typeof fee === "object") {
      rma.fee = rma.fee || { amount: 0, currency: "INR", status: "waived" };
      if (fee.amount != null) rma.fee.amount = Number(fee.amount || 0);
      if (fee.currency != null) rma.fee.currency = String(fee.currency || "INR");
      if (fee.status != null) rma.fee.status = normalize(fee.status || "waived");
    }

    // Fee gating for exchange
    if (
      rma.type === "exchange" &&
      Number(rma?.fee?.amount || 0) > 0 &&
      normalize(rma?.fee?.status) !== "paid"
    ) {
      const blocked = [
        "approved",
        "pickup_scheduled",
        "picked",
        "in_transit",
        "received",
        "replacement_shipped",
        "closed",
      ];
      if (status && blocked.includes(normalize(status))) {
        return badRequest(res, "Exchange fee unpaid. Cannot proceed until paid.");
      }
    }

    // Main updates
    if (status) {
      rma.status = normalize(status);
      rma.statusUpdatedAt = new Date();
    }

    if (adminNote != null) rma.adminNote = String(adminNote || "");
    if (resolution) rma.resolution = normalize(resolution);

    // Refund object
    if (refund && typeof refund === "object") {
      rma.refund = rma.refund || {};
      if (refund.amount != null) rma.refund.amount = Number(refund.amount || 0);
      if (refund.mode != null) rma.refund.mode = String(refund.mode || "");
      if (refund.status != null) rma.refund.status = String(refund.status || "");
      if (refund.referenceId != null) rma.refund.referenceId = String(refund.referenceId || "");
    }

    // Reverse pickup object
    if (reverseShipment && typeof reverseShipment === "object") {
      rma.reverseShipment = rma.reverseShipment || {};
      ["orderId", "shipmentId", "awb", "courierName", "trackingUrl"].forEach((f) => {
        if (reverseShipment[f] != null) rma.reverseShipment[f] = String(reverseShipment[f] || "");
      });

      ["pickupScheduledAt", "pickedAt", "receivedAt"].forEach((df) => {
        if (reverseShipment[df] != null) rma.reverseShipment[df] = safeDate(reverseShipment[df]);
      });
    }

    await order.save();

    const didStatusChange = status && prevStatus !== rma.status;
    const didResolutionChange = resolution && prevResolution !== rma.resolution;
    const didFeeChange =
      fee &&
      (prevFeeStatus !== String(rma?.fee?.status || "") ||
        prevFeeAmount !== Number(rma?.fee?.amount || 0));

    console.log("✅ [UPDATE RMA] Updated:", {
      orderNumber: order.orderNumber,
      rmaNumber,
      status: rma.status,
      resolution: rma.resolution,
    });

    // ✅ Trigger emails only if meaningful changes happened
    if (didStatusChange || didResolutionChange || didFeeChange) {
      try {
        console.log("📩 [UPDATE RMA] Triggering RMA emails...");
        triggerRmaEmails({ order: order.toObject(), rma: rma.toObject(), policy: RMA_POLICY });
      } catch (e) {
        console.error("⚠️ [UPDATE RMA] triggerRmaEmails failed:", e?.message || e);
      }
    }

    return res.status(200).json({
      message: "RMA updated",
      rma: order.rmas[idx],
      order,
    });
  } catch (err) {
    console.error("❌ Update RMA Error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/* ============================================================
   ✅ GET RMAs by Order
============================================================ */
export const getRmasByOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return notFound(res, "Order not found");
    return res.status(200).json({ rmas: order.rmas || [] });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/* ============================================================
   ✅ GET single RMA
============================================================ */
export const getRmaByNumber = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return notFound(res, "Order not found");

    const rma = (order.rmas || []).find(
      (r) => String(r.rmaNumber) === String(req.params.rmaNumber)
    );

    if (!rma) return notFound(res, "RMA not found");
    return res.status(200).json({ rma });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/* ============================================================
   ✅ GET All RMAs (Admin)
============================================================ */
export const getAllRmasAdmin = async (req, res) => {
  try {
    const { status, type, search } = req.query;

    const match = { rmas: { $exists: true, $ne: [] } };
    if (status) match["rmas.status"] = normalize(status);
    if (type) match["rmas.type"] = normalize(type);

    const orders = await Order.find(match)
      .populate("customerId", "name email phone")
      .sort({ createdAt: -1 })
      .lean();

    const allRmas = [];

    for (const order of orders) {
      for (const rma of order.rmas || []) {
        if (search) {
          const q = String(search).toLowerCase();
          const ok =
            String(order.orderNumber || "").toLowerCase().includes(q) ||
            String(rma.rmaNumber || "").toLowerCase().includes(q);

          if (!ok) continue;
        }

        allRmas.push({
          ...rma,
          orderId: order._id,
          orderNumber: order.orderNumber,
          customer: order.customerId,
          fulfillmentStatus: order.fulfillmentStatus,
        });
      }
    }

    return res.status(200).json({ rmas: allRmas });
  } catch (err) {
    console.error("❌ Fetch All RMAs Error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};
