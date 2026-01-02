import mongoose from "mongoose";
import Order from "./Orders.js";
import Product from "../Products/Products.js";
import Coupon from "../Coupon/Coupon.js";
import { buildAddressSnapshot } from "./order.address.mapper.js";
import { cancelShiprocketShipment } from "../shiprocket/shiprocket.cancel.js";
import Address from "../Address/Address.js"; // <-- correct path

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
  Array.from(new Set((arr || []).map((x) => String(x || "").trim()).filter(Boolean)));

const computeCategoryBreakdown = (normalizedItems) => {
  const map = new Map();
  for (const it of normalizedItems || []) {
    const catId = it?.productSnapshot?.category ? String(it.productSnapshot.category) : null;
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

    if (!Number.isInteger(idx) || idx < 0) throw new Error("Invalid orderItemIndex in RMA items");
    if (!Number.isFinite(qty) || qty < 1) throw new Error("Invalid quantity in RMA items");

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

  try {
    const {
      customerId,
      shippingAddressId,
      billingAddressId,
      items,
      discount = 0, // fallback
      coupon, // ✅ now object snapshot
      shippingFee = 0,
      tax = 0,
      paymentMethod = "cod",
      source = "website",
      isGiftOrder = false,
      currency = "INR",
    } = req.body;

    /* ------------------------------------------------
       🔒 HARD VALIDATIONS
    ------------------------------------------------ */
    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({ message: "Invalid customerId" });
    }

    if (!mongoose.Types.ObjectId.isValid(shippingAddressId)) {
      return res.status(400).json({ message: "Invalid shippingAddressId" });
    }

    if (billingAddressId && !mongoose.Types.ObjectId.isValid(billingAddressId)) {
      return res.status(400).json({ message: "Invalid billingAddressId" });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Order items missing" });
    }

    if (!["cod", "razorpay"].includes(paymentMethod)) {
      return res.status(400).json({
        message: "Invalid paymentMethod. Allowed: cod | razorpay",
      });
    }

    // ✅ sanitize coupon snapshot (no ObjectId casting issues ever)
    let couponSnapshot = null;
    let computedDiscount = Number(discount || 0);

    if (coupon && typeof coupon === "object") {
      const code = String(coupon.code || "").trim().toUpperCase();
      const couponDiscount = Number(coupon.discount || 0);
      const finalTotal = Number(coupon.finalTotal || 0);

      if (code && couponDiscount > 0) {
        couponSnapshot = {
          couponId: mongoose.Types.ObjectId.isValid(coupon.couponId)
            ? coupon.couponId
            : null,
          code,
          discount: couponDiscount,
          finalTotal,
        };

        // ✅ override discount with coupon discount
        computedDiscount = couponDiscount;
      }
    }

    await session.withTransaction(async () => {
      /* ------------------------------------------------
         0️⃣ ADDRESS SNAPSHOT (SERVER-SIDE ONLY)
      ------------------------------------------------ */
      const shippingAddress = await Address.findById(shippingAddressId).session(session);
      if (!shippingAddress) throw new Error("Shipping address not found");

      const billingAddress = billingAddressId
        ? await Address.findById(billingAddressId).session(session)
        : shippingAddress;

      const shippingAddressSnapshot = buildAddressSnapshot(shippingAddress);
      const billingAddressSnapshot = buildAddressSnapshot(billingAddress);

      /* ------------------------------------------------
         1️⃣ FETCH PRODUCTS
      ------------------------------------------------ */
      const productIds = items.map((i) => i?.productId).filter(Boolean);

      const invalidProductId = productIds.find((id) => !isObjectId(id));
      if (invalidProductId) throw new Error(`Invalid productId: ${invalidProductId}`);

      const products = await Product.find({ _id: { $in: productIds } })
        .session(session)
        .lean();

      const productMap = new Map(products.map((p) => [String(p._id), p]));

      /* ------------------------------------------------
         2️⃣ NORMALIZE ITEMS + SNAPSHOTS
      ------------------------------------------------ */
      const normalizedItems = [];
      let computedSubtotal = 0;
      let totalQty = 0;

      for (const item of items) {
        if (!item?.productId) throw new Error("productId missing");

        const qty = Number(item.quantity || 0);
        if (!Number.isFinite(qty) || qty < 1) throw new Error("Invalid quantity");

        const product = productMap.get(String(item.productId));
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
            weight: Number(product.weight ?? 0),
            currency: product.currency || currency,
          },

          variant: {
            variantId: variant?._id || null,
            sku: variant?.sku || "",
            attributes: normalizeVariantAttributes(variant),
            image: variant?.image || product.thumbnail || "",
            weight: Number(variant?.weight ?? 0),
          },

          quantity: qty,
          price: unitPrice,
          compareAtPrice: variant?.compareAtPrice ?? product?.compareAtPrice ?? null,
          subtotal: itemSubtotal,
        });
      }

      /* ------------------------------------------------
         3️⃣ STOCK REDUCTION
      ------------------------------------------------ */
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

      /* ------------------------------------------------
         4️⃣ TOTALS + ANALYTICS
      ------------------------------------------------ */
      const subtotal = computedSubtotal;
      const totalAmount = subtotal + Number(shippingFee) + Number(tax);

      const finalPayable = Math.max(0, totalAmount - Number(computedDiscount || 0));

      const analytics = {
        totalItems: totalQty,
        averageItemPrice: totalQty ? subtotal / totalQty : 0,
        couponApplied: Boolean(couponSnapshot?.code),
        creditsUsed: false,
        categoryBreakdown: computeCategoryBreakdown(normalizedItems),
        tagsUsed: uniqStrings(normalizedItems.flatMap((it) => it.productSnapshot?.tags || [])),
      };

      /* ------------------------------------------------
         5️⃣ CREATE ORDER ✅ FIXED COUPON SNAPSHOT
      ------------------------------------------------ */
      const [order] = await Order.create(
        [
          {
            customerId,
            shippingAddressSnapshot,
            billingAddressSnapshot,
            items: normalizedItems,

            subtotal,
            discount: computedDiscount,
            coupon: couponSnapshot, // ✅ now object
            shippingFee,
            tax,
            totalAmount,
            finalPayable,

            currency,
            paymentMethod,
            paymentStatus: "pending",

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

    return res.status(201).json({
      message: "Order created successfully",
      order: req.__createdOrder,
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
    return res.status(500).json({ message: "Server error", error: error.message });
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
    return res.status(500).json({ message: "Server error", error: error.message });
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

    if (!updatedOrder) return res.status(404).json({ message: "Order not found" });
    return res.status(200).json({ message: "Order updated", order: updatedOrder });
  } catch (error) {
    console.error("❌ Update Order Error:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};


/* ============================================================
   UPDATE ORDER STATUS ONLY
============================================================ */
export const updateOrderStatus = async (req, res) => {
  try {
    const { fulfillmentStatus, paymentStatus } = req.body;

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    // ✅ Update fulfillment status
    if (fulfillmentStatus) {
      order.fulfillmentStatus = fulfillmentStatus;

      // ✅ AUTO-SET deliveredAt if marked delivered
      if (fulfillmentStatus === "delivered") {
        order.trackingDetails = order.trackingDetails || {};
        if (!order.trackingDetails.deliveredAt) {
          order.trackingDetails.deliveredAt = new Date();
        }

        // optional (nice)
        order.shipment = order.shipment || {};
        if (!order.shipment.deliveredAt) {
          order.shipment.deliveredAt = new Date();
        }
      }
    }

    // ✅ Update payment status
    if (paymentStatus) order.paymentStatus = paymentStatus;

    await order.save();

    return res.status(200).json({ message: "Order status updated", order });
  } catch (error) {
    console.error("❌ Update Status Error:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};


/* ============================================================
   UPDATE TRACKING
============================================================ */
export const updateTracking = async (req, res) => {
  try {
    const { trackingId, courierName, shippedAt, deliveredAt, expectedDelivery } = req.body;

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    order.trackingDetails = {
      ...order.trackingDetails,
      trackingId: trackingId ?? order.trackingDetails?.trackingId,
      courierName: courierName ?? order.trackingDetails?.courierName,
      shippedAt: shippedAt ?? order.trackingDetails?.shippedAt,
      deliveredAt: deliveredAt ?? order.trackingDetails?.deliveredAt,
      expectedDelivery: expectedDelivery ?? order.trackingDetails?.expectedDelivery,
    };

    // ✅ If deliveredAt set -> auto mark delivered
    if (deliveredAt) {
      order.fulfillmentStatus = "delivered";
    }

    await order.save();

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
    if (!deletedOrder) return res.status(404).json({ message: "Order not found" });

    return res.status(200).json({ message: "Order deleted" });
  } catch (error) {
    console.error("❌ Delete Order Error:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

/* ============================================================
   ORDER ANALYTICS (ADMIN)
============================================================ */
export const getOrderAnalytics = async (req, res) => {
  try {
    const totalOrders = await Order.countDocuments();
    const totalRevenue = await Order.aggregate([{ $group: { _id: null, sum: { $sum: "$finalPayable" } } }]);

    const codOrders = await Order.countDocuments({ paymentMethod: "cod" });
    const prepaidOrders = await Order.countDocuments({ paymentMethod: { $ne: "cod" } });

    return res.status(200).json({
      totalOrders,
      totalRevenue: totalRevenue[0]?.sum || 0,
      codOrders,
      prepaidOrders,
    });
  } catch (error) {
    console.error("❌ Analytics Error:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ✅ GET ORDER BY ORDER NUMBER (ex: MIRAY-000005)
export const getOrderByOrderNumber = async (req, res) => {
  try {
    const orderNumber = String(req.params.orderNumber || "").trim();
    if (!orderNumber) return res.status(400).json({ message: "orderNumber missing" });

    const order = await Order.findOne({ orderNumber })
      .populate("customerId", "name email phone")
      .populate("items.productId");

    if (!order) return res.status(404).json({ message: "Order not found" });
    return res.status(200).json(order);
  } catch (error) {
    console.error("❌ Fetch Order By Number Error:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};



// CANCEL ORDER
export const cancelOrder = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const orderId = req.params.id;
    const { reason = "cancelled_by_customer" } = req.body;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    await session.withTransaction(async () => {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw new Error("Order not found");

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
        throw new Error(
          "Order cannot be cancelled after pickup / shipment"
        );
      }

      // Idempotent: already cancelled → no-op
      if (order.fulfillmentStatus === "cancelled") {
        return;
      }

      /* ------------------------------------------------
         2️⃣ CANCEL SHIPROCKET (IF BOOKED & NOT PICKED)
      ------------------------------------------------ */
      const shipmentId = order?.shipment?.shiprocket?.shipmentId;

      if (shipmentId) {
        try {
          await cancelShiprocketShipment(shipmentId);
        } catch (err) {
          console.error(
            "⚠️ Shiprocket cancel failed:",
            err?.response?.data || err
          );
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
      if (
        order.paymentMethod === "razorpay" &&
        order.paymentStatus === "paid"
      ) {
        // actual refund handled async / webhook
        order.paymentStatus = "refund_pending";
      }

      /* ------------------------------------------------
         5️⃣ FINAL ORDER STATE
      ------------------------------------------------ */
      order.fulfillmentStatus = "cancelled";

      order.shipment = {
        ...(order.shipment || {}),
        status: "cancelled",
      };

      order.adminRemarks = reason;

      await order.save({ session });
    });

    return res.status(200).json({
      success: true,
      message: "Order cancelled successfully",
    });
  } catch (error) {
    console.error("❌ Cancel Order Error:", error);
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  } finally {
    session.endSession();
  }
};
