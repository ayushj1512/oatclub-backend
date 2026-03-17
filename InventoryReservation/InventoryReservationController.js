import mongoose from "mongoose";
import Product from "../Products/Products.js";
import InventoryReservation from "../InventoryReservation/InventoryReservation.js";
import { syncOrderAllocatedQtyFromReservations } from "../inventoryUtility/syncOrderAllocatedQtyFromReservations.js";
import Order from "../Orders/Orders.js";

/* ---------------------------------------------------
   helpers
--------------------------------------------------- */
const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const s = (v) => String(v ?? "").trim();
const n = (v) => Math.max(0, Number(v || 0));

const allowedRefTypes = new Set(["order", "production", "manual"]);
const allowedStatuses = new Set([
  "pending",
  "reserved",
  "released",
  "consumed",
  "expired",
]);

const INV_DEBUG = true;
const invLog = (tag, payload = null) => {
  if (!INV_DEBUG) return;
  if (payload == null) {
    console.log(`[INV] ${tag}`);
    return;
  }
  console.log(`[INV] ${tag}`, payload);
};

export const buildReservationKey = ({
  refType,
  refId,
  productId,
  variantId = null,
}) => `${s(refType)}:${s(refId)}:${s(productId)}:${variantId ? s(variantId) : "root"}`;

const appendNote = (oldText = "", nextText = "") => {
  const a = s(oldText);
  const b = s(nextText);
  if (!a) return b;
  if (!b) return a;
  return `${a}\n${b}`;
};

const shouldSyncOrder = (refType) => s(refType) === "order";

const syncOrderIfNeeded = async ({ refType, refId, session }) => {
  if (!shouldSyncOrder(refType) || !refId) return null;
  return syncOrderAllocatedQtyFromReservations({
    orderId: refId,
    debug: false,
    session,
  });
};

const httpCodeFromMsg = (msg = "") => {
  const m = s(msg).toLowerCase();
  if (m.startsWith("invalid")) return 400;
  if (m.includes("qty must be")) return 400;
  if (m.includes("variantid required")) return 400;
  if (m.includes("only active")) return 409;
  if (m.includes("already finalized")) return 409;
  if (m.includes("not found")) return 404;
  return 500;
};

const sendErr = (res, err, fallback = "Server Error") => {
  const msg = String(err?.message || fallback);
  const code = httpCodeFromMsg(msg);
  console.error("[InventoryReservation]", code, msg, err);
  return res.status(code).json({ ok: false, message: msg });
};

/* ---------------------------------------------------
   stock helpers
   canonical model:
   - stock = physical stock
   - reservedStock = reserved qty
   - availableStock = stock - reservedStock
--------------------------------------------------- */
const syncSimpleFields = (product) => {
  product.stock = n(product.stock);
  product.reservedStock = n(product.reservedStock);
  product.availableStock = Math.max(0, n(product.stock) - n(product.reservedStock));
  product.isInStock = n(product.availableStock) > 0;
};

const syncVariantFields = (variant) => {
  variant.stock = n(variant.stock);
  variant.reservedStock = n(variant.reservedStock);
  variant.availableStock = Math.max(0, n(variant.stock) - n(variant.reservedStock));
  variant.isInStock = n(variant.availableStock) > 0;
};

const syncProductFromVariants = (product) => {
  const variants = Array.isArray(product?.variants) ? product.variants : [];

  for (const v of variants) {
    syncVariantFields(v);
  }

  product.stock = variants.reduce((sum, v) => sum + n(v.stock), 0);
  product.reservedStock = variants.reduce((sum, v) => sum + n(v.reservedStock), 0);
  product.availableStock = Math.max(0, n(product.stock) - n(product.reservedStock));
  product.isInStock = n(product.availableStock) > 0;
};

const saveProductStockState = async ({ product, variant = null, session }) => {
  if (!variant) {
    syncSimpleFields(product);
    product.markModified("stock");
    product.markModified("reservedStock");
    product.markModified("availableStock");
    product.markModified("isInStock");
    await product.save({ session });
    invLog("SAVE_SIMPLE_STOCK_STATE", {
      productId: String(product._id),
      stock: n(product.stock),
      reservedStock: n(product.reservedStock),
      availableStock: n(product.availableStock),
      isInStock: !!product.isInStock,
    });
    return;
  }

  syncVariantFields(variant);
  syncProductFromVariants(product);
  product.markModified("variants");
  product.markModified("stock");
  product.markModified("reservedStock");
  product.markModified("availableStock");
  product.markModified("isInStock");
  await product.save({ session });

  invLog("SAVE_VARIANT_STOCK_STATE", {
    productId: String(product._id),
    variantId: String(variant._id),
    variantStock: n(variant.stock),
    variantReservedStock: n(variant.reservedStock),
    variantAvailableStock: n(variant.availableStock),
    productStock: n(product.stock),
    productReservedStock: n(product.reservedStock),
    productAvailableStock: n(product.availableStock),
  });
};

