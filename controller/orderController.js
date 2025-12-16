import mongoose from "mongoose";
import Order from "../models/Orders.js";
import Product from "../models/Products.js";
import Coupon from "../models/Coupon.js";

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
      shippingAddressSnapshot,
      billingAddressSnapshot,
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

    if (!customerId) return res.status(400).json({ message: "customerId missing" });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Order items missing" });
    }

    await session.withTransaction(async () => {
      // 1) Fetch products in one query
      const productIds = items.map((i) => i?.productId).filter(Boolean);

      // Guard: if frontend mistakenly sends non-mongo id, fail fast
      const invalidProductId = productIds.find((id) => !isObjectId(id));
      if (invalidProductId) {
        throw new Error(`Invalid productId: ${invalidProductId} (must be Mongo ObjectId)`);
      }

      const products = await Product.find({ _id: { $in: productIds } }).session(session).lean();
      const productMap = new Map(products.map((p) => [String(p._id), p]));

      // 2) Validate + build normalized items (with snapshot)
      const normalizedItems = [];
      let computedSubtotal = 0;
      let totalQty = 0;

      for (const item of items) {
        if (!item?.productId) throw new Error("productId missing in items");

        const qty = Number(item.quantity || 0);
        if (!Number.isFinite(qty) || qty < 1) throw new Error("Invalid quantity in items");

        const product = productMap.get(String(item.productId));
        if (!product) throw new Error("Product not found");

        const variable =
          product.productType === "variable" || (Array.isArray(product.variants) && product.variants.length > 0);

        let variant = null;

        // variable -> require variantId + check variant stock only
        if (variable) {
          if (!item.variantId) throw new Error(`${product.title} - variantId missing`);
          variant = findVariantById(product, item.variantId);
          if (!variant) throw new Error(`${product.title} - variant not found`);

          const vStock = Number(variant.stock ?? 0);
          if (vStock < qty) {
            const skuText = variant?.sku ? ` (${variant.sku})` : "";
            throw new Error(`${product.title}${skuText} out of stock`);
          }
        } else {
          // simple -> check product stock
          const pStock = Number(product.stock ?? 0);
          if (pStock < qty) {
            const skuText = product?.sku ? ` (${product.sku})` : "";
            throw new Error(`${product.title}${skuText} out of stock`);
          }
        }

        // pricing snapshot
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
            currency: product.currency || currency || "INR",
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

      // 3) Reduce stock (atomic)
      for (const it of normalizedItems) {
        const variantId = it?.variant?.variantId;

        if (variantId) {
          const r = await Product.updateOne(
            { _id: it.productId, "variants._id": variantId, "variants.stock": { $gte: it.quantity } },
            { $inc: { "variants.$.stock": -it.quantity } }
          ).session(session);

          if (!r.modifiedCount) throw new Error("Stock update failed (variant). Please retry.");
        } else {
          const r = await Product.updateOne(
            { _id: it.productId, stock: { $gte: it.quantity } },
            { $inc: { stock: -it.quantity } }
          ).session(session);

          if (!r.modifiedCount) throw new Error("Stock update failed. Please retry.");
        }
      }

      // 4) Coupon usage tracking (optional)
      let couponApplied = false;
      let couponDoc = null;

      if (coupon) {
        couponDoc = await Coupon.findById(coupon).session(session);
        if (couponDoc) {
          couponApplied = true;
          couponDoc.usedCount = (couponDoc.usedCount || 0) + 1;
          if (Array.isArray(couponDoc.usedBy)) couponDoc.usedBy.push(customerId);
          await couponDoc.save({ session });
        }
      }

      // 5) Totals
      const subtotal = computedSubtotal;
      const totalAmount = subtotal + Number(shippingFee || 0) + Number(tax || 0);
      const finalPayable = Math.max(0, totalAmount - Number(discount || 0));

      // 6) Analytics
      const tagsUsed = uniqStrings(
        normalizedItems.flatMap((it) => (Array.isArray(it?.productSnapshot?.tags) ? it.productSnapshot.tags : []))
      );

      const analytics = {
        totalItems: totalQty,
        averageItemPrice: totalQty ? subtotal / totalQty : 0,
        couponApplied,
        creditsUsed: false,
        categoryBreakdown: computeCategoryBreakdown(normalizedItems),
        tagsUsed,
      };

      // 7) Create order (rmas default [])
      const order = await Order.create(
        [
          {
            customerId,
            shippingAddressSnapshot,
            billingAddressSnapshot,
            items: normalizedItems,

            subtotal,
            discount,
            coupon: couponDoc?._id || null,
            shippingFee,
            tax,
            totalAmount,
            finalPayable,

            currency: currency || normalizedItems?.[0]?.productSnapshot?.currency || "INR",

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

      req.__createdOrder = order?.[0];
    });

    return res.status(201).json({
      message: "Order created successfully",
      order: req.__createdOrder,
    });
  } catch (error) {
    console.error("❌ Create Order Error:", error);
    return res.status(500).json({ message: error?.message || "Server error" });
  } finally {
    session.endSession();
  }
};

/* ============================================================
   CREATE RMA (Customer/Admin)
   POST /api/orders/:id/rma
   Body: { type, reason, customerNote, items: [{orderItemIndex, quantity}] }

   ✅ POLICY ENFORCED:
   - delivered only
   - within 7 days from deliveredAt
   - exchange fee: 1st free, 2nd+ = 199 (stored in rma.fee)
============================================================ */
export const createRma = async (req, res) => {
  try {
    const orderId = req.params.id;
    const { type = "return", reason = "other", customerNote = "", items } = req.body;

    if (!isObjectId(orderId)) return res.status(400).json({ message: "Invalid order id" });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "RMA items missing" });
    }

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });

    // Must be delivered
    if (order.fulfillmentStatus !== "delivered") {
      return res.status(400).json({ message: "Return/Exchange allowed only for delivered orders" });
    }

    // Must have deliveredAt for 7-day policy
    const deliveredAt = order?.trackingDetails?.deliveredAt;
    if (!deliveredAt) {
      return res.status(400).json({ message: "Delivery date missing (deliveredAt). Cannot create RMA." });
    }

    // 7-day window
    if (!isWithinRmaWindow(deliveredAt)) {
      return res.status(400).json({
        message: `Return/Exchange window expired. Allowed within ${RMA_POLICY.windowDays} days from delivery.`,
      });
    }

    // Prevent over-return
    const remaining = computeRemainingQtyByIndex(order);
    for (const ri of items) {
      const idx = String(Number(ri?.orderItemIndex));
      const qty = Number(ri?.quantity || 0);
      const rem = remaining.get(idx);

      if (rem == null) return res.status(400).json({ message: `Invalid orderItemIndex: ${idx}` });
      if (qty < 1) return res.status(400).json({ message: "Invalid RMA quantity" });
      if (qty > rem) {
        return res.status(400).json({ message: `Return qty exceeds remaining for item index ${idx}` });
      }
    }

    const rmaItemsSnapshots = buildRmaItemsSnapshots(order, items);

    // Exchange fee policy
    let fee = { amount: 0, currency: "INR", status: "waived" };
    if (type === "exchange") {
      const prevExchanges = countPreviousExchanges(order);
      const amount = computeExchangeFee(prevExchanges);
      fee = {
        amount,
        currency: "INR",
        status: amount > 0 ? "unpaid" : "waived",
      };
    }

    order.rmas = order.rmas || [];
    order.rmas.push({
      type,
      reason,
      customerNote,
      items: rmaItemsSnapshots,
      status: "requested",
      resolution: "pending",
      fee, // ✅ stored
    });

    // schema hook auto-generates rmaNumber
    await order.save();

    const created = order.rmas[order.rmas.length - 1];
    return res.status(201).json({
      message: "RMA created",
      rma: created,
      orderId: order._id,
      policy: {
        windowDays: RMA_POLICY.windowDays,
        exchange: RMA_POLICY.exchange,
      },
    });
  } catch (error) {
    console.error("❌ Create RMA Error:", error);
    return res.status(500).json({ message: error?.message || "Server error" });
  }
};

