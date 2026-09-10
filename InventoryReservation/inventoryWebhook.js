import mongoose from "mongoose";
import Order from "../Orders/Orders.js";
import InventoryReservation from "../InventoryReservation/InventoryReservation.js";
import {
  createReservationInternal,
  reconcilePendingReservationsInternal,
} from "../InventoryReservation/InventoryReservationController.js";
/* ---------------------------------------------------
   helpers
--------------------------------------------------- */
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const s = (v) => String(v ?? "").trim();
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));

const keyOf = (productId, variantId) =>
  `${String(productId)}::${variantId ? String(variantId) : "root"}`;

const buildReservationKey = ({ refType, refId, productId, variantId = null }) =>
  `${s(refType)}:${s(refId)}:${s(productId)}:${variantId ? s(variantId) : "root"}`;

const requiredQtyOf = (item) => {
  const qty = Math.max(0, n(item?.quantity));
  const shipped = Math.max(
    0,
    n(item?.fulfillment?.shippedQty),
  );

  // Active reservation quantity is deducted separately
  // through alreadyMap, so allocatedQty is not deducted here.
  return Math.max(0, qty - shipped);
};

/* ---------------------------------------------------
   INTERNAL
--------------------------------------------------- */
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
  const log = (...args) => debug && console.log(`🧩 [${runId}]`, ...args);

 const summary = {
    runId,
    orderNumber: on,
    orderId: "",
    orderType: "",
    fulfillmentStatus: "",
    isConfirmed: false,
    itemsCount: 0,
    groups: 0,
    requestedQty: 0,
    createdCount: 0,
    reservedCount: 0,
    pendingCount: 0,
    skippedGroups: 0,
    stoppedBecause: "",
    results: [],
  };

  const order = await Order.findOne({ orderNumber: on })
    .select(
      "orderNumber orderType parentOrderId isConfirmed fulfillmentStatus items",
    )
    .session(session);

  if (!order) throw new Error("Order not found");

  const orderType = s(
    order.orderType || "shipment",
  ).toLowerCase();

  if (orderType === "parent") {
    summary.orderId = String(order._id);
    summary.fulfillmentStatus = s(order.fulfillmentStatus);
    summary.isConfirmed = !!order.isConfirmed;
    summary.itemsCount = Array.isArray(order.items)
      ? order.items.length
      : 0;

    summary.stoppedBecause = "split_parent";

    log("STOPPED_SPLIT_PARENT", {
      orderId: String(order._id),
      orderNumber: order.orderNumber,
    });

    return summary;
  }

  summary.orderId = String(order._id);
  summary.fulfillmentStatus = s(order.fulfillmentStatus);
  summary.isConfirmed = !!order.isConfirmed;
  summary.itemsCount = Array.isArray(order.items) ? order.items.length : 0;

  if (confirmedOnly && !order.isConfirmed) {
    summary.stoppedBecause = "not_confirmed";
    return summary;
  }

  if (
    Array.isArray(allowedFulfillment) &&
    allowedFulfillment.length &&
    !allowedFulfillment.includes(order.fulfillmentStatus)
  ) {
    summary.stoppedBecause = "status_not_allowed";
    return summary;
  }

  const items = Array.isArray(order.items) ? order.items : [];
  if (!items.length) {
    summary.stoppedBecause = "no_items";
    return summary;
  }

  const needMap = new Map();

  for (const it of items) {
    const productId = it?.productId?._id || it?.productId;
    if (!productId || !isObjectId(productId)) continue;

    const variantId = it?.variant?.variantId || it?.variantId || it?.variant?._id || null;
    if (variantId && !isObjectId(variantId)) continue;

    const qtyNeed = requiredQtyOf(it);    if (qtyNeed <= 0) continue;

    const k = keyOf(productId, variantId);
    const snap = it?.productSnapshot || {};
    const vSnap = it?.variant || {};

    if (!needMap.has(k)) {
      needMap.set(k, {
        productModel: s(it?.productModel || "Product"),
        productId: oid(productId),
        variantId: variantId ? oid(variantId) : null,
        qtyNeed,
        productTitle: s(snap.title),
        productImage: s(
          snap.thumbnail ||
            (Array.isArray(snap.images) && snap.images.length ? snap.images[0] : "")
        ),
        variantSku: s(vSnap.sku),
        selectedSize: s(it?.selectedSize),
        selectedColor: s(it?.selectedColor),
      });
    } else {
      needMap.get(k).qtyNeed += qtyNeed;
    }
  }

  if (!needMap.size) {
    summary.stoppedBecause = "no_pending_lines";
    return summary;
  }

  summary.groups = needMap.size;
  summary.requestedQty = Array.from(needMap.values()).reduce((sum, g) => sum + n(g.qtyNeed), 0);

  const existing = await InventoryReservation.find({
    refType: "order",
    refId: oid(order._id),
    status: { $in: ["pending", "reserved"] },
  })
    .select("productId variantId qty")
    .session(session);

  const alreadyMap = new Map();
  for (const r of existing) {
    const k = keyOf(r.productId, r.variantId || null);
    alreadyMap.set(k, (alreadyMap.get(k) || 0) + n(r.qty));
  }

  for (const [k, g] of needMap.entries()) {
    const alreadyActive = alreadyMap.get(k) || 0;
    const missing = Math.max(0, n(g.qtyNeed) - alreadyActive);

    if (missing <= 0) {
      summary.skippedGroups += 1;
      summary.results.push({
        key: k,
        productId: String(g.productId),
        variantId: g.variantId ? String(g.variantId) : null,
        needed: g.qtyNeed,
        alreadyActive,
        addedNow: 0,
        status: "skipped_already_active",
      });
      continue;
    }

    const reservation = await createReservationInternal({
      productModel: g.productModel,
      productId: g.productId,
      variantId: g.variantId,
      qty: missing,
      refType: "order",
      refId: oid(order._id),
      reservationKey: buildReservationKey({
        refType: "order",
        refId: order._id,
        productId: g.productId,
        variantId: g.variantId,
      }),
      notes: `Auto-reserve by order confirmation | orderNumber=${on}`,
      productTitle: g.productTitle,
      productImage: g.productImage,
      orderNumber: on,
      variantSku: g.variantSku,
      selectedSize: g.selectedSize,
      selectedColor: g.selectedColor,
      session,
    });

    summary.createdCount += 1;
    if (reservation.status === "reserved") summary.reservedCount += 1;
    if (reservation.status === "pending") summary.pendingCount += 1;

    summary.results.push({
      key: k,
      productId: String(g.productId),
      variantId: g.variantId ? String(g.variantId) : null,
      needed: g.qtyNeed,
      alreadyActive,
      addedNow: missing,
      status: reservation.status,
    });

    log("DONE GROUP", {
      key: k,
      missing,
      finalStatus: reservation.status,
    });
  }

  if (!summary.createdCount && !summary.skippedGroups) {
    summary.stoppedBecause = "no_action";
  }

  return summary;
};

