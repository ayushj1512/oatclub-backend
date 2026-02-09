// InventoryReservation/InventoryReservationController.js
import mongoose from "mongoose";
import Product from "../Products/Products.js";
import InventoryReservation from "../InventoryReservation/InventoryReservation.js";

/* ---------------- utils ---------------- */
const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const allowedRefTypes = new Set(["order", "production", "manual"]);

const httpCodeFromMsg = (msg = "") => {
  const m = String(msg).toLowerCase();
  if (m.startsWith("invalid")) return 400;
  if (m.includes("qty must be")) return 400;
  if (m.includes("variantid required")) return 400;
  if (m.includes("only 'reserved'")) return 409;
  if (m.includes("insufficient")) return 409;
  if (m.includes("not found")) return 404;
  if (m.includes("update failed")) return 409;
  return 500;
};

const sendErr = (res, err, fallback = "Server Error") => {
  const msg = String(err?.message || fallback);
  const code = httpCodeFromMsg(msg);
  console.error("[InventoryReservation]", code, msg, err);
  return res.status(code).json({ ok: false, message: msg });
};

// ✅ Atomic reserve (prevents oversell/race)
// ✅ Atomic reserve (prevents oversell/race)
const tryReserveAtomic = async ({ productId, variantId, qty, session }) => {
  const q = Math.max(1, Number(qty || 0));

  // -----------------------
  // SIMPLE product (root stock)
  // -----------------------
  if (!variantId) {
    const upd = await Product.updateOne(
      {
        _id: productId,
        $expr: { $gte: [{ $subtract: ["$stock", "$reservedStock"] }, q] },
      },
      { $inc: { reservedStock: q } },
      { session }
    );

    // ✅ must be modified, not just matched
    if (!upd.modifiedCount) throw new Error("Insufficient stock to reserve.");
    return;
  }

  // -----------------------
  // VARIABLE product (variant-level) ✅ CORRECT + RELIABLE
  // - Stock check happens in QUERY via $expr (so matchedCount is meaningful)
  // - Update uses arrayFilters to increment only the target variant
  // -----------------------
  const vId = new mongoose.Types.ObjectId(String(variantId));

  const upd = await Product.updateOne(
    {
      _id: productId,
      $expr: {
        $let: {
          vars: {
            v: {
              $first: {
                $filter: {
                  input: "$variants",
                  as: "v",
                  cond: { $eq: ["$$v._id", vId] },
                },
              },
            },
          },
          in: {
            $and: [
              { $ne: ["$$v", null] },
              { $gte: [{ $subtract: ["$$v.stock", "$$v.reservedStock"] }, q] },
            ],
          },
        },
      },
    },
    { $inc: { "variants.$[v].reservedStock": q } },
    { arrayFilters: [{ "v._id": vId }], session }
  );

  // ✅ if not modified => either variant not found OR insufficient
  if (!upd.modifiedCount) throw new Error("Insufficient stock to reserve.");
};


// ✅ Release/Consume/Expire (variant consumes in 2 calls to avoid conflict)
const applyReservationTransition = async ({ r, nextStatus, reason = "", session }) => {
  if (!r) throw new Error("Reservation not found");
  if (r.status !== "reserved") throw new Error("Only 'reserved' reservations can be updated");

  const productId = oid(r.productId);
  const variantId = r.variantId ? oid(r.variantId) : null;
  const qty = Math.max(1, Number(r.qty || 0));

  if (variantId) {
    // 1) reservedStock -qty
    let upd = await Product.updateOne(
      { _id: productId },
      { $inc: { "variants.$[v].reservedStock": -qty } },
      { arrayFilters: [{ "v._id": variantId }], session }
    );
    if (!upd.matchedCount) throw new Error("Product not found");
    if (!upd.modifiedCount) throw new Error("Variant not found / update failed");

    // 2) stock -qty (only on consume)
    if (nextStatus === "consumed") {
      upd = await Product.updateOne(
        { _id: productId },
        { $inc: { "variants.$[v].stock": -qty } },
        { arrayFilters: [{ "v._id": variantId }], session }
      );
      if (!upd.matchedCount) throw new Error("Product not found");
      if (!upd.modifiedCount) throw new Error("Variant stock update failed");
    }
  } else {
    const inc = { reservedStock: -qty };
    if (nextStatus === "consumed") inc.stock = -qty;

    const upd = await Product.updateOne({ _id: productId }, { $inc: inc }, { session });
    if (!upd.matchedCount) throw new Error("Product not found / update failed");
  }

  r.status = nextStatus;

  if (reason) {
    const tag =
      nextStatus === "released" ? "Released" :
      nextStatus === "consumed" ? "Consumed" :
      "Expired";
    r.notes = (r.notes ? `${r.notes}\n` : "") + `${tag}: ${reason}`;
  }

  await r.save({ session });
  return r;
};

