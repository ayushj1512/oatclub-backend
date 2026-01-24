import mongoose from "mongoose";
import Order from "./Orders.js";
import Product from "../Products/Products.js";
import { buildAddressSnapshot } from "./order.address.mapper.js";
import { cancelShiprocketShipment } from "../shiprocket/shiprocket.cancel.js";
import Address from "../Address/Address.js"; // <-- correct path
import {
  checkServiceability,
  createShipment,
  assignAwb,
} from "../shiprocket/index.js";
import { buildShiprocketPayload } from "../shiprocket/shiprocket.payload.js";
import { Mailer } from "../nodemailer/events/mailer.js"; // ✅ adjust relative path if needed
// ✅ Centralized email triggers
import {
  triggerOrderEmails,
  triggerOrderCancellationEmails,
  triggerRmaEmails,
} from "./order.emails.js";
import Coupon from "../Coupon/Coupon.js"; 
// ⚠️ path tumhare project ke hisaab se adjust kar lena

const ADMIN_ORDER_ALERT_EMAILS = [
  "finance@mirayfashions.com",
  "support@mirayfashions.com",
  "miray.ayushjuneja@gmail.com",
].filter(Boolean);

const RAZORPAY_DISCOUNT_PERCENT = 10;

const sendAdminOrderReceivedMail = async (order) => {
  try {
    if (process.env.MAIL_ENABLED !== "true") {
      console.log("📭 Admin order mail skipped: MAIL_ENABLED not true");
      return;
    }

    // ✅ Remove duplicates + join safely for nodemailer
    const recipients = [...new Set(ADMIN_ORDER_ALERT_EMAILS)]
      .map((e) => String(e).trim().toLowerCase())
      .filter(Boolean);

    if (!recipients.length) {
      console.log("📭 Admin order mail skipped: no admin recipients");
      return;
    }

    // ✅ CTA: Prefer Admin panel if available else fallback
    const baseAdminUrl =
      process.env.ADMIN_PANEL_URL ||
      process.env.CLIENT_URL ||
      "http://localhost:3000";

    const orderId = order?.orderId || order?.orderNumber || order?._id;
    const ctaUrl = orderId ? `${baseAdminUrl}/admin/orders/${orderId}` : baseAdminUrl;

    await Mailer.sendAdminOrderReceived({
      to: recipients.join(","),
      order,
      ctaUrl,
    });

    console.log("✅ Admin Order Received mail sent to:", recipients.join(", "));
  } catch (err) {
    console.error("❌ Admin Order Received mail error FULL:", err);
  }
};



/* ============================================================
   RMA POLICY (hardcoded backend)
   - Return/Exchange allowed within 7 days from deliveredAt
   - 1st exchange free, 2nd+ exchange fee = 199
============================================================ */
const RMA_POLICY = {
  windowDays: 7,
  exchange: {
    firstFree: true,
    secondFee: 199,
  },
  countExchangeStatuses: [
    "requested",
    "approved",
    "pickup_scheduled",
    "picked",
    "in_transit",
    "received",
    "qc_pass",
    "qc_fail",
    "replacement_shipped",
    "closed",
  ],
};

/* ============================================================
   HELPERS
============================================================ */
const normalizeVariantAttributes = (variant) => {
  const attrs = Array.isArray(variant?.attributes) ? variant.attributes : [];
  return attrs
    .filter((a) => a && a.key != null && a.value != null)
    .map((a) => ({ key: String(a.key), value: String(a.value) }));
};

const findVariantById = (product, variantId) => {
  if (!variantId) return null;
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  return variants.find((v) => String(v._id) === String(variantId)) || null;
};

const uniqStrings = (arr) =>
  Array.from(
    new Set((arr || []).map((x) => String(x || "").trim()).filter(Boolean))
  );

const computeCategoryBreakdown = (normalizedItems) => {
  const map = new Map();
  for (const it of normalizedItems || []) {
    const catId = it?.productSnapshot?.category
      ? String(it.productSnapshot.category)
      : null;
    if (!catId) continue;

    const prev = map.get(catId) || {
      categoryId: it.productSnapshot.category,
      totalSpend: 0,
      quantity: 0,
    };
    prev.totalSpend += Number(it.subtotal || 0);
    prev.quantity += Number(it.quantity || 0);
    map.set(catId, prev);
  }
  return Array.from(map.values());
};

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));

const daysDiff = (fromDate, toDate) => {
  const a = new Date(fromDate).getTime();
  const b = new Date(toDate).getTime();
  return Math.floor((a - b) / (1000 * 60 * 60 * 24));
};

const pickAttr = (attrs = [], keys = []) => {
  const kset = keys.map((k) => String(k).trim().toLowerCase());
  const found = (attrs || []).find((a) =>
    kset.includes(String(a?.key || "").trim().toLowerCase())
  );
  return found?.value ? String(found.value) : "";
};


const isWithinRmaWindow = (deliveredAt) => {
  if (!deliveredAt) return false;
  const diffDays = daysDiff(Date.now(), deliveredAt); // today - deliveredAt
  return diffDays >= 0 && diffDays <= RMA_POLICY.windowDays;
};

const countPreviousExchanges = (order) => {
  const rmas = order?.rmas || [];
  return rmas.filter((r) => {
    if (!r) return false;
    if (r.type !== "exchange") return false;
    if (r.status === "rejected") return false;
    return RMA_POLICY.countExchangeStatuses.includes(r.status);
  }).length;
};

const computeExchangeFee = (exchangeCountSoFar) => {
  if (RMA_POLICY.exchange.firstFree && exchangeCountSoFar === 0) return 0;
  return Number(RMA_POLICY.exchange.secondFee || 0);
};

/**
 * RMA snapshot builder (for embedding in Order.rmas[])
 * item: { orderItemIndex, quantity }
 */
const buildRmaItemsSnapshots = (order, rmaItems) => {
  const out = [];
  for (const ri of rmaItems || []) {
    const idx = Number(ri?.orderItemIndex);
    const qty = Number(ri?.quantity);

    if (!Number.isInteger(idx) || idx < 0)
      throw new Error("Invalid orderItemIndex in RMA items");
    if (!Number.isFinite(qty) || qty < 1)
      throw new Error("Invalid quantity in RMA items");

    const orderItem = Array.isArray(order?.items) ? order.items[idx] : null;
    if (!orderItem) throw new Error(`Order item not found at index: ${idx}`);

    out.push({
      orderItemIndex: idx,
      quantity: qty,
      productId: orderItem.productId || null,
      productCode: orderItem?.productSnapshot?.productCode || "",
      title: orderItem?.productSnapshot?.title || "",
      variantSku: orderItem?.variant?.sku || "",
    });
  }
  return out;
};

const str = (v) => (v == null ? "" : String(v));
const normEmail = (v) => str(v).trim().toLowerCase();
const normPhone = (v) => str(v).replace(/[^\d+]/g, "").trim().replace(/^\+/, "");

const buildCouponIdentity = ({ email, phone }) => {
  const e = normEmail(email);
  if (e && e.includes("@")) return `email:${e}`;
  const p = normPhone(phone);
  if (p) return `phone:${p}`;
  return "";
};

/**
 * Compute remaining returnable qty for each order item index
 * - Excludes rejected RMAs
 * - Counts all other statuses as "consumed"
 */
const computeRemainingQtyByIndex = (order) => {
  const purchased = new Map();
  (order.items || []).forEach((it, idx) => {
    purchased.set(String(idx), Number(it.quantity || 0));
  });

  const returned = new Map();
  (order.rmas || []).forEach((r) => {
    if (!r || r.status === "rejected") return;
    (r.items || []).forEach((ri) => {
      const key = String(ri.orderItemIndex);
      returned.set(key, (returned.get(key) || 0) + Number(ri.quantity || 0));
    });
  });

  const remaining = new Map();
  for (const [k, bought] of purchased.entries()) {
    const used = returned.get(k) || 0;
    remaining.set(k, Math.max(0, bought - used));
  }
  return remaining;
};

