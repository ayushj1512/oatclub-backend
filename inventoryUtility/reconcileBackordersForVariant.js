// inventoryUtility/reconcileBackordersForVariant.js
import mongoose from "mongoose";
import Product from "../Products/Products.js";
import Order from "../Orders/Orders.js";
import { createReservationInternal } from "../InventoryReservation/InventoryReservationController.js";

/* ---------------- tiny helpers ---------------- */
const s = (v) => String(v ?? "");
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const log = (on, ...a) => on && console.log(...a);

/**
 * MODE B ✅ Auto-reserve for any pending qty:
 * pending = quantity - allocatedQty - shippedQty
 *
 * ✅ Priority FIFO (high -> medium -> normal)
 * ✅ BUT priority missing => treated as "normal"
 *
 * ✅ Confirmed-only (optional)
 *
 * Notes:
 * - No toProduceQty filter
 * - Transaction + atomic reserve inside createReservationInternal()
 */
export const reconcileBackordersForVariant = async ({
  productId,
  variantId = null,
  maxOrders = 300,
  allowedStatuses = ["processing", "packed"],
  confirmedOnly = true,
  debug = true,
} = {}) => {
  if (!mongoose.Types.ObjectId.isValid(productId)) throw new Error("Invalid productId");
  if (variantId && !mongoose.Types.ObjectId.isValid(variantId)) throw new Error("Invalid variantId");

  const runId = `reconcile:${Date.now()}:${Math.random().toString(16).slice(2, 7)}`;
  const session = await mongoose.startSession();

  const productOid = oid(productId);
  const variantOid = variantId ? oid(variantId) : null;
  const productStr = String(productId);
  const variantStr = variantId ? String(variantId) : null;

  const summary = {
    runId,
    productId: productStr,
    variantId: variantStr,
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
    log(debug, `\n🧩 [${runId}] START`, { productId: productStr, variantId: variantStr });

    await session.withTransaction(async () => {
      /* -------------------------------------------------
         1) Load product + compute sellable
         sellable = stock - reservedStock
      ------------------------------------------------- */
      const product = await Product.findById(productOid).session(session);
      if (!product) throw new Error("Product not found");

      const isVariable = Array.isArray(product.variants) && product.variants.length > 0;

      let sellable = 0;
      if (isVariable) {
        if (!variantOid) throw new Error("variantId required for variable product");
        const v = product.variants.id(variantOid);
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

      /* -------------------------------------------------
         2) Build robust order query
         (handles productId stored as ObjectId/string/populated)
      ------------------------------------------------- */
      const and = [];

      if (confirmedOnly) and.push({ isConfirmed: true });
      and.push({ fulfillmentStatus: { $in: allowedStatuses } });

      and.push({
        $or: [
          { "items.productId": productOid },
          { "items.productId": productStr },
          { "items.productId._id": productOid },
        ],
      });

      if (variantOid) {
        and.push({
          $or: [
            { "items.variant.variantId": variantOid },
            { "items.variantId": variantOid },
            { "items.variant._id": variantOid },
            { "items.variant.variantId": variantStr },
            { "items.variantId": variantStr },
            { "items.variant._id": variantStr },
          ],
        });
      } else {
        // simple reconcile => avoid variant lines
        and.push({
          $or: [
            { "items.variant.variantId": { $exists: false } },
            { "items.variantId": { $exists: false } },
            { "items.variant": { $exists: false } },
            { "items.variant.variantId": null },
            { "items.variantId": null },
          ],
        });
      }

      const baseQuery = and.length ? { $and: and } : {};

      // debug count
      if (debug) {
        const cnt = await Order.countDocuments(baseQuery).session(session);
        log(debug, `🔎 [${runId}] baseQuery matchCount=`, cnt);
      }

      /* -------------------------------------------------
         3) Fetch orders with proper PRIORITY sort
         ✅ priority missing => "normal"
         ✅ high first, then medium, then normal
         ✅ FIFO: createdAt, _id
      ------------------------------------------------- */
      const orders = await Order.aggregate([
        { $match: baseQuery },

        // normalize priority if missing/blank
        {
          $addFields: {
            _priorityNorm: {
              $cond: [
                { $in: ["$priority", ["high", "medium", "normal"]] },
                "$priority",
                "normal",
              ],
            },
          },
        },

        // rank for sort
        {
          $addFields: {
            _priorityRank: {
              $switch: {
                branches: [
                  { case: { $eq: ["$_priorityNorm", "high"] }, then: 0 },
                  { case: { $eq: ["$_priorityNorm", "medium"] }, then: 1 },
                ],
                default: 2, // normal
              },
            },
          },
        },

        { $sort: { _priorityRank: 1, createdAt: 1, _id: 1 } },
        { $limit: Math.max(0, Number(maxOrders || 0)) },

        // keep only fields we need (small payload)
        { $project: { items: 1, createdAt: 1, orderNumber: 1, priority: 1 } },
      ]).session(session);

      summary.ordersFound = orders.length;
      log(debug, `📦 [${runId}] ordersFound=`, orders.length);

      if (!orders.length) {
        summary.stoppedBecause = "no_orders";
        summary.sellableAfter = sellable;
        return;
      }

      /* -------------------------------------------------
         4) Reserve per order line (pending based)
      ------------------------------------------------- */
      const itemProductId = (it) => String(it?.productId?._id || it?.productId || "").trim();
      const itemVariantId = (it) =>
        String(it?.variant?.variantId || it?.variantId || it?.variant?._id || "").trim();

      for (const order of orders) {
        if (!sellable) break;

        let touched = false;

        for (const it of order.items || []) {
          if (!sellable) break;

          if (itemProductId(it) !== productStr) continue;

          if (variantStr) {
            if (itemVariantId(it) !== variantStr) continue;
          } else {
            if (itemVariantId(it)) continue;
          }

          const qty = n(it?.quantity);
          const allocated = n(it?.fulfillment?.allocatedQty);
          const shipped = n(it?.fulfillment?.shippedQty);

          const pending = Math.max(0, qty - allocated - shipped);
          if (pending <= 0) continue;

          const allocateNow = Math.min(pending, sellable);
          if (allocateNow <= 0) continue;

          log(debug, `🟩 [${runId}] allocate`, {
            order: order.orderNumber,
            lineId: it?.lineId,
            pending,
            allocateNow,
          });

          const reservation = await createReservationInternal({
            productId: productOid,
            variantId: variantOid,
            qty: allocateNow,
            refType: "order",
            refId: order._id,
            expiresAt: null,
            notes: `Auto-reserved after stock update | orderNumber=${order.orderNumber || ""}`,
            session,
          });

          if (!reservation) continue;

          summary.reservationsCreated += 1;

          // IMPORTANT:
          // This `order` is from aggregate (plain object), not mongoose doc,
          // so we cannot `order.save()` here reliably.
          // If you want allocatedQty updates stored on order lines,
          // do it via Order.updateOne with positional operator.
          // For now we only reserve inventory (main goal).
          sellable -= allocateNow;
          summary.reservedAdded += allocateNow;
          summary.linesTouched += 1;
          touched = true;
        }

        if (touched) summary.ordersTouched += 1;
      }

      if (!summary.reservedAdded) summary.stoppedBecause = "no_pending_lines";

      /* -------------------------------------------------
         5) Compute sellableAfter
      ------------------------------------------------- */
      const fresh = await Product.findById(productOid).session(session);
      if (!fresh) throw new Error("Product not found after reconcile");

      if (variantOid) {
        const vv = fresh.variants?.id(variantOid);
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
