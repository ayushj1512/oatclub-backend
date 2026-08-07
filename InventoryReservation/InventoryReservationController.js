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

const reservationProductKey = (productId, variantId = null) =>
  `${String(productId)}::${variantId ? String(variantId) : "root"}`;

const orderItemProductKey = (item) => {
  const productId = item?.productId?._id || item?.productId;

  const variantId =
    item?.variant?.variantId ||
    item?.variantId ||
    item?.variant?._id ||
    null;

  if (!productId) return "";

  return reservationProductKey(productId, variantId);
};

const getOrderRequiredQtyForProduct = ({
  order,
  productId,
  variantId = null,
}) => {
  const requiredKey = reservationProductKey(productId, variantId);

  return (Array.isArray(order?.items) ? order.items : []).reduce(
    (total, item) => {
      if (orderItemProductKey(item) !== requiredKey) {
        return total;
      }

      const orderedQty = n(item?.quantity);
      const shippedQty = n(item?.fulfillment?.shippedQty);

      return total + Math.max(0, orderedQty - shippedQty);
    },
    0
  );
};

/* ---------------------------------------------------
   PENDING ORDER RESERVATION VALIDATION

   Purpose:
   Prevent stale / already-shipped order reservations
   from becoming reserved later when stock is added.
--------------------------------------------------- */

const TERMINAL_FULFILLMENT_STATUSES = new Set([
  "shipped",
  "delivered",
  "cancelled",
  "canceled",
]);

export async function validatePendingOrderReservation(
  reservation,
  { session } = {}
) {
  if (!reservation) {
    return {
      valid: false,
      safeToDelete: false,
      reason: "RESERVATION_NOT_FOUND",
      remainingQty: 0,
      order: null,
    };
  }

  if (s(reservation.status) !== "pending") {
    return {
      valid: false,
      safeToDelete: false,
      reason: "NOT_PENDING",
      remainingQty: 0,
      order: null,
    };
  }

  // Production/manual reservations are not part of this repair.
  if (s(reservation.refType) !== "order") {
    return {
      valid: true,
      safeToDelete: false,
      reason: "",
      remainingQty: n(reservation.qty),
      order: null,
    };
  }

  if (!reservation.refId || !isObjectId(reservation.refId)) {
    return {
      valid: false,
      safeToDelete: true,
      reason: "INVALID_ORDER_REFERENCE",
      remainingQty: 0,
      order: null,
    };
  }

  const order = await Order.findById(reservation.refId)
    .select(
      "_id orderNumber isConfirmed confirmedAt paymentStatus fulfillmentStatus items"
    )
    .session(session);

  if (!order) {
    return {
      valid: false,
      safeToDelete: true,
      reason: "ORDER_NOT_FOUND",
      remainingQty: 0,
      order: null,
    };
  }

  const fulfillmentStatus = s(
    order.fulfillmentStatus
  ).toLowerCase();

  /* -----------------------------------------------
     Terminal order = reservation must never revive
  ----------------------------------------------- */

  if (TERMINAL_FULFILLMENT_STATUSES.has(fulfillmentStatus)) {
    const reasonMap = {
      shipped: "ORDER_SHIPPED",
      delivered: "ORDER_DELIVERED",
      cancelled: "ORDER_CANCELLED",
      canceled: "ORDER_CANCELLED",
    };

    return {
      valid: false,
      safeToDelete: true,
      reason:
        reasonMap[fulfillmentStatus] ||
        "ORDER_FULFILLMENT_FINALIZED",
      remainingQty: 0,
      order,
    };
  }

  const isConfirmed =
    Boolean(order.isConfirmed) ||
    Boolean(order.confirmedAt);

  if (!isConfirmed) {
    // Do NOT delete automatically.
    // Order could still get confirmed later.
    return {
      valid: false,
      safeToDelete: false,
      reason: "ORDER_NOT_CONFIRMED",
      remainingQty: 0,
      order,
    };
  }

  /* -----------------------------------------------
     Remaining quantity based on shippedQty
  ----------------------------------------------- */

  const remainingQty =
    getOrderRequiredQtyForProduct({
      order,
      productId: reservation.productId,
      variantId: reservation.variantId || null,
    });

  if (remainingQty <= 0) {
    return {
      valid: false,
      safeToDelete: true,
      reason: "NO_PENDING_QTY",
      remainingQty: 0,
      order,
    };
  }

  /*
   * Important:
   * Don't reserve qty 3 when order only still needs qty 1.
   *
   * We block it, but DON'T auto-delete because some
   * inventory may still legitimately be required.
   */
  if (n(reservation.qty) > remainingQty) {
    return {
      valid: false,
      safeToDelete: false,
      reason: "PENDING_QTY_EXCEEDS_REQUIRED",
      remainingQty,
      order,
    };
  }

  return {
    valid: true,
    safeToDelete: false,
    reason: "",
    remainingQty,
    order,
  };
}

