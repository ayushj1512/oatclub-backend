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
import {
  consumeReservationsInternalByOrder,
  cancelReservationsInternalByOrder,
  restockFromRTOInternal,
} from "../InventoryReservation/InventoryReservationController.js";

import { reserveInventoryForOrderNumberInternal } from "../InventoryReservation/inventoryWebhook.js";

import {
  detectDuplicateOrders,
  markDuplicateOrderAlerts,
} from "./order.duplicate.utils.js";

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

const scrubXpressbees = (order) => {
  if (!order || !order.shipment) return;

  // If xpressbees exists but is undefined / not an object, remove it
  if (order.shipment.xpressbees === undefined) {
    order.shipment.xpressbees = undefined; // keep for clarity
    delete order.shipment.xpressbees;
  } else if (
    order.shipment.xpressbees != null &&
    typeof order.shipment.xpressbees !== "object"
  ) {
    delete order.shipment.xpressbees;
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

  const normalizePriority = (v) => {
    const p = str(v).trim().toLowerCase();
    return p === "high" || p === "medium" || p === "normal" ? p : "normal";
  };

  const validateAndComputeCoupon = async ({ code, cartTotal, identity }) => {
    if (!code) {
      return {
        couponSnapshot: null,
        couponDiscount: 0,
        couponDoc: null,
      };
    }

    const couponCode = str(code).trim().toUpperCase();
    const couponDoc = await Coupon.findOne({ code: couponCode }).session(session);

    if (!couponDoc) throw new Error("Invalid coupon code.");
    if (!couponDoc.isActive) throw new Error("Coupon is not active.");
    if (couponDoc.validFrom && new Date() < new Date(couponDoc.validFrom)) {
      throw new Error("Coupon is not active yet.");
    }
    if (couponDoc.validTill && new Date() > new Date(couponDoc.validTill)) {
      throw new Error("Coupon has expired.");
    }

    if (num(cartTotal) < num(couponDoc.minPurchase || 0)) {
      throw new Error(
        `Minimum purchase required is ₹${num(couponDoc.minPurchase || 0)}`
      );
    }

    if (
      num(couponDoc.usageLimit) > 0 &&
      num(couponDoc.usedCount) >= num(couponDoc.usageLimit)
    ) {
      throw new Error("Coupon usage limit has been reached.");
    }

    const perUserLimit = num(couponDoc.usageLimitPerCustomer || 1);
    const usedBy = Array.isArray(couponDoc.usedBy) ? couponDoc.usedBy : [];
    const usedTimes = identity
      ? usedBy.filter((x) => str(x) === identity).length
      : 0;

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
      couponSnapshot: {
        code: couponCode,
        discount: discountAmount,
      },
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
    if (!isObjectId(customerId)) {
      return res.status(400).json({ message: "Invalid customerId" });
    }

    if (!isObjectId(shippingAddressId)) {
      return res.status(400).json({ message: "Invalid shippingAddressId" });
    }

    if (billingAddressId && !isObjectId(billingAddressId)) {
      return res.status(400).json({ message: "Invalid billingAddressId" });
    }

    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ message: "Order items missing" });
    }

    if (!["cod", "razorpay"].includes(pm)) {
      return res.status(400).json({
        message: "Invalid paymentMethod. Allowed: cod | razorpay",
      });
    }

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
      const productIds = [
        ...new Set(items.map((i) => str(i?.productId)).filter(Boolean)),
      ];
      const bad = productIds.find((id) => !isObjectId(id));
      if (bad) throw new Error(`Invalid productId: ${bad}`);

      const products = await Product.find({ _id: { $in: productIds } })
        .session(session)
        .lean();

      const productMap = new Map(products.map((p) => [str(p._id), p]));

      /* ---------- 4) Normalize items ---------- */
      const normalizedItems = [];
      let subtotal = 0;
      let totalQty = 0;

      for (const item of items) {
        const pid = str(item?.productId);
        if (!pid) throw new Error("productId missing");

        const qty = num(item?.quantity);
        if (!Number.isFinite(qty) || qty < 1) {
          throw new Error("Invalid quantity");
        }

        const product = productMap.get(pid);
        if (!product) throw new Error("Product not found");

        const isVariable =
          product.productType === "variable" ||
          (Array.isArray(product.variants) && product.variants.length > 0);

        let variant = null;

        if (isVariable) {
          if (!item.variantId) {
            throw new Error(`${product.title} - variantId missing`);
          }
          variant = findVariantById(product, item.variantId);
          if (!variant) {
            throw new Error(`${product.title} - variant not found`);
          }
        }

        const unitPrice = num(product.price);
        const lineSubtotal = unitPrice * qty;

        subtotal += lineSubtotal;
        totalQty += qty;

        const attrs = normalizeVariantAttributes(variant);

        const selectedSize =
          pickAttr(attrs, ["size", "sizes", "shirt_size"]) ||
          getSizeFromSku(variant?.sku);

        const selectedColorRaw =
          pickAttr(attrs, ["color", "colour", "color_name"]) ||
          getColorFromSku(variant?.sku, product.productCode);

        const selectedColor = sanitizeSelectedColor(
          selectedColorRaw,
          product.productCode
        );

        normalizedItems.push({
          lineId: crypto.randomUUID(),
          productModel: "Product",
          productId: oid(product._id),

          // ✅ IMPORTANT:
          // createOrder pe reservation nahi chahiye
          // reservation confirm ke baad webhook se hoga
          fulfillment: {
            allocatedQty: 0,
            shippedQty: 0,
            toProduceQty: qty,
          },

          productSnapshot: {
            productCode: product.productCode || "",
            title: product.title,
            slug: product.slug || "",
            thumbnail: product.thumbnail || "",
            images: Array.isArray(product.images) ? product.images : [],
            productType:
              product.productType ||
              (product?.variants?.length ? "variable" : "simple"),
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

      const couponCode =
        coupon && typeof coupon === "object" ? str(coupon.code) : "";

      const { couponSnapshot, couponDiscount, couponDoc } =
        await validateAndComputeCoupon({
          code: couponCode,
          cartTotal: subtotal,
          identity,
        });

      const baseForRazorpayExtra = Math.max(
        0,
        subtotal - Math.min(num(couponDiscount), subtotal)
      );

      const razorpayExtraDiscount =
        pm === "razorpay"
          ? Math.min(
              baseForRazorpayExtra,
              Math.round(
                (baseForRazorpayExtra * RAZORPAY_DISCOUNT_PERCENT) / 100
              )
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
        tagsUsed: uniqStrings(
          normalizedItems.flatMap((it) => it.productSnapshot?.tags || [])
        ),
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

    // ✅ createOrder pe reservation webhook nahi chalega
    // reservation sirf confirm hone ke baad chalega

    try {
      triggerOrderEmails(finalOrder);
    } catch (e) {
      console.error("⚠️ triggerOrderEmails failed:", e?.message || e);
    }

    return res.status(201).json({
    message: "Order created successfully",
      order: finalOrder,
    });
  } catch (error) {
    console.error("❌ Create Order Error:", error);
    return res.status(400).json({
      message: error.message || "Order creation failed",
    });
  } finally {
    session.endSession();
  }
};




/* -------------------------------------------
   ✅ Date helpers (IST-safe)
   - If startAt/endAt provided (ISO with offset), use directly.
   - Else use startDate/endDate (YYYY-MM-DD) and convert to IST day boundaries.
------------------------------------------- */
const IST_OFFSET_MIN = 330; // +05:30

const parseYMD = (ymd) => {
  const s = String(ymd || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, mo, d };
};

// Convert "YYYY-MM-DD" IST midnight to a UTC Date object
const istStartUtcFromYMD = (ymd) => {
  const p = parseYMD(ymd);
  if (!p) return null;
  const utcMidnightMs = Date.UTC(p.y, p.mo - 1, p.d, 0, 0, 0, 0);
  return new Date(utcMidnightMs - IST_OFFSET_MIN * 60 * 1000);
};

// End exclusive: next day IST midnight (converted to UTC)
const istEndExclusiveUtcFromYMD = (ymd) => {
  const start = istStartUtcFromYMD(ymd);
  if (!start) return null;
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
};

// ✅ Updated: getAllOrders
// - supports array query params (fulfillmentStatus, paymentStatus, paymentMethod, priority)
// - safer parsing + sanitization
// - optional higher limit for admin (still capped, configurable)
// - keeps your IST date helpers as-is

export const getAllOrders = async (req, res) => {
  try {
    const {
      customerId,
      paymentStatus,
      fulfillmentStatus,
      isConfirmed,
      confirmFilter,
      priority,

      startDate,
      endDate,
      startAt,
      endAt,

      minAmount,
      maxAmount,
      paymentMethod,
      customerName,

      page = "1",
      limit = "100",

      // ✅ only compute sum when asked
      includeSum = "false",
    } = req.query;

    const filters = {};

    /* ----------------------------
       ✅ helpers
    ---------------------------- */
    const toStr = (v) => String(v ?? "").trim();
    const toLower = (v) => toStr(v).toLowerCase();

    // normalize query that can be string OR array
    const normalizeArrayParam = (v) => {
      if (v == null) return [];
      const arr = Array.isArray(v) ? v : [v];
      return arr
        .map((x) => toStr(x))
        .filter(Boolean);
    };

    const setInOrEq = (field, raw, mapFn = (x) => x) => {
      const arr = normalizeArrayParam(raw).map(mapFn).filter(Boolean);
      if (!arr.length) return;
      if (arr.length === 1) filters[field] = arr[0];
      else filters[field] = { $in: arr };
    };

    /* ----------------------------
       ✅ Basic filters
    ---------------------------- */
    if (customerId && mongoose.Types.ObjectId.isValid(String(customerId))) {
      filters.customerId = new mongoose.Types.ObjectId(String(customerId));
    }

    // ✅ paymentStatus: supports multi
    setInOrEq("paymentStatus", paymentStatus, (x) => toStr(x));

    // ✅ fulfillmentStatus: supports multi (processing/packed etc)
    setInOrEq("fulfillmentStatus", fulfillmentStatus, (x) => toStr(x));

    // confirmation
    if (confirmFilter === "confirmed") filters.isConfirmed = true;
    else if (confirmFilter === "not_confirmed") filters.isConfirmed = { $ne: true };
    else if (isConfirmed != null) filters.isConfirmed = toLower(isConfirmed) === "true";

    // ✅ priority: supports multi + whitelist
    const allowedPriority = new Set(["normal", "medium", "high"]);
    const prArr = normalizeArrayParam(priority).map((x) => toLower(x));
    const prClean = prArr.filter((p) => allowedPriority.has(p));
    if (prClean.length === 1) filters.priority = prClean[0];
    else if (prClean.length > 1) filters.priority = { $in: prClean };

    // ✅ paymentMethod: supports multi + lowercased
    setInOrEq("paymentMethod", paymentMethod, (x) => toLower(x));

    /* ----------------------------
       ✅ Date range (createdAt) — IST Correct
    ---------------------------- */
    const hasStartAt = !!toStr(startAt);
    const hasEndAt = !!toStr(endAt);
    const hasStartDate = !!toStr(startDate);
    const hasEndDate = !!toStr(endDate);

    if (hasStartAt || hasEndAt || hasStartDate || hasEndDate) {
      filters.createdAt = {};

      if (hasStartAt) {
        const d = new Date(toStr(startAt));
        if (!Number.isNaN(d.getTime())) filters.createdAt.$gte = d;
      } else if (hasStartDate) {
        const d = istStartUtcFromYMD(startDate);
        if (d) filters.createdAt.$gte = d;
      }

      if (hasEndAt) {
        const d = new Date(toStr(endAt));
        if (!Number.isNaN(d.getTime())) filters.createdAt.$lte = d;
      } else if (hasEndDate) {
        const d = istEndExclusiveUtcFromYMD(endDate);
        if (d) filters.createdAt.$lt = d;
      }

      if (!filters.createdAt.$gte && !filters.createdAt.$lt && !filters.createdAt.$lte) {
        delete filters.createdAt;
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
       ✅ Search (regex)
    ---------------------------- */
    const q = toStr(customerName);
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filters.$or = [
        { orderNumber: rx },
        { "shippingAddressSnapshot.fullName": rx },
        { "shippingAddressSnapshot.email": rx },
        { "shippingAddressSnapshot.phone": rx },
      ];
    }

    /* ----------------------------
       ✅ Pagination
       - default 100
       - cap configurable
       NOTE: if you want to allow admin to pull more, increase MAX_LIMIT.
    ---------------------------- */
    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);

    const limitNumRaw = parseInt(String(limit), 10) || 100;
    const MAX_LIMIT = 200; // ✅ keep 200 OR change to 500/1000 for admin panel
    const limitNum = Math.min(Math.max(1, limitNumRaw), MAX_LIMIT);

    const skip = (pageNum - 1) * limitNum;

    /* ----------------------------
       ✅ FAST projection for list
    ---------------------------- */
    const LIST_FIELDS = {
      orderNumber: 1,
      createdAt: 1,
      orderDate: 1,

      priority: 1,
      priorityRank: 1,

      paymentMethod: 1,
      paymentStatus: 1,
      fulfillmentStatus: 1,
      isConfirmed: 1,

      subtotal: 1,
      discount: 1,
      shippingFee: 1,
      tax: 1,
      totalAmount: 1,
      finalPayable: 1,
      currency: 1,

      "shippingAddressSnapshot.fullName": 1,
      "shippingAddressSnapshot.phone": 1,
      "shippingAddressSnapshot.email": 1,
      "shippingAddressSnapshot.pincode": 1,

      // light tracking
      "shipment.status": 1,
      "shipment.shiprocket.awb": 1,
      "shipment.shiprocket.courierName": 1,
      "shipment.shiprocket.trackingUrl": 1,

      // items but light + snapshot
      "items.lineId": 1,
      "items.quantity": 1,
      "items.price": 1,
      "items.subtotal": 1,
      "items.selectedSize": 1,
      "items.selectedColor": 1,
      "items.productSnapshot.productCode": 1,
      "items.productSnapshot.title": 1,
      "items.productSnapshot.thumbnail": 1,
      "items.variant.sku": 1,
    };

    /* ----------------------------
       ✅ Sort
    ---------------------------- */
    const sort = { priorityRank: -1, createdAt: -1 };

    const wantSum = toLower(includeSum) === "true";

    const promises = [
      Order.find(filters)
        .select(LIST_FIELDS)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean()
        .populate({ path: "customerId", select: "name email phone" }),

      Order.countDocuments(filters),
    ];

    if (wantSum) {
      promises.push(
        Order.aggregate([
          { $match: filters },
          {
            $group: {
              _id: null,
              totalSum: { $sum: { $ifNull: ["$finalPayable", 0] } },
            },
          },
        ])
      );
    }

    const [orders, totalCount, sumAgg] = await Promise.all(promises);

    const totalSum = wantSum ? Number(sumAgg?.[0]?.totalSum || 0) : null;
    const hasMore = skip + (orders?.length || 0) < totalCount;

    return res.status(200).json({
      orders,
      meta: {
        page: pageNum,
        limit: limitNum,
        totalCount,
        totalSum,
        hasMore,
      },
    });
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
   ✅ Fix: packed flow VersionError after reservation consume
============================================================ */
export const updateOrderStatus = async (req, res) => {
  const session = await mongoose.startSession();

  const str = (v) => (v == null ? "" : String(v));
  const lower = (v) => str(v).trim().toLowerCase();
  const normEmail = (v) => str(v).trim().toLowerCase();
  const normPhone = (v) =>
    str(v).replace(/[^\d+]/g, "").trim().replace(/^\+/, "");

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
    const incoming = lower(req.body?.reason);
    if (incoming === "cancelled_by_admin" || incoming === "admin") {
      return "cancelled_by_admin";
    }
    if (incoming === "cancelled_by_customer" || incoming === "customer") {
      return "cancelled_by_customer";
    }

    const actor = lower(req.body?.cancelledBy);
    if (actor === "admin") return "cancelled_by_admin";
    if (actor === "customer") return "cancelled_by_customer";

    const ar = lower(req.body?.adminRemarks);
    if (ar === "cancelled_by_admin" || ar === "admin") {
      return "cancelled_by_admin";
    }

    return req.user?.role === "admin"
      ? "cancelled_by_admin"
      : "cancelled_by_customer";
  };

  const isAdminCancel = (reason) => lower(reason) === "cancelled_by_admin";

  const defer = (fn) =>
    typeof setImmediate === "function" ? setImmediate(fn) : setTimeout(fn, 0);

  const triggerReserveNonBlocking = (orderNumber) => {
    const on = str(orderNumber).trim();
    if (!on) return;

    defer(async () => {
      try {
        await reserveInventoryForOrderNumberInternal({
          orderNumber: on,
          allowedFulfillment: ["processing", "packed"],
          confirmedOnly: true,
          debug: false,
        });
      } catch (err) {
        console.error(
          "⚠️ reserve after paid+confirm failed:",
          err?.message || err
        );
      }
    });
  };

  try {
    req.body = stripUndefinedDeep(req.body);

    if (req.body?.shipment) {
      if (req.body.shipment.xpressbees == null) {
        delete req.body.shipment.xpressbees;
      }
      if (req.body.shipment.shiprocket == null) {
        delete req.body.shipment.shiprocket;
      }
    }

    const orderId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    const fulfillmentStatus = req.body?.fulfillmentStatus
      ? lower(req.body.fulfillmentStatus)
      : "";
    const paymentStatus = req.body?.paymentStatus
      ? lower(req.body.paymentStatus)
      : "";
    const isConfirmedReq = req.body?.isConfirmed === true;

    const reason = pickCancelReason();

    let updatedOrder = null;
    let shouldBookShiprocket = false;
    let shouldTriggerReserve = false;

    await session.withTransaction(async () => {
      if (fulfillmentStatus === "cancelled") {
        await performOrderCancellation({ orderId, reason, session });

        const $set = {};
        const $unset = {};

        if (isAdminCancel(reason)) {
          $set.adminRemarks =
            str(req.body?.adminRemarks).trim() || "cancelled_by_admin";
          $unset.customerMessage = 1;
        } else {
          $set.customerMessage =
            str(req.body?.customerMessage).trim() || "cancelled_by_customer";
          $unset.adminRemarks = 1;
        }

        await Order.updateOne({ _id: orderId }, { $set, $unset }).session(
          session
        );
        updatedOrder = await Order.findById(orderId).session(session);
        return;
      }

      let order = await Order.findById(orderId).session(session);
      if (!order) throw new Error("Order not found");

      const isParent = lower(order?.orderType) === "parent";
      const prevPaid = lower(order?.paymentStatus) === "paid";
      const prevConfirmed = Boolean(order?.isConfirmed);

      if (paymentStatus) {
        order.paymentStatus = paymentStatus;
      }

      if (isConfirmedReq && !order.isConfirmed) {
        if (
          lower(order.paymentMethod) === "razorpay" &&
          lower(order.paymentStatus) !== "paid"
        ) {
          throw new Error("Cannot confirm Razorpay order before payment is paid");
        }
        order.isConfirmed = true;
        order.confirmedAt = new Date();
      }

      if (
        paymentStatus === "paid" &&
        lower(order.paymentMethod) === "razorpay" &&
        !order.isConfirmed
      ) {
        order.isConfirmed = true;
        order.confirmedAt = new Date();
      }

      const nowPaid = lower(order?.paymentStatus) === "paid";
      const nowConfirmed = Boolean(order?.isConfirmed);

      if (
        (!prevPaid && nowPaid && lower(order.paymentMethod) === "razorpay") ||
        (!prevConfirmed && nowConfirmed)
      ) {
        shouldTriggerReserve = true;
      }

      if (
        paymentStatus === "paid" &&
        lower(order.paymentMethod) === "razorpay" &&
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
          const couponDoc = await Coupon.findOne({ code: couponCode }).session(
            session
          );
          if (couponDoc) {
            couponDoc.usedBy = Array.isArray(couponDoc.usedBy)
              ? couponDoc.usedBy
              : [];
            if (!couponDoc.usedBy.includes(identity)) {
              couponDoc.usedBy.push(identity);
              couponDoc.usedCount = Number(couponDoc.usedCount || 0) + 1;
              await couponDoc.save({ session });
            }
          }
        }
      }

      let packedConsumed = false;

      if (fulfillmentStatus) {
        const shippingStages = [
          "packed",
          "picked",
          "shipped",
          "out_for_delivery",
          "delivered",
        ];
        const curr = lower(order.fulfillmentStatus);

        const isReversePickup = fulfillmentStatus === "pickup_initiated";
        const becomingPacked =
          fulfillmentStatus === "packed" && curr !== "packed";

        if (!isReversePickup) {
          if (isParent && shippingStages.includes(fulfillmentStatus)) {
            throw new Error(
              "Parent order cannot move to shipping stages. Update shipment orders (-A/-B) instead."
            );
          }
          if (!nowConfirmed && shippingStages.includes(fulfillmentStatus)) {
            throw new Error("Order must be confirmed before shipping stages");
          }
        }

        if (fulfillmentStatus === "refunded") {
          const allowedPrev = ["returned", "cancelled", "rto"];
          if (!allowedPrev.includes(curr)) {
            throw new Error(
              "Refunded can be marked only after returned/cancelled/rto"
            );
          }
          order.paymentStatus = "refunded";
        }

        if (becomingPacked && !isParent) {
          if (
            lower(order.paymentMethod) === "razorpay" &&
            lower(order.paymentStatus) !== "paid"
          ) {
            throw new Error("Cannot book shipment before Razorpay payment is paid");
          }

          await consumeReservationsInternalByOrder({
            orderId: order._id,
            reason: `Consumed on PACKED | orderNumber=${order.orderNumber || ""}`,
            session,
          });

          packedConsumed = true;

          // IMPORTANT:
          // reservation consume ke baad same order DB me update ho chuka ho sakta hai
          // isliye fresh document dubara read karo before save
          order = await Order.findById(orderId).session(session);
          if (!order) throw new Error("Order not found after reservation consume");
        }

        order.fulfillmentStatus = fulfillmentStatus;

        if (fulfillmentStatus === "delivered") {
          order.trackingDetails = order.trackingDetails || {};
          order.shipment = order.shipment || {};

          if (!order.trackingDetails.deliveredAt) {
            order.trackingDetails.deliveredAt = new Date();
          }
          if (!order.shipment.deliveredAt) {
            order.shipment.deliveredAt = new Date();
          }
        }

        if (becomingPacked && !isParent) {
          const alreadyBooked =
            order?.shipment?.shiprocket?.awb ||
            order?.shipment?.shiprocket?.shipmentId;

          if (!alreadyBooked) {
            shouldBookShiprocket = true;
          }
        }
      }

      await order.save({ session });
      updatedOrder = order;
    });

    const finalOrder = updatedOrder?._id
      ? await Order.findById(updatedOrder._id).lean()
      : null;

    if (finalOrder && shouldTriggerReserve) {
      try {
        triggerReserveNonBlocking(finalOrder?.orderNumber);
      } catch (e) {
        console.error("⚠️ reserve scheduling failed:", e?.message || e);
      }
    }

    if (finalOrder && shouldBookShiprocket) {
      try {
        const freshOrderDoc = await Order.findById(finalOrder._id);
        await autoBookShiprocketForOrder(freshOrderDoc);
      } catch (e) {
        console.error(
          "⚠️ Auto Shiprocket booking after packed failed:",
          e?.message || e
        );
      }
    }

    if (fulfillmentStatus === "cancelled") {
      try {
        triggerOrderCancellationEmails(finalOrder, reason);
      } catch (e) {
        console.error(
          "⚠️ Cancellation email trigger failed:",
          e?.message || e
        );
      }
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
   ✅ DUPLICATE / EXCHANGE ORDER
   - Creates MIRAY-000217-R1, R2 ...
   - paymentMethod: exchange
   - paymentStatus: not_applicable
============================================================ */



export const duplicateExchangeOrder = async (req, res) => {
  const session = await mongoose.startSession();

  // ---------------- helpers (LOCAL, self-contained) ----------------
  const str = (v) => (v == null ? "" : String(v));

  const num = (v, d = 0) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : d;
  };

  const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));

  const oid = (v) => new mongoose.Types.ObjectId(String(v));

  const escapeRegExp = (s) => String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const normalizeVariantAttributes = (variant) => {
    const raw = variant?.attributes;

    // supports: [{key,value}] or {key:value}
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

  const findVariantById = (product, variantId) => {
    if (!variantId) return null;
    const vars = Array.isArray(product?.variants) ? product.variants : [];
    return vars.find((v) => String(v._id) === String(variantId)) || null;
  };

  const pickAttr = (attrs = [], keys = []) => {
    const wanted = keys.map((k) => str(k).trim().toLowerCase());
    const found = (Array.isArray(attrs) ? attrs : []).find((a) =>
      wanted.includes(str(a?.key).trim().toLowerCase())
    );
    return found?.value ? str(found.value) : "";
  };

  const isNumericLike = (v) => /^[0-9]+$/.test(str(v).trim());

  const sanitizeSelectedColor = (color, productCode = "") => {
    const c = str(color).trim();
    const pc = str(productCode).trim();
    if (!c) return "";
    if (isNumericLike(c)) return "";
    if (pc && c.toUpperCase() === pc.toUpperCase()) return "";
    return c;
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

  // ✅ allocate from sellable stock (stock - reservedStock) else toProduce
  const computeAllocation = ({ stock = 0, reservedStock = 0, qty = 1 }) => {
    const q = Math.max(1, num(qty, 1));
    const sellable = Math.max(0, num(stock) - num(reservedStock));
    const allocatedQty = Math.min(q, sellable);
    const toProduceQty = Math.max(0, q - allocatedQty);
    return { allocatedQty, toProduceQty };
  };

  // ---------------- controller ----------------
  try {
    const orderId = req.params.orderId;

    const {
      // optional override items (exchange items)
      // [{ productId, quantity, variantId? }]
      items,

      // optional: link to existing rmaNumber
      rmaNumber,

      // optional notes
      customerNote = "",
      adminNote = "",
      reason = "other",
      resolution = "exchange",
    } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "Invalid orderId" });
    }

    let newOrderDoc = null;

    await session.withTransaction(async () => {
      const original = await Order.findById(orderId).session(session);
      if (!original) throw new Error("Original order not found");

      const base = str(original.orderNumber).trim(); // MIRAY-000217
      if (!base) throw new Error("Original orderNumber missing");

      // ✅ find next sequence: MIRAY-000217-R{n}
      const regex = new RegExp(`^${escapeRegExp(base)}-R(\\d+)$`, "i");
      const existing = await Order.find(
        { orderNumber: { $regex: regex } },
        { orderNumber: 1 }
      )
        .session(session)
        .lean();

      let maxN = 0;
      for (const x of existing) {
        const m = String(x.orderNumber || "").match(/-R(\d+)$/i);
        if (!m) continue;
        const n = Number(m[1]);
        if (Number.isFinite(n)) maxN = Math.max(maxN, n);
      }

      const nextN = maxN + 1;
      const newOrderNumber = `${base}-R${nextN}`;

      const incomingItems = Array.isArray(items) && items.length ? items : null;

      let normalizedItems = [];
      let subtotal = 0;

      if (!incomingItems) {
        // ✅ copy original items (snapshot based)
        normalizedItems = (original.items || []).map((it) => {
          const qty = Math.max(1, Number(it.quantity || 1));
          subtotal += Number(it.subtotal ?? Number(it.price || 0) * qty);

          return {
            ...(it?.toObject?.() ? it.toObject() : it),
            lineId: crypto.randomUUID(),
            fulfillment: { allocatedQty: 0, shippedQty: 0, toProduceQty: qty },
          };
        });
      } else {
        // ✅ build fresh snapshots from Product
        const productIds = [
          ...new Set(incomingItems.map((i) => str(i?.productId)).filter(Boolean)),
        ];
        const bad = productIds.find((id) => !isObjectId(id));
        if (bad) throw new Error(`Invalid productId: ${bad}`);

        const products = await Product.find({ _id: { $in: productIds } })
          .session(session)
          .lean();

        const productMap = new Map(products.map((p) => [str(p._id), p]));

        for (const item of incomingItems) {
          const pid = str(item?.productId);
          if (!pid) throw new Error("productId missing");

          const qty = num(item?.quantity, 0);
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

          const unitPrice = num(product.price, 0);
          const lineSubtotal = unitPrice * qty;

          subtotal += lineSubtotal;

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
              weight: num(product.weight, 0),
              currency: product.currency || "INR",
            },

            variant: {
              variantId: variant?._id || null,
              sku: variant?.sku || "",
              attributes: attrs,
              weight: num(variant?.weight, 0),
            },

            selectedSize,
            selectedColor,
            quantity: qty,
            price: unitPrice,
            compareAtPrice: product?.compareAtPrice ?? null,
            subtotal: lineSubtotal,
          });
        }
      }

      // ✅ exchange order amounts
      const exchangeSubtotal = subtotal;
      const exchangeDiscount = 0;
      const exchangeShipping = 0;
      const exchangeTax = 0;
      const exchangeTotalAmount = exchangeSubtotal;
      const exchangeFinalPayable = 0;

      const [created] = await Order.create(
        [
          {
            customerId: original.customerId,
            shippingAddressSnapshot: original.shippingAddressSnapshot,
            billingAddressSnapshot: original.billingAddressSnapshot,

            items: normalizedItems,

            rmas: [
              {
                rmaNumber: rmaNumber || undefined,
                type: "exchange",
                status: "approved",
                items: normalizedItems.map((it, idx) => ({
                  orderLineId: it.lineId,
                  orderItemIndex: idx,
                  quantity: Number(it.quantity || 1),
                  productId: it.productId || null,
                  productCode: it?.productSnapshot?.productCode || "",
                  title: it?.productSnapshot?.title || "",
                  variantSku: it?.variant?.sku || "",
                })),
                reason,
                customerNote: str(customerNote),
                adminNote: str(adminNote),
                resolution,
                exchangeRequest: { note: "Replacement order created" },
                fee: { amount: 0, currency: "INR", status: "waived" },
              },
            ],

            subtotal: exchangeSubtotal,
            discount: exchangeDiscount,
            shippingFee: exchangeShipping,
            tax: exchangeTax,
            totalAmount: exchangeTotalAmount,
            finalPayable: exchangeFinalPayable,
            currency: original.currency || "INR",

            paymentMethod: "exchange",
            paymentStatus: "not_applicable",
            fulfillmentStatus: "processing",

            source: "manual",
            isGiftOrder: original.isGiftOrder || false,

            orderType: "shipment",
            parentOrderId: original._id,
            splitSuffix: `R${nextN}`,

            isConfirmed: true,
            confirmedAt: new Date(),
            confirmedBy: req.user?._id || null,

            adminRemarks: `exchange_replacement_of:${base}`,
            customerSupportRemark: original.customerSupportRemark || "",

            analytics: {
              ...(original.analytics || {}),
              couponApplied: false,
              creditsUsed: false,
              onlinePaymentDiscountApplied: false,
              onlinePaymentDiscountPct: 0,
              onlinePaymentDiscountAmount: 0,
            },

            orderNumber: newOrderNumber,
          },
        ],
        { session }
      );

      newOrderDoc = created;
    });

    const fresh = await Order.findById(newOrderDoc._id).lean();
    return res.status(201).json({ message: "Exchange duplicate order created", order: fresh });
  } catch (e) {
    console.error("❌ duplicateExchangeOrder error:", e);
    return res.status(400).json({ message: e.message || "Duplicate create failed" });
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

  const defer = (fn) => {
    if (typeof setImmediate === "function") return setImmediate(fn);
    return setTimeout(fn, 0);
  };

  try {
    const orderId = req.params.id;
    console.log("🔵 [CONFIRM] Request received for orderId:", orderId);

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      console.log("❌ [CONFIRM] Invalid orderId");
      return res.status(400).json({ message: "Invalid order id" });
    }

    const adminId = req.user?._id || null;
    let updatedOrder = null;

    await session.withTransaction(async () => {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw new Error("Order not found");

      console.log("🟡 [CONFIRM] Order found:", {
        orderNumber: order.orderNumber,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        isConfirmed: order.isConfirmed,
      });

      if (order.paymentMethod === "razorpay" && order.paymentStatus !== "paid") {
        throw new Error("Cannot confirm Razorpay order before payment is paid");
      }

      if (order.isConfirmed) {
        console.log("⚠️ [CONFIRM] Order already confirmed");
        updatedOrder = order;
        return;
      }

      order.isConfirmed = true;
      order.confirmedAt = new Date();
      if (adminId) order.confirmedBy = adminId;

      await order.save({ session });
      updatedOrder = order;

      console.log("✅ [CONFIRM] Order marked confirmed:", order.orderNumber);
    });

    const finalOrder = await Order.findById(updatedOrder._id).lean();

    console.log("🟢 [CONFIRM] Transaction completed. Preparing inventory trigger...");

    // ✅ NON-BLOCKING reserve after confirm
    try {
      const orderNumber = String(finalOrder?.orderNumber || "").trim();

      if (!orderNumber) {
        console.log("⚠️ [INVENTORY] orderNumber missing — skipping reserve");
      } else {
        console.log("🚀 [INVENTORY] Scheduling reserve for:", orderNumber);

        defer(async () => {
          try {
            console.log("🟣 [INVENTORY] Reserve function started for:", orderNumber);

            const result = await reserveInventoryForOrderNumberInternal({
              orderNumber,
              allowedFulfillment: ["processing", "packed"],
              confirmedOnly: true,
              debug: true, // turn on deeper logs if your function supports
            });

            console.log("✅ [INVENTORY] Reserve completed:", {
              orderNumber,
              result,
            });
          } catch (err) {
            console.error("❌ [INVENTORY] Reserve failed:", err?.message || err);
          }
        });
      }
    } catch (e) {
      console.error("❌ [INVENTORY] Schedule failed:", e?.message || e);
    }

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
    const { trackingId, awb, courierName, trackingUrl, shippedAt, deliveredAt, expectedDelivery } = req.body || {};

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (String(order?.orderType || "").toLowerCase() === "parent") {
      return res.status(400).json({
        message: "Tracking cannot be updated on parent order. Update shipment order (-A/-B) instead.",
        reason: "parent_order_blocked",
      });
    }

    const finalAwb = String(awb ?? trackingId ?? order?.shipment?.shiprocket?.awb ?? order?.trackingDetails?.trackingId ?? "").trim();
    const finalCourier = String(courierName ?? order?.shipment?.shiprocket?.courierName ?? order?.trackingDetails?.courierName ?? "").trim();
    const finalUrl = String(trackingUrl ?? order?.shipment?.shiprocket?.trackingUrl ?? order?.trackingDetails?.trackingUrl ?? "").trim();

    order.shipment = order.shipment && typeof order.shipment === "object" ? order.shipment : {};
    order.shipment.provider = order.shipment.provider || "shiprocket";
    order.shipment.shiprocket = order.shipment.shiprocket && typeof order.shipment.shiprocket === "object" ? order.shipment.shiprocket : {};

    if (finalAwb) order.shipment.shiprocket.awb = finalAwb;
    if (finalCourier) order.shipment.shiprocket.courierName = finalCourier;
    if (finalUrl) order.shipment.shiprocket.trackingUrl = finalUrl;

    order.trackingDetails = {
      ...(order.trackingDetails || {}),
      trackingId: finalAwb || order.trackingDetails?.trackingId,
      courierName: finalCourier || order.trackingDetails?.courierName,
      trackingUrl: finalUrl || order.trackingDetails?.trackingUrl,
      shippedAt: shippedAt ?? order.trackingDetails?.shippedAt,
      deliveredAt: deliveredAt ?? order.trackingDetails?.deliveredAt,
      expectedDelivery: expectedDelivery ?? order.trackingDetails?.expectedDelivery,
    };

    const curr = String(order.fulfillmentStatus || "").toLowerCase();
    const terminal = ["cancelled", "returned", "refunded"];

    const hasShippedSignal = Boolean(finalAwb) || shippedAt != null;
    if (hasShippedSignal) {
      if (!terminal.includes(curr) && ["processing", "packed", "picked"].includes(curr)) order.fulfillmentStatus = "shipped";
      if (!order.shipment.status || order.shipment.status === "pending") order.shipment.status = "shipped";
      if (shippedAt && !order.shipment.shippedAt) order.shipment.shippedAt = new Date(shippedAt);
    }

    if (deliveredAt) {
      if (!terminal.includes(curr)) order.fulfillmentStatus = "delivered";
      order.shipment.status = "delivered";
      if (!order.shipment.deliveredAt) order.shipment.deliveredAt = new Date(deliveredAt);
      if (!order.trackingDetails.deliveredAt) order.trackingDetails.deliveredAt = new Date(deliveredAt);
    }

    await order.save();

    try {
      const customerEmail = order?.shippingAddressSnapshot?.email || order?.billingAddressSnapshot?.email || order?.customerId?.email || order?.email;
      const customerName = order?.shippingAddressSnapshot?.fullName || order?.shippingAddressSnapshot?.name || order?.customerId?.name || "Customer";
      if (customerEmail && (finalAwb || finalUrl)) {
        await Mailer.sendOrderTracking({ to: customerEmail, name: customerName, awb: finalAwb, courierName: finalCourier || "—", trackingLink: finalUrl || "#", order });
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
    if (incoming === "cancelled_by_admin" || incoming === "admin") {
      return "cancelled_by_admin";
    }
    if (incoming === "cancelled_by_customer" || incoming === "customer") {
      return "cancelled_by_customer";
    }

    const actor = norm(req.body?.cancelledBy);
    if (actor === "admin") return "cancelled_by_admin";
    if (actor === "customer") return "cancelled_by_customer";

    return req.user?.role === "admin"
      ? "cancelled_by_admin"
      : "cancelled_by_customer";
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

      const isParent = norm(order?.orderType) === "parent";

      const nonCancellableStatuses = ["picked", "shipped", "out_for_delivery", "delivered"];
      if (nonCancellableStatuses.includes(norm(order.fulfillmentStatus))) {
        throw new Error("Order cannot be cancelled after pickup / shipment");
      }

      if (norm(order.fulfillmentStatus) === "cancelled") {
        cancelledOrderId = order._id;
        return;
      }

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

      const cancelResult = await cancelReservationsInternalByOrder({
        orderId: order._id,
        reason,
        nextStatus: "released",
        session,
      });

      releasedCount = Number(cancelResult?.count || 0);

      if (norm(order.paymentMethod) === "razorpay" && norm(order.paymentStatus) === "paid") {
        order.paymentStatus = "refund_pending";
      }

      order.fulfillmentStatus = "cancelled";

      if (!order.shipment || typeof order.shipment !== "object") {
        order.shipment = {};
      }
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
      console.log(`${TAG} ✅ Cancelled saved`, {
        orderId: cancelledOrderId,
        releasedCount,
      });
    });

    const finalOrder = cancelledOrderId
      ? await Order.findById(cancelledOrderId).lean()
      : null;

    return res.status(200).json({
      success: true,
      message:
        finalOrder?.fulfillmentStatus === "cancelled"
          ? "Order cancelled successfully"
          : "Order already cancelled",
      releasedReservations: releasedCount,
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

  const nonCancellableStatuses = ["picked", "shipped", "out_for_delivery", "delivered"];
  if (nonCancellableStatuses.includes(String(order.fulfillmentStatus || "").toLowerCase())) {
    throw new Error("Order cannot be cancelled after pickup / shipment");
  }

  if (String(order.fulfillmentStatus || "").toLowerCase() === "cancelled") {
    return order;
  }

  const isParent = String(order?.orderType || "").toLowerCase() === "parent";

  if (!isParent) {
    const shipmentId = order?.shipment?.shiprocket?.shipmentId;
    if (shipmentId) {
      try {
        await cancelShiprocketShipment(shipmentId);
      } catch (err) {
        console.error("⚠️ Shiprocket cancel failed:", err?.response?.data || err);
      }
    }
  }

  await cancelReservationsInternalByOrder({
    orderId: order._id,
    reason,
    nextStatus: "released",
    session,
  });

  if (order.paymentMethod === "razorpay" && order.paymentStatus === "paid") {
    order.paymentStatus = "refund_pending";
  }

  order.fulfillmentStatus = "cancelled";
  if (!order.shipment || typeof order.shipment !== "object") order.shipment = {};
  order.shipment.status = "cancelled";
  order.adminRemarks = reason;

  await order.save({ session });
  return order;
}




/**
 * Auto book Shiprocket once order is PACKED.
 * ✅ Fix included: prevents "shipment.xpressbees cast" from blocking shiprocket save
 * (even if you don't use xpressbees, old/undefined values can still fail validation)
 */
async function autoBookShiprocketForOrder(order) {
  const TAG = "🚀[AUTO-SHIPROCKET]";

  /* ---------------- small helpers ---------------- */
  const low = (v) => String(v || "").trim().toLowerCase();
  const log = (m, o) => console.log(`${TAG} ${m}`, o || "");
  const scrubXpressbees = () => {
    // if xpressbees exists but isn't a proper object, remove it (prevents cast error)
    if (!order?.shipment || typeof order.shipment !== "object") return;
    if (order.shipment.xpressbees === undefined) delete order.shipment.xpressbees;
    else if (order.shipment.xpressbees != null && typeof order.shipment.xpressbees !== "object")
      delete order.shipment.xpressbees;
  };
  const ensureShipment = () => {
    order.shipment = order.shipment && typeof order.shipment === "object" ? order.shipment : {};
    order.shipment.shiprocket =
      order.shipment.shiprocket && typeof order.shipment.shiprocket === "object"
        ? order.shipment.shiprocket
        : {};
    scrubXpressbees();
  };
  const saveSafe = async () => {
    scrubXpressbees();
    await order.save();
  };

  /* ---------------- guards ---------------- */
  if (isParentOrder(order))
    return log("🚫 SKIP: parent order cannot be shipped", { orderNumber: order?.orderNumber });

  if (!order?.isConfirmed) return log("🚫 SKIP: not confirmed");
  if (low(order?.fulfillmentStatus) !== "packed")
    return log("🚫 SKIP: not packed yet", {
      orderNumber: order?.orderNumber,
      fulfillmentStatus: order?.fulfillmentStatus,
    });

  try {
    log("START", {
      orderNumber: order?.orderNumber,
      orderId: order?._id?.toString(),
      paymentMethod: order?.paymentMethod,
      paymentStatus: order?.paymentStatus,
      isConfirmed: order?.isConfirmed,
    });

    // env/address guards
    if (!order?.shippingAddressSnapshot?.pincode) return log("❌ SKIP: shipping pincode missing");
    if (!process.env.SHIPROCKET_PICKUP_PINCODE) return log("❌ SKIP: SHIPROCKET_PICKUP_PINCODE missing");
    if (!process.env.SHIPROCKET_PICKUP_LOCATION) return log("❌ SKIP: SHIPROCKET_PICKUP_LOCATION missing");

    // prepaid guard
    if (low(order?.paymentMethod) === "razorpay" && low(order?.paymentStatus) !== "paid")
      return log("⏳ SKIP: prepaid not paid yet");

    ensureShipment();

    // already has AWB -> done
    if (order?.shipment?.shiprocket?.awb)
      return log("✅ SKIP: AWB exists", { awb: order.shipment.shiprocket.awb });

    // shipment exists but AWB missing -> assign AWB
    const existingShipmentId = String(order?.shipment?.shiprocket?.shipmentId || "").trim();
    if (existingShipmentId) {
      log("✅ Shipment exists. Trying assign AWB...", { existingShipmentId });

      try {
        const assigned = await assignAwb(existingShipmentId);
        const awb = String(assigned?.awb_code || assigned?.awb || "").trim();
        if (!awb) return log("⚠️ Assign AWB response missing awb_code", { shipmentId: existingShipmentId });

        ensureShipment();
        order.shipment.provider = order.shipment.provider || "shiprocket";
        order.shipment.status = "processing";

        order.shipment.shiprocket.awb = awb;
        order.shipment.shiprocket.courierName =
          assigned?.courier_name || order.shipment.shiprocket.courierName || "";
        order.shipment.shiprocket.trackingUrl =
          assigned?.tracking_url ||
          order.shipment.shiprocket.trackingUrl ||
          `https://shiprocket.co/tracking/${awb}`;
        order.shipment.shiprocket.status = "processing";
        order.shipment.shiprocket.lastUpdatedAt = new Date();

        order.trackingDetails = {
          ...(order.trackingDetails || {}),
          trackingId: awb,
          courierName: order.shipment.shiprocket.courierName,
          trackingUrl: order.shipment.shiprocket.trackingUrl,
        };

        await saveSafe();
        return log("✅ AWB assigned & saved", { shipmentId: existingShipmentId, awb });
      } catch (e) {
        return log("⚠️ Assign AWB failed", {
          shipmentId: existingShipmentId,
          message: e?.message,
          status: e?.response?.status,
          data: e?.response?.data,
        });
      }
    }

    /* ---------------- weight ---------------- */
    const totalWeight =
      order.items?.reduce((sum, it) => {
        const w = Number(it.variant?.weight) || Number(it.productSnapshot?.weight) || 0.5;
        return sum + w * Number(it.quantity || 1);
      }, 0) || 0.5;

    /* ---------------- serviceability ---------------- */
    const isCOD = low(order.paymentMethod) === "cod";
    const couriers = await checkServiceability({
      pickupPincode: process.env.SHIPROCKET_PICKUP_PINCODE,
      deliveryPincode: String(order.shippingAddressSnapshot.pincode || ""),
      weight: totalWeight,
      cod: isCOD ? 1 : 0,
    });
    if (!Array.isArray(couriers) || couriers.length === 0) return log("⚠️ SKIP: No courier available");

    /* ---------------- payload ---------------- */
    const payload = buildShiprocketPayload(order);
    payload.payment_method = isCOD ? "COD" : "Prepaid";
    payload.shipping_charges = Number(order.shippingFee || 0);
    payload.collectable_amount = isCOD ? Number(order.finalPayable || 0) : 0;
    if (payload.transaction_charges == null) payload.transaction_charges = 0;

    // ✅ NET consistency (COD): sub_total should equal (finalPayable - shipping - tax)
    if (isCOD) {
      const expectedSubTotal = Math.max(
        0,
        Number(order.finalPayable || 0) - Number(order.shippingFee || 0) - Number(order.tax || 0)
      );
      if (Number.isFinite(expectedSubTotal) && Math.abs(Number(payload.sub_total || 0) - expectedSubTotal) >= 1) {
        payload.sub_total = expectedSubTotal;

        // quick rebalance order_items selling_price
        if (Array.isArray(payload.order_items) && payload.order_items.length) {
          const totalUnits = payload.order_items.reduce((s, x) => s + Number(x.units || 0), 0) || 1;
          const perUnit = Math.round(expectedSubTotal / totalUnits);

          payload.order_items = payload.order_items.map((x) => ({
            ...x,
            selling_price: String(perUnit),
            discount: "0",
          }));

          const after = payload.order_items.reduce(
            (s, x) => s + Number(x.selling_price || 0) * Number(x.units || 0),
            0
          );
          const delta = expectedSubTotal - after;
          const lastIdx = payload.order_items.length - 1;
          const last = payload.order_items[lastIdx];
          const lastUnits = Number(last.units || 1);
          payload.order_items[lastIdx] = {
            ...last,
            selling_price: String(Math.max(0, Number(last.selling_price || 0) + Math.round(delta / lastUnits))),
          };
        }
      }
    }

    log("📦 Creating shipment...", {
      order_id: payload?.order_id,
      payment_method: payload?.payment_method,
      weight: payload?.weight || totalWeight,
      items: payload?.order_items?.length || 0,
    });

    const shipment = await createShipment(payload);
    const shipmentId = shipment?.shipment_id ? String(shipment.shipment_id) : "";
    const shiprocketOrderId = shipment?.order_id ? String(shipment.order_id) : "";
    let awb = String(shipment?.awb_code || "").trim();

    if (!shipmentId) return log("❌ FAIL: shipment_id missing", { shipment });

    /* ---------------- save shiprocket snapshot (NO overwrite) ---------------- */
    ensureShipment();
    order.shipment.provider = "shiprocket";
    order.shipment.status = "processing";

    order.shipment.shiprocket.shipmentId = shipmentId;
    order.shipment.shiprocket.orderId = shiprocketOrderId;
    order.shipment.shiprocket.courierName = shipment?.courier_name || order.shipment.shiprocket.courierName || "";
    order.shipment.shiprocket.trackingUrl = shipment?.tracking_url || order.shipment.shiprocket.trackingUrl || "";
    order.shipment.shiprocket.status = "processing";
    order.shipment.shiprocket.lastUpdatedAt = new Date();

    await saveSafe();

    /* ---------------- assign AWB if missing ---------------- */
    if (!awb) {
      try {
        const assigned = await assignAwb(shipmentId);
        awb = String(assigned?.awb_code || assigned?.awb || "").trim();

        if (awb) {
          ensureShipment();
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

          await saveSafe();
          log("✅ AWB assigned & saved", { shipmentId, awb });
        } else {
          log("⚠️ Assign AWB success but awb_code missing", { shipmentId });
        }
      } catch (e) {
        log("⚠️ Assign AWB failed", {
          shipmentId,
          message: e?.message,
          status: e?.response?.status,
          data: e?.response?.data,
        });
      }
    }

    log("END ✅", {
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
// Admin trigger: Book Shiprocket ONLY if missing
// Route: POST /admin/orders/:id/shiprocket/book
export const adminBookShiprocketIfMissing = async (req, res) => {
  const TAG = "🛠️[ADMIN-BOOK-SHIPROCKET]";

  // tiny helpers
  const str = (v) => (v == null ? "" : String(v));
  const low = (v) => str(v).trim().toLowerCase();
  const trim = (v) => str(v).trim();

  // ✅ Fix: if xpressbees (unused) is present as undefined/bad type, it can block order.save()
  const scrubXpressbees = (order) => {
    if (!order?.shipment || typeof order.shipment !== "object") return;
    if (order.shipment.xpressbees === undefined) delete order.shipment.xpressbees;
    else if (order.shipment.xpressbees != null && typeof order.shipment.xpressbees !== "object")
      delete order.shipment.xpressbees;
  };

  try {
    const orderId = req.params.id;

    /* ---------------- validate id ---------------- */
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: "Invalid order id" });
    }

    /* ---------------- load order (Mongoose doc, not lean) ---------------- */
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    /* ---------------- guards ---------------- */
    if (isParentOrder(order)) {
      return res.status(400).json({
        success: false,
        message: "Parent order cannot be shipped. Create -A/-B shipment order first.",
        reason: "parent_order_blocked",
      });
    }

    if (!order.isConfirmed) {
      return res.status(400).json({
        success: false,
        message: "Order not confirmed. Confirm order first.",
        reason: "not_confirmed",
      });
    }

    if (low(order.fulfillmentStatus) !== "packed") {
      return res.status(400).json({
        success: false,
        message: "Shiprocket booking allowed only when order is packed.",
        reason: "not_packed",
        fulfillmentStatus: order.fulfillmentStatus,
      });
    }

    if (low(order.paymentMethod) === "razorpay" && low(order.paymentStatus) !== "paid") {
      return res.status(400).json({
        success: false,
        message: "Razorpay order is not paid yet.",
        reason: "prepaid_not_paid",
      });
    }

    if (!trim(order?.shippingAddressSnapshot?.pincode)) {
      return res.status(400).json({
        success: false,
        message: "Shipping pincode missing in order.",
        reason: "missing_delivery_pincode",
      });
    }

    if (!trim(process.env.SHIPROCKET_PICKUP_PINCODE)) {
      return res.status(500).json({
        success: false,
        message: "SHIPROCKET_PICKUP_PINCODE missing in env.",
        reason: "missing_pickup_pincode_env",
      });
    }

    /* ---------------- already booked? ---------------- */
    const sr = order?.shipment?.shiprocket || {};
    const hasAwb = Boolean(trim(sr.awb));
    const hasShipmentId = Boolean(trim(sr.shipmentId));

    if (hasAwb || hasShipmentId) {
      return res.status(200).json({
        success: true,
        skipped: true,
        message: "Shiprocket already exists for this order. Skipping booking.",
        reason: hasAwb ? "awb_exists" : "shipmentId_exists",
        shiprocket: {
          shipmentId: trim(sr.shipmentId),
          awb: trim(sr.awb),
          courierName: trim(sr.courierName),
          trackingUrl: trim(sr.trackingUrl),
        },
        trackingDetails: {
          trackingId: trim(order?.trackingDetails?.trackingId),
          courierName: trim(order?.trackingDetails?.courierName),
          trackingUrl: trim(order?.trackingDetails?.trackingUrl),
        },
      });
    }

    /* ---------------- book now ---------------- */
    console.log(`${TAG} Booking Shiprocket...`, {
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      fulfillmentStatus: order.fulfillmentStatus,
    });

    // ✅ important: remove bad xpressbees before booking (prevents cast error on save)
    scrubXpressbees(order);

    // This function will set shipment.shiprocket fields & save
    await autoBookShiprocketForOrder(order);

    /* ---------------- fetch fresh view ---------------- */
    const fresh = await Order.findById(orderId).lean();
    const freshSr = fresh?.shipment?.shiprocket || {};

    return res.status(200).json({
      success: true,
      message: "Shiprocket booking triggered (only when packed and details were missing).",
      orderId: fresh?._id,
      orderNumber: fresh?.orderNumber,
      shiprocket: {
        shipmentId: trim(freshSr.shipmentId),
        awb: trim(freshSr.awb),
        courierName: trim(freshSr.courierName),
        trackingUrl: trim(freshSr.trackingUrl),
      },
      trackingDetails: {
        trackingId: trim(fresh?.trackingDetails?.trackingId),
        courierName: trim(fresh?.trackingDetails?.courierName),
        trackingUrl: trim(fresh?.trackingDetails?.trackingUrl),
      },
    });
  } catch (err) {
    console.error(`${TAG} ❌ error:`, err?.message || err);

    // ✅ helpful: show validation paths if any
    if (err?.name === "ValidationError") {
      console.error(`${TAG} Validation paths:`, Object.keys(err.errors || {}));
    }

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





/* ============================================================
   ✅ LOOKUP ORDERS BY EMAIL / PHONE  (for Customer Support)
   Route: GET /api/orders/lookup?email=&phone=
   - searches in shipping/billing snapshots + coupon/analytics identity
   - returns latest first (and priority rank if you want)
   - includes enough fields for support panel
============================================================ */

export const lookupOrdersByIdentity = async (req, res) => {
  try {
    const str = (v) => (v == null ? "" : String(v));
    const normEmail = (v) => str(v).trim().toLowerCase();
    const normPhone = (v) => str(v).replace(/[^\d+]/g, "").trim().replace(/^\+/, "");

    const email = normEmail(req.query.email);
    const phone = normPhone(req.query.phone);

    if (!email && !phone) {
      return res.status(400).json({ message: "email or phone required" });
    }

    // build identities (matches your createOrder analytics.couponIdentity style)
    const identities = [];
    if (email && email.includes("@")) identities.push(`email:${email}`);
    if (phone) identities.push(`phone:${phone}`);

    // escape for regex contains search (fallback)
    const escapeRegExp = (s) => String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rxEmail = email ? new RegExp(`^${escapeRegExp(email)}$`, "i") : null;
    const rxPhone = phone ? new RegExp(`^${escapeRegExp(phone)}$`, "i") : null;

    const or = [];

    // ✅ primary: snapshot exact matches (case-insensitive for email)
    if (email) {
      or.push(
        { "shippingAddressSnapshot.email": rxEmail },
        { "billingAddressSnapshot.email": rxEmail }
      );
    }
    if (phone) {
      or.push(
        { "shippingAddressSnapshot.phone": phone },
        { "billingAddressSnapshot.phone": phone }
      );
    }

    // ✅ coupon / analytics identity matches
    if (identities.length) {
      or.push(
        { "coupon.identity": { $in: identities } },
        { "analytics.couponIdentity": { $in: identities } }
      );
    }

    // ✅ optional fallback: if your phone snapshots sometimes store +91 etc
    // do a "contains digits" regex (kept small to avoid slow scans)
    if (phone && phone.length >= 8) {
      const rxDigits = new RegExp(escapeRegExp(phone.slice(-10))); // last 10
      or.push(
        { "shippingAddressSnapshot.phone": rxDigits },
        { "billingAddressSnapshot.phone": rxDigits }
      );
    }

    // If somehow no OR built (shouldn’t happen), guard
    if (!or.length) {
      return res.status(400).json({ message: "Invalid lookup query" });
    }

    // ✅ Query with priority rank sort like your getAllOrders
    const orders = await Order.aggregate([
      { $match: { $or: or } },
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
      { $sort: { createdAt: -1, _priorityRank: -1 } }, // latest first (support wants latest)
      { $limit: 50 },
      {
        $project: {
          // keep payload light but useful for support panel
          orderNumber: 1,
          createdAt: 1,
          orderDate: 1,
          priority: 1,

          paymentMethod: 1,
          paymentStatus: 1,
          fulfillmentStatus: 1,
          isConfirmed: 1,

          subtotal: 1,
          discount: 1,
          shippingFee: 1,
          tax: 1,
          totalAmount: 1,
          finalPayable: 1,
          currency: 1,

          shippingAddressSnapshot: 1,
          billingAddressSnapshot: 1,

          trackingDetails: 1,
          shipment: 1,

          items: 1,
          rmas: 1,
        },
      },
    ]);

    // if you want customer details too (optional):
    // const populated = await Order.populate(orders, [
    //   { path: "customerId", select: "name email phone" },
    //   { path: "items.productId" },
    // ]);

    return res.status(200).json({ orders });
  } catch (error) {
    console.error("❌ lookupOrdersByIdentity Error:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};


export const getProductOrderCount = async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();

    if (!q) {
      return res.status(400).json({
        success: false,
        message: "q is required",
      });
    }

    const escapeRegex = (s = "") =>
      String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const rx = new RegExp(escapeRegex(q), "i");

    const match = {
      isConfirmed: true, // recommended
      $or: [
        { "items.productSnapshot.title": rx },
        { "items.productSnapshot.productCode": rx },
      ],
    };

    const totalOrders = await Order.countDocuments(match);

    return res.status(200).json({
      success: true,
      query: q,
      totalOrders,
    });
  } catch (error) {
    console.error("❌ getProductOrderCount Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

export const searchProductOrderNumbers = async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();

    if (!q) {
      return res.status(400).json({
        success: false,
        message: "q is required",
      });
    }

    // ✅ safe regex
    const escapeRegex = (s = "") =>
      String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const rx = new RegExp(escapeRegex(q), "i");

    // ✅ find matching orders
    const orders = await Order.find({
      isConfirmed: true, // IMPORTANT
      $or: [
        { "items.productSnapshot.title": rx },
        { "items.productSnapshot.productCode": rx },
      ],
    })
      .select("orderNumber")
      .lean();

    // ✅ unique order numbers
    const orderNumbers = [
      ...new Set(
        orders
          .map((o) => o.orderNumber)
          .filter(Boolean)
      ),
    ];

    return res.status(200).json({
      success: true,
      query: q,
      totalOrders: orderNumbers.length,
      orderNumbers,
    });
  } catch (error) {
    console.error("❌ searchProductOrderNumbers error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};



/* ------------------------------------------------------------------
   GET /api/orders/location/search?state=Delhi&pincode=110019&page=1&limit=50
   - state only
   - pincode only
   - dono saath
   - shipping + billing dono me match karega
------------------------------------------------------------------- */


const safe = (v) => String(v ?? "").trim();

const parseIntSafe = (v, d) => {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};

const escapeRegex = (s = "") =>
  String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const rx = (v) => new RegExp(`^${escapeRegex(safe(v))}$`, "i");


export const findOrdersByStateAndPincode = async (req, res) => {
  try {
    const {
      state = "",
      pincode = "",
      page = 1,
      limit = 50,
      fulfillmentStatus = "",
      paymentMethod = "",
      isConfirmed,
      search = "",
    } = req.query;

    const pageNum = parseIntSafe(page, 1);
    const limitNum = Math.min(parseIntSafe(limit, 50), 500);
    const skip = (pageNum - 1) * limitNum;

    const filters = {};

    /* ---------------- state / pincode filters ---------------- */
    const locationAnd = [];

    if (safe(state)) {
      locationAnd.push({
        $or: [
          { "shippingAddressSnapshot.state": rx(state) },
          { "billingAddressSnapshot.state": rx(state) },
        ],
      });
    }

    if (safe(pincode)) {
      locationAnd.push({
        $or: [
          { "shippingAddressSnapshot.pincode": safe(pincode) },
          { "billingAddressSnapshot.pincode": safe(pincode) },
        ],
      });
    }

    if (locationAnd.length) {
      filters.$and = locationAnd;
    }

    /* ---------------- optional extra filters ---------------- */
    if (safe(fulfillmentStatus)) {
      filters.fulfillmentStatus = safe(fulfillmentStatus).toLowerCase();
    }

    if (safe(paymentMethod)) {
      filters.paymentMethod = safe(paymentMethod).toLowerCase();
    }

    if (isConfirmed !== undefined && String(isConfirmed).trim() !== "") {
      const val = String(isConfirmed).trim().toLowerCase();
      filters.isConfirmed = ["true", "1", "yes"].includes(val);
    }

    /* ---------------- optional text search ---------------- */
    if (safe(search)) {
      const searchRegex = new RegExp(escapeRegex(search), "i");

      filters.$and = [
        ...(filters.$and || []),
        {
          $or: [
            { orderNumber: searchRegex },
            { "shippingAddressSnapshot.fullName": searchRegex },
            { "shippingAddressSnapshot.phone": searchRegex },
            { "shippingAddressSnapshot.email": searchRegex },
            { "shippingAddressSnapshot.city": searchRegex },
            { "shippingAddressSnapshot.state": searchRegex },
            { "shippingAddressSnapshot.pincode": searchRegex },
            { "billingAddressSnapshot.fullName": searchRegex },
            { "billingAddressSnapshot.phone": searchRegex },
            { "billingAddressSnapshot.email": searchRegex },
            { "billingAddressSnapshot.city": searchRegex },
            { "billingAddressSnapshot.state": searchRegex },
            { "billingAddressSnapshot.pincode": searchRegex },
          ],
        },
      ];
    }

    const [orders, total] = await Promise.all([
      Order.find(filters)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .select({
          orderNumber: 1,
          createdAt: 1,
          customerId: 1,
          shippingAddressSnapshot: 1,
          billingAddressSnapshot: 1,
          paymentMethod: 1,
          paymentStatus: 1,
          fulfillmentStatus: 1,
          isConfirmed: 1,
          finalPayable: 1,
          totalAmount: 1,
          items: 1,
        })
        .populate("customerId", "name email phone")
        .lean(),

      Order.countDocuments(filters),
    ]);

    return res.status(200).json({
      success: true,
      message: "Orders fetched successfully",
      filters: {
        state: safe(state),
        pincode: safe(pincode),
        fulfillmentStatus: safe(fulfillmentStatus),
        paymentMethod: safe(paymentMethod),
        isConfirmed:
          isConfirmed !== undefined && String(isConfirmed).trim() !== ""
            ? filters.isConfirmed
            : undefined,
        search: safe(search),
      },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.max(1, Math.ceil(total / limitNum)),
        hasNextPage: skip + orders.length < total,
        hasPrevPage: pageNum > 1,
      },
      orders,
    });
  } catch (error) {
    console.error("findOrdersByStateAndPincode error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch orders by state/pincode",
      error: error.message,
    });
  }
};


export const getDuplicateOrderAlerts = async (req, res) => {
  try {
    const result = await detectDuplicateOrders();

    return res.status(200).json({
      ok: true,
      message: "Duplicate order scan completed",
      ...result,
    });
  } catch (error) {
    console.error("getDuplicateOrderAlerts error:", error);
    return res.status(500).json({
      ok: false,
      message: "Failed to detect duplicate orders",
      error: error.message,
    });
  }
};

export const markDuplicateOrderAlertsController = async (req, res) => {
  try {
    const result = await markDuplicateOrderAlerts();

    return res.status(200).json({
      ok: true,
      message: "Duplicate alerts marked successfully",
      ...result,
    });
  } catch (error) {
    console.error("markDuplicateOrderAlertsController error:", error);
    return res.status(500).json({
      ok: false,
      message: "Failed to mark duplicate order alerts",
      error: error.message,
    });
  }
};