/* ============================================================
   UPDATE RMA STATUS / DETAILS (Admin)
   PATCH /api/orders/:id/rma/:rmaNumber

   ✅ Added support to update fee status (paid/unpaid/waived)
============================================================ */
export const updateRma = async (req, res) => {
  try {
    const orderId = req.params.id;
    const rmaNumber = String(req.params.rmaNumber || "").trim();

    if (!isObjectId(orderId)) return res.status(400).json({ message: "Invalid order id" });
    if (!rmaNumber) return res.status(400).json({ message: "rmaNumber missing" });

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const idx = (order.rmas || []).findIndex((r) => String(r.rmaNumber) === rmaNumber);
    if (idx === -1) return res.status(404).json({ message: "RMA not found" });

    const rma = order.rmas[idx];

    const {
      status,
      adminNote,
      resolution,
      refund, // {amount, mode, status, referenceId}
      reverseShipment, // {orderId, shipmentId, awb, courierName, trackingUrl, pickupScheduledAt, ...}
      fee, // ✅ {amount, currency, status}
    } = req.body;

    if (status) rma.status = status;
    if (adminNote != null) rma.adminNote = String(adminNote);
    if (resolution) rma.resolution = resolution;

    if (refund && typeof refund === "object") {
      rma.refund = rma.refund || {};
      if (refund.amount != null) rma.refund.amount = Number(refund.amount || 0);
      if (refund.mode) rma.refund.mode = refund.mode;
      if (refund.status) rma.refund.status = refund.status;
      if (refund.referenceId != null) rma.refund.referenceId = String(refund.referenceId || "");
    }

    if (fee && typeof fee === "object") {
      rma.fee = rma.fee || { amount: 0, currency: "INR", status: "waived" };
      if (fee.amount != null) rma.fee.amount = Number(fee.amount || 0);
      if (fee.currency != null) rma.fee.currency = String(fee.currency || "INR");
      if (fee.status != null) rma.fee.status = String(fee.status || (rma.fee.amount > 0 ? "unpaid" : "waived"));
    }

    if (reverseShipment && typeof reverseShipment === "object") {
      rma.reverseShipment = rma.reverseShipment || {};
      const fields = ["orderId", "shipmentId", "awb", "courierName", "trackingUrl"];
      for (const f of fields) {
        if (reverseShipment[f] != null) rma.reverseShipment[f] = String(reverseShipment[f] || "");
      }
      const dateFields = ["pickupScheduledAt", "pickedAt", "receivedAt"];
      for (const df of dateFields) {
        if (reverseShipment[df] != null) rma.reverseShipment[df] = reverseShipment[df];
      }
    }

    await order.save();

    return res.status(200).json({ message: "RMA updated", rma: order.rmas[idx] });
  } catch (error) {
    console.error("❌ Update RMA Error:", error);
    return res.status(500).json({ message: error?.message || "Server error" });
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
      .populate("coupon", "code discountType discountValue")
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
      .populate("coupon", "code discountType discountValue")
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
    const updatedOrder = await Order.findByIdAndUpdate(req.params.id, req.body, {
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

    if (fulfillmentStatus) order.fulfillmentStatus = fulfillmentStatus;
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
      .populate("coupon", "code discountType discountValue")
      .populate("items.productId");

    if (!order) return res.status(404).json({ message: "Order not found" });
    return res.status(200).json(order);
  } catch (error) {
    console.error("❌ Fetch Order By Number Error:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};