/* ---------------------------------------------------
   INTERNAL HELPER
--------------------------------------------------- */

export const ensureInventoryReservationForOrderInternal = async ({
  orderNumber,
  debug = false,
  session,
} = {}) => {
  const on = s(orderNumber);

  if (!on) {
    throw new Error("orderNumber required");
  }

  /*
   * Step 1:
   * Creates only missing reservation quantities.
   *
   * Existing active pending/reserved quantities are detected
   * inside reserveInventoryForOrderNumberInternal.
   */
  const reservationSummary =
    await reserveInventoryForOrderNumberInternal({
      orderNumber: on,
      confirmedOnly: true,
      allowedFulfillment: ["processing", "packed"],
      debug,
      session,
    });

  if (reservationSummary.stoppedBecause) {
    return {
      ...reservationSummary,
      reconciliation: [],
    };
  }

  /*
   * Step 2:
   * Recheck existing pending reservations against current stock.
   */
  const pendingRows = await InventoryReservation.find({
    refType: "order",
    refId: oid(reservationSummary.orderId),
    status: "pending",
  })
    .select("_id productId variantId")
    .session(session);

  const uniqueInventoryGroups = new Map();

  for (const row of pendingRows) {
    const key = keyOf(
      row.productId,
      row.variantId || null,
    );

    if (!uniqueInventoryGroups.has(key)) {
      uniqueInventoryGroups.set(key, {
        productId: row.productId,
        variantId: row.variantId || null,
      });
    }
  }

  const reconciliation = [];

  for (const group of uniqueInventoryGroups.values()) {
    const result =
      await reconcilePendingReservationsInternal({
        productId: group.productId,
        variantId: group.variantId,
        session,
      });

    reconciliation.push(result);
  }

  /*
   * Return final active state for verification.
   */
  const finalReservations =
    await InventoryReservation.find({
      refType: "order",
      refId: oid(reservationSummary.orderId),
      status: {
        $in: ["pending", "reserved"],
      },
    })
      .select(
        "_id productId variantId productCode selectedSize qty status reservedAt",
      )
      .session(session)
      .lean();

  return {
    ...reservationSummary,

    reconciliation,

    finalReservations,

    finalReservedCount:
      finalReservations.filter(
        (row) => row.status === "reserved",
      ).length,

    finalPendingCount:
      finalReservations.filter(
        (row) => row.status === "pending",
      ).length,
  };
};