const getProductAndVariant = async ({ productId, variantId = null, session }) => {
  const product = await Product.findById(productId).session(session);
  if (!product) throw new Error("Product not found");

  if (!variantId) {
    syncSimpleFields(product);
    return { product, variant: null };
  }

  const variant = product.variants.id(variantId);
  if (!variant) throw new Error("Variant not found");

  syncVariantFields(variant);
  syncProductFromVariants(product);

  return { product, variant };
};

const getAvailableStock = async ({ productId, variantId = null, session }) => {
  const { product, variant } = await getProductAndVariant({
    productId,
    variantId,
    session,
  });

  if (!variant) {
    return { available: n(product.availableStock), product, variant: null };
  }

  return { available: n(variant.availableStock), product, variant };
};

const reserveAvailableStockNow = async ({ productId, variantId = null, qty, session }) => {
  const q = Math.max(1, Number(qty || 0));
  const { available, product, variant } = await getAvailableStock({
    productId,
    variantId,
    session,
  });

  invLog("RESERVE_AVAILABLE_STOCK_NOW", {
    productId: String(productId),
    variantId: variantId ? String(variantId) : null,
    qty: q,
    available,
  });

  if (available < q) {
    return { reservedNow: 0, pendingNow: q, product, variant };
  }

  if (!variant) {
    product.reservedStock = n(product.reservedStock) + q;
    await saveProductStockState({ product, variant: null, session });
    return { reservedNow: q, pendingNow: 0, product, variant: null };
  }

  variant.reservedStock = n(variant.reservedStock) + q;
  await saveProductStockState({ product, variant, session });

  return { reservedNow: q, pendingNow: 0, product, variant };
};

const releaseReservedStock = async ({ productId, variantId = null, qty, session }) => {
  const q = Math.max(1, Number(qty || 0));
  const { product, variant } = await getProductAndVariant({
    productId,
    variantId,
    session,
  });

  if (!variant) {
    product.reservedStock = Math.max(0, n(product.reservedStock) - q);
    await saveProductStockState({ product, variant: null, session });
    return;
  }

  variant.reservedStock = Math.max(0, n(variant.reservedStock) - q);
  await saveProductStockState({ product, variant, session });
};

const increasePhysicalStock = async ({ productId, variantId = null, qty, session }) => {
  const q = Math.max(1, Number(qty || 0));
  const { product, variant } = await getProductAndVariant({
    productId,
    variantId,
    session,
  });

  if (!variant) {
    product.stock = n(product.stock) + q;
    await saveProductStockState({ product, variant: null, session });
    return;
  }

  variant.stock = n(variant.stock) + q;
  await saveProductStockState({ product, variant, session });
};

const consumeReservedStock = async ({ productId, variantId = null, qty, session }) => {
  const q = Math.max(1, Number(qty || 0));
  const { product, variant } = await getProductAndVariant({
    productId,
    variantId,
    session,
  });

  if (!variant) {
    product.reservedStock = Math.max(0, n(product.reservedStock) - q);
    product.stock = Math.max(0, n(product.stock) - q);
    await saveProductStockState({ product, variant: null, session });
    return;
  }

  variant.reservedStock = Math.max(0, n(variant.reservedStock) - q);
  variant.stock = Math.max(0, n(variant.stock) - q);
  await saveProductStockState({ product, variant, session });
};

/* ---------------------------------------------------
   state transitions
--------------------------------------------------- */
const consumeReserved = async ({ reservation, reason = "", session }) => {
  if (!reservation) throw new Error("Reservation not found");
  if (reservation.status !== "reserved") {
    throw new Error("Only active reserved reservations can be consumed");
  }

  await consumeReservedStock({
    productId: reservation.productId,
    variantId: reservation.variantId || null,
    qty: reservation.qty,
    session,
  });

  reservation.status = "consumed";
  reservation.consumedAt = new Date();
  if (reason) reservation.notes = appendNote(reservation.notes, `Consumed: ${reason}`);
  await reservation.save({ session });

  await syncOrderIfNeeded({
    refType: reservation.refType,
    refId: reservation.refId,
    session,
  });

  return reservation;
};

