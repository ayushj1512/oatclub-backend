import mongoose from "mongoose";
import Order from "../Orders/Orders.js";
import InventoryReservation from "../InventoryReservation/InventoryReservation.js";

/* ---------------------------------------------------
   helpers
--------------------------------------------------- */
const s = (v) => String(v ?? "").trim();
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));

const keyOf = (productId, variantId) =>
  `${String(productId)}::${variantId ? String(variantId) : "root"}`;

const itemProductIdOf = (it) => s(it?.productId?._id || it?.productId);
const itemVariantIdOf = (it) =>
  s(it?.variant?.variantId || it?.variantId || it?.variant?._id || "");

/**
 * allocatedQty sync rule:
 * - only RESERVED reservations count as allocated
 * - pending stays in queue, not allocated
 * - toProduceQty = qty - allocatedQty - shippedQty
 */
export const syncOrderAllocatedQtyFromReservations = async ({
  orderId,
  debug = true,
  session = null,
} = {}) => {
  if (!isObjectId(orderId)) throw new Error("Invalid orderId");

  const runId = `syncAlloc:${Date.now()}:${Math.random().toString(16).slice(2, 7)}`;
  const log = (...args) => debug && console.log(`🧩 [${runId}]`, ...args);

  const ownSession = !session;
  const dbSession = session || (await mongoose.startSession());

  const summary = {
    runId,
    orderId: String(orderId),
    orderNumber: "",
    itemsCount: 0,
    reservedReservations: 0,
    pendingReservations: 0,
    linesUpdated: 0,
    totalAllocatedQty: 0,
    totalToProduceQty: 0,
    changed: false,
  };

  try {
    const runner = async () => {
      const order = await Order.findById(orderId).session(dbSession);
      if (!order) throw new Error("Order not found");

      const items = Array.isArray(order.items) ? order.items : [];
      summary.orderNumber = s(order.orderNumber);
      summary.itemsCount = items.length;

      if (!items.length) return;

      const reservations = await InventoryReservation.find({
        refType: "order",
        refId: oid(orderId),
        status: { $in: ["pending", "reserved"] },
      })
        .select("productId variantId qty status")
        .sort({ createdAt: 1, _id: 1 })
        .session(dbSession);

      const reservedQtyMap = new Map();

      for (const r of reservations) {
        if (r.status === "pending") {
          summary.pendingReservations += 1;
          continue;
        }

        summary.reservedReservations += 1;
        const k = keyOf(r.productId, r.variantId || null);
        reservedQtyMap.set(k, (reservedQtyMap.get(k) || 0) + n(r.qty));
      }

      let changed = false;

      for (const item of items) {
        const productId = itemProductIdOf(item);
        if (!productId) continue;

        const variantId = itemVariantIdOf(item) || null;
        const k = keyOf(productId, variantId);

        const reservedForGroup = Math.max(0, n(reservedQtyMap.get(k) || 0));
        const qty = Math.max(0, n(item.quantity));
        const shippedQty = Math.max(0, n(item?.fulfillment?.shippedQty));
        const maxAllocatable = Math.max(0, qty - shippedQty);

        const newAllocatedQty = Math.min(maxAllocatable, reservedForGroup);
        const newToProduceQty = Math.max(0, qty - newAllocatedQty - shippedQty);

        const oldAllocatedQty = Math.max(0, n(item?.fulfillment?.allocatedQty));
        const oldToProduceQty = Math.max(0, n(item?.fulfillment?.toProduceQty));

        if (!item.fulfillment) item.fulfillment = {};

        item.fulfillment.allocatedQty = newAllocatedQty;
        item.fulfillment.toProduceQty = newToProduceQty;

        reservedQtyMap.set(k, Math.max(0, reservedForGroup - newAllocatedQty));

        summary.totalAllocatedQty += newAllocatedQty;
        summary.totalToProduceQty += newToProduceQty;

        if (
          oldAllocatedQty !== newAllocatedQty ||
          oldToProduceQty !== newToProduceQty
        ) {
          changed = true;
          summary.linesUpdated += 1;

          log("LINE UPDATED", {
            lineId: item.lineId,
            productId,
            variantId,
            oldAllocatedQty,
            newAllocatedQty,
            oldToProduceQty,
            newToProduceQty,
          });
        }
      }

      if (changed) {
        await order.save({ session: dbSession });
      }

      summary.changed = changed;
    };

    if (ownSession) {
      await dbSession.withTransaction(runner);
    } else {
      await runner();
    }

    return summary;
  } finally {
    if (ownSession) dbSession.endSession();
  }
};

export default syncOrderAllocatedQtyFromReservations;