// inventoryUtility/reserveInventoryForOrder.js
import mongoose from "mongoose";
import Order from "../Orders/Orders.js";
import InventoryReservation from "../InventoryReservation/InventoryReservation.js";
import { createReservationInternal } from "../InventoryReservation/InventoryReservationController.js";

/* ---------------- tiny helpers ---------------- */
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const s = (v) => String(v ?? "").trim();
const oid = (v) => new mongoose.Types.ObjectId(String(v));

const keyOf = (productId, variantId) => `${String(productId)}::${variantId ? String(variantId) : ""}`;

export const reserveInventoryForOrder = async ({
  orderId,
  debug = true,
  // ✅ reserve only when order is confirmed + in allowed stages
  confirmedOnly = true,
  allowedFulfillment = ["processing", "packed"],
} = {}) => {
  if (!mongoose.Types.ObjectId.isValid(orderId)) throw new Error("Invalid orderId");

  const runId = `reserveOrder:${Date.now()}:${Math.random().toString(16).slice(2, 7)}`;
  const session = await mongoose.startSession();

  const summary = {
    runId,
    orderId: String(orderId),
    orderNumber: "",
    groups: 0,
    reservedAdded: 0,
    reservationsCreated: 0,
    insufficientGroups: 0,
    skippedGroups: 0,
    results: [],
    stoppedBecause: "",
  };

  try {
    if (debug) console.log(`\n🧩 [${runId}] START`, { orderId: String(orderId) });

    await session.withTransaction(async () => {
      /* 1) Load ONLY this order (small payload) */
      const order = await Order.findById(orderId)
        .select("orderNumber isConfirmed fulfillmentStatus items createdAt")
        .session(session);

      if (!order) throw new Error("Order not found");
      summary.orderNumber = s(order.orderNumber);

      // ✅ gating (as you wanted processing+confirmed behavior)
      if (confirmedOnly && !order.isConfirmed) {
        summary.stoppedBecause = "not_confirmed";
        return;
      }
      if (allowedFulfillment?.length && !allowedFulfillment.includes(order.fulfillmentStatus)) {
        summary.stoppedBecause = "status_not_allowed";
        return;
      }

      const items = Array.isArray(order.items) ? order.items : [];
      if (!items.length) {
        summary.stoppedBecause = "no_items";
        return;
      }

      /* 2) Build required qty per (productId, variantId) group using PENDING */
      const needMap = new Map(); // key -> { productId, variantId, qtyNeed, snapshots... }

      for (const it of items) {
        const productId = it?.productId;
        if (!productId) continue;

        const variantId = it?.variant?.variantId || null;

        const qty = n(it?.quantity);
        const allocated = n(it?.fulfillment?.allocatedQty);
        const shipped = n(it?.fulfillment?.shippedQty);
        const pending = Math.max(0, qty - allocated - shipped);

        if (pending <= 0) continue;

        const k = keyOf(productId, variantId);
        const prev = needMap.get(k);

        const snap = it?.productSnapshot || {};
        const vSnap = it?.variant || {};

        const payload = {
          productId,
          variantId,
          qtyNeed: pending,
          // denormalized from order snapshot (fast + correct at purchase time)
          productCode: s(snap.productCode),
          productTitle: s(snap.title),
          productImage: s(snap.thumbnail || (Array.isArray(snap.images) ? snap.images[0] : "")),
          variantSku: s(vSnap.sku),
          selectedSize: s(it?.selectedSize),
          selectedColor: s(it?.selectedColor),
        };

        if (!prev) needMap.set(k, payload);
        else prev.qtyNeed += pending;
      }

      if (!needMap.size) {
        summary.stoppedBecause = "no_pending_lines";
        return;
      }

      summary.groups = needMap.size;

      /* 3) Find already RESERVED reservations for THIS order (single query) */
      const existing = await InventoryReservation.find({
        refType: "order",
        refId: oid(orderId),
        status: "reserved",
      })
        .select("productId variantId qty")
        .session(session);

      const alreadyMap = new Map(); // key -> qtyAlready
      for (const r of existing) {
        const k = keyOf(r.productId, r.variantId || null);
        alreadyMap.set(k, (alreadyMap.get(k) || 0) + n(r.qty));
      }

      /* 4) Reserve ONLY missing per group (idempotent ✅) */
      for (const [k, g] of needMap.entries()) {
        const already = alreadyMap.get(k) || 0;
        const missing = Math.max(0, n(g.qtyNeed) - already);

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
          continue;
        }

        try {
          const r = await createReservationInternal({
            productId: oid(g.productId),
            variantId: g.variantId ? oid(g.variantId) : null,
            qty: missing,
            refType: "order",
            refId: oid(orderId),
            expiresAt: null,
            notes: `Webhook auto-reserve | orderNumber=${summary.orderNumber}`,

            // denormalized fields
            productTitle: g.productTitle,
            productImage: g.productImage,
            orderNumber: summary.orderNumber,
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
          }
        } catch (e) {
          // most common: Insufficient stock to reserve (409 logic already in controller)
          const msg = String(e?.message || "");
          if (msg.toLowerCase().includes("insufficient")) summary.insufficientGroups += 1;

          summary.results.push({
            key: k,
            productId: String(g.productId),
            variantId: g.variantId ? String(g.variantId) : null,
            needed: g.qtyNeed,
            alreadyReserved: already,
            reservedNow: 0,
            status: msg.toLowerCase().includes("insufficient") ? "insufficient" : "error",
            error: msg,
          });
        }
      }

      if (!summary.reservedAdded && !summary.insufficientGroups && !summary.skippedGroups) {
        summary.stoppedBecause = "no_action";
      }
    });

    if (debug) console.log(`✅ [${runId}] DONE`, summary);
    return summary;
  } finally {
    session.endSession();
  }
};