/* ---------------- INTERNAL create ---------------- */
export async function createReservationInternal({
  productId,
  variantId = null,
  qty,
  refType,
  refId,
  expiresAt = null,
  notes = "",

  // denormalized optional fields
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
  if (!Number.isFinite(Number(qty)) || Number(qty) <= 0) throw new Error("qty must be > 0");
  if (!allowedRefTypes.has(refType)) throw new Error("Invalid refType");
  if (!isObjectId(refId)) throw new Error("Invalid refId");

  const qtyNum = Math.max(1, Number(qty));
  const vId = variantId ? oid(variantId) : null;

  // fetch product for productCode/title/image (not for availability)
  const product = await Product.findById(productId).session(session);
  if (!product) throw new Error("Product not found");

  // ✅ atomic reserve
  await tryReserveAtomic({ productId: product._id, variantId: vId, qty: qtyNum, session });

  const [reservation] = await InventoryReservation.create(
    [
      {
        productId: product._id,
        productCode: String(product.productCode || "").trim(),

        productTitle: String(productTitle || product?.title || "").trim(),
        productImage: String(productImage || product?.thumbnail || product?.images?.[0] || "").trim(),
        orderNumber: String(orderNumber || "").trim(),

        variantId: vId,
        variantSku: String(variantSku || "").trim(),
        selectedSize: String(selectedSize || "").trim(),
        selectedColor: String(selectedColor || "").trim(),

        qty: qtyNum,
        status: "reserved",
        refType,
        refId: oid(refId),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        notes: String(notes || ""),
      },
    ],
    { session }
  );

  return reservation;
}

/* ---------------- API: create ---------------- */
export async function createReservation(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const reservation = await createReservationInternal({ ...(req.body || {}), session });
    await session.commitTransaction();
    return res.status(201).json({ ok: true, reservation });
  } catch (e) {
    await session.abortTransaction();
    return sendErr(res, e, "Failed to create reservation");
  } finally {
    session.endSession();
  }
}

/* ---------------- API: release/consume/expire ---------------- */
export async function releaseReservation(req, res) {
  const { id } = req.params;
  const { reason = "" } = req.body || {};
  if (!isObjectId(id)) return res.status(400).json({ ok: false, message: "Invalid reservation id" });

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const r = await InventoryReservation.findById(id).session(session);
    const reservation = await applyReservationTransition({ r, nextStatus: "released", reason, session });
    await session.commitTransaction();
    return res.json({ ok: true, reservation });
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
  if (!isObjectId(id)) return res.status(400).json({ ok: false, message: "Invalid reservation id" });

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const r = await InventoryReservation.findById(id).session(session);
    const reservation = await applyReservationTransition({ r, nextStatus: "consumed", reason, session });
    await session.commitTransaction();
    return res.json({ ok: true, reservation });
  } catch (e) {
    await session.abortTransaction();
    return sendErr(res, e, "Failed to consume reservation");
  } finally {
    session.endSession();
  }
}

export async function expireReservation(req, res) {
  const { id } = req.params;
  if (!isObjectId(id)) return res.status(400).json({ ok: false, message: "Invalid reservation id" });

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const r = await InventoryReservation.findById(id).session(session);
    const reservation = await applyReservationTransition({ r, nextStatus: "expired", reason: "", session });
    await session.commitTransaction();
    return res.json({ ok: true, reservation });
  } catch (e) {
    await session.abortTransaction();
    return sendErr(res, e, "Failed to expire reservation");
  } finally {
    session.endSession();
  }
}

/* ---------------- API: list/get ---------------- */
export async function listReservations(req, res) {
  try {
    const { productId, variantId, status, refType, refId, productCode, orderNumber } = req.query || {};
    const filter = {};

    if (productId) {
      if (!isObjectId(productId)) return res.status(400).json({ ok: false, message: "Invalid productId" });
      filter.productId = oid(productId);
    }
    if (variantId) {
      if (!isObjectId(variantId)) return res.status(400).json({ ok: false, message: "Invalid variantId" });
      filter.variantId = oid(variantId);
    }
    if (refId) {
      if (!isObjectId(refId)) return res.status(400).json({ ok: false, message: "Invalid refId" });
      filter.refId = oid(refId);
    }

    if (productCode) filter.productCode = String(productCode).trim();
    if (orderNumber) filter.orderNumber = String(orderNumber).trim();
    if (status) filter.status = String(status).trim();
    if (refType) filter.refType = String(refType).trim();

    const data = await InventoryReservation.find(filter).sort({ createdAt: -1 }).limit(500);
    return res.json({ ok: true, count: data.length, data });
  } catch (e) {
    return sendErr(res, e, "Failed to list reservations");
  }
}

export async function getReservation(req, res) {
  const { id } = req.params;
  if (!isObjectId(id)) return res.status(400).json({ ok: false, message: "Invalid reservation id" });

  try {
    const reservation = await InventoryReservation.findById(id);
    if (!reservation) return res.status(404).json({ ok: false, message: "Reservation not found" });
    return res.json({ ok: true, reservation });
  } catch (e) {
    return sendErr(res, e, "Failed to get reservation");
  }
}

/* ---------------- API: expire due ---------------- */
export async function expireDueReservations(req, res) {
  const now = new Date();
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const due = await InventoryReservation.find({
      status: "reserved",
      expiresAt: { $ne: null, $lte: now },
    })
      .sort({ expiresAt: 1 })
      .limit(200)
      .session(session);

    for (const r of due) {
      await applyReservationTransition({ r, nextStatus: "expired", reason: "", session });
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


// ✅ Consume all RESERVED reservations for an order (idempotent)
export async function consumeReservationsInternalByOrder({
  orderId,
  reason = "packed",
  session,
}) {
  if (!mongoose.Types.ObjectId.isValid(String(orderId || ""))) {
    throw new Error("Invalid orderId");
  }

  const list = await InventoryReservation.find({
    refType: "order",
    refId: new mongoose.Types.ObjectId(String(orderId)),
    status: "reserved",
  }).session(session);

  for (const r of list) {
    await applyReservationTransition({
      r,
      nextStatus: "consumed",
      reason,
      session,
    });
  }

  return { consumedCount: list.length };
}
