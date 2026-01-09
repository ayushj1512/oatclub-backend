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

const ADMIN_ORDER_ALERT_EMAILS = [
  "finance@mirayfashions.com",
  "support@mirayfashions.com",
  "miray.ayushjuneja@gmail.com",
].filter(Boolean);


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

/* ============================================================
   CREATE ORDER
  Expect each item: { productId, quantity, variantId? }
============================================================ */
export const createOrder = async (req, res) => {
  const session = await mongoose.startSession();

  /* =========================================================
     ✅ Helpers: Attribute normalize + extract
  ========================================================= */
  const str = (v) => (v == null ? "" : String(v));

  const pickAttr = (attrs = [], keys = []) => {
    const wanted = keys.map((k) => str(k).toLowerCase());
    const found = (Array.isArray(attrs) ? attrs : []).find((a) =>
      wanted.includes(str(a?.key).toLowerCase())
    );
    return found?.value ? str(found.value) : "";
  };

  const normalizeVariantAttributes = (variant) => {
    const raw = variant?.attributes;

    // ✅ Case 1: already array format [{key,value}]
    if (Array.isArray(raw)) {
      return raw
        .filter((a) => a?.key != null && a?.value != null)
        .map((a) => ({ key: str(a.key), value: str(a.value) }));
    }

    // ✅ Case 2: object format { size: "M", color: "black" }
    if (raw && typeof raw === "object") {
      return Object.entries(raw).map(([k, v]) => ({
        key: str(k),
        value: str(v),
      }));
    }

    return [];
  };

  // ✅ SKU fallback: pick last size token from SKU
  const getSizeFromSku = (sku) => {
    const parts = str(sku).toUpperCase().split("-");
    const sizeOrder = [
      "XXS",
      "XS",
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "3XL",
      "4XL",
      "5XL",
    ];
    for (let i = parts.length - 1; i >= 0; i--) {
      if (sizeOrder.includes(parts[i])) return parts[i];
    }
    return "";
  };

  // ✅ SKU fallback: color token = 2nd last usually
  const getColorFromSku = (sku) => {
    const parts = str(sku).toUpperCase().split("-");
    if (parts.length < 2) return "";

    const sizeOrder = [
      "XXS",
      "XS",
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "3XL",
      "4XL",
      "5XL",
    ];

    const maybeColor = parts[parts.length - 2];
    if (sizeOrder.includes(maybeColor)) return "";

    return maybeColor.toLowerCase();
  };

  try {
    const {
      customerId,
      shippingAddressId,
      billingAddressId,
      items,
      discount = 0,
      coupon,
      shippingFee = 0,
      tax = 0,
      paymentMethod = "cod",
      source = "website",
      isGiftOrder = false,
      currency = "INR",
    } = req.body;

    const pm = str(paymentMethod).toLowerCase();

    /* =========================================================
       ✅ Hard Validations
    ========================================================= */
    if (!mongoose.Types.ObjectId.isValid(customerId))
      return res.status(400).json({ message: "Invalid customerId" });

    if (!mongoose.Types.ObjectId.isValid(shippingAddressId))
      return res.status(400).json({ message: "Invalid shippingAddressId" });

    if (billingAddressId && !mongoose.Types.ObjectId.isValid(billingAddressId))
      return res.status(400).json({ message: "Invalid billingAddressId" });

    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ message: "Order items missing" });

    if (!["cod", "razorpay"].includes(pm))
      return res.status(400).json({
        message: "Invalid paymentMethod. Allowed: cod | razorpay",
      });

    /* =========================================================
       ✅ Coupon Snapshot (if any)
    ========================================================= */
    let couponSnapshot = null;
    let computedDiscount = Number(discount || 0);

    if (coupon && typeof coupon === "object") {
      const code = str(coupon.code).trim().toUpperCase();
      const couponDiscount = Number(coupon.discount || 0);
      const finalTotal = Number(coupon.finalTotal || 0);

      if (code && couponDiscount > 0) {
        couponSnapshot = { code, discount: couponDiscount, finalTotal };
        computedDiscount = couponDiscount;
      }
    }

    /* =========================================================
       ✅ Transaction: Create Order + Reduce Stock
    ========================================================= */
    await session.withTransaction(async () => {
      // ✅ fetch address
      const shippingAddress = await Address.findById(shippingAddressId).session(
        session
      );
      if (!shippingAddress) throw new Error("Shipping address not found");

      const billingAddress = billingAddressId
        ? await Address.findById(billingAddressId).session(session)
        : shippingAddress;

      const shippingAddressSnapshot = buildAddressSnapshot(shippingAddress);
      const billingAddressSnapshot = buildAddressSnapshot(billingAddress);

      // ✅ validate product ids
      const productIds = [
        ...new Set(items.map((i) => str(i?.productId)).filter(Boolean)),
      ];

      const invalidProductId = productIds.find((id) => !isObjectId(id));
      if (invalidProductId)
        throw new Error(`Invalid productId: ${invalidProductId}`);

      // ✅ fetch products
      const products = await Product.find({ _id: { $in: productIds } })
        .session(session)
        .lean();

      const productMap = new Map(products.map((p) => [str(p._id), p]));

      const normalizedItems = [];
      let computedSubtotal = 0;
      let totalQty = 0;

      /* =========================================================
         ✅ Normalize Items (product snapshot + variant snapshot)
      ========================================================= */
      for (const item of items) {
        if (!item?.productId) throw new Error("productId missing");

        const qty = Number(item.quantity || 0);
        if (!Number.isFinite(qty) || qty < 1)
          throw new Error("Invalid quantity");

        const product = productMap.get(str(item.productId));
        if (!product) throw new Error("Product not found");

        const isVariable =
          product.productType === "variable" ||
          (Array.isArray(product.variants) && product.variants.length > 0);

        let variant = null;

        // ✅ Resolve variant
        if (isVariable) {
          if (!item.variantId)
            throw new Error(`${product.title} - variantId missing`);

          variant = findVariantById(product, item.variantId);
          if (!variant) throw new Error(`${product.title} - variant not found`);

          if (Number(variant.stock ?? 0) < qty)
            throw new Error(`${product.title} out of stock`);
        } else {
          if (Number(product.stock ?? 0) < qty)
            throw new Error(`${product.title} out of stock`);
        }

        // ✅ price resolve
        const unitPrice =
          variant && Number(variant.price) > 0
            ? Number(variant.price)
            : Number(product.price || 0);

        const itemSubtotal = unitPrice * qty;
        totalQty += qty;
        computedSubtotal += itemSubtotal;

        // ✅ variant attributes snapshot
        const attrs = normalizeVariantAttributes(variant);

        // ✅ size/color from attrs OR fallback to SKU
        let selectedSize =
          pickAttr(attrs, ["size", "sizes", "shirt_size"]) ||
          getSizeFromSku(variant?.sku);

        let selectedColor =
          pickAttr(attrs, ["color", "colour", "color_name"]) ||
          getColorFromSku(variant?.sku);

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
            productType:
              product.productType ||
              (product?.variants?.length ? "variable" : "simple"),
            sku: product.sku || "",
            tags: Array.isArray(product.tags) ? product.tags : [],
            weight: Number(product.weight ?? 0),
            currency: product.currency || currency,
          },

          variant: {
            variantId: variant?._id || null,
            sku: variant?.sku || "",
            attributes: attrs, // ✅ FIXED
            image: variant?.image || product.thumbnail || "",
            weight: Number(variant?.weight ?? 0),
          },

          selectedSize,
          selectedColor,

          quantity: qty,
          price: unitPrice,
          compareAtPrice:
            variant?.compareAtPrice ?? product?.compareAtPrice ?? null,
          subtotal: itemSubtotal,
        });
      }

      /* =========================================================
         ✅ Stock Reduction (atomic)
      ========================================================= */
      for (const it of normalizedItems) {
        const variantId = it?.variant?.variantId;

        const result = variantId
          ? await Product.updateOne(
              {
                _id: it.productId,
                "variants._id": variantId,
                "variants.stock": { $gte: it.quantity },
              },
              { $inc: { "variants.$.stock": -it.quantity } }
            ).session(session)
          : await Product.updateOne(
              { _id: it.productId, stock: { $gte: it.quantity } },
              { $inc: { stock: -it.quantity } }
            ).session(session);

        if (!result.modifiedCount) throw new Error("Stock update failed");
      }

      /* =========================================================
         ✅ Final totals
      ========================================================= */
      const subtotal = computedSubtotal;
      const totalAmount = subtotal + Number(shippingFee) + Number(tax);
      const finalPayable = Math.max(
        0,
        totalAmount - Number(computedDiscount || 0)
      );

      const analytics = {
        totalItems: totalQty,
        averageItemPrice: totalQty ? subtotal / totalQty : 0,
        couponApplied: Boolean(couponSnapshot?.code),
        creditsUsed: false,
        categoryBreakdown: computeCategoryBreakdown(normalizedItems),
        tagsUsed: uniqStrings(
          normalizedItems.flatMap((it) => it.productSnapshot?.tags || [])
        ),
      };

      /* =========================================================
         ✅ Create order
      ========================================================= */
      const [order] = await Order.create(
        [
          {
            customerId,
            shippingAddressSnapshot,
            billingAddressSnapshot,
            items: normalizedItems,
            subtotal,
            discount: computedDiscount,
            coupon: couponSnapshot,
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

      req.__createdOrder = order;
    });

    /* =========================================================
       ✅ Auto Book Shiprocket (COD only immediately)
       - Razorpay orders will be booked when paymentStatus becomes "paid"
       - via updateOrderStatus (add call there)
    ========================================================= */
    try {
      const createdOrder = await Order.findById(req.__createdOrder._id);

      if (createdOrder?.paymentMethod === "cod") {
        await autoBookShiprocketForOrder(createdOrder);
      }
    } catch (e) {
      console.error("⚠️ Auto Shiprocket booking failed:", e?.message || e);
     
    }

    /* =========================================================
       ✅ Fetch final order (lean)
    ========================================================= */
    const finalOrder = await Order.findById(req.__createdOrder._id).lean();

    /* =========================================================
       ✅ EMAILS (Non-blocking)
       - Admin order received + Customer confirmation
       - Never blocks response
    ========================================================= */
    try {
      // ✅ fire-and-forget unified trigger
      triggerOrderEmails(finalOrder);
    } catch (e) {
      console.error("⚠️ triggerOrderEmails failed:", e?.message || e);
    }

    /* =========================================================
       ✅ Return final order
    ========================================================= */
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






/* ============================================================
   GET ALL ORDERS (ADMIN)
============================================================ */
export const getAllOrders = async (req, res) => {
  try {
    const { customerId, paymentStatus, fulfillmentStatus } = req.query;

    const filters = {};
    if (customerId) filters.customerId = customerId;
    if (paymentStatus) filters.paymentStatus = paymentStatus;
    if (fulfillmentStatus) filters.fulfillmentStatus = fulfillmentStatus;

    const orders = await Order.find(filters)
      .populate("customerId", "name email phone")
      .populate("items.productId")
      .sort({ createdAt: -1 });

    return res.status(200).json(orders);
  } catch (error) {
    console.error("❌ Fetch Orders Error:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
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
============================================================ */
export const updateOrderStatus = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { fulfillmentStatus, paymentStatus, reason = "cancelled_by_admin" } =
      req.body;

    const orderId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    let updatedOrder = null;

    await session.withTransaction(async () => {
      // ✅ If cancelling → run full cancel flow
      if (fulfillmentStatus === "cancelled") {
        updatedOrder = await performOrderCancellation({
          orderId,
          reason,
          session,
        });
        return;
      }

      // ✅ Normal status update flow
      const order = await Order.findById(orderId).session(session);
      if (!order) throw new Error("Order not found");

      if (fulfillmentStatus) {
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

      if (paymentStatus) order.paymentStatus = paymentStatus;

      await order.save({ session });

      updatedOrder = order;
    });

    // ✅ Fetch Lean for email trigger + response consistency
    const finalOrder = await Order.findById(updatedOrder._id).lean();

    /* =========================================================
       ✅ If cancelled → trigger cancellation emails
    ========================================================= */
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
   UPDATE TRACKING
============================================================ */
export const updateTracking = async (req, res) => {
  try {
    const {
      trackingId,
      courierName,
      shippedAt,
      deliveredAt,
      expectedDelivery,
    } = req.body;

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    order.trackingDetails = {
      ...order.trackingDetails,
      trackingId: trackingId ?? order.trackingDetails?.trackingId,
      courierName: courierName ?? order.trackingDetails?.courierName,
      shippedAt: shippedAt ?? order.trackingDetails?.shippedAt,
      deliveredAt: deliveredAt ?? order.trackingDetails?.deliveredAt,
      expectedDelivery:
        expectedDelivery ?? order.trackingDetails?.expectedDelivery,
    };

    // ✅ If deliveredAt set -> auto mark delivered
    if (deliveredAt) {
      order.fulfillmentStatus = "delivered";
    }

    await order.save();

    return res.status(200).json({ message: "Tracking updated", order });
  } catch (error) {
    console.error("❌ Tracking Update Error:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
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

        triggerOrderCancellationEmails(finalOrder, reason);

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
    });

    // ------------------------------------------------
    // 0) Guards
    // ------------------------------------------------
    if (!order?.shippingAddressSnapshot?.pincode) {
      console.log(`${TAG} ❌ SKIP: shipping pincode missing`);
      return;
    }

    if (!process.env.SHIPROCKET_PICKUP_PINCODE) {
      console.log(`${TAG} ❌ SKIP: SHIPROCKET_PICKUP_PINCODE missing in env`);
      return;
    }

    if (order.shipment?.shiprocket?.awb) {
      console.log(`${TAG} ✅ SKIP: AWB already exists`, {
        awb: order.shipment.shiprocket.awb,
      });
      return;
    }

    if (order.shipment?.shiprocket?.shipmentId) {
      console.log(`${TAG} ℹ️ ShipmentId already exists on order`, {
        shipmentId: order.shipment.shiprocket.shipmentId,
      });
    }

    // Payment guard: prepaid only after paid
    if (order.paymentMethod === "razorpay" && order.paymentStatus !== "paid") {
      console.log(`${TAG} ⏳ SKIP: prepaid not paid yet`);
      return;
    }

    // ------------------------------------------------
    // 1) Calculate Weight
    // ------------------------------------------------
    const totalWeight =
      order.items.reduce((sum, it) => {
        const w =
          Number(it.variant?.weight) ||
          Number(it.productSnapshot?.weight) ||
          0.5;
        return sum + w * Number(it.quantity || 1);
      }, 0) || 0.5;

    console.log(`${TAG} 📦 Weight computed`, {
      totalWeight,
      itemCount: order?.items?.length || 0,
      pickupPincode: process.env.SHIPROCKET_PICKUP_PINCODE,
      deliveryPincode: order.shippingAddressSnapshot.pincode,
      isCOD: order.paymentMethod === "cod",
    });

    // ------------------------------------------------
    // 2) Serviceability
    // ------------------------------------------------
    console.log(`${TAG} 🔎 Checking serviceability...`);

    const couriers = await checkServiceability({
      pickupPincode: process.env.SHIPROCKET_PICKUP_PINCODE,
      deliveryPincode: order.shippingAddressSnapshot.pincode,
      weight: totalWeight,
      cod: order.paymentMethod === "cod" ? 1 : 0,
    });

    console.log(`${TAG} ✅ Serviceability result`, {
      courierCount: Array.isArray(couriers) ? couriers.length : 0,
      sample: Array.isArray(couriers)
        ? couriers.slice(0, 3).map((c) => ({
            courier_name: c?.courier_name,
            courier_company_id: c?.courier_company_id,
            rate: c?.rate,
            etd: c?.etd,
          }))
        : "INVALID_RESPONSE",
    });

    if (!Array.isArray(couriers) || couriers.length === 0) {
      console.log(`${TAG} ⚠️ SKIP: No courier available`);
      return;
    }

    // ------------------------------------------------
    // 3) Create Shipment (Adhoc)
    // ------------------------------------------------
    const payload = buildShiprocketPayload(order);

    console.log(`${TAG} 📦 Create shipment payload`, {
      order_id: payload?.order_id,
      pickup_location: payload?.pickup_location,
      payment_method: payload?.payment_method,
      weight: payload?.weight,
      delivery_pincode: payload?.billing_pincode,
    });

    const shipment = await createShipment(payload);

    console.log(`${TAG} ✅ Create shipment response`, {
      shiprocket_order_id: shipment?.order_id,
      shipment_id: shipment?.shipment_id,
      status: shipment?.status,
      awb_code: shipment?.awb_code,
      courier_name: shipment?.courier_name,
    });

    const shipmentId = shipment?.shipment_id
      ? String(shipment.shipment_id)
      : "";
    const shiprocketOrderId = shipment?.order_id
      ? String(shipment.order_id)
      : "";
    let awb = (shipment?.awb_code || "").trim();

    if (!shipmentId) {
      console.log(`${TAG} ❌ FAIL: shipment_id missing in Shiprocket response`);
      return;
    }

    // ------------------------------------------------
    // 4) Save shipment snapshot even if AWB missing ✅
    // ------------------------------------------------
    order.shipment = {
      ...(order.shipment || {}),
      provider: "shiprocket",
      shiprocket: {
        ...(order.shipment?.shiprocket || {}),
        shipmentId,
        orderId: shiprocketOrderId,
        awb: order.shipment?.shiprocket?.awb || "",
        courierName:
          shipment?.courier_name ||
          order.shipment?.shiprocket?.courierName ||
          "",
        trackingUrl:
          shipment?.tracking_url ||
          order.shipment?.shiprocket?.trackingUrl ||
          "",
        status: "processing",
        lastUpdatedAt: new Date(),
      },
      status: "processing",
    };

    await order.save();

    console.log(`${TAG} ✅ Saved shipment snapshot to DB`, {
      orderNumber: order.orderNumber,
      shipmentId: order.shipment?.shiprocket?.shipmentId,
      existingAwb: order.shipment?.shiprocket?.awb,
    });

    // ------------------------------------------------
    // 5) If AWB missing, try assign AWB (optional auto step)
    // ------------------------------------------------
    if (!awb) {
      console.log(`${TAG} 📌 AWB missing. Attempting /courier/assign/awb...`);

      try {
        const assigned = await assignAwb(shipmentId);

        console.log(`${TAG} ✅ Assign AWB response`, {
          awb_code: assigned?.awb_code,
          courier_name: assigned?.courier_name,
          courier_company_id: assigned?.courier_company_id,
          raw: assigned,
        });

        awb = (assigned?.awb_code || assigned?.awb || "").trim();

        if (awb) {
          order.shipment.shiprocket.awb = awb;
          order.shipment.shiprocket.courierName =
            assigned?.courier_name || order.shipment.shiprocket.courierName;

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
          };

          await order.save();

          console.log(`${TAG} ✅ AWB assigned & saved to DB`, {
            orderNumber: order.orderNumber,
            shipmentId,
            awb,
            courierName: order.shipment.shiprocket.courierName,
            trackingUrl: order.shipment.shiprocket.trackingUrl,
          });
        } else {
          console.log(
            `${TAG} ⚠️ Assign AWB success but awb_code missing (panel/webhook will update later)`
          );
        }
      } catch (e) {
        console.log(
          `${TAG} ⚠️ Assign AWB failed (will rely on webhook/panel)`,
          {
            message: e?.message,
            status: e?.response?.status,
            data: e?.response?.data,
            url: e?.config?.url,
          }
        );
      }
    } else {
      console.log(
        `${TAG} ✅ AWB already returned in create shipment response`,
        { awb }
      );
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
