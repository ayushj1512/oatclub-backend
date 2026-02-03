// InventoryReservation/InventoryReservationController.js
import mongoose from "mongoose";
import Product from "../Products/Products.js";
import InventoryReservation from "../InventoryReservation/InventoryReservation.js";

/* ---------------- utils ---------------- */
const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const allowedRefTypes = new Set(["order", "production", "manual"]);

const sendErr = (res, err, fallback = "Server Error") => {
  const msg = String(err?.message || fallback);

  const code =
    msg.startsWith("Invalid") ? 400 :
    msg.includes("variantId required") ? 400 :
    msg.includes("qty must be") ? 400 :
    msg.includes("Only 'reserved'") ? 409 :
    msg.toLowerCase().includes("insufficient") ? 409 :
    msg.toLowerCase().includes("not found") ? 404 :
    msg.toLowerCase().includes("update failed") ? 409 :
    500;

  console.error("[InventoryReservation]", code, msg, err);
  return res.status(code).json({ ok: false, message: msg });
};

const computeAvailable = (product, variantId) => {
  const isVariable = Array.isArray(product?.variants) && product.variants.length > 0;

  if (!isVariable) {
    return {
      isVariable: false,
      available: Math.max(0, (product.stock ?? 0) - (product.reservedStock ?? 0)),
    };
  }

  if (!variantId) return { isVariable: true, available: 0, error: "variantId required for variable product" };
  const v = product.variants.id(variantId);
  if (!v) return { isVariable: true, available: 0, error: "Variant not found" };

  return {
    isVariable: true,
    available: Math.max(0, (v.stock ?? 0) - (v.reservedStock ?? 0)),
  };
};

const incReserved = async ({ productId, variantId, qty, session }) => {
  const q = Math.max(1, Number(qty || 0));

  if (variantId) {
    const upd = await Product.updateOne(
      { _id: productId },
      { $inc: { "variants.$[v].reservedStock": q } },
      { arrayFilters: [{ "v._id": variantId }], session }
    );
    if (upd.matchedCount === 0) throw new Error("Product not found");
    if (upd.modifiedCount === 0) throw new Error("Variant not found / update failed");
    return;
  }

  const upd = await Product.updateOne(
    { _id: productId },
    { $inc: { reservedStock: q } },
    { session }
  );
  if (upd.matchedCount === 0) throw new Error("Product not found / update failed");
};

/**
 * ✅ IMPORTANT FIX:
 * consume (variant) => DO TWO UPDATES to avoid conflict
 */
const applyReservationTransition = async ({ r, nextStatus, reason = "", session }) => {
  if (!r) throw new Error("Reservation not found");
  if (r.status !== "reserved") throw new Error("Only 'reserved' reservations can be updated");

  const productId = oid(r.productId);
  const variantId = r.variantId ? oid(r.variantId) : null;
  const qty = Math.max(1, Number(r.qty || 0));

  if (variantId) {
    // 1) reservedStock -qty (always)
    let upd = await Product.updateOne(
      { _id: productId },
      { $inc: { "variants.$[v].reservedStock": -qty } },
      { arrayFilters: [{ "v._id": variantId }], session }
    );
    if (upd.matchedCount === 0) throw new Error("Product not found");
    if (upd.modifiedCount === 0) throw new Error("Variant not found / update failed");

    // 2) stock -qty (only when consumed) ✅ separate call => no conflict
    if (nextStatus === "consumed") {
      upd = await Product.updateOne(
        { _id: productId },
        { $inc: { "variants.$[v].stock": -qty } },
        { arrayFilters: [{ "v._id": variantId }], session }
      );
      if (upd.matchedCount === 0) throw new Error("Product not found");
      if (upd.modifiedCount === 0) throw new Error("Variant stock update failed");
    }
  } else {
    const inc = { reservedStock: -qty };
    if (nextStatus === "consumed") inc.stock = -qty;

    const upd = await Product.updateOne({ _id: productId }, { $inc: inc }, { session });
    if (upd.matchedCount === 0) throw new Error("Product not found / update failed");
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

  const product = await Product.findById(productId).session(session);
  if (!product) throw new Error("Product not found");

  const qtyNum = Math.max(1, Number(qty));
  const vId = variantId ? oid(variantId) : null;

  const { isVariable, available, error } = computeAvailable(product, vId);
  if (error) throw new Error(error);
  if (available < qtyNum) throw new Error(`Insufficient stock to reserve. Available: ${available}`);

  await incReserved({ productId: product._id, variantId: isVariable ? vId : null, qty: qtyNum, session });

  const [reservation] = await InventoryReservation.create(
    [
      {
        productId: product._id,
        productCode: String(product.productCode || "").trim(),

        productTitle: String(productTitle || product?.title || "").trim(),
        productImage: String(productImage || product?.thumbnail || product?.images?.[0] || "").trim(),
        orderNumber: String(orderNumber || "").trim(),

        variantId: isVariable ? vId : null,
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
    }).sort({ expiresAt: 1 }).limit(200).session(session);

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