// ========================================================================================
// ✅ EASY CONFIRM: Mark order confirmed (manual / cod / admin action)
// ========================================================================================
const confirmOrderById = async ({ orderId, adminId = null, session = null }) => {
  const update = {
    isConfirmed: true,
    confirmedAt: new Date(),
  };

  if (adminId) update.confirmedBy = adminId;

  const query = Order.findByIdAndUpdate(orderId, update, {
    new: true,
    runValidators: true,
  });

  if (session) query.session(session);

  return query;
};


/* ============================================================
   CREATE ORDER
  Expect each item: { productId, quantity, variantId? }
============================================================ */
export const createOrder = async (req, res) => {
  const session = await mongoose.startSession();

  /* =========================
     Helpers
  ========================= */
  const str = (v) => (v == null ? "" : String(v));
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  const normEmail = (v) => str(v).trim().toLowerCase();
  const normPhone = (v) => str(v).replace(/[^\d+]/g, "").trim();

  const isNumericLike = (v) => {
    const s = str(v).trim();
    return s.length > 0 && /^[0-9]+$/.test(s);
  };

  const sanitizeSelectedColor = (color, productCode = "") => {
    const c = str(color).trim();
    const pc = str(productCode).trim();
    if (!c) return "";
    if (isNumericLike(c)) return ""; // kills "00218"
    if (pc && c.toUpperCase() === pc.toUpperCase()) return ""; // kills productCode
    return c;
  };

  const buildCouponIdentity = ({ email, phone }) => {
    const e = normEmail(email);
    if (e && e.includes("@")) return `email:${e}`;
    const p = normPhone(phone).replace(/^\+/, "");
    if (p) return `phone:${p}`;
    return "";
  };

  const pickAttr = (attrs = [], keys = []) => {
    const wanted = keys.map((k) => str(k).toLowerCase());
    const found = (Array.isArray(attrs) ? attrs : []).find((a) =>
      wanted.includes(str(a?.key).toLowerCase())
    );
    return found?.value ? str(found.value) : "";
  };

  const normalizeVariantAttributes = (variant) => {
    const raw = variant?.attributes;
    if (Array.isArray(raw)) {
      return raw
        .filter((a) => a?.key != null && a?.value != null)
        .map((a) => ({ key: str(a.key), value: str(a.value) }));
    }
    if (raw && typeof raw === "object") {
      return Object.entries(raw).map(([k, v]) => ({ key: str(k), value: str(v) }));
    }
    return [];
  };

  const getSizeFromSku = (sku) => {
    const parts = str(sku).toUpperCase().split("-");
    const sizes = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL"];
    for (let i = parts.length - 1; i >= 0; i--) {
      if (sizes.includes(parts[i])) return parts[i];
    }
    return "";
  };

  // NOTE: your SKU is like FEA-00218-L (no color), so protect numeric/productCode tokens.
  const getColorFromSku = (sku, productCode = "") => {
    const parts = str(sku).toUpperCase().split("-");
    if (parts.length < 2) return "";

    const sizes = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL"];
    const maybeColor = parts[parts.length - 2];

    if (sizes.includes(maybeColor)) return "";
    if (/^[0-9]+$/.test(maybeColor)) return "";
    if (productCode && maybeColor === str(productCode).toUpperCase()) return "";

    return maybeColor.toLowerCase();
  };

  const validateAndComputeCoupon = async ({ code, cartTotal, identity }) => {
    if (!code) return { couponSnapshot: null, couponDiscount: 0 };

    const couponCode = str(code).trim().toUpperCase();
    const couponDoc = await Coupon.findOne({ code: couponCode }).session(session);
    if (!couponDoc) throw new Error("Invalid coupon code.");
    if (!couponDoc.isActive) throw new Error("Coupon is not active.");
    if (couponDoc.validFrom && new Date() < new Date(couponDoc.validFrom))
      throw new Error("Coupon is not active yet.");
    if (couponDoc.validTill && new Date() > new Date(couponDoc.validTill))
      throw new Error("Coupon has expired.");

    if (num(cartTotal) < num(couponDoc.minPurchase || 0)) {
      throw new Error(`Minimum purchase required is ₹${num(couponDoc.minPurchase || 0)}`);
    }

    if (num(couponDoc.usageLimit) > 0 && num(couponDoc.usedCount) >= num(couponDoc.usageLimit)) {
      throw new Error("Coupon usage limit has been reached.");
    }

    const perUserLimit = num(couponDoc.usageLimitPerCustomer || 1);
    const usedBy = Array.isArray(couponDoc.usedBy) ? couponDoc.usedBy : [];
    const usedTimes = identity ? usedBy.filter((x) => str(x) === identity).length : 0;

    if (identity && usedTimes >= perUserLimit) {
      throw new Error("You have already used this coupon.");
    }

    let discountAmount = 0;
    if (couponDoc.discountType === "percentage") {
      discountAmount = (num(cartTotal) * num(couponDoc.discountValue)) / 100;
      if (num(couponDoc.maxDiscount) > 0) {
        discountAmount = Math.min(discountAmount, num(couponDoc.maxDiscount));
      }
    } else {
      discountAmount = num(couponDoc.discountValue);
    }

    discountAmount = Math.max(0, Math.round(discountAmount));
    if (!discountAmount) throw new Error("Invalid discount calculation.");

    return {
      couponSnapshot: { code: couponCode, discount: discountAmount },
      couponDiscount: discountAmount,
      couponDoc,
    };
  };

  try {
    const {
      customerId,
      shippingAddressId,
      billingAddressId,
      items,
      coupon, // expects { code }
      shippingFee = 0,
      tax = 0,
      paymentMethod = "cod",
      source = "website",
      isGiftOrder = false,
      currency = "INR",
    } = req.body;

    const pm = str(paymentMethod).toLowerCase();

    if (!mongoose.Types.ObjectId.isValid(customerId))
      return res.status(400).json({ message: "Invalid customerId" });

    if (!mongoose.Types.ObjectId.isValid(shippingAddressId))
      return res.status(400).json({ message: "Invalid shippingAddressId" });

    if (billingAddressId && !mongoose.Types.ObjectId.isValid(billingAddressId))
      return res.status(400).json({ message: "Invalid billingAddressId" });

    if (!Array.isArray(items) || !items.length)
      return res.status(400).json({ message: "Order items missing" });

    if (!["cod", "razorpay"].includes(pm))
      return res.status(400).json({ message: "Invalid paymentMethod. Allowed: cod | razorpay" });

    await session.withTransaction(async () => {
      const shippingAddress = await Address.findById(shippingAddressId).session(session);
      if (!shippingAddress) throw new Error("Shipping address not found");

      const billingAddress = billingAddressId
        ? await Address.findById(billingAddressId).session(session)
        : shippingAddress;

      const shippingAddressSnapshot = buildAddressSnapshot(shippingAddress);
      const billingAddressSnapshot = buildAddressSnapshot(billingAddress);

      const identity = buildCouponIdentity({
        email: shippingAddressSnapshot?.email,
        phone: shippingAddressSnapshot?.phone,
      });

      const productIds = [...new Set(items.map((i) => str(i?.productId)).filter(Boolean))];
      const invalidProductId = productIds.find((id) => !isObjectId(id));
      if (invalidProductId) throw new Error(`Invalid productId: ${invalidProductId}`);

      const products = await Product.find({ _id: { $in: productIds } }).session(session).lean();
      const productMap = new Map(products.map((p) => [str(p._id), p]));

      const normalizedItems = [];
      let computedSubtotal = 0;
      let totalQty = 0;

      for (const item of items) {
        if (!item?.productId) throw new Error("productId missing");

        const qty = Number(item.quantity || 0);
        if (!Number.isFinite(qty) || qty < 1) throw new Error("Invalid quantity");

        const product = productMap.get(str(item.productId));
        if (!product) throw new Error("Product not found");

        const isVariable =
          product.productType === "variable" ||
          (Array.isArray(product.variants) && product.variants.length > 0);

        let variant = null;

        if (isVariable) {
          if (!item.variantId) throw new Error(`${product.title} - variantId missing`);

          variant = findVariantById(product, item.variantId);
          if (!variant) throw new Error(`${product.title} - variant not found`);

          if (Number(variant.stock ?? 0) < qty) throw new Error(`${product.title} out of stock`);
        } else {
          if (Number(product.stock ?? 0) < qty) throw new Error(`${product.title} out of stock`);
        }

        const unitPrice =
          variant && Number(variant.price) > 0 ? Number(variant.price) : Number(product.price || 0);

        const itemSubtotal = unitPrice * qty;
        totalQty += qty;
        computedSubtotal += itemSubtotal;

        const attrs = normalizeVariantAttributes(variant);

        const selectedSize =
          pickAttr(attrs, ["size", "sizes", "shirt_size"]) || getSizeFromSku(variant?.sku);

        const selectedColorRaw =
          pickAttr(attrs, ["color", "colour", "color_name"]) ||
          getColorFromSku(variant?.sku, product.productCode);

        const selectedColor = sanitizeSelectedColor(selectedColorRaw, product.productCode);

        normalizedItems.push({
          productId: product._id,
          productSnapshot: {
            productCode: product.productCode || "",
            title: product.title,
            slug: product.slug || "",
            thumbnail: product.thumbnail || "",
            images: Array.isArray(product.images) ? product.images : [],
            category: product.category || null,
            subcategory: product.subcategory || null,
            productType: product.productType || (product?.variants?.length ? "variable" : "simple"),
            sku: product.sku || "",
            tags: Array.isArray(product.tags) ? product.tags : [],
            hsnCode: String(product.hsnCode || "62105000"),
            weight: Number(product.weight ?? 0),
            currency: product.currency || currency,
          },
          variant: {
            variantId: variant?._id || null,
            sku: variant?.sku || "",
            attributes: attrs,
            image: variant?.image || product.thumbnail || "",
            weight: Number(variant?.weight ?? 0),
          },
          selectedSize,
          selectedColor,
          quantity: qty,
          price: unitPrice,
          compareAtPrice: variant?.compareAtPrice ?? product?.compareAtPrice ?? null,
          subtotal: itemSubtotal,
        });
      }

      for (const it of normalizedItems) {
        const variantId = it?.variant?.variantId;

        const result = variantId
          ? await Product.updateOne(
              { _id: it.productId, "variants._id": variantId, "variants.stock": { $gte: it.quantity } },
              { $inc: { "variants.$.stock": -it.quantity } }
            ).session(session)
          : await Product.updateOne(
              { _id: it.productId, stock: { $gte: it.quantity } },
              { $inc: { stock: -it.quantity } }
            ).session(session);

        if (!result.modifiedCount) throw new Error("Stock update failed");
      }

      const subtotal = computedSubtotal;
      const totalAmount = subtotal + num(shippingFee) + num(tax);

      const couponCode = coupon && typeof coupon === "object" ? str(coupon.code) : "";
      const { couponSnapshot, couponDiscount, couponDoc } = await validateAndComputeCoupon({
        code: couponCode,
        cartTotal: subtotal,
        identity,
      });

const razorpayExtraDiscount =
  pm === "razorpay"
    ? Math.round((subtotal * RAZORPAY_DISCOUNT_PERCENT) / 100)
    : 0;

      let finalDiscount = num(couponDiscount) + num(razorpayExtraDiscount);
      if (finalDiscount > totalAmount) finalDiscount = totalAmount;

      const finalPayable = Math.max(0, totalAmount - finalDiscount);

      const analytics = {
        totalItems: totalQty,
        averageItemPrice: totalQty ? subtotal / totalQty : 0,
        couponApplied: Boolean(couponSnapshot?.code),
        creditsUsed: false,
        categoryBreakdown: computeCategoryBreakdown(normalizedItems),
        tagsUsed: uniqStrings(normalizedItems.flatMap((it) => it.productSnapshot?.tags || [])),
        onlinePaymentDiscountApplied: pm === "razorpay",
onlinePaymentDiscountPct: pm === "razorpay" ? RAZORPAY_DISCOUNT_PERCENT : 0,
        onlinePaymentDiscountAmount: razorpayExtraDiscount,
        couponIdentity: identity || "",
      };

      const [order] = await Order.create(
        [
          {
            customerId,
            shippingAddressSnapshot,
            billingAddressSnapshot,
            items: normalizedItems,
            subtotal,
            discount: finalDiscount,
            coupon: couponSnapshot ? { ...couponSnapshot, identity } : null,
            shippingFee,
            tax,
            totalAmount,
            finalPayable,
            currency,
            paymentMethod: pm,
            paymentStatus: "pending",
            fulfillmentStatus: "processing",
            source,
            isGiftOrder,
            analytics,
            rmas: [],
          },
        ],
        { session }
      );

      // COD: mark coupon used immediately
      // Razorpay: mark used after payment success
      if (couponDoc && couponSnapshot?.code && identity && pm === "cod") {
        couponDoc.usedBy = Array.isArray(couponDoc.usedBy) ? couponDoc.usedBy : [];
        couponDoc.usedBy.push(identity);
        couponDoc.usedCount = num(couponDoc.usedCount) + 1;
        await couponDoc.save({ session });
      }

      req.__createdOrder = order;
    });

    // Shiprocket booking (COD only)
    try {
      const createdOrder = await Order.findById(req.__createdOrder._id);
      if (createdOrder?.paymentMethod === "cod") {
        await autoBookShiprocketForOrder(createdOrder);
      }
    } catch (e) {
      console.error("⚠️ Auto Shiprocket booking failed:", e?.message || e);
    }

    const finalOrder = await Order.findById(req.__createdOrder._id).lean();

    try { triggerOrderEmails(finalOrder); }
catch (e) { console.error("⚠️ triggerOrderEmails failed:", e?.message || e); }

    return res.status(201).json({ message: "Order created successfully", order: finalOrder });
  } catch (error) {
    console.error("❌ Create Order Error:", error);
    return res.status(400).json({ message: error.message || "Order creation failed" });
  } finally {
    session.endSession();
  }
};









