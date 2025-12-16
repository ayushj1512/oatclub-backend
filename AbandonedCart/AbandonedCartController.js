// AbandonedCart/AbandonedCart.js
// ✅ Model + Controller in same file (as you requested)

import mongoose from "mongoose";
import AbandonedCart from "./AbandonedCart.js"; // ⚠️ If this file itself IS the model, remove this import and use the model at bottom.
import Customer from "../models/Customer.js";
import Product from "../models/Products.js";

const safe = (v) => String(v ?? "").trim();
const safeLower = (v) => safe(v).toLowerCase();
const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v));

/* ------------------------------------------------------------------ */
/* Helpers */
/* ------------------------------------------------------------------ */

function pickCartIdentityFilter(payload = {}) {
  const cartId = safe(payload.cartId);
  const sessionId = safe(payload.sessionId);
  const firebaseUID = safe(payload.customerFirebaseUID || payload.firebaseUID);
  const email = safeLower(payload.customerEmail || payload.email);

  // Priority: cartId > sessionId > firebaseUID > email
  if (cartId) return { cartId };
  if (sessionId) return { sessionId };
  if (firebaseUID) return { customerFirebaseUID: firebaseUID };
  if (email) return { customerEmail: email };
  return null;
}

function computePricing(items = [], currency = "INR", coupon = null) {
  const subtotal = items.reduce((sum, it) => sum + (Number(it.unitPrice || 0) * Number(it.qty || 1)), 0);
  const discount = Number(coupon?.discount || 0);
  const shipping = 0;
  const tax = 0;
  const total = Math.max(0, subtotal - discount + shipping + tax);

  return {
    subtotal,
    discount,
    shipping,
    tax,
    total,
    currency: safe(currency) || "INR",
  };
}

function normalizeItemInput(raw = {}) {
  return {
    productId: raw.productId,
    variantId: raw.variantId ?? null,
    qty: Math.max(1, Number(raw.qty || 1)),
  };
}

// Builds a "snapshot" cart item from Product and optional embedded variant.
function buildCartItemFromProduct(product, variantId, qty) {
  const isVariable = Array.isArray(product?.variants) && product.variants.length > 0;

  let v = null;
  if (variantId && isVariable) {
    v = product.variants.find((x) => String(x?._id) === String(variantId)) || null;
  }

  // If variable product but no variant matched, you can choose to throw instead.
  // We'll allow it but snapshot will be product-level.
  const thumbnail = safe(product?.thumbnail) || safe(product?.images?.[0]) || "";
  const image = safe(v?.image) || thumbnail;

  const productSku = safe(product?.sku); // simple products typically have sku
  const variantSku = safe(v?.sku);

  const unitPrice = v ? Number(v.price || 0) : Number(product?.price || 0);
  const compareAtPrice = v
    ? (v.compareAtPrice != null ? Number(v.compareAtPrice) : null)
    : (product?.compareAtPrice != null ? Number(product.compareAtPrice) : null);

  const attrs = Array.isArray(v?.attributes)
    ? v.attributes.map((a) => ({
        attribute: a?.attribute ?? null,
        key: safe(a?.key),
        value: safe(a?.value),
      }))
    : [];

  return {
    productId: product?._id ?? null,
    variantId: v?._id ?? null,

    productCode: safe(product?.productCode),
    title: safe(product?.title),
    slug: safeLower(product?.slug),

    productSku,
    variantSku,

    thumbnail,
    image,

    unitPrice,
    compareAtPrice,
    currency: safe(product?.currency) || "INR",

    qty: Math.max(1, Number(qty || 1)),

    attributes: attrs,

    // optional inventory snapshot
    stock: v ? Number(v.stock ?? null) : Number(product?.stock ?? null),
    isInStock: v ? !!v.isInStock : !!product?.isInStock,
  };
}

/* ------------------------------------------------------------------ */
/* CONTROLLERS */
/* ------------------------------------------------------------------ */

/**
 * ✅ UPSERT cart (create/update)
 * POST /api/abandoned-carts/upsert
 *
 * Body example:
 * {
 *   "cartId": "CART-123",              // optional
 *   "sessionId": "SID-abc",            // optional
 *   "customerFirebaseUID": "uid...",   // optional
 *   "customerEmail": "a@b.com",        // optional
 *   "customerPhone": "9999...",        // optional
 *   "items": [
 *     { "productId": "...", "variantId": "...", "qty": 2 }
 *   ],
 *   "coupon": { "code": "SAVE10", "discount": 100 },
 *   "utm": { "source": "fb", "campaign": "retarget" },
 *   "context": { "lastPageUrl": "...", "referrer": "..." }
 * }
 */