const releaseOrExpire = async ({ reservation, nextStatus, reason = "", session }) => {
  if (!reservation) throw new Error("Reservation not found");
  if (!["pending", "reserved"].includes(reservation.status)) {
    throw new Error("Only active reservations can be updated");
  }

  if (reservation.status === "reserved") {
    await releaseReservedStock({
      productId: reservation.productId,
      variantId: reservation.variantId || null,
      qty: reservation.qty,
      session,
    });
  }

  reservation.status = nextStatus;

  if (nextStatus === "released") reservation.releasedAt = new Date();
  if (nextStatus === "expired") reservation.expiredAt = new Date();

  if (reason) {
    reservation.notes = appendNote(
      reservation.notes,
      `${nextStatus === "released" ? "Released" : "Expired"}: ${reason}`
    );
  }

  await reservation.save({ session });

  await syncOrderIfNeeded({
    refType: reservation.refType,
    refId: reservation.refId,
    session,
  });

  return reservation;
};

/* ---------------------------------------------------
   FIFO pending -> reserved
--------------------------------------------------- */
export async function reconcilePendingReservationsInternal({
  productId,
  variantId = null,
  maxRows = 200,
  session,
}) {
  if (!isObjectId(productId)) throw new Error("Invalid productId");
  if (variantId && !isObjectId(variantId)) throw new Error("Invalid variantId");

  const runId = `reconcile:${Date.now()}:${Math.random().toString(16).slice(2, 7)}`;
  const log = (tag, payload = null) => {
    if (!INV_DEBUG) return;
    if (payload == null) {
      console.log(`🔁 [${runId}] ${tag}`);
      return;
    }
    console.log(`🔁 [${runId}] ${tag}`, payload);
  };

  log("START", {
    productId: String(productId),
    variantId: variantId ? String(variantId) : null,
    maxRows: Math.max(1, Number(maxRows || 200)),
  });

  const list = await InventoryReservation.find({
    productId: oid(productId),
    ...(variantId ? { variantId: oid(variantId) } : { variantId: null }),
    status: "pending",
  })
    .sort({ createdAt: 1, _id: 1 })
    .limit(Math.max(1, Number(maxRows || 200)))
    .session(session);

  log(
    "PENDING_ROWS_FOUND",
    list.map((r) => ({
      reservationId: String(r._id),
      productId: String(r.productId),
      variantId: r.variantId ? String(r.variantId) : null,
      qty: Number(r.qty || 0),
      refType: r.refType,
      refId: r.refId ? String(r.refId) : null,
      orderNumber: r.orderNumber || "",
    }))
  );

  let promotedCount = 0;
  let promotedQty = 0;
  let skippedNonConfirmed = 0;
  let skippedInsufficientStock = 0;
  const orderIdsToSync = new Set();

  for (const row of list) {
    log("ROW_CHECK_START", {
      reservationId: String(row._id),
      qty: Number(row.qty || 0),
      refType: row.refType,
      refId: row.refId ? String(row.refId) : null,
      variantId: row.variantId ? String(row.variantId) : null,
      orderNumber: row.orderNumber || "",
    });

    if (s(row.refType) === "order") {
      if (!row.refId || !isObjectId(row.refId)) {
        skippedNonConfirmed += 1;
        log("SKIP_ORDER_INVALID_REFID", {
          reservationId: String(row._id),
          refId: row.refId ? String(row.refId) : null,
        });
        continue;
      }

      const order = await Order.findById(row.refId)
        .select("_id orderNumber isConfirmed confirmedAt paymentStatus fulfillmentStatus")
        .session(session);

      const isConfirmedOrder = !!order?.isConfirmed || !!order?.confirmedAt;

      log("ORDER_CONFIRMATION_CHECK", {
        reservationId: String(row._id),
        orderId: order?._id ? String(order._id) : null,
        orderNumber: order?.orderNumber || row.orderNumber || "",
        isConfirmed: !!order?.isConfirmed,
        confirmedAt: order?.confirmedAt || null,
        paymentStatus: order?.paymentStatus || "",
        fulfillmentStatus: order?.fulfillmentStatus || "",
        passes: isConfirmedOrder,
      });

      if (!order || !isConfirmedOrder) {
        skippedNonConfirmed += 1;
        log("SKIP_NOT_CONFIRMED_ORDER", {
          reservationId: String(row._id),
          orderId: order?._id ? String(order._id) : null,
          orderNumber: order?.orderNumber || row.orderNumber || "",
          isConfirmed: !!order?.isConfirmed,
          confirmedAt: order?.confirmedAt || null,
        });
        continue;
      }
    }

    const { available } = await getAvailableStock({
      productId: row.productId,
      variantId: row.variantId || null,
      session,
    });

    log("AVAILABLE_STOCK_CHECK", {
      reservationId: String(row._id),
      qtyNeeded: Number(row.qty || 0),
      available: Number(available || 0),
      productId: String(row.productId),
      variantId: row.variantId ? String(row.variantId) : null,
    });

    if (available < row.qty) {
      skippedInsufficientStock += 1;
      log("BREAK_INSUFFICIENT_STOCK_FIFO", {
        reservationId: String(row._id),
        qtyNeeded: Number(row.qty || 0),
        available: Number(available || 0),
      });
      break;
    }

    const reserveResult = await reserveAvailableStockNow({
      productId: row.productId,
      variantId: row.variantId || null,
      qty: row.qty,
      session,
    });

    log("RESERVE_RESULT", {
      reservationId: String(row._id),
      reservedNow: Number(reserveResult?.reservedNow || 0),
      pendingNow: Number(reserveResult?.pendingNow || 0),
    });

    row.status = "reserved";
    row.reservedAt = new Date();
    row.notes = appendNote(row.notes, "Auto-promoted from pending (FIFO)");
    await row.save({ session });

    promotedCount += 1;
    promotedQty += Number(row.qty || 0);

    log("ROW_PROMOTED", {
      reservationId: String(row._id),
      promotedCount,
      promotedQty,
      status: row.status,
    });

    if (shouldSyncOrder(row.refType) && row.refId) {
      orderIdsToSync.add(String(row.refId));
    }
  }

  for (const orderId of orderIdsToSync) {
    log("SYNC_ORDER_ALLOCATED_QTY", { orderId });

    await syncOrderAllocatedQtyFromReservations({
      orderId,
      debug: false,
      session,
    });
  }

  const summary = {
    promotedCount,
    promotedQty,
    skippedNonConfirmed,
    skippedInsufficientStock,
    scannedCount: list.length,
  };

  log("DONE", summary);
  return summary;
}

