import mongoose from "mongoose";
import Product from "../Products/Products.js";
import Order from "../Orders/Orders.js";
import { createReservationInternal } from "../InventoryReservation/InventoryReservationController.js";

const s = (v) => String(v ?? "");
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const log = (on, ...a) => on && console.log(...a);

/**
 * MODE B ✅ Auto-reserve for any pending qty:
 * pending = quantity - allocatedQty - shippedQty
 * (ignores toProduceQty filter)
 */
export const reconcileBackordersForVariant = async ({
  productId,
  variantId = null,
  maxOrders = 300,
  allowedStatuses = ["processing", "packed"],
  debug = true,
} = {}) => {
  if (!mongoose.Types.ObjectId.isValid(productId)) throw new Error("Invalid productId");
  if (variantId && !mongoose.Types.ObjectId.isValid(variantId)) throw new Error("Invalid variantId");

  const runId = `reconcile:${Date.now()}:${Math.random().toString(16).slice(2, 7)}`;
  const session = await mongoose.startSession();

  const summary = {
    runId,
    productId: s(productId),
    variantId: variantId ? s(variantId) : null,
    sellableBefore: 0,
    sellableAfter: 0,
    ordersFound: 0,
    ordersTouched: 0,
    linesTouched: 0,
    reservedAdded: 0,
    reservationsCreated: 0,
    stoppedBecause: "",
  };

  try {
    log(debug, `\n🧩 [${runId}] START`, { productId: s(productId), variantId: variantId ? s(variantId) : null });

    await session.withTransaction(async () => {
      // 1) Product + sellable
      const product = await Product.findById(productId).session(session);
      if (!product) throw new Error("Product not found");

      const isVariable = Array.isArray(product.variants) && product.variants.length > 0;

      let sellable = 0;
      if (isVariable) {
        if (!variantId) throw new Error("variantId required for variable product");
        const v = product.variants.id(oid(variantId));
        if (!v) throw new Error("Variant not found");
        sellable = Math.max(0, n(v.stock) - n(v.reservedStock));
      } else {
        sellable = Math.max(0, n(product.stock) - n(product.reservedStock));
      }

      summary.sellableBefore = sellable;
      log(debug, `🟩 [${runId}] sellableBefore=`, sellable);

      if (!sellable) {
        summary.stoppedBecause = "no_sellable";
        log(debug, `🟧 [${runId}] STOP no_sellable`);
        return;
      }

      // 2) Orders FIFO ✅ (no toProduceQty filter)
      const query = {
        fulfillmentStatus: { $in: allowedStatuses },
        "items.productId": oid(productId),
      };
      if (variantId) query["items.variant.variantId"] = oid(variantId);

      const orders = await Order.find(query, { items: 1, createdAt: 1, orderNumber: 1 })
        .sort({ createdAt: 1 })
        .limit(maxOrders)
        .session(session);

      summary.ordersFound = orders.length;
      log(debug, `📦 [${runId}] ordersFound=`, orders.length);

      if (!orders.length) {
        summary.stoppedBecause = "no_orders";
        summary.sellableAfter = sellable;
        return;
      }

      // 3) Allocate by pending qty
      for (const order of orders) {
        if (!sellable) break;

        let touched = false;

        for (const it of order.items || []) {
          if (!sellable) break;

          if (s(it?.productId) !== s(productId)) continue;

          if (variantId) {
            if (s(it?.variant?.variantId) !== s(variantId)) continue;
          } else {
            if (it?.variant?.variantId) continue;
          }

          const qty = n(it?.quantity);
          const allocated = n(it?.fulfillment?.allocatedQty);
          const shipped = n(it?.fulfillment?.shippedQty);

          const pending = Math.max(0, qty - allocated - shipped);
          if (pending <= 0) continue;

          const allocateNow = Math.min(pending, sellable);
          if (allocateNow <= 0) continue;

          log(debug, `🟩 [${runId}] allocate`, { order: order.orderNumber, lineId: it?.lineId, pending, allocateNow });

          const reservation = await createReservationInternal({
            productId,
            variantId,
            qty: allocateNow,
            refType: "order",
            refId: order._id,
            expiresAt: null,
            notes: `Auto-reserved after stock update | orderNumber=${order.orderNumber || ""}`,
            session,
          });

          if (!reservation) continue;

          summary.reservationsCreated += 1;

          it.fulfillment = it.fulfillment || {};
          it.fulfillment.allocatedQty = allocated + allocateNow;

          // (optional) maintain toProduceQty if you still use it elsewhere
          const tp = n(it.fulfillment.toProduceQty);
          if (tp > 0) it.fulfillment.toProduceQty = Math.max(0, tp - allocateNow);

          sellable -= allocateNow;
          summary.reservedAdded += allocateNow;
          summary.linesTouched += 1;
          touched = true;
        }

        if (touched) {
          await order.save({ session });
          summary.ordersTouched += 1;
        }
      }

      if (!summary.reservedAdded) summary.stoppedBecause = "no_pending_lines";

      // 4) sellableAfter
      const fresh = await Product.findById(productId).session(session);
      if (!fresh) throw new Error("Product not found after reconcile");

      if (variantId) {
        const vv = fresh.variants?.id(oid(variantId));
        summary.sellableAfter = Math.max(0, n(vv?.stock) - n(vv?.reservedStock));
      } else {
        summary.sellableAfter = Math.max(0, n(fresh.stock) - n(fresh.reservedStock));
      }
    });

    log(debug, `✅ [${runId}] DONE`, summary);
    return summary;
  } catch (e) {
    console.error(`🟥 [${runId}] ERROR`, e?.message);
    throw e;
  } finally {
    session.endSession();
  }
};