export const upsertAbandonedCart = async (req, res) => {
  try {
    const payload = req.body || {};

    const identity = pickCartIdentityFilter(payload);
    if (!identity) {
      return res.status(400).json({
        success: false,
        message: "Provide at least one identifier: cartId or sessionId or customerFirebaseUID or customerEmail",
      });
    }

    // Normalize identifiers
    const cartId = safe(payload.cartId);
    const sessionId = safe(payload.sessionId);
    const customerFirebaseUID = safe(payload.customerFirebaseUID || payload.firebaseUID);
    const customerEmail = safeLower(payload.customerEmail || payload.email);
    const customerPhone = safe(payload.customerPhone || payload.phone);

    // Optional: link Customer if we can
    let customerId = null;
    if (customerFirebaseUID || customerEmail) {
      const cFilter = {};
      if (customerFirebaseUID) cFilter.firebaseUID = customerFirebaseUID;
      if (customerEmail) cFilter.email = customerEmail;

      const customer = await Customer.findOne(cFilter).lean();
      if (customer?._id) customerId = customer._id;
    }

    // Build item snapshots from Product
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    const normalized = rawItems.map(normalizeItemInput).filter((x) => x.productId);

    const snapshots = [];
    for (const it of normalized) {
      if (!isObjectId(it.productId)) continue;

      const product = await Product.findById(it.productId).lean();
      if (!product) continue;

      const snap = buildCartItemFromProduct(product, it.variantId, it.qty);
      snapshots.push(snap);
    }

    // If you want to strictly require items:
    // if (!snapshots.length) return res.status(400).json({ success:false, message:"No valid items" });

    const coupon = payload.coupon && typeof payload.coupon === "object"
      ? { code: safe(payload.coupon.code), discount: Number(payload.coupon.discount || 0) }
      : { code: "", discount: 0 };

    const pricing = computePricing(snapshots, payload?.pricing?.currency || "INR", coupon);

    const update = {
      // identifiers
      cartId,
      sessionId,
      customerId,
      customerFirebaseUID,
      customerEmail,
      customerPhone,

      // snapshots
      items: snapshots,
      coupon,
      pricing,

      // attribution / context
      utm: payload.utm && typeof payload.utm === "object" ? {
        source: safe(payload.utm.source),
        medium: safe(payload.utm.medium),
        campaign: safe(payload.utm.campaign),
        term: safe(payload.utm.term),
        content: safe(payload.utm.content),
      } : undefined,

      context: payload.context && typeof payload.context === "object" ? {
        lastPageUrl: safe(payload.context.lastPageUrl),
        referrer: safe(payload.context.referrer),
        device: safe(payload.context.device),
        userAgent: safe(payload.context.userAgent),
        ip: safe(payload.context.ip),
      } : undefined,

      // lifecycle
      status: payload.status ? safe(payload.status).toUpperCase() : undefined,
      lastActivityAt: new Date(),
    };

    // Don’t set undefined keys (keeps old values)
    Object.keys(update).forEach((k) => update[k] === undefined && delete update[k]);

    const cart = await AbandonedCart.findOneAndUpdate(
      identity,
      { $set: update, $setOnInsert: { status: "ACTIVE" } },
      { new: true, upsert: true }
    ).lean();

    return res.json({ success: true, message: "Cart saved", cart });
  } catch (err) {
    console.error("❌ upsertAbandonedCart:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * ✅ Mark cart as ABANDONED
 * PATCH /api/abandoned-carts/:id/abandon
 */
export const markCartAbandoned = async (req, res) => {
  try {
    const { id } = req.params;
    const filter = isObjectId(id) ? { _id: id } : { cartId: safe(id) };

    const cart = await AbandonedCart.findOne(filter);
    if (!cart) return res.status(404).json({ success: false, message: "Cart not found" });

    cart.status = "ABANDONED";
    cart.abandonedAt = cart.abandonedAt || new Date();
    cart.lastActivityAt = new Date();
    await cart.save();

    return res.json({ success: true, message: "Cart marked abandoned", cart });
  } catch (err) {
    console.error("❌ markCartAbandoned:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * ✅ Mark cart as RECOVERED (optionally attach orderId)
 * PATCH /api/abandoned-carts/:id/recover
 * Body: { orderId?: "...mongoId..." }
 */
export const markCartRecovered = async (req, res) => {
  try {
    const { id } = req.params;
    const { orderId } = req.body || {};

    const filter = isObjectId(id) ? { _id: id } : { cartId: safe(id) };

    const cart = await AbandonedCart.findOne(filter);
    if (!cart) return res.status(404).json({ success: false, message: "Cart not found" });

    cart.status = "RECOVERED";
    cart.recoveredAt = new Date();
    cart.lastActivityAt = new Date();
    if (orderId && isObjectId(orderId)) cart.recoveredOrderId = orderId;

    await cart.save();
    return res.json({ success: true, message: "Cart marked recovered", cart });
  } catch (err) {
    console.error("❌ markCartRecovered:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * ✅ List carts for retargeting (filter by status/date/email/uid)
 * GET /api/abandoned-carts?status=ABANDONED&page=1&limit=20&q=...
 *
 * q searches: cartId, email, uid, phone
 */
export const listAbandonedCarts = async (req, res) => {
  try {
    const { status = "", page = 1, limit = 20, q = "" } = req.query;

    const filter = {};
    if (status) filter.status = safe(status).toUpperCase();

    const qq = safe(q);
    if (qq) {
      filter.$or = [
        { cartId: { $regex: qq, $options: "i" } },
        { customerEmail: { $regex: qq, $options: "i" } },
        { customerFirebaseUID: { $regex: qq, $options: "i" } },
        { customerPhone: { $regex: qq, $options: "i" } },
      ];
    }

    const safeLimit = Math.min(200, Math.max(1, Number(limit)));
    const skip = (Number(page) - 1) * safeLimit;

    const [items, total] = await Promise.all([
      AbandonedCart.find(filter)
        .sort({ lastActivityAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .populate("customerId", "name email phone firebaseUID city state country")
        .lean(),
      AbandonedCart.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      items: items || [],
      total: total || 0,
      page: Number(page),
      pages: Math.ceil((total || 0) / safeLimit),
    });
  } catch (err) {
    console.error("❌ listAbandonedCarts:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * ✅ Get single cart
 * GET /api/abandoned-carts/:id
 * (id can be Mongo _id OR cartId)
 */
export const getAbandonedCart = async (req, res) => {
  try {
    const { id } = req.params;
    const filter = isObjectId(id) ? { _id: id } : { cartId: safe(id) };

    const cart = await AbandonedCart.findOne(filter)
      .populate("customerId", "name email phone firebaseUID city state country")
      .lean();

    if (!cart) return res.status(404).json({ success: false, message: "Cart not found" });
    return res.json({ success: true, cart });
  } catch (err) {
    console.error("❌ getAbandonedCart:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * ✅ Update retarget attempt metadata
 * PATCH /api/abandoned-carts/:id/retargeted
 */
export const markRetargeted = async (req, res) => {
  try {
    const { id } = req.params;
    const filter = isObjectId(id) ? { _id: id } : { cartId: safe(id) };

    const cart = await AbandonedCart.findOne(filter);
    if (!cart) return res.status(404).json({ success: false, message: "Cart not found" });

    cart.lastRetargetedAt = new Date();
    cart.retargetCount = Number(cart.retargetCount || 0) + 1;
    await cart.save();

    return res.json({ success: true, message: "Marked retargeted", cart });
  } catch (err) {
    console.error("❌ markRetargeted:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * ✅ Delete cart
 * DELETE /api/abandoned-carts/:id
 */
export const deleteAbandonedCart = async (req, res) => {
  try {
    const { id } = req.params;
    const filter = isObjectId(id) ? { _id: id } : { cartId: safe(id) };

    const deleted = await AbandonedCart.findOneAndDelete(filter).lean();
    if (!deleted) return res.status(404).json({ success: false, message: "Cart not found" });

    return res.json({ success: true, message: "Cart deleted" });
  } catch (err) {
    console.error("❌ deleteAbandonedCart:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ------------------------------------------------------------------ */
/* OPTIONAL: Routes helper (if you want to mount quickly) */
/* ------------------------------------------------------------------ */
/*
import express from "express";
export const abandonedCartRouter = express.Router();

abandonedCartRouter.post("/upsert", upsertAbandonedCart);
abandonedCartRouter.get("/", listAbandonedCarts);
abandonedCartRouter.get("/:id", getAbandonedCart);
abandonedCartRouter.patch("/:id/abandon", markCartAbandoned);
abandonedCartRouter.patch("/:id/recover", markCartRecovered);
abandonedCartRouter.patch("/:id/retargeted", markRetargeted);
abandonedCartRouter.delete("/:id", deleteAbandonedCart);

export default abandonedCartRouter;
*/