/* ---------------------------------------------------
   inventory add + reconcile
--------------------------------------------------- */
export async function addInventoryAndReconcileInternal({
  productId,
  variantId = null,
  qty,
  reason = "",
  session,
}) {
  if (!isObjectId(productId)) throw new Error("Invalid productId");
  if (variantId && !isObjectId(variantId)) throw new Error("Invalid variantId");
  if (!Number.isFinite(Number(qty)) || Number(qty) <= 0) {
    throw new Error("qty must be > 0");
  }

  await increasePhysicalStock({ productId, variantId, qty, session });

  const result = await reconcilePendingReservationsInternal({
    productId,
    variantId,
    session,
  });

  return {
    addedQty: Math.max(1, Number(qty)),
    ...result,
    note: s(reason),
  };
}

/* ---------------------------------------------------
   INTERNAL create
--------------------------------------------------- */
export async function createReservationInternal({
  productModel = "Product",
  productId,
  variantId = null,
  qty,
  refType,
  refId,
  expiresAt = null,
  notes = "",
  reservationKey = "",
  productTitle = "",
  productImage = "",
  orderNumber = "",
  variantSku = "",
  selectedSize = "",
  selectedColor = "",
  session,
}) {
  if (!isObjectId(productId)) throw new Error("Invalid productId");
  if (variantId && !isObjectId(variantId)) throw new Error("Invalid variantId");
  if (!Number.isFinite(Number(qty)) || Number(qty) <= 0) {
    throw new Error("qty must be > 0");
  }
  if (!allowedRefTypes.has(s(refType))) throw new Error("Invalid refType");
  if (!isObjectId(refId)) throw new Error("Invalid refId");

  const qtyNum = Math.max(1, Number(qty));
  const productObjId = oid(productId);
  const variantObjId = variantId ? oid(variantId) : null;
  const refObjId = oid(refId);

  const key =
    s(reservationKey) ||
    buildReservationKey({
      refType,
      refId: refObjId,
      productId: productObjId,
      variantId: variantObjId,
    });

  const product = await Product.findById(productObjId).session(session);
  if (!product) throw new Error("Product not found");

  invLog("CREATE_RESERVATION_START", {
    productId: String(productObjId),
    variantId: variantObjId ? String(variantObjId) : null,
    qty: qtyNum,
    refType: s(refType),
    refId: String(refObjId),
    reservationKey: key,
    orderNumber: s(orderNumber),
  });

  const existing = await InventoryReservation.findOne({
    reservationKey: key,
    status: { $in: ["pending", "reserved"] },
  }).session(session);

  if (existing) {
    invLog("CREATE_RESERVATION_EXISTING_ACTIVE", {
      reservationId: String(existing._id),
      status: existing.status,
      qty: existing.qty,
    });

    if (expiresAt) existing.expiresAt = new Date(expiresAt);
    existing.notes = appendNote(existing.notes, notes);

    if (productTitle) existing.productTitle = s(productTitle);
    if (productImage) existing.productImage = s(productImage);
    if (orderNumber) existing.orderNumber = s(orderNumber);
    if (variantSku) existing.variantSku = s(variantSku);
    if (selectedSize) existing.selectedSize = s(selectedSize);
    if (selectedColor) existing.selectedColor = s(selectedColor);

    await existing.save({ session });

    await syncOrderIfNeeded({
      refType: existing.refType,
      refId: existing.refId,
      session,
    });

    return existing;
  }

  const { pendingNow } = await reserveAvailableStockNow({
    productId: productObjId,
    variantId: variantObjId,
    qty: qtyNum,
    session,
  });

  const nextStatus = pendingNow > 0 ? "pending" : "reserved";

  invLog("CREATE_RESERVATION_STOCK_DECISION", {
    productId: String(productObjId),
    variantId: variantObjId ? String(variantObjId) : null,
    qtyNum,
    pendingNow,
    nextStatus,
  });

  const [created] = await InventoryReservation.create(
    [
      {
        productModel: s(productModel || "Product"),
        productId: productObjId,
        variantId: variantObjId,
        qty: qtyNum,
        status: nextStatus,
        reservedAt: nextStatus === "reserved" ? new Date() : null,
        refType: s(refType),
        refId: refObjId,
        reservationKey: key,
        productCode: s(product.productCode),
        productTitle: s(productTitle || product.title),
        productImage: s(productImage || product.thumbnail || product.images?.[0]),
        orderNumber: s(orderNumber),
        variantSku: s(variantSku),
        selectedSize: s(selectedSize),
        selectedColor: s(selectedColor),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        notes:
          nextStatus === "pending"
            ? appendNote(notes, "Created as pending (stock unavailable)")
            : s(notes),
      },
    ],
    { session }
  );

  invLog("CREATE_RESERVATION_CREATED", {
    reservationId: String(created._id),
    status: created.status,
    qty: created.qty,
  });

  await syncOrderIfNeeded({
    refType: created.refType,
    refId: created.refId,
    session,
  });

  return created;
}