/* ---------------------------------------------------
   FIFO pending -> reserved
--------------------------------------------------- */
export async function reconcilePendingReservationsInternal({
  productId,
  variantId = null,
  maxRows = 200,
  excludeReservationIds = [],
  session,
}) {
  if (!isObjectId(productId)) throw new Error("Invalid productId");
  if (variantId && !isObjectId(variantId)) {
    throw new Error("Invalid variantId");
  }

  const excludedIds = Array.from(
    new Set(
      (Array.isArray(excludeReservationIds) ? excludeReservationIds : [])
        .filter(isObjectId)
        .map((id) => String(id))
    )
  ).map(oid);

  const runId = `reconcile:${Date.now()}:${Math.random()
    .toString(16)
    .slice(2, 7)}`;

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
    excludedIds: excludedIds.map(String),
  });

  const filter = {
    productId: oid(productId),
    ...(variantId
      ? { variantId: oid(variantId) }
      : { variantId: null }),
    status: "pending",
  };

  if (excludedIds.length) {
    filter._id = { $nin: excludedIds };
  }

  const list = await InventoryReservation.find(filter)
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
        continue;
      }

      const order = await Order.findById(row.refId)
        .select(
          "_id orderNumber isConfirmed confirmedAt paymentStatus fulfillmentStatus"
        )
        .session(session);

      const isConfirmedOrder =
        Boolean(order?.isConfirmed) || Boolean(order?.confirmedAt);

      if (!order || !isConfirmedOrder) {
        skippedNonConfirmed += 1;
        continue;
      }
    }

    const { available } = await getAvailableStock({
      productId: row.productId,
      variantId: row.variantId || null,
      session,
    });

    if (available < n(row.qty)) {
      skippedInsufficientStock += 1;

      // Do not break here.
      // A later pending row may require a smaller quantity.
      continue;
    }

    const reserveResult = await reserveAvailableStockNow({
      productId: row.productId,
      variantId: row.variantId || null,
      qty: row.qty,
      session,
    });

    if (reserveResult.reservedNow !== n(row.qty)) {
      skippedInsufficientStock += 1;
      continue;
    }

    row.status = "reserved";
    row.reservedAt = new Date();
    row.releasedAt = null;
    row.expiredAt = null;

    row.notes = appendNote(
      row.notes,
      `Promoted from pending to reserved at ${new Date().toISOString()}`
    );

    await row.save({ session });

    promotedCount += 1;
    promotedQty += n(row.qty);

    if (shouldSyncOrder(row.refType) && row.refId) {
      orderIdsToSync.add(String(row.refId));
    }
  }

  for (const orderId of orderIdsToSync) {
    await syncOrderIfNeeded({
      refType: "order",
      refId: orderId,
      session,
    });
  }

  return {
    productId: String(productId),
    variantId: variantId ? String(variantId) : null,
    checkedCount: list.length,
    promotedCount,
    promotedQty,
    skippedNonConfirmed,
    skippedInsufficientStock,
    excludedReservationIds: excludedIds.map(String),
  };
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
/* ---------------------------------------------------
   API: list reservations
--------------------------------------------------- */
export async function listReservations(req, res) {
  try {
    const {
      productId,
      variantId,

      status,
      refType,
      refId,
      refIds,

      productCode,
      productTitle,
      orderNumber,
      reservationKey,

      page = 1,
      limit = 50,
      all = false,
    } = req.query || {};

    const filter = {};

    const toArray = (value) => {
      if (value == null) return [];

      if (Array.isArray(value)) {
        return value.flatMap(toArray);
      }

      if (typeof value === "string") {
        return value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
      }

      return [String(value).trim()].filter(Boolean);
    };

    const escapeRegex = (value = "") =>
      String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    /* ---------------------------------------------------
       ObjectId filters
    --------------------------------------------------- */

    if (productId) {
      if (!isObjectId(productId)) {
        return res.status(400).json({
          ok: false,
          message: "Invalid productId",
        });
      }

      filter.productId = oid(productId);
    }

    if (variantId) {
      if (!isObjectId(variantId)) {
        return res.status(400).json({
          ok: false,
          message: "Invalid variantId",
        });
      }

      filter.variantId = oid(variantId);
    }

    if (refId) {
      if (!isObjectId(refId)) {
        return res.status(400).json({
          ok: false,
          message: "Invalid refId",
        });
      }

      filter.refId = oid(refId);
    }

    if (refIds) {
      const rawRefIds = toArray(refIds);

      if (!rawRefIds.length) {
        return res.status(400).json({
          ok: false,
          message: "Invalid refIds",
        });
      }

      const invalidRefIds = rawRefIds.filter(
        (id) => !isObjectId(id)
      );

      if (invalidRefIds.length) {
        return res.status(400).json({
          ok: false,
          message: "One or more refIds are invalid",
          invalidRefIds,
        });
      }

      filter.refId = {
        $in: rawRefIds.map((id) => oid(id)),
      };
    }

    /* ---------------------------------------------------
       Enum filters
    --------------------------------------------------- */

    if (status) {
      const parsedStatus = s(status).toLowerCase();

      if (!allowedStatuses.has(parsedStatus)) {
        return res.status(400).json({
          ok: false,
          message: "Invalid status",
        });
      }

      filter.status = parsedStatus;
    }

    if (refType) {
      const parsedRefType = s(refType).toLowerCase();

      if (!allowedRefTypes.has(parsedRefType)) {
        return res.status(400).json({
          ok: false,
          message: "Invalid refType",
        });
      }

      filter.refType = parsedRefType;
    }

    /* ---------------------------------------------------
       Search filters

       Partial and case-insensitive search makes the
       admin filters easier to use.
    --------------------------------------------------- */

    if (productCode) {
      filter.productCode = {
        $regex: escapeRegex(s(productCode)),
        $options: "i",
      };
    }

    if (productTitle) {
      filter.productTitle = {
        $regex: escapeRegex(s(productTitle)),
        $options: "i",
      };
    }

    if (orderNumber) {
      filter.orderNumber = {
        $regex: escapeRegex(s(orderNumber)),
        $options: "i",
      };
    }

    if (reservationKey) {
      filter.reservationKey = {
        $regex: escapeRegex(s(reservationKey)),
        $options: "i",
      };
    }

    /* ---------------------------------------------------
       Pagination
    --------------------------------------------------- */

    const wantsAll =
      String(all).trim().toLowerCase() === "true" ||
      String(limit).trim() === "0";

    const safePage = Math.max(
      1,
      Number.parseInt(page, 10) || 1
    );

    const safeLimit = Math.min(
      200,
      Math.max(1, Number.parseInt(limit, 10) || 50)
    );

    const skip = (safePage - 1) * safeLimit;

    const total = await InventoryReservation.countDocuments(filter);

    const totalPages = wantsAll
      ? 1
      : Math.max(1, Math.ceil(total / safeLimit));

    // Prevent requesting a page beyond the last available page.
    const finalPage = wantsAll
      ? 1
      : Math.min(safePage, totalPages);

    const finalSkip = (finalPage - 1) * safeLimit;

    let query = InventoryReservation.find(filter)
      .sort({
        createdAt: -1,
        _id: -1,
      })
      .lean();

    if (!wantsAll) {
      query = query.skip(finalSkip).limit(safeLimit);
    }

    const data = await query;

    return res.json({
      ok: true,

      data,

      // Number of records returned in current response.
      count: data.length,

      // Total records matching the filters.
      total,

      page: finalPage,

      limit: wantsAll ? data.length : safeLimit,

      pages: totalPages,

      hasNextPage: !wantsAll && finalPage < totalPages,
      hasPreviousPage: !wantsAll && finalPage > 1,

      all: wantsAll,
    });
  } catch (error) {
    return sendErr(
      res,
      error,
      "Failed to list reservations"
    );
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

/* ---------------------------------------------------
   ADMIN REPAIR: reserved -> pending

   Behaviour:
   1. Reserved stock is released.
   2. Current reservation becomes pending.
   3. Released stock is offered to OTHER pending rows.
   4. Current row is excluded from immediate reconciliation,
      otherwise the same old FIFO row may reserve itself again.
--------------------------------------------------- */
export async function moveReservationToPending(req, res) {
  const { id } = req.params;
  const {
    reason = "Moved to pending by admin",
    reconcile = true,
  } = req.body || {};

  if (!isObjectId(id)) {
    return res.status(400).json({
      ok: false,
      message: "Invalid reservation id",
    });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const reservation = await InventoryReservation.findById(id).session(
      session
    );

    if (!reservation) {
      throw new Error("Reservation not found");
    }

    if (reservation.status !== "reserved") {
      throw new Error(
        "Only reserved reservations can be moved to pending"
      );
    }

    const productId = reservation.productId;
    const variantId = reservation.variantId || null;
    const oldStatus = reservation.status;

    await releaseReservedStock({
      productId,
      variantId,
      qty: reservation.qty,
      session,
    });

    reservation.status = "pending";
    reservation.reservedAt = null;
    reservation.releasedAt = null;
    reservation.consumedAt = null;
    reservation.expiredAt = null;

    reservation.notes = appendNote(
      reservation.notes,
      `Moved reserved → pending: ${s(reason) || "Admin repair"}`
    );

    await reservation.save({ session });

    await syncOrderIfNeeded({
      refType: reservation.refType,
      refId: reservation.refId,
      session,
    });

    let reconcileSummary = null;

    if (reconcile !== false) {
      reconcileSummary = await reconcilePendingReservationsInternal({
        productId,
        variantId,
        excludeReservationIds: [reservation._id],
        session,
      });
    }

    await session.commitTransaction();

    return res.json({
      ok: true,
      message: "Reservation moved to pending",
      reservation,
      summary: {
        reservationId: String(reservation._id),
        oldStatus,
        newStatus: reservation.status,
        releasedQty: n(reservation.qty),
        reconciliation: reconcileSummary,
      },
    });
  } catch (e) {
    await session.abortTransaction();
    return sendErr(
      res,
      e,
      "Failed to move reservation to pending"
    );
  } finally {
    session.endSession();
  }
}

/* ---------------------------------------------------
   ADMIN REPAIR: transfer reserved inventory

   Transfers reservation ownership from one order
   to another without changing product stock or
   reservedStock.

   Supports:
   - full transfer
   - partial quantity transfer
   - target pending reservation conversion
   - target reserved reservation merge
--------------------------------------------------- */
export async function transferReservation(req, res) {
  const { id } = req.params;

  const {
    targetOrderNumber,
    qty: requestedQty,
    reason = "Reservation transferred by admin",
  } = req.body || {};

  if (!isObjectId(id)) {
    return res.status(400).json({
      ok: false,
      message: "Invalid source reservation id",
    });
  }

  const targetOrderNo = s(targetOrderNumber);

  if (!targetOrderNo) {
    return res.status(400).json({
      ok: false,
      message: "targetOrderNumber is required",
    });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    /* -------------------------------------------------
       Source reservation
    ------------------------------------------------- */

    const sourceReservation =
      await InventoryReservation.findById(id).session(session);

    if (!sourceReservation) {
      throw new Error("Source reservation not found");
    }

    if (sourceReservation.status !== "reserved") {
      throw new Error(
        "Only reserved reservations can be transferred"
      );
    }

    if (sourceReservation.refType !== "order") {
      throw new Error(
        "Only order reservations can be transferred"
      );
    }

    /* -------------------------------------------------
       Target order
    ------------------------------------------------- */

    const targetOrder = await Order.findOne({
      orderNumber: targetOrderNo,
    })
      .select(
        "_id orderNumber isConfirmed confirmedAt fulfillmentStatus items"
      )
      .session(session);

    if (!targetOrder) {
      throw new Error("Target order not found");
    }

    if (
      String(targetOrder._id) ===
      String(sourceReservation.refId)
    ) {
      throw new Error(
        "Source and target orders cannot be the same"
      );
    }

    const targetConfirmed =
      Boolean(targetOrder.isConfirmed) ||
      Boolean(targetOrder.confirmedAt);

    if (!targetConfirmed) {
      throw new Error(
        "Target order must be confirmed before transferring reservation"
      );
    }

    const productId = sourceReservation.productId;
    const variantId = sourceReservation.variantId || null;

    /* -------------------------------------------------
       Check target order contains same item
    ------------------------------------------------- */

    const targetRequiredQty = getOrderRequiredQtyForProduct({
      order: targetOrder,
      productId,
      variantId,
    });

    if (targetRequiredQty <= 0) {
      throw new Error(
        "Target order does not contain this product and variant"
      );
    }

    /* -------------------------------------------------
       Current target reserved quantity
    ------------------------------------------------- */

    const targetReservedRows =
      await InventoryReservation.find({
        refType: "order",
        refId: targetOrder._id,
        productId,
        ...(variantId
          ? { variantId }
          : { variantId: null }),
        status: "reserved",
      }).session(session);

    const currentTargetReservedQty =
      targetReservedRows.reduce(
        (total, row) => total + n(row.qty),
        0
      );

    const targetRemainingQty = Math.max(
      0,
      targetRequiredQty - currentTargetReservedQty
    );

    if (targetRemainingQty <= 0) {
      throw new Error(
        "Target order is already fully reserved for this product"
      );
    }

    /* -------------------------------------------------
       Transfer quantity
    ------------------------------------------------- */

    const sourceQty = n(sourceReservation.qty);

    const transferQty =
      requestedQty == null || requestedQty === ""
        ? Math.min(sourceQty, targetRemainingQty)
        : Number(requestedQty);

    if (
      !Number.isFinite(transferQty) ||
      transferQty <= 0
    ) {
      throw new Error("Transfer qty must be greater than 0");
    }

    if (transferQty > sourceQty) {
      throw new Error(
        `Transfer qty cannot exceed source reserved qty ${sourceQty}`
      );
    }

    if (transferQty > targetRemainingQty) {
      throw new Error(
        `Target order only requires ${targetRemainingQty} more reserved unit(s)`
      );
    }

    const targetReservationKey = buildReservationKey({
      refType: "order",
      refId: targetOrder._id,
      productId,
      variantId,
    });

    /* -------------------------------------------------
       Target pending reservation
    ------------------------------------------------- */

    const targetPending =
      await InventoryReservation.findOne({
        refType: "order",
        refId: targetOrder._id,
        productId,
        ...(variantId
          ? { variantId }
          : { variantId: null }),
        status: "pending",
      }).session(session);

    let targetReserved = targetReservedRows[0] || null;

    /* -------------------------------------------------
       Case 1:
       Target already has a reserved row.
       Merge transferred qty into it.
    ------------------------------------------------- */

    if (targetReserved) {
      targetReserved.qty =
        n(targetReserved.qty) + transferQty;

      targetReserved.notes = appendNote(
        targetReserved.notes,
        `Received ${transferQty} reserved unit(s) from order ${sourceReservation.orderNumber || sourceReservation.refId
        }. Reason: ${s(reason)}`
      );

      await targetReserved.save({ session });

      /*
       Reduce target pending row because the transferred
       reservation is now fulfilling that pending demand.
      */
      if (targetPending) {
        if (n(targetPending.qty) <= transferQty) {
          await InventoryReservation.deleteOne({
            _id: targetPending._id,
          }).session(session);
        } else {
          targetPending.qty =
            n(targetPending.qty) - transferQty;

          targetPending.notes = appendNote(
            targetPending.notes,
            `${transferQty} unit(s) fulfilled through reservation transfer`
          );

          await targetPending.save({ session });
        }
      }
    }

    /* -------------------------------------------------
       Case 2:
       Target only has pending row.
    ------------------------------------------------- */

    else if (targetPending) {
      const pendingQty = n(targetPending.qty);

      if (pendingQty <= transferQty) {
        /*
         Convert full pending row into reserved.
         Any extra transferred qty is included in this row.
        */
        targetPending.qty = transferQty;
        targetPending.status = "reserved";
        targetPending.reservedAt = new Date();
        targetPending.releasedAt = null;
        targetPending.expiredAt = null;

        targetPending.notes = appendNote(
          targetPending.notes,
          `Converted pending → reserved using ${transferQty} unit(s) transferred from order ${sourceReservation.orderNumber || sourceReservation.refId
          }. Reason: ${s(reason)}`
        );

        await targetPending.save({ session });

        targetReserved = targetPending;
      } else {
        /*
         Pending demand is larger than transfer quantity.
         Reduce pending row and create separate reserved row.
        */
        targetPending.qty = pendingQty - transferQty;

        targetPending.notes = appendNote(
          targetPending.notes,
          `${transferQty} unit(s) fulfilled through reservation transfer`
        );

        await targetPending.save({ session });

        const [createdReserved] =
          await InventoryReservation.create(
            [
              {
                productModel:
                  sourceReservation.productModel ||
                  "Product",

                productId,
                variantId,

                qty: transferQty,
                status: "reserved",

                refType: "order",
                refId: targetOrder._id,

                reservationKey: targetReservationKey,

                productCode:
                  sourceReservation.productCode,

                productTitle:
                  sourceReservation.productTitle,

                productImage:
                  sourceReservation.productImage,

                orderNumber: targetOrder.orderNumber,

                variantSku:
                  sourceReservation.variantSku,

                selectedSize:
                  sourceReservation.selectedSize,

                selectedColor:
                  sourceReservation.selectedColor,

                reservedAt: new Date(),

                notes: `Transferred ${transferQty} reserved unit(s) from order ${sourceReservation.orderNumber ||
                  sourceReservation.refId
                  }. Reason: ${s(reason)}`,
              },
            ],
            { session }
          );

        targetReserved = createdReserved;
      }
    }

    /* -------------------------------------------------
       Case 3:
       No active reservation exists for target.
       Create reserved row directly.
    ------------------------------------------------- */

    else {
      const [createdReserved] =
        await InventoryReservation.create(
          [
            {
              productModel:
                sourceReservation.productModel || "Product",

              productId,
              variantId,

              qty: transferQty,
              status: "reserved",

              refType: "order",
              refId: targetOrder._id,

              reservationKey: targetReservationKey,

              productCode:
                sourceReservation.productCode,

              productTitle:
                sourceReservation.productTitle,

              productImage:
                sourceReservation.productImage,

              orderNumber: targetOrder.orderNumber,

              variantSku:
                sourceReservation.variantSku,

              selectedSize:
                sourceReservation.selectedSize,

              selectedColor:
                sourceReservation.selectedColor,

              reservedAt: new Date(),

              notes: `Transferred ${transferQty} reserved unit(s) from order ${sourceReservation.orderNumber ||
                sourceReservation.refId
                }. Reason: ${s(reason)}`,
            },
          ],
          { session }
        );

      targetReserved = createdReserved;
    }

    /* -------------------------------------------------
       Update source reservation

       Important:
       Do not release reservedStock because reservation
       remains reserved and only its ownership changes.
    ------------------------------------------------- */

    if (transferQty === sourceQty) {
      await InventoryReservation.deleteOne({
        _id: sourceReservation._id,
      }).session(session);
    } else {
      sourceReservation.qty = sourceQty - transferQty;

      sourceReservation.notes = appendNote(
        sourceReservation.notes,
        `Transferred ${transferQty} reserved unit(s) to order ${targetOrder.orderNumber}. Reason: ${s(
          reason
        )}`
      );

      await sourceReservation.save({ session });
    }

    /* -------------------------------------------------
       Sync both orders
    ------------------------------------------------- */

    await syncOrderIfNeeded({
      refType: "order",
      refId: sourceReservation.refId,
      session,
    });

    await syncOrderIfNeeded({
      refType: "order",
      refId: targetOrder._id,
      session,
    });

    await session.commitTransaction();

    return res.json({
      ok: true,
      message: "Reservation transferred successfully",

      summary: {
        sourceReservationId: String(
          sourceReservation._id
        ),

        sourceOrderId: String(
          sourceReservation.refId
        ),

        sourceOrderNumber:
          sourceReservation.orderNumber || "",

        targetOrderId: String(targetOrder._id),

        targetOrderNumber:
          targetOrder.orderNumber,

        productId: String(productId),

        variantId: variantId
          ? String(variantId)
          : null,

        transferredQty: transferQty,

        sourceRemainingQty:
          sourceQty - transferQty,

        targetRequiredQty,

        targetReservedQtyAfter:
          currentTargetReservedQty + transferQty,

        targetRemainingQtyAfter: Math.max(
          0,
          targetRemainingQty - transferQty
        ),

        targetReservationId:
          targetReserved?._id
            ? String(targetReserved._id)
            : null,
      },
    });
  } catch (error) {
    await session.abortTransaction();

    return sendErr(
      res,
      error,
      "Failed to transfer reservation"
    );
  } finally {
    session.endSession();
  }
}

/* ---------------------------------------------------
   ADMIN REPAIR: permanently delete reservation

   Allowed:
   - pending
   - reserved
   - released
   - expired

   Consumed rows are protected because inventory has already
   been physically deducted.
--------------------------------------------------- */
export async function deleteReservation(req, res) {
  const { id } = req.params;
  const {
    reason = "Deleted by admin",
    reconcile = true,
    allowFinalized = false,
  } = req.body || {};

  if (!isObjectId(id)) {
    return res.status(400).json({
      ok: false,
      message: "Invalid reservation id",
    });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const reservation = await InventoryReservation.findById(id).session(
      session
    );

    if (!reservation) {
      throw new Error("Reservation not found");
    }

    const oldStatus = s(reservation.status);

    if (oldStatus === "consumed" && allowFinalized !== true) {
      throw new Error(
        "Consumed reservation cannot be deleted. Use an inventory adjustment instead."
      );
    }

    const productId = reservation.productId;
    const variantId = reservation.variantId || null;
    const qty = n(reservation.qty);
    const refType = reservation.refType;
    const refId = reservation.refId;
    const orderNumber = reservation.orderNumber || "";

    let releasedReservedQty = 0;

    if (oldStatus === "reserved") {
      await releaseReservedStock({
        productId,
        variantId,
        qty,
        session,
      });

      releasedReservedQty = qty;
    }

    await InventoryReservation.deleteOne({
      _id: reservation._id,
    }).session(session);

    await syncOrderIfNeeded({
      refType,
      refId,
      session,
    });

    let reconcileSummary = null;

    if (oldStatus === "reserved" && reconcile !== false) {
      reconcileSummary = await reconcilePendingReservationsInternal({
        productId,
        variantId,
        session,
      });
    }

    await session.commitTransaction();

    return res.json({
      ok: true,
      message: "Reservation permanently deleted",
      summary: {
        deletedReservationId: String(id),
        orderNumber,
        oldStatus,
        qty,
        releasedReservedQty,
        reason: s(reason),
        reconciliation: reconcileSummary,
      },
    });
  } catch (e) {
    await session.abortTransaction();
    return sendErr(res, e, "Failed to delete reservation");
  } finally {
    session.endSession();
  }
}


/* ---------------------------------------------------
   ADMIN REPAIR:
   detect stale pending ORDER reservations
--------------------------------------------------- */

export async function detectInvalidPendingOrderReservations(
  req,
  res
) {
  try {
    const limit = Math.min(
      Math.max(1, Number(req.query?.limit || 500)),
      1000
    );

    const pendingRows =
      await InventoryReservation.find({
        status: "pending",
        refType: "order",
      })
        .sort({
          createdAt: 1,
          _id: 1,
        })
        .limit(limit);

    const invalidRows = [];
    const reviewRows = [];

    let validCount = 0;

    for (const row of pendingRows) {
      const validation =
        await validatePendingOrderReservation(row);

      if (validation.valid) {
        validCount += 1;
        continue;
      }

      const order = validation.order;

      const data = {
        reservationId: String(row._id),

        orderId: row.refId
          ? String(row.refId)
          : "",

        orderNumber:
          row.orderNumber ||
          order?.orderNumber ||
          "",

        productId: String(row.productId),

        variantId: row.variantId
          ? String(row.variantId)
          : null,

        productCode: row.productCode || "",
        productTitle: row.productTitle || "",

        selectedSize: row.selectedSize || "",
        selectedColor: row.selectedColor || "",

        qty: n(row.qty),

        remainingQty: n(
          validation.remainingQty
        ),

        reservationStatus: row.status,

        fulfillmentStatus:
          order?.fulfillmentStatus || "",

        repairReason: validation.reason,

        safeToDelete:
          validation.safeToDelete === true,

        createdAt: row.createdAt,
      };

      if (validation.safeToDelete) {
        invalidRows.push(data);
      } else {
        reviewRows.push(data);
      }
    }

    return res.json({
      ok: true,

      summary: {
        checked: pendingRows.length,

        valid: validCount,

        invalid: invalidRows.length,

        needsReview: reviewRows.length,

        safeToDelete: invalidRows.length,
      },

      rows: invalidRows,

      reviewRows,
    });
  } catch (error) {
    return sendErr(
      res,
      error,
      "Failed to detect invalid pending reservations"
    );
  }
}

/* ---------------------------------------------------
   ADMIN REPAIR:
   safely bulk-delete invalid pending order rows

   IMPORTANT:
   - pending only
   - order only
   - validation runs AGAIN server-side
   - no reservedStock / stock mutation
--------------------------------------------------- */

export async function bulkDeleteInvalidPendingOrderReservations(
  req,
  res
) {
  const rawIds = Array.isArray(req.body?.ids)
    ? req.body.ids
    : [];

  const ids = Array.from(
    new Set(
      rawIds
        .map((id) => s(id))
        .filter(isObjectId)
    )
  );

  if (!ids.length) {
    return res.status(400).json({
      ok: false,
      message:
        "At least one valid reservation id is required",
    });
  }

  if (ids.length > 500) {
    return res.status(400).json({
      ok: false,
      message:
        "Maximum 500 reservations can be repaired at once",
    });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const reservations =
      await InventoryReservation.find({
        _id: {
          $in: ids.map(oid),
        },
        status: "pending",
        refType: "order",
      }).session(session);

    const deleted = [];
    const rejected = [];
    const orderIdsToSync = new Set();

    for (const row of reservations) {
      // Always revalidate server-side.
      const validation =
        await validatePendingOrderReservation(
          row,
          { session }
        );

      if (
        validation.valid ||
        validation.safeToDelete !== true
      ) {
        rejected.push({
          reservationId: String(row._id),
          orderNumber: row.orderNumber || "",
          reason:
            validation.reason ||
            "RESERVATION_STILL_VALID",
        });

        continue;
      }

      await InventoryReservation.deleteOne({
        _id: row._id,
        status: "pending",
        refType: "order",
      }).session(session);

      /*
       * Only sync when linked order actually exists.
       *
       * ORDER_NOT_FOUND rows must simply be deleted.
       */
      if (
        validation.order?._id &&
        isObjectId(validation.order._id)
      ) {
        orderIdsToSync.add(
          String(validation.order._id)
        );
      }

      deleted.push({
        reservationId: String(row._id),
        orderNumber: row.orderNumber || "",
        productCode: row.productCode || "",
        qty: n(row.qty),
        reason: validation.reason,
      });
    }

    /*
     * Keep allocatedQty consistent for existing orders.
     *
     * Pending reservation deletion does not change
     * product.stock or product.reservedStock.
     */
    for (const orderId of orderIdsToSync) {
      if (!isObjectId(orderId)) continue;

      const orderExists =
        await Order.exists({
          _id: oid(orderId),
        }).session(session);

      if (!orderExists) continue;

      await syncOrderIfNeeded({
        refType: "order",
        refId: orderId,
        session,
      });
    }

    await session.commitTransaction();

    return res.json({
      ok: true,
      message:
        "Invalid pending reservations repaired",

      summary: {
        requested: ids.length,
        foundPending: reservations.length,
        deleted: deleted.length,
        rejected: rejected.length,
      },

      deleted,
      rejected,
    });
  } catch (error) {
    await session.abortTransaction();

    return sendErr(
      res,
      error,
      "Failed to bulk repair pending reservations"
    );
  } finally {
    session.endSession();
  }
}


