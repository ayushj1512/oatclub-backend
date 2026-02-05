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
import { createReservationInternal } from "../InventoryReservation/InventoryReservationController.js";
import { consumeReservationsInternalByOrder } from "../InventoryReservation/InventoryReservationController.js";

// ⚠️ path tumhare project ke hisaab se adjust kar lena

const isParentOrder = (order) => String(order?.orderType || "").toLowerCase() === "parent";
const isShipmentOrder = (order) =>
  ["shipment", "child"].includes(String(order?.orderType || "").toLowerCase()); // pick one naming


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

  /* ---------- tiny helpers ---------- */
  const str = (v) => (v == null ? "" : String(v));
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
  const oid = (v) => new mongoose.Types.ObjectId(String(v));

  const normEmail = (v) => str(v).trim().toLowerCase();
  const normPhone = (v) =>
    str(v).replace(/[^\d+]/g, "").trim().replace(/^\+/, "");

  const isNumericLike = (v) => /^[0-9]+$/.test(str(v).trim());

  const sanitizeSelectedColor = (color, productCode = "") => {
    const c = str(color).trim();
    const pc = str(productCode).trim();
    if (!c) return "";
    if (isNumericLike(c)) return "";
    if (pc && c.toUpperCase() === pc.toUpperCase()) return "";
    return c;
  };

  const buildCouponIdentity = ({ email, phone }) => {
    const e = normEmail(email);
    if (e && e.includes("@")) return `email:${e}`;
    const p = normPhone(phone);
    if (p) return `phone:${p}`;
    return "";
  };

  const pickAttr = (attrs = [], keys = []) => {
    const wanted = keys.map((k) => str(k).trim().toLowerCase());
    const found = (Array.isArray(attrs) ? attrs : []).find((a) =>
      wanted.includes(str(a?.key).trim().toLowerCase())
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
      return Object.entries(raw).map(([k, v]) => ({
        key: str(k),
        value: str(v),
      }));
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

  // ✅ allocate from sellable (stock - reserved) but allow made-to-order
  const computeAllocation = ({ stock, reservedStock, qty }) => {
    const sellable = Math.max(0, num(stock) - num(reservedStock));
    const allocatedQty = Math.min(num(qty), sellable);
    const toProduceQty = Math.max(0, num(qty) - allocatedQty);
    return { allocatedQty, toProduceQty };
  };

  const normalizePriority = (v) => {
    const p = str(v).trim().toLowerCase();
    return p === "high" || p === "medium" || p === "normal" ? p : "normal";
  };

  const validateAndComputeCoupon = async ({ code, cartTotal, identity }) => {
    if (!code) return { couponSnapshot: null, couponDiscount: 0, couponDoc: null };

    const couponCode = str(code).trim().toUpperCase();
    const couponDoc = await Coupon.findOne({ code: couponCode }).session(session);
    if (!couponDoc) throw new Error("Invalid coupon code.");
    if (!couponDoc.isActive) throw new Error("Coupon is not active.");
    if (couponDoc.validFrom && new Date() < new Date(couponDoc.validFrom))
      throw new Error("Coupon is not active yet.");
    if (couponDoc.validTill && new Date() > new Date(couponDoc.validTill))
      throw new Error("Coupon has expired.");

    if (num(cartTotal) < num(couponDoc.minPurchase || 0))
      throw new Error(`Minimum purchase required is ₹${num(couponDoc.minPurchase || 0)}`);

    if (num(couponDoc.usageLimit) > 0 && num(couponDoc.usedCount) >= num(couponDoc.usageLimit))
      throw new Error("Coupon usage limit has been reached.");

    const perUserLimit = num(couponDoc.usageLimitPerCustomer || 1);
    const usedBy = Array.isArray(couponDoc.usedBy) ? couponDoc.usedBy : [];
    const usedTimes = identity ? usedBy.filter((x) => str(x) === identity).length : 0;
    if (identity && usedTimes >= perUserLimit)
      throw new Error("You have already used this coupon.");

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
      coupon,
      shippingFee = 0,
      tax = 0,
      paymentMethod = "cod",
      source = "website",
      isGiftOrder = false,
      currency = "INR",
      customerSupportRemark = "",
      priority = "normal",
    } = req.body;

    const pm = str(paymentMethod).trim().toLowerCase();
    const finalPriority = normalizePriority(priority);

    /* ---------- basic validations ---------- */
    if (!isObjectId(customerId))
      return res.status(400).json({ message: "Invalid customerId" });

    if (!isObjectId(shippingAddressId))
      return res.status(400).json({ message: "Invalid shippingAddressId" });

    if (billingAddressId && !isObjectId(billingAddressId))
      return res.status(400).json({ message: "Invalid billingAddressId" });

    if (!Array.isArray(items) || !items.length)
      return res.status(400).json({ message: "Order items missing" });

    if (!["cod", "razorpay"].includes(pm))
      return res.status(400).json({
        message: "Invalid paymentMethod. Allowed: cod | razorpay",
      });

    let createdOrderId = null;

    await session.withTransaction(async () => {
      /* ---------- 1) Address snapshots ---------- */
      const shippingAddress = await Address.findById(shippingAddressId).session(session);
      if (!shippingAddress) throw new Error("Shipping address not found");

      const billingAddress = billingAddressId
        ? await Address.findById(billingAddressId).session(session)
        : shippingAddress;

      const shippingAddressSnapshot = buildAddressSnapshot(shippingAddress);
      const billingAddressSnapshot = buildAddressSnapshot(billingAddress);

      /* ---------- 2) Coupon identity ---------- */
      const identity = buildCouponIdentity({
        email: shippingAddressSnapshot?.email,
        phone: shippingAddressSnapshot?.phone,
      });

      /* ---------- 3) Fetch products (lean) ---------- */
      const productIds = [...new Set(items.map((i) => str(i?.productId)).filter(Boolean))];
      const bad = productIds.find((id) => !isObjectId(id));
      if (bad) throw new Error(`Invalid productId: ${bad}`);

      const products = await Product.find({ _id: { $in: productIds } })
        .session(session)
        .lean();

      const productMap = new Map(products.map((p) => [str(p._id), p]));

      /* ---------- 4) Normalize items + compute allocations ---------- */
      const normalizedItems = [];
      let subtotal = 0;
      let totalQty = 0;

      for (const item of items) {
        const pid = str(item?.productId);
        if (!pid) throw new Error("productId missing");

        const qty = num(item?.quantity);
        if (!Number.isFinite(qty) || qty < 1) throw new Error("Invalid quantity");

        const product = productMap.get(pid);
        if (!product) throw new Error("Product not found");

        const isVariable =
          product.productType === "variable" ||
          (Array.isArray(product.variants) && product.variants.length > 0);

        let variant = null;

        if (isVariable) {
          if (!item.variantId) throw new Error(`${product.title} - variantId missing`);
          variant = findVariantById(product, item.variantId);
          if (!variant) throw new Error(`${product.title} - variant not found`);
        }

        const { allocatedQty, toProduceQty } = computeAllocation({
          stock: variant ? variant.stock : product.stock,
          reservedStock: variant ? variant.reservedStock : product.reservedStock,
          qty,
        });

        const unitPrice = num(product.price);
        const lineSubtotal = unitPrice * qty;

        subtotal += lineSubtotal;
        totalQty += qty;

        const attrs = normalizeVariantAttributes(variant);

        const selectedSize =
          pickAttr(attrs, ["size", "sizes", "shirt_size"]) || getSizeFromSku(variant?.sku);

        const selectedColorRaw =
          pickAttr(attrs, ["color", "colour", "color_name"]) ||
          getColorFromSku(variant?.sku, product.productCode);

        const selectedColor = sanitizeSelectedColor(selectedColorRaw, product.productCode);

        normalizedItems.push({
          lineId: crypto.randomUUID(),
          productModel: "Product",
          productId: oid(product._id),

          fulfillment: { allocatedQty, shippedQty: 0, toProduceQty },

          productSnapshot: {
            productCode: product.productCode || "",
            title: product.title,
            slug: product.slug || "",
            thumbnail: product.thumbnail || "",
            images: Array.isArray(product.images) ? product.images : [],
            productType:
              product.productType || (product?.variants?.length ? "variable" : "simple"),
            sku: product.sku || "",
            tags: Array.isArray(product.tags) ? product.tags : [],
            hsnCode: str(product.hsnCode),
            weight: num(product.weight),
            currency: product.currency || currency,
          },

          variant: {
            variantId: variant?._id || null,
            sku: variant?.sku || "",
            attributes: attrs,
            weight: num(variant?.weight),
          },

          selectedSize,
          selectedColor,
          quantity: qty,
          price: unitPrice,
          compareAtPrice: product?.compareAtPrice ?? null,
          subtotal: lineSubtotal,
        });
      }

      /* ---------- 5) Discounts ---------- */
      const totalAmount = subtotal + num(shippingFee) + num(tax);

      const couponCode = coupon && typeof coupon === "object" ? str(coupon.code) : "";
      const { couponSnapshot, couponDiscount, couponDoc } = await validateAndComputeCoupon({
        code: couponCode,
        cartTotal: subtotal,
        identity,
      });

      const baseForRazorpayExtra = Math.max(0, subtotal - Math.min(num(couponDiscount), subtotal));
      const razorpayExtraDiscount =
        pm === "razorpay"
          ? Math.min(
              baseForRazorpayExtra,
              Math.round((baseForRazorpayExtra * RAZORPAY_DISCOUNT_PERCENT) / 100)
            )
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

      /* ---------- 6) Create order ---------- */
      const [order] = await Order.create(
        [
          {
            customerId: oid(customerId),
            shippingAddressSnapshot,
            billingAddressSnapshot,
            items: normalizedItems,

            // ✅ NEW
            priority: finalPriority,

            customerSupportRemark: str(customerSupportRemark).trim(),
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

      /* ---------- 7) Coupon usage on COD ---------- */
      if (couponDoc && couponSnapshot?.code && identity && pm === "cod") {
        couponDoc.usedBy = Array.isArray(couponDoc.usedBy) ? couponDoc.usedBy : [];
        couponDoc.usedBy.push(identity);
        couponDoc.usedCount = num(couponDoc.usedCount) + 1;
        await couponDoc.save({ session });
      }

      createdOrderId = order._id;
    });

    const finalOrder = await Order.findById(createdOrderId).lean();

    // non-blocking emails
    try {
      triggerOrderEmails(finalOrder);
    } catch (e) {
      console.error("⚠️ triggerOrderEmails failed:", e?.message || e);
    }

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
    const {
      customerId,
      paymentStatus,
      fulfillmentStatus,
      isConfirmed,      // supports boolean too
      confirmFilter,    // supports "confirmed" | "not_confirmed"
      priority,

      // ✅ NEW filters
      startDate,        // "YYYY-MM-DD"
      endDate,          // "YYYY-MM-DD"
      minAmount,
      maxAmount,
      paymentMethod,    // "cod" | "razorpay" | "exchange"
      customerName,     // search: order#, name, email, phone
    } = req.query;

    const filters = {};

    /* ----------------------------
       ✅ Basic filters
       ---------------------------- */
    if (customerId && mongoose.Types.ObjectId.isValid(String(customerId))) {
      filters.customerId = new mongoose.Types.ObjectId(String(customerId));
    }

    if (paymentStatus) filters.paymentStatus = String(paymentStatus).trim();
    if (fulfillmentStatus) filters.fulfillmentStatus = String(fulfillmentStatus).trim();

    // ✅ confirmation: support both isConfirmed=true/false and confirmFilter dropdown
    if (confirmFilter === "confirmed") filters.isConfirmed = true;
    else if (confirmFilter === "not_confirmed") filters.isConfirmed = { $ne: true };
    else if (isConfirmed != null) filters.isConfirmed = String(isConfirmed) === "true";

    // ✅ priority
    if (priority) {
      const p = String(priority).trim().toLowerCase();
      if (["normal", "medium", "high"].includes(p)) filters.priority = p;
    }

    // ✅ paymentMethod
    if (paymentMethod) filters.paymentMethod = String(paymentMethod).trim().toLowerCase();

    /* ----------------------------
       ✅ Date range (createdAt)
       - startDate inclusive
       - endDate exclusive (end + 1 day)
       ---------------------------- */
    const hasStart = !!startDate;
    const hasEnd = !!endDate;

    if (hasStart || hasEnd) {
      filters.createdAt = {};
      if (hasStart) {
        // start of day
        filters.createdAt.$gte = new Date(`${String(startDate)}T00:00:00.000Z`);
      }
      if (hasEnd) {
        // end exclusive: next day 00:00
        const end = new Date(`${String(endDate)}T00:00:00.000Z`);
        end.setUTCDate(end.getUTCDate() + 1);
        filters.createdAt.$lt = end;
      }
    }

    /* ----------------------------
       ✅ Amount range (finalPayable)
       ---------------------------- */
    const minA = Number(minAmount);
    const maxA = Number(maxAmount);
    if (Number.isFinite(minA) || Number.isFinite(maxA)) {
      filters.finalPayable = {};
      if (Number.isFinite(minA)) filters.finalPayable.$gte = minA;
      if (Number.isFinite(maxA)) filters.finalPayable.$lte = maxA;
    }

    /* ----------------------------
       ✅ Search (customerName param)
       - Supports: orderNumber, name, email, phone
       ---------------------------- */
    const q = String(customerName || "").trim();
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filters.$or = [
        { orderNumber: rx },
        { "shippingAddressSnapshot.fullName": rx },
        { "shippingAddressSnapshot.email": rx },
        { "shippingAddressSnapshot.phone": rx },
      ];
      // Note: customerId populate fields can't be searched here easily without $lookup.
      // If you want search in customer collection too, we can add $lookup in aggregate.
    }

    /* ----------------------------
       ✅ Aggregate: priority sort + latest
       ---------------------------- */
    const orders = await Order.aggregate([
      { $match: filters },
      {
        $addFields: {
          _priorityRank: {
            $switch: {
              branches: [
                { case: { $eq: ["$priority", "high"] }, then: 3 },
                { case: { $eq: ["$priority", "medium"] }, then: 2 },
                { case: { $eq: ["$priority", "normal"] }, then: 1 },
              ],
              default: 1,
            },
          },
        },
      },
      { $sort: { _priorityRank: -1, createdAt: -1 } },
      { $limit: 500 },
    ]);

    const populated = await Order.populate(orders, [
      { path: "customerId", select: "name email phone" },
      { path: "items.productId" },
    ]);

    return res.status(200).json(populated);
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
.sort({ priority: -1, createdAt: -1 });

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

    // ✅ trim remark
    if (body.customerSupportRemark != null) {
      body.customerSupportRemark = String(body.customerSupportRemark).trim();
    }

    // ✅ sanitize priority (normal | medium | high)
    if (body.priority != null) {
      const p = String(body.priority).trim().toLowerCase();
      body.priority = ["normal", "medium", "high"].includes(p) ? p : "normal";
    }

    // ✅ If coupon object updated manually, sync discount too
    if (body.coupon && typeof body.coupon === "object" && body.coupon.code) {
      body.discount = Number(body.coupon.discount || 0);
      if (body.coupon.identity != null) body.coupon.identity = String(body.coupon.identity).trim();
      if (body.coupon.code != null) body.coupon.code = String(body.coupon.code).trim().toUpperCase();
    }

    const updatedOrder = await Order.findByIdAndUpdate(req.params.id, body, {
      new: true,
      runValidators: true,
    });

    if (!updatedOrder) return res.status(404).json({ message: "Order not found" });

    return res.status(200).json({ message: "Order updated", order: updatedOrder });
  } catch (error) {
    console.error("❌ Update Order Error:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};


/* ============================================================
   UPDATE ORDER STATUS ONLY
   ✅ Fix: default cancel reason -> cancelled_by_customer
   ✅ Supports: cancelled_by_admin / cancelled_by_customer
============================================================ */
export const updateOrderStatus = async (req, res) => {
  const session = await mongoose.startSession();

  const str = (v) => (v == null ? "" : String(v));
  const normEmail = (v) => str(v).trim().toLowerCase();
  const normPhone = (v) => str(v).replace(/[^\d+]/g, "").trim().replace(/^\+/, "");
  const normReason = (v) => str(v).trim().toLowerCase();

  const stripUndefinedDeep = (obj) => {
    if (Array.isArray(obj)) return obj.map(stripUndefinedDeep);
    if (obj && typeof obj === "object") {
      const out = {};
      for (const [k, v] of Object.entries(obj)) {
        if (v === undefined) continue;
        out[k] = stripUndefinedDeep(v);
      }
      return out;
    }
    return obj;
  };

  const buildCouponIdentity = ({ email, phone }) => {
    const e = normEmail(email);
    if (e && e.includes("@")) return `email:${e}`;
    const p = normPhone(phone);
    if (p) return `phone:${p}`;
    return "";
  };

  const pickCancelReason = () => {
    const incoming = normReason(req.body?.reason);
    if (incoming === "cancelled_by_admin") return "cancelled_by_admin";
    if (incoming === "cancelled_by_customer") return "cancelled_by_customer";
    if (incoming === "admin") return "cancelled_by_admin";
    if (incoming === "customer") return "cancelled_by_customer";

    const actor = normReason(req.body?.cancelledBy);
    if (actor === "admin") return "cancelled_by_admin";
    if (actor === "customer") return "cancelled_by_customer";

    const ar = normReason(req.body?.adminRemarks);
    if (ar === "cancelled_by_admin" || ar === "admin") return "cancelled_by_admin";

    if (req.user?.role === "admin") return "cancelled_by_admin";
    return "cancelled_by_customer";
  };

  const isAdminCancel = (reason) => normReason(reason) === "cancelled_by_admin";

  try {
    req.body = stripUndefinedDeep(req.body);

    if (req.body?.shipment) {
      if (req.body.shipment.xpressbees == null) delete req.body.shipment.xpressbees;
      if (req.body.shipment.shiprocket == null) delete req.body.shipment.shiprocket;
    }

    const orderId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    const { fulfillmentStatus, paymentStatus, isConfirmed } = req.body;
    const reason = pickCancelReason();

    let updatedOrder = null;
    let shouldBookShiprocket = false;

    await session.withTransaction(async () => {
      // ✅ Cancel flow
      if (fulfillmentStatus === "cancelled") {
        await performOrderCancellation({ orderId, reason, session });

        const $set = {};
        const $unset = {};

        if (isAdminCancel(reason)) {
          $set.adminRemarks = str(req.body?.adminRemarks).trim() || "cancelled_by_admin";
          $unset.customerMessage = 1;
        } else {
          $set.customerMessage =
            str(req.body?.customerMessage).trim() || "cancelled_by_customer";
          $unset.adminRemarks = 1;
        }

        await Order.updateOne({ _id: orderId }, { $set, $unset }).session(session);
        updatedOrder = await Order.findById(orderId).session(session);
        return;
      }

      const order = await Order.findById(orderId).session(session);
      if (!order) throw new Error("Order not found");

      const isParent = String(order?.orderType || "").toLowerCase() === "parent";

      // 1) Payment status
      if (paymentStatus) order.paymentStatus = paymentStatus;

      // 2) Manual confirm
      if (isConfirmed === true && !order.isConfirmed) {
        if (order.paymentMethod === "razorpay" && order.paymentStatus !== "paid") {
          throw new Error("Cannot confirm Razorpay order before payment is paid");
        }
        order.isConfirmed = true;
        order.confirmedAt = new Date();
      }

      // 3) Auto-confirm razorpay paid
      if (
        paymentStatus === "paid" &&
        order.paymentMethod === "razorpay" &&
        !order.isConfirmed
      ) {
        order.isConfirmed = true;
        order.confirmedAt = new Date();
      }

      // 3.1) Mark coupon used on razorpay paid (idempotent)
      if (paymentStatus === "paid" && order.paymentMethod === "razorpay" && order?.coupon?.code) {
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
            if (!couponDoc.usedBy.includes(identity)) {
              couponDoc.usedBy.push(identity);
              couponDoc.usedCount = Number(couponDoc.usedCount || 0) + 1;
              await couponDoc.save({ session });
            }
          }
        }
      }

      const nowConfirmed = Boolean(order.isConfirmed);

      // 4) Fulfillment status update
      if (fulfillmentStatus) {
        const shippingStages = ["packed", "picked", "shipped", "out_for_delivery", "delivered"];

        if (isParent && shippingStages.includes(fulfillmentStatus)) {
          throw new Error(
            "Parent order cannot move to shipping stages. Update shipment orders (-A/-B) instead."
          );
        }

        if (!nowConfirmed && shippingStages.includes(fulfillmentStatus)) {
          throw new Error("Order must be confirmed before shipping stages");
        }

        // ✅ IMPORTANT: booking trigger should happen when it becomes PACKED
        const becomingPacked =
          fulfillmentStatus === "packed" && order.fulfillmentStatus !== "packed";

        // ✅ set status
        order.fulfillmentStatus = fulfillmentStatus;

        // ✅ Consume inventory reservations on PACKED
        // NOTE: you must import this at top of file:
        // import { consumeReservationsInternalByOrder } from "../InventoryReservation/InventoryReservationController.js";
        if (becomingPacked && !isParent) {
          await consumeReservationsInternalByOrder({
            orderId: order._id,
            reason: `Consumed on PACKED | orderNumber=${order.orderNumber || ""}`,
            session,
          });
        }

        if (fulfillmentStatus === "delivered") {
          order.trackingDetails = order.trackingDetails || {};
          order.shipment = order.shipment || {};
          if (!order.trackingDetails.deliveredAt) order.trackingDetails.deliveredAt = new Date();
          if (!order.shipment.deliveredAt) order.shipment.deliveredAt = new Date();
        }

        // ✅ BOOK SHIPROCKET ONLY WHEN PACKED (not on confirm)
        if (becomingPacked && !isParent) {
          const alreadyBooked =
            order?.shipment?.shiprocket?.awb || order?.shipment?.shiprocket?.shipmentId;

          // prepaid guard (extra safety)
          if (order.paymentMethod === "razorpay" && order.paymentStatus !== "paid") {
            throw new Error("Cannot book shipment before Razorpay payment is paid");
          }

          if (!alreadyBooked) shouldBookShiprocket = true;
        }
      }

      await order.save({ session });
      updatedOrder = order;
    });

    const finalOrder = await Order.findById(updatedOrder._id).lean();

    // ✅ Auto-book shiprocket AFTER packed (outside txn)
    try {
      if (shouldBookShiprocket) {
        const freshOrderDoc = await Order.findById(finalOrder._id);
        await autoBookShiprocketForOrder(freshOrderDoc);
      }
    } catch (e) {
      console.error("⚠️ Auto Shiprocket booking after packed failed:", e?.message || e);
    }

    // cancellation emails
    try {
      if (fulfillmentStatus === "cancelled") {
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
    return res.status(500).json({ message: "Server error", error: error.message });
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

    const adminId = req.user?._id || null;

    let updatedOrder = null;

    await session.withTransaction(async () => {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw new Error("Order not found");

      const isParent = String(order?.orderType || "").toLowerCase() === "parent";

      // ✅ prepaid guard
      if (order.paymentMethod === "razorpay" && order.paymentStatus !== "paid") {
        throw new Error("Cannot confirm Razorpay order before payment is paid");
      }

      // ✅ idempotent
      if (order.isConfirmed) {
        updatedOrder = order;
        return;
      }

      order.isConfirmed = true;
      order.confirmedAt = new Date();
      if (adminId) order.confirmedBy = adminId;

      // ✅ IMPORTANT: Do NOT book shipment on confirm anymore
      // booking will happen only when fulfillmentStatus becomes "packed"
      if (isParent) {
        // parent order confirm is ok, but shipping actions remain blocked
      }

      await order.save({ session });
      updatedOrder = order;
    });

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
      trackingId, // backward compatibility
      awb,
      courierName,
      trackingUrl,
      shippedAt,
      deliveredAt,
      expectedDelivery,
    } = req.body;

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    // ✅ PATCH: block parent tracking updates (partial-shipment model)
    if (String(order?.orderType || "").toLowerCase() === "parent") {
      return res.status(400).json({
        message:
          "Tracking cannot be updated on parent order. Update shipment order (-A/-B) instead.",
        reason: "parent_order_blocked",
      });
    }

    const finalAwb = String(
      awb ??
        trackingId ??
        order?.shipment?.shiprocket?.awb ??
        order?.trackingDetails?.trackingId ??
        ""
    ).trim();

    const finalCourier = String(
      courierName ??
        order?.shipment?.shiprocket?.courierName ??
        order?.trackingDetails?.courierName ??
        ""
    ).trim();

    const finalUrl = String(
      trackingUrl ??
        order?.shipment?.shiprocket?.trackingUrl ??
        order?.trackingDetails?.trackingUrl ??
        ""
    ).trim();

    // ✅ Ensure shipment objects exist
    order.shipment = order.shipment && typeof order.shipment === "object" ? order.shipment : {};
    order.shipment.provider = order.shipment.provider || "shiprocket";
    order.shipment.shiprocket =
      order.shipment.shiprocket && typeof order.shipment.shiprocket === "object"
        ? order.shipment.shiprocket
        : {};

    // ✅ Save main source of truth
    if (finalAwb) order.shipment.shiprocket.awb = finalAwb;
    if (finalCourier) order.shipment.shiprocket.courierName = finalCourier;
    if (finalUrl) order.shipment.shiprocket.trackingUrl = finalUrl;

    // ✅ Mirror
    order.trackingDetails = {
      ...(order.trackingDetails || {}),
      trackingId: finalAwb || order.trackingDetails?.trackingId,
      courierName: finalCourier || order.trackingDetails?.courierName,
      trackingUrl: finalUrl || order.trackingDetails?.trackingUrl,
      shippedAt: shippedAt ?? order.trackingDetails?.shippedAt,
      deliveredAt: deliveredAt ?? order.trackingDetails?.deliveredAt,
      expectedDelivery: expectedDelivery ?? order.trackingDetails?.expectedDelivery,
    };

    // ✅ If shipped → set shipped status (but don't downgrade)
    const hasShippedSignal = Boolean(finalAwb) || shippedAt != null;
    if (hasShippedSignal) {
      if (order.fulfillmentStatus === "processing") order.fulfillmentStatus = "shipped";
      if (!order.shipment.status || order.shipment.status === "pending")
        order.shipment.status = "shipped";

      if (shippedAt && !order.shipment.shippedAt) order.shipment.shippedAt = new Date(shippedAt);
    }

    // ✅ If deliveredAt set -> auto mark delivered (strongest)
    if (deliveredAt) {
      order.fulfillmentStatus = "delivered";
      order.shipment.status = "delivered";
      if (!order.shipment.deliveredAt) order.shipment.deliveredAt = new Date(deliveredAt);
    }

    await order.save();

    // ✅ Send tracking email to customer (non-blocking)
    try {
      const customerEmail =
        order?.shippingAddressSnapshot?.email ||
        order?.billingAddressSnapshot?.email ||
        order?.customerId?.email ||
        order?.email;

      const customerName =
        order?.shippingAddressSnapshot?.fullName ||
        order?.shippingAddressSnapshot?.name ||
        order?.customerId?.name ||
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
// ✅ IMPORTANT: Add these imports at top (adjust paths if needed)
// import InventoryReservation from "../InventoryReservation/InventoryReservation.js";
// import { releaseReservationInternalByOrder } from "../InventoryReservation/reservation.internal.js"; // optional helper (shown below)

export const cancelOrder = async (req, res) => {
  const session = await mongoose.startSession();
  const TAG = "❌[CANCEL_ORDER]";

  const str = (v) => (v == null ? "" : String(v));
  const norm = (v) => str(v).trim().toLowerCase();

  // ✅ remove undefined deeply (prevents cast errors)
  const stripUndefinedDeep = (obj) => {
    if (Array.isArray(obj)) return obj.map(stripUndefinedDeep);
    if (obj && typeof obj === "object") {
      const out = {};
      for (const [k, v] of Object.entries(obj)) {
        if (v === undefined) continue;
        out[k] = stripUndefinedDeep(v);
      }
      return out;
    }
    return obj;
  };

  const isAdminCancel = (reason) => norm(reason) === "cancelled_by_admin";

  const pickCancelReason = (req) => {
    const incoming = norm(req.body?.reason);
    if (incoming === "cancelled_by_admin" || incoming === "admin") return "cancelled_by_admin";
    if (incoming === "cancelled_by_customer" || incoming === "customer") return "cancelled_by_customer";

    const actor = norm(req.body?.cancelledBy);
    if (actor === "admin") return "cancelled_by_admin";
    if (actor === "customer") return "cancelled_by_customer";

    if (req.user?.role === "admin") return "cancelled_by_admin";
    return "cancelled_by_customer";
  };

  // ✅ release ALL "reserved" reservations for this order (restores reservedStock automatically)
  const releaseReservationsForOrder = async ({ orderId, reason, session }) => {
    const reservations = await InventoryReservation.find({
      refType: "order",
      refId: orderId,
      status: "reserved",
    }).session(session);

    for (const r of reservations) {
      // same logic as your controller: applyReservationTransition({r, nextStatus:"released"...})
      // but we call it inline to keep cancelOrder self-contained.
      const productId = r.productId;
      const variantId = r.variantId;
      const qty = Math.max(1, Number(r.qty || 0));

      if (variantId) {
        // reservedStock -qty on variant
        const upd = await Product.updateOne(
          { _id: productId },
          { $inc: { "variants.$[v].reservedStock": -qty } },
          { arrayFilters: [{ "v._id": variantId }], session }
        );
        if (upd.matchedCount === 0) throw new Error("Product not found while releasing reservation");
        if (upd.modifiedCount === 0) throw new Error("Variant not found / release failed");
      } else {
        const upd = await Product.updateOne(
          { _id: productId },
          { $inc: { reservedStock: -qty } },
          { session }
        );
        if (upd.matchedCount === 0) throw new Error("Product not found while releasing reservation");
      }

      r.status = "released";
      r.notes =
        (r.notes ? `${r.notes}\n` : "") +
        `Released: ${reason || "order_cancelled"} | at=${new Date().toISOString()}`;
      await r.save({ session });
    }

    return reservations.length;
  };

  try {
    req.body = stripUndefinedDeep(req.body);

    const orderId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      console.log(`${TAG} Invalid orderId`);
      return res.status(400).json({ success: false, message: "Invalid order id" });
    }

    const reason = pickCancelReason(req);
    console.log(`${TAG} Request received`, { orderId, reason });

    let cancelledOrderId = null;
    let releasedCount = 0;

    await session.withTransaction(async () => {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw new Error("Order not found");

      const orderType = norm(order?.orderType);
      const isParent = orderType === "parent";
      const isShipment = orderType === "shipment" || orderType === "child";

      // ✅ guards
      const nonCancellableStatuses = ["picked", "shipped", "out_for_delivery", "delivered"];
      if (nonCancellableStatuses.includes(norm(order.fulfillmentStatus))) {
        throw new Error("Order cannot be cancelled after pickup / shipment");
      }

      // ✅ idempotent
      if (norm(order.fulfillmentStatus) === "cancelled") {
        cancelledOrderId = order._id;
        return;
      }

      /* ------------------------------------------------
         1) Cancel Shiprocket (if booked) - skip parent
      ------------------------------------------------ */
      if (!isParent) {
        const shipmentId = order?.shipment?.shiprocket?.shipmentId;
        if (shipmentId) {
          try {
            await cancelShiprocketShipment(shipmentId);
            console.log(`${TAG} ✅ Shiprocket cancellation successful`, { shipmentId });
          } catch (err) {
            console.error(`${TAG} ⚠️ Shiprocket cancel failed`, err?.response?.data || err);
          }
        }
      }

      /* ------------------------------------------------
         2) ✅ NEW: Release inventory reservations (THIS is the main change)
         - Your createOrder now creates InventoryReservation docs
         - On cancel we must "release" them to reduce reservedStock
         - Parent: usually no stock ops, but still safe to release if any exist
      ------------------------------------------------ */
      releasedCount = await releaseReservationsForOrder({
        orderId: order._id,
        reason,
        session,
      });

      /* ------------------------------------------------
         3) 🚫 Remove old "restore stock +qty" logic
         Because you did NOT decrement stock at order creation.
         Stock is decremented only when reservation is CONSUMED (packed/shipped flow).
         So on cancel we only release reservations (reservedStock goes down).
      ------------------------------------------------ */
      // ✅ If you still have legacy orders that DID decrement stock at create,
      // handle them separately (migration / flag). Don't mix in this flow.

      /* ------------------------------------------------
         4) Payment status
      ------------------------------------------------ */
      if (norm(order.paymentMethod) === "razorpay" && norm(order.paymentStatus) === "paid") {
        order.paymentStatus = "refund_pending";
      }

      /* ------------------------------------------------
         5) Final state + remarks (safe shipment update)
      ------------------------------------------------ */
      order.fulfillmentStatus = "cancelled";

      if (!order.shipment || typeof order.shipment !== "object") order.shipment = {};
      order.shipment.status = "cancelled";

      if (isAdminCancel(reason)) {
        order.adminRemarks = "cancelled_by_admin";
        order.customerMessage = undefined;
      } else {
        order.customerMessage = "cancelled_by_customer";
        order.adminRemarks = undefined;
      }

      await order.save({ session });

      cancelledOrderId = order._id;
      console.log(`${TAG} ✅ Cancelled saved`, { orderId: cancelledOrderId, releasedCount });
    });

    const finalOrder = cancelledOrderId ? await Order.findById(cancelledOrderId).lean() : null;

    return res.status(200).json({
      success: true,
      message:
        finalOrder?.fulfillmentStatus === "cancelled"
          ? "Order cancelled successfully"
          : "Order already cancelled",
      releasedReservations: releasedCount, // ✅ helpful for debug
      order: finalOrder || null,
    });
  } catch (error) {
    console.error(`${TAG} ❌ Cancel Order Error`, error);
    return res.status(400).json({ success: false, message: error.message });
  } finally {
    console.log(`${TAG} Session ended`);
    session.endSession();
  }
};





async function performOrderCancellation({ orderId, reason, session }) {
  const order = await Order.findById(orderId).session(session);
  if (!order) throw new Error("Order not found");

  const orderType = String(order?.orderType || "").toLowerCase();
  const isParent = orderType === "parent";
  const isShipment = orderType === "shipment" || orderType === "child";

  const nonCancellableStatuses = ["picked", "shipped", "out_for_delivery", "delivered"];
  if (nonCancellableStatuses.includes(order.fulfillmentStatus)) {
    throw new Error("Order cannot be cancelled after pickup / shipment");
  }

  // ✅ Idempotent
  if (order.fulfillmentStatus === "cancelled") return order;

  /* ------------------------------------------------
     1) Cancel Shiprocket (if booked)
     ✅ Parent order never has shipment in partial model
  ------------------------------------------------ */
  if (!isParent) {
    const shipmentId = order?.shipment?.shiprocket?.shipmentId;
    if (shipmentId) {
      try {
        await cancelShiprocketShipment(shipmentId);
      } catch (err) {
        console.error("⚠️ Shiprocket cancel failed:", err?.response?.data || err);
        // don't block cancellation
      }
    }
  }

  /* ------------------------------------------------
     2) Restore Stock (atomic)
     ✅ Parent: DO NOT restore (children will restore)
     ✅ Shipment/Child: restore normally
     ✅ Fallback: if orderType missing, restore (safer)
  ------------------------------------------------ */
  const shouldRestoreStock = !isParent; // parent => false, shipment/child => true

  if (shouldRestoreStock) {
    for (const it of order.items || []) {
      const qty = Number(it.quantity || 0);
      if (!qty) continue;

      const variantId = it?.variant?.variantId;

      if (variantId) {
        await Product.updateOne(
          { _id: it.productId, "variants._id": variantId },
          { $inc: { "variants.$.stock": qty } }
        ).session(session);
      } else {
        await Product.updateOne(
          { _id: it.productId },
          { $inc: { stock: qty } }
        ).session(session);
      }
    }
  }

  /* ------------------------------------------------
     3) Payment State
  ------------------------------------------------ */
  if (order.paymentMethod === "razorpay" && order.paymentStatus === "paid") {
    order.paymentStatus = "refund_pending";
  }

  /* ------------------------------------------------
     4) Final State ✅ SAFE (no shipment overwrite)
  ------------------------------------------------ */
  order.fulfillmentStatus = "cancelled";

  // ✅ ensure shipment exists
  if (!order.shipment || typeof order.shipment !== "object") order.shipment = {};

  // ✅ set only status (do NOT replace object)
  order.shipment.status = "cancelled";

  // ✅ keep remarks (reason can be cancelled_by_admin / cancelled_by_customer)
  order.adminRemarks = reason;

  await order.save({ session });
  return order;
}





// SHIPROCKET AUTOBOOK
async function autoBookShiprocketForOrder(order) {
  const TAG = "🚀[AUTO-SHIPROCKET]";

// 🚫 Never book shipment for parent order
if (isParentOrder(order)) {
  return console.log(`${TAG} 🚫 SKIP: parent order cannot be shipped`, {
    orderNumber: order?.orderNumber,
  });
}

if (!order?.isConfirmed) return console.log(`${TAG} 🚫 SKIP: not confirmed`);

// ✅ NEW: only packed
if (String(order?.fulfillmentStatus || "").toLowerCase() !== "packed") {
  return console.log(`${TAG} 🚫 SKIP: not packed yet`, {
    orderNumber: order?.orderNumber,
    fulfillmentStatus: order?.fulfillmentStatus,
  });
}

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

    // ✅ block parent orders
    if (isParentOrder(order)) {
      return res.status(400).json({
        success: false,
        message: "Parent order cannot be shipped. Create -A/-B shipment order first.",
        reason: "parent_order_blocked",
      });
    }

    // ✅ Must be confirmed
    if (!order.isConfirmed) {
      return res.status(400).json({
        success: false,
        message: "Order not confirmed. Confirm order first.",
        reason: "not_confirmed",
      });
    }

    // ✅ NEW: Must be packed
    if (String(order.fulfillmentStatus || "").toLowerCase() !== "packed") {
      return res.status(400).json({
        success: false,
        message: "Shiprocket booking allowed only when order is packed.",
        reason: "not_packed",
        fulfillmentStatus: order.fulfillmentStatus,
      });
    }

    // prepaid guard
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

    const sr = order?.shipment?.shiprocket || {};
    const hasAwb = Boolean(String(sr.awb || "").trim());
    const hasShipmentId = Boolean(String(sr.shipmentId || "").trim());

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
      fulfillmentStatus: order.fulfillmentStatus,
      hasTrackingId,
    });

    await autoBookShiprocketForOrder(order);

    const fresh = await Order.findById(orderId).lean();
    const freshSr = fresh?.shipment?.shiprocket || {};

    return res.status(200).json({
      success: true,
      message: "Shiprocket booking triggered (only when packed and details were missing).",
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

export const splitOrderIntoShipments = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const orderId = req.params.id;
    const { splits } = req.body;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }
    if (!Array.isArray(splits) || splits.length < 2) {
      return res.status(400).json({ message: "splits must have at least 2 groups" });
    }

    let parentOrder;
    let childOrders = [];

    await session.withTransaction(async () => {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw new Error("Order not found");

      // 🚫 if already split, block double split
      const alreadyHasChildren = await Order.exists({ parentOrderId: order._id }).session(session);
      if (alreadyHasChildren) throw new Error("Order already split");

      const items = Array.isArray(order.items) ? order.items : [];
      if (!items.length) throw new Error("Order has no items");

      // Build map lineId -> item
      const itemMap = new Map(items.map((it) => [String(it.lineId), it]));

      // Validate all requested lineIds exist and are unique across splits
      const used = new Set();
      for (const grp of splits) {
        const lines = Array.isArray(grp?.lines) ? grp.lines.map(String) : [];
        if (!lines.length) throw new Error("Each split group must have lines[]");

        for (const lid of lines) {
          if (!itemMap.has(lid)) throw new Error(`Invalid lineId: ${lid}`);
          if (used.has(lid)) throw new Error(`Duplicate lineId across splits: ${lid}`);
          used.add(lid);
        }
      }

      // Ensure all items are covered (optional strict)
      if (used.size !== items.length) {
        throw new Error("All items must be included in splits");
      }

      // ✅ Convert original to parent ONLY NOW
      order.orderType = "parent";
      order.parentOrderId = null;
      order.splitSuffix = "";
      await order.save({ session });
      parentOrder = order;

      // Create child orders
      const suffixes = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
      for (let i = 0; i < splits.length; i++) {
        const grp = splits[i];
        const lines = grp.lines.map(String);
        const childItems = lines.map((lid) => itemMap.get(lid));

        // totals
        const childSubtotal = childItems.reduce((s, it) => s + Number(it.subtotal || 0), 0);

        // ✅ shipping/tax distribution strategy (simple):
        // shippingFee split proportionally by subtotal (or equally if subtotal 0)
        const parentShipping = Number(order.shippingFee || 0);
        const parentTax = Number(order.tax || 0);
        const parentDiscount = Number(order.discount || 0);
        const parentTotalSubtotal = Number(order.subtotal || 0) || 1;

        const ratio = childSubtotal / parentTotalSubtotal;

        const childShippingFee = Math.round(parentShipping * ratio);
        const childTax = Math.round(parentTax * ratio);
        const childDiscount = Math.round(parentDiscount * ratio);

        const childTotalAmount = childSubtotal + childShippingFee + childTax;
        const childFinalPayable = Math.max(0, childTotalAmount - childDiscount);

        const suffix = suffixes[i] || String(i + 1);

        const childDoc = await Order.create(
          [
            {
              customerId: order.customerId,
              shippingAddressSnapshot: order.shippingAddressSnapshot,
              billingAddressSnapshot: order.billingAddressSnapshot,

              items: childItems,

              // ✅ link
              orderType: "shipment",
              parentOrderId: order._id,
              splitSuffix: suffix,

              // ✅ inherit confirmation/payment info
              isConfirmed: order.isConfirmed,
              confirmedAt: order.confirmedAt,
              confirmedBy: order.confirmedBy,

              paymentMethod: order.paymentMethod,
              paymentStatus: order.paymentStatus,

              // ✅ money
              subtotal: childSubtotal,
              shippingFee: childShippingFee,
              tax: childTax,
              discount: childDiscount,
              totalAmount: childTotalAmount,
              finalPayable: childFinalPayable,

              currency: order.currency,
              coupon: order.coupon, // keep same snapshot if needed
              fulfillmentStatus: order.fulfillmentStatus === "processing" ? "processing" : order.fulfillmentStatus,
              source: order.source,
              isGiftOrder: order.isGiftOrder,
              customerSupportRemark: order.customerSupportRemark || "",
              analytics: order.analytics || {},
              rmas: [],
            },
          ],
          { session }
        );

        childOrders.push(childDoc[0]);
      }
    });

    return res.status(200).json({
      message: "Order split successfully",
      parentOrderId: parentOrder._id,
      childOrders: childOrders.map((o) => ({
        _id: o._id,
        orderNumber: o.orderNumber,
        splitSuffix: o.splitSuffix,
        parentOrderId: o.parentOrderId,
      })),
    });
  } catch (e) {
    return res.status(400).json({ message: e.message || "Split failed" });
  } finally {
    session.endSession();
  }
};