/* ---------------------------------------------------
   cancel all active by order
--------------------------------------------------- */
export async function cancelReservationsInternalByOrder({
  orderId,
  reason = "order cancelled",
  nextStatus = "released",
  session,
}) {
  if (!isObjectId(orderId)) throw new Error("Invalid orderId");

  const list = await InventoryReservation.find({
    refType: "order",
    refId: oid(orderId),
    status: { $in: ["pending", "reserved"] },
  }).session(session);

  const touched = [];

  for (const row of list) {
    const updated = await releaseOrExpire({
      reservation: row,
      nextStatus,
      reason,
      session,
    });

    touched.push(updated);

    await reconcilePendingReservationsInternal({
      productId: row.productId,
      variantId: row.variantId || null,
      session,
    });
  }

  return { count: touched.length, reservations: touched };
}

/* ---------------------------------------------------
   RTO restock
--------------------------------------------------- */
export async function restockFromRTOInternal({
  productId,
  variantId = null,
  qty,
  reason = "RTO received",
  session,
}) {
  return addInventoryAndReconcileInternal({
    productId,
    variantId,
    qty,
    reason,
    session,
  });
}

/* ---------------------------------------------------
   API: create
--------------------------------------------------- */
export async function createReservation(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const reservation = await createReservationInternal({
      ...(req.body || {}),
      session,
    });

    await session.commitTransaction();
    return res.status(201).json({ ok: true, reservation });
  } catch (e) {
    await session.abortTransaction();
    return sendErr(res, e, "Failed to create reservation");
  } finally {
    session.endSession();
  }
}

