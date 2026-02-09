// InventoryReservation/inventoryWebhook.js
import mongoose from "mongoose";
import Order from "../Orders/Orders.js";
import InventoryReservation from "../InventoryReservation/InventoryReservation.js";
import { createReservationInternal } from "../InventoryReservation/InventoryReservationController.js";

/* ---------------- tiny helpers ---------------- */
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const s = (v) => String(v ?? "").trim();
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));

const keyOf = (productId, variantId) =>
  `${String(productId)}::${variantId ? String(variantId) : ""}`;

/**
 * ✅ INTERNAL (CORE)
 * Input: orderNumber
 * Behavior:
 * - ONLY that order
 * - group by productId+variantId
 * - pending = quantity - allocatedQty - shippedQty
 * - reserve ONLY missing qty (idempotent: subtract already reserved for that order)
 * - insufficient => skip (continue) ✅
 */
export const reserveInventoryForOrderNumberInternal = async ({
  orderNumber,
  confirmedOnly = true,
  allowedFulfillment = ["processing", "packed"],
  debug = false,
  session,
} = {}) => {
  const on = s(orderNumber);
  if (!on) throw new Error("orderNumber required");

  const runId = `reserveByOrderNo:${Date.now()}:${Math.random().toString(16).slice(2, 7)}`;
  const log = (...a) => debug && console.log(`🧩 [${runId}]`, ...a);

  const summary = {
    runId,
    orderNumber: on,
    orderId: "",
    fulfillmentStatus: "",
    isConfirmed: false,

    itemsCount: 0,
    groups: 0,
    reservedAdded: 0,
    reservationsCreated: 0,
    insufficientGroups: 0,
    skippedGroups: 0,

    stoppedBecause: "",
    results: [],
  };

  log("START", { orderNumber: on, confirmedOnly, allowedFulfillment });

  // 1) Load only this order
  const order = await Order.findOne({ orderNumber: on })
    .select("orderNumber isConfirmed fulfillmentStatus items createdAt")
    .session(session);

  if (!order) {
    log("❌ Order not found");
    throw new Error("Order not found");
  }

  summary.orderId = String(order._id);
  summary.fulfillmentStatus = s(order.fulfillmentStatus);
  summary.isConfirmed = !!order.isConfirmed;
  summary.itemsCount = Array.isArray(order.items) ? order.items.length : 0;

  log("ORDER FOUND", {
    orderId: summary.orderId,
    status: summary.fulfillmentStatus,
    isConfirmed: summary.isConfirmed,
    items: summary.itemsCount,
  });

  // 2) gating: confirmed + allowed statuses
  if (confirmedOnly && !order.isConfirmed) {
    summary.stoppedBecause = "not_confirmed";
    log("STOP not_confirmed");
    return summary;
  }

  if (Array.isArray(allowedFulfillment) && allowedFulfillment.length) {
    if (!allowedFulfillment.includes(order.fulfillmentStatus)) {
      summary.stoppedBecause = "status_not_allowed";
      log("STOP status_not_allowed", { status: order.fulfillmentStatus, allowedFulfillment });
      return summary;
    }
  }

  const items = Array.isArray(order.items) ? order.items : [];
  if (!items.length) {
    summary.stoppedBecause = "no_items";
    log("STOP no_items");
    return summary;
  }

  // 3) Build need map per product+variant from PENDING qty
  const needMap = new Map();

  for (const it of items) {
    const productId = it?.productId;
    if (!productId || !isObjectId(productId)) continue;

    const variantId = it?.variant?.variantId || null;
    if (variantId && !isObjectId(variantId)) continue;

    const qty = Math.max(0, n(it?.quantity));
    const allocated = Math.max(0, n(it?.fulfillment?.allocatedQty));
    const shipped = Math.max(0, n(it?.fulfillment?.shippedQty));

    const pending = Math.max(0, qty - allocated - shipped);
    if (pending <= 0) continue;

    const k = keyOf(productId, variantId);

    const snap = it?.productSnapshot || {};
    const vSnap = it?.variant || {};

    const payload = needMap.get(k) || {
      productId: oid(productId),
      variantId: variantId ? oid(variantId) : null,
      qtyNeed: 0,

      productCode: s(snap.productCode),
      productTitle: s(snap.title),
      productImage: s(
        snap.thumbnail ||
          (Array.isArray(snap.images) && snap.images.length ? snap.images[0] : "")
      ),

      variantSku: s(vSnap.sku),
      selectedSize: s(it?.selectedSize),
      selectedColor: s(it?.selectedColor),
    };

    payload.qtyNeed += pending;
    needMap.set(k, payload);
  }

  if (!needMap.size) {
    summary.stoppedBecause = "no_pending_lines";
    log("STOP no_pending_lines");
    return summary;
  }

  summary.groups = needMap.size;
  log("NEED GROUPS BUILT", {
    groups: summary.groups,
    preview: Array.from(needMap.values()).slice(0, 5).map((g) => ({
      productId: String(g.productId),
      variantId: g.variantId ? String(g.variantId) : null,
      qtyNeed: g.qtyNeed,
      sku: g.variantSku,
      title: g.productTitle,
    })),
  });

  // 4) Already reserved for this order (reserved status only)
  const existing = await InventoryReservation.find({
    refType: "order",
    refId: oid(order._id),
    status: "reserved",
  })
    .select("productId variantId qty")
    .session(session);

  log("EXISTING RESERVED FOUND", { count: existing.length });

  const alreadyMap = new Map();
  for (const r of existing) {
    const k = keyOf(r.productId, r.variantId || null);
    alreadyMap.set(k, (alreadyMap.get(k) || 0) + Math.max(0, n(r.qty)));
  }

  // 5) Create only missing reservations
  for (const [k, g] of needMap.entries()) {
    const already = alreadyMap.get(k) || 0;
    const missing = Math.max(0, n(g.qtyNeed) - already);

    log("GROUP CHECK", {
      key: k,
      productId: String(g.productId),
      variantId: g.variantId ? String(g.variantId) : null,
      needed: g.qtyNeed,
      alreadyReserved: already,
      missing,
      sku: g.variantSku,
      title: g.productTitle,
    });

    if (missing <= 0) {
      summary.skippedGroups += 1;
      summary.results.push({
        key: k,
        productId: String(g.productId),
        variantId: g.variantId ? String(g.variantId) : null,
        needed: g.qtyNeed,
        alreadyReserved: already,
        reservedNow: 0,
        status: "skipped_already_reserved",
      });
      log("SKIP already reserved", { key: k });
      continue;
    }

    try {
      log("➡️ Creating reservation...", { key: k, missing });

      const r = await createReservationInternal({
        productId: g.productId,
        variantId: g.variantId,
        qty: missing,

        refType: "order",
        refId: oid(order._id),

        expiresAt: null,
        notes: `Auto-reserved (orderNumber webhook) | orderNumber=${on}`,

        // denormalized
        productTitle: g.productTitle,
        productImage: g.productImage,
        orderNumber: on,
        variantSku: g.variantSku,
        selectedSize: g.selectedSize,
        selectedColor: g.selectedColor,

        session,
      });

      if (r) {
        summary.reservationsCreated += 1;
        summary.reservedAdded += missing;

        summary.results.push({
          key: k,
          productId: String(g.productId),
          variantId: g.variantId ? String(g.variantId) : null,
          needed: g.qtyNeed,
          alreadyReserved: already,
          reservedNow: missing,
          status: "reserved",
        });

        log("✅ Reserved", { key: k, reservedNow: missing });
      } else {
        summary.results.push({
          key: k,
          productId: String(g.productId),
          variantId: g.variantId ? String(g.variantId) : null,
          needed: g.qtyNeed,
          alreadyReserved: already,
          reservedNow: 0,
          status: "no_return_from_createReservationInternal",
        });
        log("⚠️ createReservationInternal returned null/undefined", { key: k });
      }
    } catch (e) {
      const msg = String(e?.message || "Reserve failed");
      const isIns = msg.toLowerCase().includes("insufficient");

      if (isIns) summary.insufficientGroups += 1;

      summary.results.push({
        key: k,
        productId: String(g.productId),
        variantId: g.variantId ? String(g.variantId) : null,
        needed: g.qtyNeed,
        alreadyReserved: already,
        reservedNow: 0,
        status: isIns ? "insufficient" : "error",
        error: msg,
      });

      log(isIns ? "⚠️ INSUFFICIENT (continue)" : "❌ ERROR (continue)", { key: k, msg });
      continue;
    }
  }

  if (!summary.reservedAdded && !summary.insufficientGroups && !summary.skippedGroups) {
    summary.stoppedBecause = "no_action";
  }

  log("DONE SUMMARY", summary);
  return summary;
};