export const reserveInventoryAfterOrderConfirmed = async ({
  orderNumber,
  debug = false,
  session,
} = {}) => {
  const on = s(orderNumber);
  if (!on) throw new Error("orderNumber required");

  return reserveInventoryForOrderNumberInternal({
    orderNumber: on,
    confirmedOnly: true,
    allowedFulfillment: ["processing", "packed"],
    debug,
    session,
  });
};

/* ---------------------------------------------------
   HTTP controller
--------------------------------------------------- */
export const reserveInventoryWebhookByOrderNumber = async (req, res) => {
  const orderNumber =
    s(req?.params?.orderNumber) ||
    s(req?.body?.orderNumber) ||
    s(req?.query?.orderNumber);

  const debug = String(req?.query?.debug || "0") === "1";

  if (!orderNumber) {
    return res.status(400).json({ ok: false, message: "orderNumber missing" });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const summary = await reserveInventoryForOrderNumberInternal({
      orderNumber,
      confirmedOnly: true,
      allowedFulfillment: ["processing", "packed"],
      debug,
      session,
    });

    await session.commitTransaction();
    return res.json({ ok: true, summary });
  } catch (e) {
    await session.abortTransaction();
    return res.status(400).json({ ok: false, message: String(e?.message || "Server error") });
  } finally {
    session.endSession();
  }
};

export const ensureInventoryReservationByOrderNumber = async (
  req,
  res,
) => {
  const orderNumber =
    s(req?.params?.orderNumber) ||
    s(req?.body?.orderNumber) ||
    s(req?.query?.orderNumber);

  const debug =
    String(req?.query?.debug || "0") === "1";

  if (!orderNumber) {
    return res.status(400).json({
      ok: false,
      message: "orderNumber missing",
    });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const summary =
      await ensureInventoryReservationForOrderInternal({
        orderNumber,
        debug,
        session,
      });

    await session.commitTransaction();

    return res.json({
      ok: true,
      message:
        summary.finalPendingCount > 0
          ? "Reservation checked; some inventory is still pending"
          : "Inventory reservation checked successfully",
      summary,
    });
  } catch (error) {
    await session.abortTransaction();

    return res.status(400).json({
      ok: false,
      message: String(
        error?.message ||
        "Failed to ensure inventory reservation",
      ),
    });
  } finally {
    session.endSession();
  }
};