/* ---------------------------------------------------
   API: release / consume / expire
--------------------------------------------------- */
export async function releaseReservation(req, res) {
  const { id } = req.params;
  const { reason = "" } = req.body || {};

  if (!isObjectId(id)) {
    return res.status(400).json({ ok: false, message: "Invalid reservation id" });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const reservation = await InventoryReservation.findById(id).session(session);

    const updated = await releaseOrExpire({
      reservation,
      nextStatus: "released",
      reason,
      session,
    });

    await reconcilePendingReservationsInternal({
      productId: updated.productId,
      variantId: updated.variantId || null,
      session,
    });

    await session.commitTransaction();
    return res.json({ ok: true, reservation: updated });
  } catch (e) {
    await session.abortTransaction();
    return sendErr(res, e, "Failed to release reservation");
  } finally {
    session.endSession();
  }
}

export async function consumeReservation(req, res) {
  const { id } = req.params;
  const { reason = "" } = req.body || {};

  if (!isObjectId(id)) {
    return res.status(400).json({ ok: false, message: "Invalid reservation id" });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const reservation = await InventoryReservation.findById(id).session(session);
    const updated = await consumeReserved({ reservation, reason, session });

    await session.commitTransaction();
    return res.json({ ok: true, reservation: updated });
  } catch (e) {
    await session.abortTransaction();
    return sendErr(res, e, "Failed to consume reservation");
  } finally {
    session.endSession();
  }
}

export async function expireReservation(req, res) {
  const { id } = req.params;
  const { reason = "" } = req.body || {};

  if (!isObjectId(id)) {
    return res.status(400).json({ ok: false, message: "Invalid reservation id" });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const reservation = await InventoryReservation.findById(id).session(session);

    const updated = await releaseOrExpire({
      reservation,
      nextStatus: "expired",
      reason,
      session,
    });

    await reconcilePendingReservationsInternal({
      productId: updated.productId,
      variantId: updated.variantId || null,
      session,
    });

    await session.commitTransaction();
    return res.json({ ok: true, reservation: updated });
  } catch (e) {
    await session.abortTransaction();
    return sendErr(res, e, "Failed to expire reservation");
  } finally {
    session.endSession();
  }
}

/* ---------------------------------------------------
   API: list / get
--------------------------------------------------- */
export async function listReservations(req, res) {
  try {
    const {
      productId,
      variantId,
      status,
      refType,
      refId,
      productCode,
      orderNumber,
      reservationKey,
    } = req.query || {};

    const filter = {};

    if (productId) {
      if (!isObjectId(productId)) {
        return res.status(400).json({ ok: false, message: "Invalid productId" });
      }
      filter.productId = oid(productId);
    }

    if (variantId) {
      if (!isObjectId(variantId)) {
        return res.status(400).json({ ok: false, message: "Invalid variantId" });
      }
      filter.variantId = oid(variantId);
    }

    if (refId) {
      if (!isObjectId(refId)) {
        return res.status(400).json({ ok: false, message: "Invalid refId" });
      }
      filter.refId = oid(refId);
    }

    if (status) {
      const st = s(status);
      if (!allowedStatuses.has(st)) {
        return res.status(400).json({ ok: false, message: "Invalid status" });
      }
      filter.status = st;
    }

    if (refType) {
      const rt = s(refType);
      if (!allowedRefTypes.has(rt)) {
        return res.status(400).json({ ok: false, message: "Invalid refType" });
      }
      filter.refType = rt;
    }

    if (productCode) filter.productCode = s(productCode);
    if (orderNumber) filter.orderNumber = s(orderNumber);
    if (reservationKey) filter.reservationKey = s(reservationKey);

    const data = await InventoryReservation.find(filter)
      .sort({ createdAt: -1 })
      .limit(500);

    return res.json({ ok: true, count: data.length, data });
  } catch (e) {
    return sendErr(res, e, "Failed to list reservations");
  }
}