/* ============================================================
   GET ALL ORDERS (ADMIN)
============================================================ */
export const getAllOrders = async (req, res) => {
  try {
    const { customerId, paymentStatus, fulfillmentStatus, isConfirmed } = req.query;

    const filters = {};
    if (customerId) filters.customerId = customerId;
    if (paymentStatus) filters.paymentStatus = paymentStatus;
    if (fulfillmentStatus) filters.fulfillmentStatus = fulfillmentStatus;
    if (isConfirmed != null) filters.isConfirmed = isConfirmed === "true";

    const orders = await Order.find(filters)
      .populate("customerId", "name email phone")
      .populate("items.productId")
      .sort({ createdAt: -1 });

    return res.status(200).json(orders);
  } catch (error) {
    console.error("❌ Fetch Orders Error:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};


/* ============================================================
   GET ORDER BY ID
============================================================ */
export const getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("customerId", "name email phone")
      .populate("items.productId");

    if (!order) return res.status(404).json({ message: "Order not found" });
    return res.status(200).json(order);
  } catch (error) {
    console.error("❌ Fetch Order Error:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

/* ============================================================
   GET ORDERS OF SPECIFIC CUSTOMER
============================================================ */
export const getOrdersByCustomer = async (req, res) => {
  try {
    const orders = await Order.find({ customerId: req.params.customerId })
      .populate("items.productId")
      .sort({ createdAt: -1 });

    return res.status(200).json(orders);
  } catch (error) {
    console.error("❌ Customer Orders Error:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

/* ============================================================
   UPDATE FULL ORDER
============================================================ */
export const updateOrder = async (req, res) => {
  try {
    const body = { ...req.body };

    // ✅ If coupon object updated manually, sync discount too
    if (body.coupon && typeof body.coupon === "object" && body.coupon.code) {
      body.discount = Number(body.coupon.discount || 0);
    }

    const updatedOrder = await Order.findByIdAndUpdate(req.params.id, body, {
      new: true,
      runValidators: true,
    });

    if (!updatedOrder)
      return res.status(404).json({ message: "Order not found" });
    return res
      .status(200)
      .json({ message: "Order updated", order: updatedOrder });
  } catch (error) {
    console.error("❌ Update Order Error:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

/* ============================================================
   UPDATE ORDER STATUS ONLY
   ✅ Fix: default cancel reason -> cancelled_by_customer
   ✅ Supports: cancelled_by_admin / cancelled_by_customer
============================================================ */
export const updateOrderStatus = async (req, res) => {
  const session = await mongoose.startSession();

  // -------- helpers (keep local to avoid changing file structure)
  const str = (v) => (v == null ? "" : String(v));
  const normEmail = (v) => str(v).trim().toLowerCase();
  const normPhone = (v) =>
    str(v).replace(/[^\d+]/g, "").trim().replace(/^\+/, "");
  const buildCouponIdentity = ({ email, phone }) => {
    const e = normEmail(email);
    if (e && e.includes("@")) return `email:${e}`;
    const p = normPhone(phone);
    if (p) return `phone:${p}`;
    return "";
  };

  // ✅ NEW: normalize cancel reason with safe defaults
  const normReason = (v) => str(v).trim().toLowerCase();
  const pickCancelReason = () => {
  const incoming = normReason(req.body?.reason);

  if (incoming === "cancelled_by_admin") return "cancelled_by_admin";
  if (incoming === "cancelled_by_customer") return "cancelled_by_customer";
  if (incoming === "admin") return "cancelled_by_admin";
  if (incoming === "customer") return "cancelled_by_customer";

  const actor = normReason(req.body?.cancelledBy);
  if (actor === "admin") return "cancelled_by_admin";
  if (actor === "customer") return "cancelled_by_customer";

  // ✅ NEW: adminRemarks se infer
  const ar = normReason(req.body?.adminRemarks);
  if (ar === "cancelled_by_admin" || ar === "admin") return "cancelled_by_admin";

  // ✅ NEW: if request is from admin (if you have auth/role)
  if (req.user?.role === "admin") return "cancelled_by_admin";

  return "cancelled_by_customer";
};


  const isAdminCancel = (reason) => normReason(reason) === "cancelled_by_admin";

  try {
    const { fulfillmentStatus, paymentStatus, isConfirmed } = req.body;

    // ✅ default -> cancelled_by_customer
    const reason = pickCancelReason();

    const orderId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    let updatedOrder = null;
    let shouldBookShiprocket = false;

    await session.withTransaction(async () => {
      // ✅ If cancelling → run full cancel flow
     if (fulfillmentStatus === "cancelled") {
  updatedOrder = await performOrderCancellation({ orderId, reason, session });

  const $set = {};
  const $unset = {};

  if (isAdminCancel(reason)) {
    $set.adminRemarks = str(req.body?.adminRemarks).trim() || "cancelled_by_admin";
    $unset.customerMessage = ""; // ✅ ensure customer msg not present
  } else {
    $set.customerMessage = str(req.body?.customerMessage).trim() || "cancelled_by_customer";
    $unset.adminRemarks = "";    // ✅ ensure admin remark not present
  }

  await Order.updateOne({ _id: orderId }, { $set, $unset }).session(session);
  updatedOrder = await Order.findById(orderId).session(session);
  return;
}


      const order = await Order.findById(orderId).session(session);
      if (!order) throw new Error("Order not found");

      const wasConfirmed = Boolean(order.isConfirmed);

      // -----------------------------------------------
      // ✅ 1) Payment status update
      // -----------------------------------------------
      if (paymentStatus) {
        order.paymentStatus = paymentStatus;
      }

      // -----------------------------------------------
      // ✅ 2) Manual confirm support (isConfirmed: true)
      //    ✅ BUT: for razorpay prepaid, must be paid first
      // -----------------------------------------------
      if (isConfirmed === true && !order.isConfirmed) {
        if (order.paymentMethod === "razorpay" && order.paymentStatus !== "paid") {
          throw new Error("Cannot confirm Razorpay order before payment is paid");
        }
        order.isConfirmed = true;
        order.confirmedAt = new Date();
      }

      // -----------------------------------------------
      // ✅ 3) AUTO-CONFIRM: Razorpay paid => confirmed
      // -----------------------------------------------
      if (
        paymentStatus === "paid" &&
        order.paymentMethod === "razorpay" &&
        !order.isConfirmed
      ) {
        order.isConfirmed = true;
        order.confirmedAt = new Date();
      }

      // -----------------------------------------------
      // ✅ 3.1) MARK COUPON USED ON RAZORPAY "PAID"
      // (idempotent: won't double count)
      // -----------------------------------------------
      if (
        paymentStatus === "paid" &&
        order.paymentMethod === "razorpay" &&
        order?.coupon?.code
      ) {
        const couponCode = str(order.coupon.code).trim().toUpperCase();

        const identity =
          str(order?.coupon?.identity).trim() ||
          buildCouponIdentity({
            email: order?.shippingAddressSnapshot?.email,
            phone: order?.shippingAddressSnapshot?.phone,
          });

        if (couponCode && identity) {
          const couponDoc = await Coupon.findOne({ code: couponCode }).session(session);

          if (couponDoc) {
            couponDoc.usedBy = Array.isArray(couponDoc.usedBy) ? couponDoc.usedBy : [];

            // ✅ idempotent guard
            const alreadyUsed = couponDoc.usedBy.includes(identity);

            if (!alreadyUsed) {
              couponDoc.usedBy.push(identity);
              couponDoc.usedCount = Number(couponDoc.usedCount || 0) + 1;
              await couponDoc.save({ session });
            }
          }
        }
      }

      // ✅ detect confirm transition
      const nowConfirmed = Boolean(order.isConfirmed);

      // -----------------------------------------------
      // ✅ 4) Fulfillment status update (guard shipping stages)
      // -----------------------------------------------
      if (fulfillmentStatus) {
        const shippingStages = ["packed", "picked", "shipped", "out_for_delivery", "delivered"];

        if (!nowConfirmed && shippingStages.includes(fulfillmentStatus)) {
          throw new Error("Order must be confirmed before shipping stages");
        }

        order.fulfillmentStatus = fulfillmentStatus;

        // ✅ AUTO deliveredAt
        if (fulfillmentStatus === "delivered") {
          order.trackingDetails = order.trackingDetails || {};
          if (!order.trackingDetails.deliveredAt) {
            order.trackingDetails.deliveredAt = new Date();
          }

          order.shipment = order.shipment || {};
          if (!order.shipment.deliveredAt) {
            order.shipment.deliveredAt = new Date();
          }
        }
      }

      // -----------------------------------------------
      // ✅ 5) Shiprocket booking trigger ONLY if:
      // - was not confirmed and now confirmed
      // - AND not already booked
      // -----------------------------------------------
      if (!wasConfirmed && nowConfirmed) {
        const alreadyBooked =
          order?.shipment?.shiprocket?.awb || order?.shipment?.shiprocket?.shipmentId;

        if (!alreadyBooked) shouldBookShiprocket = true;
      }

      await order.save({ session });
      updatedOrder = order;
    });

    const finalOrder = await Order.findById(updatedOrder._id).lean();

    // ✅ Book Shiprocket ONLY if order became confirmed
    try {
      if (shouldBookShiprocket) {
        const freshOrderDoc = await Order.findById(finalOrder._id);
        await autoBookShiprocketForOrder(freshOrderDoc);
      }
    } catch (e) {
      console.error("⚠️ Auto Shiprocket booking after confirmation failed:", e?.message || e);
    }

    // ✅ Cancellation emails
    try {
      if (fulfillmentStatus === "cancelled") {
        console.log("📩 Triggering cancellation emails from updateOrderStatus...");
        triggerOrderCancellationEmails(finalOrder, reason);
      }
    } catch (e) {
      console.error("⚠️ Cancellation email trigger failed:", e?.message || e);
    }

    return res.status(200).json({
      message:
        fulfillmentStatus === "cancelled"
          ? "Order cancelled successfully"
          : "Order status updated",
      order: finalOrder,
    });
  } catch (error) {
    console.error("❌ Update Status Error:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};





/* ============================================================
   ✅ CONFIRM ORDER (ADMIN / COD)
   - sets isConfirmed + confirmedAt + confirmedBy
   - triggers Shiprocket booking
============================================================ */
export const confirmOrder = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const orderId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    const adminId = req.user?._id || null; // if you have auth middleware

    let updatedOrder = null;
    let shouldBookShiprocket = false;

    await session.withTransaction(async () => {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw new Error("Order not found");

      // ✅ prepaid guard (razorpay must be paid)
      if (order.paymentMethod === "razorpay" && order.paymentStatus !== "paid") {
        throw new Error("Cannot confirm Razorpay order before payment is paid");
      }

      // ✅ idempotent: already confirmed
      if (order.isConfirmed) {
        updatedOrder = order;
        return;
      }

      order.isConfirmed = true;
      order.confirmedAt = new Date();
      if (adminId) order.confirmedBy = adminId;

      // ✅ book only if not already booked
      const alreadyBooked =
        order?.shipment?.shiprocket?.awb || order?.shipment?.shiprocket?.shipmentId;

      if (!alreadyBooked) shouldBookShiprocket = true;

      await order.save({ session });
      updatedOrder = order;
    });

    // ✅ book shiprocket outside transaction
    try {
      if (shouldBookShiprocket) {
        const freshOrderDoc = await Order.findById(updatedOrder._id);
        await autoBookShiprocketForOrder(freshOrderDoc);
      }
    } catch (e) {
      console.error("⚠️ Auto Shiprocket booking after confirm failed:", e?.message || e);
    }

    const finalOrder = await Order.findById(updatedOrder._id).lean();

    return res.status(200).json({
      message: "Order confirmed successfully",
      order: finalOrder,
    });
  } catch (error) {
    console.error("❌ Confirm Order Error:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};


/* ============================================================
   UPDATE TRACKING
============================================================ */
export const updateTracking = async (req, res) => {
  try {
    const {
      trackingId,        // keep for backward compatibility
      awb,               // ✅ NEW
      courierName,
      trackingUrl,       // ✅ NEW
      shippedAt,
      deliveredAt,
      expectedDelivery,
    } = req.body;

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const finalAwb = (awb ?? trackingId ?? order?.shipment?.shiprocket?.awb ?? order?.trackingDetails?.trackingId ?? "").toString();
    const finalCourier = (courierName ?? order?.shipment?.shiprocket?.courierName ?? order?.trackingDetails?.courierName ?? "").toString();
    const finalUrl = (trackingUrl ?? order?.shipment?.shiprocket?.trackingUrl ?? order?.trackingDetails?.trackingUrl ?? "").toString();

    // ✅ Ensure shipment objects exist
    order.shipment = order.shipment || {};
    order.shipment.provider = order.shipment.provider || "shiprocket";
    order.shipment.shiprocket = order.shipment.shiprocket || {};

    // ✅ Save main source of truth
    if (finalAwb) order.shipment.shiprocket.awb = finalAwb;
    if (finalCourier) order.shipment.shiprocket.courierName = finalCourier;
    if (finalUrl) order.shipment.shiprocket.trackingUrl = finalUrl;

    // ✅ trackingDetails mirror (if you added trackingUrl in schema)
    order.trackingDetails = {
      ...(order.trackingDetails || {}),
      trackingId: finalAwb || order.trackingDetails?.trackingId,
      courierName: finalCourier || order.trackingDetails?.courierName,
      trackingUrl: finalUrl || order.trackingDetails?.trackingUrl,
      shippedAt: shippedAt ?? order.trackingDetails?.shippedAt,
      deliveredAt: deliveredAt ?? order.trackingDetails?.deliveredAt,
      expectedDelivery: expectedDelivery ?? order.trackingDetails?.expectedDelivery,
    };

    // ✅ If shipped → set shipped status (optional but sensible)
    if (finalAwb || shippedAt) {
      order.fulfillmentStatus = order.fulfillmentStatus === "processing" ? "shipped" : order.fulfillmentStatus;
      order.shipment.status = order.shipment.status === "pending" ? "shipped" : order.shipment.status;
      if (shippedAt && !order.shipment.shippedAt) order.shipment.shippedAt = new Date(shippedAt);
    }

    // ✅ If deliveredAt set -> auto mark delivered
    if (deliveredAt) {
      order.fulfillmentStatus = "delivered";
      order.shipment.status = "delivered";
      if (!order.shipment.deliveredAt) order.shipment.deliveredAt = new Date(deliveredAt);
    }

    await order.save();

        // ✅ Send tracking email to customer (only if we have basic tracking info)
    try {
      const customerEmail =
        order?.shippingAddressSnapshot?.email ||
        order?.customerId?.email || // works if populated
        order?.billingAddressSnapshot?.email ||
        order?.email;

      const customerName =
        order?.shippingAddressSnapshot?.fullName ||
        order?.shippingAddressSnapshot?.name ||
        order?.customerId?.name || // works if populated
        "Customer";

      if (customerEmail && (finalAwb || finalUrl)) {
        await Mailer.sendOrderTracking({
          to: customerEmail,
          name: customerName,
          awb: finalAwb,
          courierName: finalCourier || "—",
          trackingLink: finalUrl || "#",
          order,
        });
      }
    } catch (mailErr) {
      console.error("❌ Tracking mail error:", mailErr?.message || mailErr);
    }


    return res.status(200).json({ message: "Tracking updated", order });
  } catch (error) {
    console.error("❌ Tracking Update Error:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

/* ============================================================
   DELETE ORDER
============================================================ */
export const deleteOrder = async (req, res) => {
  try {
    const deletedOrder = await Order.findByIdAndDelete(req.params.id);
    if (!deletedOrder)
      return res.status(404).json({ message: "Order not found" });

    return res.status(200).json({ message: "Order deleted" });
  } catch (error) {
    console.error("❌ Delete Order Error:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

/* ============================================================
   ORDER ANALYTICS (ADMIN)
============================================================ */
export const getOrderAnalytics = async (req, res) => {
  try {
    const totalOrders = await Order.countDocuments();
    const totalRevenue = await Order.aggregate([
      { $group: { _id: null, sum: { $sum: "$finalPayable" } } },
    ]);

    const codOrders = await Order.countDocuments({ paymentMethod: "cod" });
    const prepaidOrders = await Order.countDocuments({
      paymentMethod: { $ne: "cod" },
    });

    return res.status(200).json({
      totalOrders,
      totalRevenue: totalRevenue[0]?.sum || 0,
      codOrders,
      prepaidOrders,
    });
  } catch (error) {
    console.error("❌ Analytics Error:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// ✅ GET ORDER BY ORDER NUMBER (ex: MIRAY-000005)
export const getOrderByOrderNumber = async (req, res) => {
  try {
    const orderNumber = String(req.params.orderNumber || "").trim();
    if (!orderNumber)
      return res.status(400).json({ message: "orderNumber missing" });

    const order = await Order.findOne({ orderNumber })
      .populate("customerId", "name email phone")
      .populate("items.productId");

    if (!order) return res.status(404).json({ message: "Order not found" });
    return res.status(200).json(order);
  } catch (error) {
    console.error("❌ Fetch Order By Number Error:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// CANCEL ORDER
export const cancelOrder = async (req, res) => {
  const session = await mongoose.startSession();
  const TAG = "❌[CANCEL_ORDER]";

  try {
    const orderId = req.params.id;
    const { reason = "cancelled_by_customer" } = req.body;

    console.log(`${TAG} Request received`, { orderId, reason });

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      console.log(`${TAG} Invalid orderId`);
      return res.status(400).json({ message: "Invalid order id" });
    }

    let cancelledOrderId = null; // ✅ store for later email trigger

    await session.withTransaction(async () => {
      console.log(`${TAG} Transaction started`);

      const order = await Order.findById(orderId).session(session);
      if (!order) {
        console.log(`${TAG} Order not found inside txn`);
        throw new Error("Order not found");
      }

      console.log(`${TAG} Order loaded`, {
        fulfillmentStatus: order.fulfillmentStatus,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
      });

      /* ------------------------------------------------
         1️⃣ CANCELLATION GUARDS
      ------------------------------------------------ */
      const nonCancellableStatuses = [
        "picked",
        "shipped",
        "out_for_delivery",
        "delivered",
      ];

      if (nonCancellableStatuses.includes(order.fulfillmentStatus)) {
        console.log(`${TAG} Cannot cancel due to status`, {
          fulfillmentStatus: order.fulfillmentStatus,
        });
        throw new Error("Order cannot be cancelled after pickup / shipment");
      }

      // ✅ Idempotent: already cancelled → no-op
      if (order.fulfillmentStatus === "cancelled") {
        console.log(`${TAG} Already cancelled -> no-op`);
        cancelledOrderId = order._id;
        return;
      }

      /* ------------------------------------------------
         2️⃣ CANCEL SHIPROCKET (IF BOOKED & NOT PICKED)
      ------------------------------------------------ */
      const shipmentId = order?.shipment?.shiprocket?.shipmentId;

      console.log(`${TAG} Checking Shiprocket shipment`, { shipmentId });

      if (shipmentId) {
        try {
          await cancelShiprocketShipment(shipmentId);
          console.log(`${TAG} ✅ Shiprocket cancellation successful`, {
            shipmentId,
          });
        } catch (err) {
          console.error(
            `${TAG} ⚠️ Shiprocket cancel failed`,
            err?.response?.data || err
          );
          // Do NOT block cancellation
        }
      }

      /* ------------------------------------------------
         3️⃣ RESTORE STOCK (ATOMIC)
      ------------------------------------------------ */
      console.log(`${TAG} Restoring stock for items...`, {
        itemsCount: order.items?.length || 0,
      });

      for (const it of order.items || []) {
        const qty = Number(it.quantity || 0);
        if (!qty) continue;

        const variantId = it?.variant?.variantId;

        console.log(`${TAG} Restoring stock`, {
          productId: it.productId,
          variantId: variantId || null,
          qty,
        });

        if (variantId) {
          await Product.updateOne(
            {
              _id: it.productId,
              "variants._id": variantId,
            },
            { $inc: { "variants.$.stock": qty } }
          ).session(session);
        } else {
          await Product.updateOne(
            { _id: it.productId },
            { $inc: { stock: qty } }
          ).session(session);
        }
      }

      console.log(`${TAG} ✅ Stock restoration complete`);

      /* ------------------------------------------------
         4️⃣ PAYMENT STATE (REFUND MARKING)
      ------------------------------------------------ */
      if (
        order.paymentMethod === "razorpay" &&
        order.paymentStatus === "paid"
      ) {
        console.log(`${TAG} Razorpay paid -> marking refund_pending`);
        // actual refund handled async / webhook
        order.paymentStatus = "refund_pending";
      }

      /* ------------------------------------------------
         5️⃣ FINAL ORDER STATE
      ------------------------------------------------ */
      console.log(`${TAG} Updating order state to cancelled`);

      order.fulfillmentStatus = "cancelled";

      order.shipment = {
        ...(order.shipment || {}),
        status: "cancelled",
      };

      order.adminRemarks = reason;

      await order.save({ session });

      console.log(`${TAG} ✅ Order cancelled saved in DB`, {
        orderId: order._id,
        fulfillmentStatus: order.fulfillmentStatus,
      });

      cancelledOrderId = order._id;
    });

    /* =========================================================
       ✅ Fetch cancelled order (lean)
       - outside txn
       - for email trigger + response consistency
    ========================================================= */
    let finalOrder = null;

    try {
      if (cancelledOrderId) {
        finalOrder = await Order.findById(cancelledOrderId).lean();
        console.log(`${TAG} ✅ Final order fetched outside txn`, {
          cancelledOrderId,
          fulfillmentStatus: finalOrder?.fulfillmentStatus,
        });
      }
    } catch (e) {
      console.error(`${TAG} ⚠️ Cancel order fetch failed`, e?.message || e);
    }

    /* =========================================================
       ✅ EMAIL TRIGGER (Non-blocking)
       - Customer cancellation email
       - Admin FYI email (optional)
       - Never block response
    ========================================================= */
    try {
      if (finalOrder) {
        console.log(`${TAG} Triggering cancellation emails...`, {
          customerEmail:
            finalOrder?.shippingAddressSnapshot?.email ||
            finalOrder?.customerId?.email ||
            finalOrder?.email ||
            null,
        });

        // triggerOrderCancellationEmails(finalOrder, reason);

        console.log(`${TAG} ✅ triggerOrderCancellationEmails called`);
      }
    } catch (e) {
      console.error(
        `${TAG} ⚠️ triggerOrderCancellationEmails failed`,
        e?.message || e
      );
    }

    return res.status(200).json({
      success: true,
      message:
        finalOrder?.fulfillmentStatus === "cancelled"
          ? "Order cancelled successfully"
          : "Order already cancelled",
      order: finalOrder || undefined,
    });
  } catch (error) {
    console.error(`${TAG} ❌ Cancel Order Error`, error);
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  } finally {
    console.log(`${TAG} Session ended`);
    session.endSession();
  }
};

async function performOrderCancellation({ orderId, reason, session }) {
  const order = await Order.findById(orderId).session(session);
  if (!order) throw new Error("Order not found");

  const nonCancellableStatuses = [
    "picked",
    "shipped",
    "out_for_delivery",
    "delivered",
  ];

  if (nonCancellableStatuses.includes(order.fulfillmentStatus)) {
    throw new Error("Order cannot be cancelled after pickup / shipment");
  }

  // ✅ Idempotent
  if (order.fulfillmentStatus === "cancelled") {
    return order;
  }

  /* ------------------------------------------------
     2️⃣ CANCEL SHIPROCKET (IF BOOKED & NOT PICKED)
  ------------------------------------------------ */
  const shipmentId = order?.shipment?.shiprocket?.shipmentId;

  if (shipmentId) {
    try {
      await cancelShiprocketShipment(shipmentId);
    } catch (err) {
      console.error("⚠️ Shiprocket cancel failed:", err?.response?.data || err);
      // Do NOT block cancellation
    }
  }

  /* ------------------------------------------------
     3️⃣ RESTORE STOCK (ATOMIC)
  ------------------------------------------------ */
  for (const it of order.items || []) {
    const qty = Number(it.quantity || 0);
    if (!qty) continue;

    const variantId = it?.variant?.variantId;

    if (variantId) {
      await Product.updateOne(
        {
          _id: it.productId,
          "variants._id": variantId,
        },
        { $inc: { "variants.$.stock": qty } }
      ).session(session);
    } else {
      await Product.updateOne(
        { _id: it.productId },
        { $inc: { stock: qty } }
      ).session(session);
    }
  }

  /* ------------------------------------------------
     4️⃣ PAYMENT STATE (REFUND MARKING)
  ------------------------------------------------ */
  if (order.paymentMethod === "razorpay" && order.paymentStatus === "paid") {
    // actual refund handled async / webhook
    order.paymentStatus = "refund_pending";
  }

  /* ------------------------------------------------
     5️⃣ FINAL ORDER STATE ✅ FIXED
  ------------------------------------------------ */
  order.fulfillmentStatus = "cancelled";

  // ✅ Always ensure shipment + shiprocket objects exist
  order.shipment = order.shipment || {};
  order.shipment.shiprocket = order.shipment.shiprocket || {};

  order.shipment = {
    ...(order.shipment || {}),
    shiprocket: {
      ...(order.shipment.shiprocket || {}),
    },
    status: "cancelled",
  };

  order.adminRemarks = reason;

  await order.save({ session });

  return order;
}



// SHIPROCKET AUTOBOOK
async function autoBookShiprocketForOrder(order) {
  const TAG = "🚀[AUTO-SHIPROCKET]";

  try {
    console.log(`${TAG} START`, {
      orderNumber: order?.orderNumber,
      orderId: order?._id?.toString(),
      paymentMethod: order?.paymentMethod,
      paymentStatus: order?.paymentStatus,
      isConfirmed: order?.isConfirmed,
    });

    // 0) Guards
    if (!order?.isConfirmed) return console.log(`${TAG} 🚫 SKIP: not confirmed`);
    if (!order?.shippingAddressSnapshot?.pincode)
      return console.log(`${TAG} ❌ SKIP: shipping pincode missing`);
    if (!process.env.SHIPROCKET_PICKUP_PINCODE)
      return console.log(`${TAG} ❌ SKIP: SHIPROCKET_PICKUP_PINCODE missing`);
    if (!process.env.SHIPROCKET_PICKUP_LOCATION)
      return console.log(`${TAG} ❌ SKIP: SHIPROCKET_PICKUP_LOCATION missing`);

    // already booked?
    if (order?.shipment?.shiprocket?.awb)
      return console.log(`${TAG} ✅ SKIP: AWB exists`, {
        awb: order.shipment.shiprocket.awb,
      });

    // shipment exists -> only assign awb
    if (order?.shipment?.shiprocket?.shipmentId) {
      const existingShipmentId = String(order.shipment.shiprocket.shipmentId || "").trim();
      if (!existingShipmentId) return;

      console.log(`${TAG} ✅ Shipment exists. Trying assign AWB...`, { existingShipmentId });

      try {
        const assigned = await assignAwb(existingShipmentId);
        const awb = String(assigned?.awb_code || assigned?.awb || "").trim();

        if (!awb) {
          return console.log(`${TAG} ⚠️ Assign AWB response missing awb_code`, {
            shipmentId: existingShipmentId,
            data: assigned,
          });
        }

        order.shipment = order.shipment || {};
        order.shipment.shiprocket = order.shipment.shiprocket || {};

        order.shipment.shiprocket.awb = awb;
        order.shipment.shiprocket.courierName =
          assigned?.courier_name || order.shipment.shiprocket.courierName || "";
        order.shipment.shiprocket.trackingUrl =
          assigned?.tracking_url ||
          order.shipment.shiprocket.trackingUrl ||
          `https://shiprocket.co/tracking/${awb}`;
        order.shipment.shiprocket.status = "processing";
        order.shipment.status = "processing";

        order.trackingDetails = {
          ...(order.trackingDetails || {}),
          trackingId: awb,
          courierName: order.shipment.shiprocket.courierName,
          trackingUrl: order.shipment.shiprocket.trackingUrl,
        };

        await order.save();
        return console.log(`${TAG} ✅ AWB assigned & saved`, { existingShipmentId, awb });
      } catch (e) {
        return console.log(`${TAG} ⚠️ Assign AWB failed`, {
          shipmentId: existingShipmentId,
          message: e?.message,
          status: e?.response?.status,
          data: e?.response?.data,
        });
      }
    }

    // prepaid guard
    if (order.paymentMethod === "razorpay" && order.paymentStatus !== "paid") {
      return console.log(`${TAG} ⏳ SKIP: prepaid not paid yet`);
    }

    // 1) Weight
    const totalWeight =
      order.items?.reduce((sum, it) => {
        const w = Number(it.variant?.weight) || Number(it.productSnapshot?.weight) || 0.5;
        return sum + w * Number(it.quantity || 1);
      }, 0) || 0.5;

    // 2) Serviceability
    const isCOD = String(order.paymentMethod || "").toLowerCase() === "cod";
    const couriers = await checkServiceability({
      pickupPincode: process.env.SHIPROCKET_PICKUP_PINCODE,
      deliveryPincode: String(order.shippingAddressSnapshot.pincode || ""),
      weight: totalWeight,
      cod: isCOD ? 1 : 0,
    });

    if (!Array.isArray(couriers) || couriers.length === 0) {
      return console.log(`${TAG} ⚠️ SKIP: No courier available`);
    }

    // 3) Build payload (✅ NET model should be implemented in buildShiprocketPayload)
    const payload = buildShiprocketPayload(order);

    // ✅ Shiprocket wants "COD" or "Prepaid"
    payload.payment_method = isCOD ? "COD" : "Prepaid";

    // ✅ Shipping charges from your order
    payload.shipping_charges = Number(order.shippingFee || 0);

    // ✅ Collectable amount (COD)
    payload.collectable_amount = isCOD ? Number(order.finalPayable || 0) : 0;

    // ✅ Avoid accidental extra additions
    if (payload.transaction_charges == null) payload.transaction_charges = 0;

    // ✅ STRONG CONSISTENCY GUARD (NET)
    if (isCOD) {
      const expectedSubTotal = Math.max(
        0,
        Number(order.finalPayable || 0) -
          Number(order.shippingFee || 0) -
          Number(order.tax || 0)
      );

      // If rounding drift/mismatch happens, force to expected
      if (Number.isFinite(expectedSubTotal) && Math.abs(Number(payload.sub_total || 0) - expectedSubTotal) >= 1) {
        payload.sub_total = expectedSubTotal;

        // keep items aligned (simple rebalance)
        if (Array.isArray(payload.order_items) && payload.order_items.length) {
          const totalUnits = payload.order_items.reduce((s, x) => s + Number(x.units || 0), 0) || 1;
          const perUnit = Math.round(expectedSubTotal / totalUnits);

          // reset all to perUnit first
          payload.order_items = payload.order_items.map((x) => ({
            ...x,
            selling_price: String(perUnit),
            discount: "0",
          }));

          // adjust last item to fix remainder
          const after = payload.order_items.reduce((s, x) => s + (Number(x.selling_price) * Number(x.units)), 0);
          const delta = expectedSubTotal - after; // could be +/- small
          const last = payload.order_items[payload.order_items.length - 1];
          const lastUnits = Number(last.units || 1);
          const lastPrice = Number(last.selling_price || 0);
          payload.order_items[payload.order_items.length - 1] = {
            ...last,
            selling_price: String(Math.max(0, lastPrice + Math.round(delta / lastUnits))),
          };
        }
      }
    }

    // ✅ Sanity log (NET model)
    console.log(`${TAG} 🧾 AMOUNT CHECK (NET model)`, {
      orderSubtotal: Number(order.subtotal || 0),
      discount: Number(order.discount || 0),
      finalPayable: Number(order.finalPayable || 0),
      shippingFee: Number(order.shippingFee || 0),
      tax: Number(order.tax || 0),

      payload_payment_method: payload.payment_method,
      payload_sub_total: Number(payload.sub_total || 0),
      payload_shipping_charges: Number(payload.shipping_charges || 0),
      payload_transaction_charges: Number(payload.transaction_charges || 0),
      payload_collectable_amount: Number(payload.collectable_amount || 0),

      payload_expected_collectable: Math.max(
        0,
        Number(payload.sub_total || 0) +
          Number(payload.shipping_charges || 0) +
          Number(order.tax || 0)
      ),
    });

    console.log(`${TAG} 📦 Creating shipment...`, {
      order_id: payload?.order_id,
      payment_method: payload?.payment_method,
      weight: payload?.weight || totalWeight,
      items: payload?.order_items?.length || 0,
    });

    const shipment = await createShipment(payload);

    const shipmentId = shipment?.shipment_id ? String(shipment.shipment_id) : "";
    const shiprocketOrderId = shipment?.order_id ? String(shipment.order_id) : "";
    let awb = String(shipment?.awb_code || "").trim();

    if (!shipmentId) return console.log(`${TAG} ❌ FAIL: shipment_id missing`, { shipment });

    // 4) Save snapshot
    order.shipment = {
      ...(order.shipment || {}),
      provider: "shiprocket",
      shiprocket: {
        ...(order.shipment?.shiprocket || {}),
        shipmentId,
        orderId: shiprocketOrderId,
        awb: order.shipment?.shiprocket?.awb || "",
        courierName: shipment?.courier_name || order.shipment?.shiprocket?.courierName || "",
        trackingUrl: shipment?.tracking_url || order.shipment?.shiprocket?.trackingUrl || "",
        status: "processing",
        lastUpdatedAt: new Date(),
      },
      status: "processing",
    };

    await order.save();

    // 5) Assign AWB if missing
    if (!awb) {
      try {
        const assigned = await assignAwb(shipmentId);
        awb = String(assigned?.awb_code || assigned?.awb || "").trim();

        if (awb) {
          order.shipment.shiprocket.awb = awb;
          order.shipment.shiprocket.courierName =
            assigned?.courier_name || order.shipment.shiprocket.courierName || "";
          order.shipment.shiprocket.trackingUrl =
            assigned?.tracking_url ||
            order.shipment.shiprocket.trackingUrl ||
            `https://shiprocket.co/tracking/${awb}`;

          order.trackingDetails = {
            ...(order.trackingDetails || {}),
            trackingId: awb,
            courierName: order.shipment.shiprocket.courierName,
            trackingUrl: order.shipment.shiprocket.trackingUrl,
          };

          await order.save();
          console.log(`${TAG} ✅ AWB assigned & saved`, { shipmentId, awb });
        } else {
          console.log(`${TAG} ⚠️ Assign AWB success but awb_code missing`, {
            shipmentId,
            assigned,
          });
        }
      } catch (e) {
        console.log(`${TAG} ⚠️ Assign AWB failed`, {
          shipmentId,
          message: e?.message,
          status: e?.response?.status,
          data: e?.response?.data,
        });
      }
    }

    console.log(`${TAG} END ✅`, {
      orderNumber: order.orderNumber,
      shipmentId: order.shipment?.shiprocket?.shipmentId,
      awb: order.shipment?.shiprocket?.awb,
      status: order.shipment?.status,
    });
  } catch (err) {
    console.error(`${TAG} ❌ ERROR`, {
      message: err?.message,
      status: err?.response?.status,
      data: err?.response?.data,
      url: err?.config?.url,
    });
  }
}




// Admin trigger: Book Shiprocket only if details missing
// Route example: POST /admin/orders/:id/shiprocket/book
export const adminBookShiprocketIfMissing = async (req, res) => {
  const TAG = "🛠️[ADMIN-BOOK-SHIPROCKET]";

  try {
    const orderId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: "Invalid order id" });
    }

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    // ✅ Guards
    if (!order.isConfirmed) {
      return res.status(400).json({
        _success: false,
        get success() {
          return this._success;
        },
        set success(value) {
          this._success = value;
        },
        message: "Order not confirmed. Confirm order first.",
        reason: "not_confirmed",
      });
    }

    // prepaid guard (extra safety; your autoBook already checks, but keeping here)
    if (order.paymentMethod === "razorpay" && order.paymentStatus !== "paid") {
      return res.status(400).json({
        success: false,
        message: "Razorpay order is not paid yet.",
        reason: "prepaid_not_paid",
      });
    }

    if (!order?.shippingAddressSnapshot?.pincode) {
      return res.status(400).json({
        success: false,
        message: "Shipping pincode missing in order.",
        reason: "missing_delivery_pincode",
      });
    }

    if (!process.env.SHIPROCKET_PICKUP_PINCODE) {
      return res.status(500).json({
        success: false,
        message: "SHIPROCKET_PICKUP_PINCODE missing in env.",
        reason: "missing_pickup_pincode_env",
      });
    }

    // ✅ "Details missing" check (model has shipment.shiprocket always)
    const sr = order?.shipment?.shiprocket || {};
    const hasAwb = Boolean(String(sr.awb || "").trim());
    const hasShipmentId = Boolean(String(sr.shipmentId || "").trim());

    // Optional mirror check (doesn't block booking)
    const hasTrackingId = Boolean(String(order?.trackingDetails?.trackingId || "").trim());

    if (hasAwb || hasShipmentId) {
      return res.status(200).json({
        success: true,
        message: "Shiprocket already exists for this order. Skipping booking.",
        skipped: true,
        reason: hasAwb ? "awb_exists" : "shipmentId_exists",
        shiprocket: {
          shipmentId: String(sr.shipmentId || ""),
          awb: String(sr.awb || ""),
          courierName: String(sr.courierName || ""),
          trackingUrl: String(sr.trackingUrl || ""),
        },
        trackingDetails: {
          trackingId: String(order?.trackingDetails?.trackingId || ""),
          courierName: String(order?.trackingDetails?.courierName || ""),
          trackingUrl: String(order?.trackingDetails?.trackingUrl || ""),
        },
      });
    }

    console.log(`${TAG} Booking Shiprocket...`, {
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      hasTrackingId,
    });

    // ✅ Do booking (your function handles createShipment + assignAwb + save)
    await autoBookShiprocketForOrder(order);

    // ✅ Return fresh state
    const fresh = await Order.findById(orderId).lean();
    const freshSr = fresh?.shipment?.shiprocket || {};

    return res.status(200).json({
      success: true,
      message: "Shiprocket booking triggered (only when details were missing).",
      orderId: fresh?._id,
      orderNumber: fresh?.orderNumber,
      shiprocket: {
        shipmentId: String(freshSr.shipmentId || ""),
        awb: String(freshSr.awb || ""),
        courierName: String(freshSr.courierName || ""),
        trackingUrl: String(freshSr.trackingUrl || ""),
      },
      trackingDetails: {
        trackingId: String(fresh?.trackingDetails?.trackingId || ""),
        courierName: String(fresh?.trackingDetails?.courierName || ""),
        trackingUrl: String(fresh?.trackingDetails?.trackingUrl || ""),
      },
    });
  } catch (err) {
    console.error("❌ adminBookShiprocketIfMissing error:", err?.message || err);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message || "unknown_error",
    });
  }
};


/* ============================================================
   UPDATE ADDRESS SNAPSHOT (ADMIN)
   PATCH /api/orders/:id/address
   body: { type: "shipping"|"billing", address: {...} }
============================================================ */
export const updateOrderAddress = async (req, res) => {
  try {
    const orderId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    const { type, address } = req.body || {};
    const targetType = String(type || "").trim().toLowerCase();

    if (!["shipping", "billing"].includes(targetType)) {
      return res.status(400).json({ message: "Invalid type. Allowed: shipping | billing" });
    }

    if (!address || typeof address !== "object") {
      return res.status(400).json({ message: "address object missing" });
    }

    // ✅ Basic sanitizers
    const str = (v) => (v == null ? "" : String(v)).trim();
    const cleanPhone = (v) => str(v).replace(/[^\d+]/g, "").replace(/^\+/, "");
    const cleanPincode = (v) => str(v).replace(/[^\d]/g, "");

    const nextSnapshot = {
      fullName: str(address.fullName),
      line1: str(address.line1),
      line2: str(address.line2),
      city: str(address.city),
      state: str(address.state),
      pincode: cleanPincode(address.pincode),
      phone: cleanPhone(address.phone),
      // keep optional fields if you store them in snapshot:
      email: str(address.email),
      country: str(address.country),
    };

    // ✅ Minimal validations
    if (!nextSnapshot.fullName || !nextSnapshot.line1 || !nextSnapshot.city || !nextSnapshot.state || !nextSnapshot.pincode) {
      return res.status(400).json({ message: "Required fields missing (fullName, line1, city, state, pincode)" });
    }

    // ✅ pincode sanity (India)
    if (nextSnapshot.pincode && nextSnapshot.pincode.length !== 6) {
      return res.status(400).json({ message: "Invalid pincode" });
    }

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });

    // 🚫 Guard: once shipped/picked/out_for_delivery/delivered -> don't allow address change
    const blockedStatuses = ["picked", "shipped", "out_for_delivery", "delivered", "returned"];
    if (blockedStatuses.includes(order.fulfillmentStatus)) {
      return res.status(400).json({
        message: `Address cannot be updated after order is ${order.fulfillmentStatus}`,
      });
    }

    // 🚫 Guard: if Shiprocket shipment already created, usually address should NOT change
    const srShipmentId = order?.shipment?.shiprocket?.shipmentId;
    const srAwb = order?.shipment?.shiprocket?.awb;
    if (srShipmentId || srAwb) {
      return res.status(400).json({
        message: "Shiprocket shipment already created. Address update is locked.",
        reason: "shiprocket_locked",
      });
    }

    // ✅ Optional: keep history
    order.addressEditLogs = Array.isArray(order.addressEditLogs) ? order.addressEditLogs : [];
    order.addressEditLogs.push({
      type: targetType,
      updatedAt: new Date(),
      // adminId: req.user?._id || null, // if auth middleware exists
      previous:
        targetType === "shipping"
          ? order.shippingAddressSnapshot
          : order.billingAddressSnapshot,
      next: nextSnapshot,
    });

    if (targetType === "shipping") order.shippingAddressSnapshot = nextSnapshot;
    if (targetType === "billing") order.billingAddressSnapshot = nextSnapshot;

    await order.save();

    return res.status(200).json({ message: "Address updated", order });
  } catch (error) {
    console.error("❌ Update Address Error:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