/* ------------------------------------------------------------------
   CONTROLLER (HTTP) - orderNumber input
   - Supports orderNumber in:
     1) req.params.orderNumber
     2) req.body.orderNumber
     3) req.query.orderNumber
   - debug: ?debug=1
------------------------------------------------------------------- */
export const reserveInventoryWebhookByOrderNumber = async (req, res) => {
  const orderNumber =
    s(req?.params?.orderNumber) || s(req?.body?.orderNumber) || s(req?.query?.orderNumber);

  const debug = String(req?.query?.debug || "0") === "1";
  const runId = `webhookReserve:${Date.now()}:${Math.random().toString(16).slice(2, 7)}`;

  const log = (...a) => console.log(`🔔 [${runId}]`, ...a);

  log("HIT", {
    method: req.method,
    url: req.originalUrl,
    orderNumber,
    debug,
  });

  if (!orderNumber) {
    log("❌ Missing orderNumber");
    return res.status(400).json({ ok: false, message: "orderNumber missing" });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    log("TXN START");
    const summary = await reserveInventoryForOrderNumberInternal({
      orderNumber,
      confirmedOnly: true,
      allowedFulfillment: ["processing", "packed"],
      debug, // internal detailed logs
      session,
    });

    await session.commitTransaction();
    log("TXN COMMIT ✅", {
      orderNumber,
      reservedAdded: summary.reservedAdded,
      reservationsCreated: summary.reservationsCreated,
      insufficientGroups: summary.insufficientGroups,
      skippedGroups: summary.skippedGroups,
      stoppedBecause: summary.stoppedBecause,
    });

    return res.json({ ok: true, summary });
  } catch (e) {
    await session.abortTransaction();
    const msg = String(e?.message || "Server error");
    log("TXN ABORT ❌", { orderNumber, error: msg });

    return res.status(400).json({ ok: false, message: msg });
  } finally {
    session.endSession();
    log("SESSION END");
  }
};
