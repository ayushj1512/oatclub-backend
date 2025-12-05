import mongoose from "mongoose";
import Order from "../models/Orders.js";
import Product from "../models/Products.js";
import Coupon from "../models/Coupon.js";

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

/* ============================================================
   CREATE ORDER
   Expect each item: { productId, quantity, variantId? }
   ✅ FIX: variable products MUST validate via variant stock (not product.stock)
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

      // Guard: if frontend mistakenly sends non-mongo id (like 185 / wc-xx), fail fast
      const invalidProductId = productIds.find((id) => !isObjectId(id));
      if (invalidProductId) {
        throw new Error(`Invalid productId: ${invalidProductId} (must be Mongo ObjectId)`);
      }

      const products = await Product.find({ _id: { $in: productIds } })
        .session(session)
        .lean();

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

        // ✅ FIX: variable products -> require variantId + check variant stock only
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
          // simple product -> check product stock
          const pStock = Number(product.stock ?? 0);
          if (pStock < qty) {
            const skuText = product?.sku ? ` (${product.sku})` : "";
            throw new Error(`${product.title}${skuText} out of stock`);
          }
        }

        // ---- pricing snapshot ----
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
            {
              $inc: { "variants.$.stock": -it.quantity },
              $set: { "variants.$.isInStock": true }, // keeps truthy; optional
            }
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
        normalizedItems.flatMap((it) =>
          Array.isArray(it?.productSnapshot?.tags) ? it.productSnapshot.tags : []
        )
      );

      const analytics = {
        totalItems: totalQty,
        averageItemPrice: totalQty ? subtotal / totalQty : 0,
        couponApplied,
        creditsUsed: false,
        categoryBreakdown: computeCategoryBreakdown(normalizedItems),
        tagsUsed,
      };

      // 7) Create order
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
    const totalRevenue = await Order.aggregate([
      { $group: { _id: null, sum: { $sum: "$finalPayable" } } },
    ]);

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