export async function getReservation(req, res) {
  const { id } = req.params;

  if (!isObjectId(id)) {
    return res.status(400).json({ ok: false, message: "Invalid reservation id" });
  }

  try {
    const reservation = await InventoryReservation.findById(id);
    if (!reservation) {
      return res.status(404).json({ ok: false, message: "Reservation not found" });
    }
    return res.json({ ok: true, reservation });
  } catch (e) {
    return sendErr(res, e, "Failed to get reservation");
  }
}

/* ---------------------------------------------------
   API: expire due
--------------------------------------------------- */
export async function expireDueReservations(req, res) {
  const now = new Date();
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const due = await InventoryReservation.find({
      status: { $in: ["pending", "reserved"] },
      expiresAt: { $ne: null, $lte: now },
    })
      .sort({ expiresAt: 1, createdAt: 1 })
      .limit(200)
      .session(session);

    for (const row of due) {
      await releaseOrExpire({
        reservation: row,
        nextStatus: "expired",
        reason: "Auto-expired",
        session,
      });

      await reconcilePendingReservationsInternal({
        productId: row.productId,
        variantId: row.variantId || null,
        session,
      });
    }

    await session.commitTransaction();
    return res.json({ ok: true, expiredCount: due.length });
  } catch (e) {
    await session.abortTransaction();
    return sendErr(res, e, "Failed to expire due reservations");
  } finally {
    session.endSession();
  }
}

/* ---------------------------------------------------
   INTERNAL: consume all reserved by order
--------------------------------------------------- */
export async function consumeReservationsInternalByOrder({
  orderId,
  reason = "packed",
  session,
}) {
  if (!isObjectId(orderId)) throw new Error("Invalid orderId");

  const list = await InventoryReservation.find({
    refType: "order",
    refId: oid(orderId),
    status: "reserved",
  }).session(session);

  for (const row of list) {
    await consumeReserved({
      reservation: row,
      reason,
      session,
    });
  }

  await syncOrderAllocatedQtyFromReservations({
    orderId,
    debug: false,
    session,
  });

  return { consumedCount: list.length };
}

/* ---------------------------------------------------
   API: add stock + reconcile
--------------------------------------------------- */
export async function addInventoryAndReconcile(req, res) {
  const { productId, variantId = null, qty, reason = "" } = req.body || {};

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const summary = await addInventoryAndReconcileInternal({
      productId,
      variantId,
      qty,
      reason,
      session,
    });

    await session.commitTransaction();
    return res.json({ ok: true, summary });
  } catch (e) {
    await session.abortTransaction();
    return sendErr(res, e, "Failed to add stock");
  } finally {
    session.endSession();
  }
}

/* ---------------------------------------------------
   API: cancel reservations by order
--------------------------------------------------- */
export async function cancelReservationsByOrder(req, res) {
  const orderId = req.params?.orderId || req.body?.orderId;
  const reason = req.body?.reason || "order cancelled";
  const nextStatus = req.body?.nextStatus || "released";

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const summary = await cancelReservationsInternalByOrder({
      orderId,
      reason,
      nextStatus,
      session,
    });

    await session.commitTransaction();
    return res.json({ ok: true, summary });
  } catch (e) {
    await session.abortTransaction();
    return sendErr(res, e, "Failed to cancel order reservations");
  } finally {
    session.endSession();
  }
}

/* ---------------------------------------------------
   API: RTO restock
--------------------------------------------------- */
export async function restockFromRTO(req, res) {
  const {
    productId,
    variantId = null,
    qty,
    reason = "RTO received",
  } = req.body || {};

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const summary = await restockFromRTOInternal({
      productId,
      variantId,
      qty,
      reason,
      session,
    });

    await session.commitTransaction();
    return res.json({ ok: true, summary });
  } catch (e) {
    await session.abortTransaction();
    return sendErr(res, e, "Failed to restock RTO inventory");
  } finally {
    session.endSession();
  }
}

export async function reconcileReservations(req, res) {
  const { productId, variantId = null } = req.body || {};

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const summary = await reconcilePendingReservationsInternal({
      productId,
      variantId,
      session,
    });

    await session.commitTransaction();
    return res.json({ ok: true, summary });
  } catch (e) {
    await session.abortTransaction();
    return sendErr(res, e, "Failed to reconcile reservations");
  } finally {
    session.endSession();
  }
}