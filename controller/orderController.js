import Order from "../models/Orders.js";
import Product from "../models/Products.js";
import Coupon from "../models/Coupon.js";

/* ============================================================
   CREATE ORDER
============================================================ */
export const createOrder = async (req, res) => {
  try {
    const {
      customerId,
      shippingAddressSnapshot,
      billingAddressSnapshot,
      items,
      subtotal,
      discount = 0,
      coupon,
      shippingFee = 0,
      tax = 0,
      totalAmount,
      finalPayable,
      paymentMethod,
      source,
      isGiftOrder,
    } = req.body;

    if (!items || items.length === 0)
      return res.status(400).json({ message: "Order items missing" });

    // 1️⃣ Stock Validation
    for (const item of items) {
      const product = await Product.findById(item.productId);
      if (!product) return res.status(400).json({ message: "Product not found" });
      if (product.stock < item.quantity)
        return res.status(400).json({ message: `${product.title} out of stock` });
    }

    // 2️⃣ Reduce Stock
    for (const item of items) {
      await Product.findByIdAndUpdate(item.productId, { $inc: { stock: -item.quantity } });
    }

    // 3️⃣ Coupon Usage Tracking
    let couponApplied = false;
    if (coupon) {
      const couponObj = await Coupon.findById(coupon);
      if (couponObj) {
        couponApplied = true;
        couponObj.usedCount += 1;
        couponObj.usedBy.push(customerId);
        await couponObj.save();
      }
    }

    // 4️⃣ Analytics
    const analytics = {
      totalItems: items.reduce((a, b) => a + b.quantity, 0),
      averageItemPrice: subtotal / items.length,
      couponApplied,
      creditsUsed: false,
    };

    // 5️⃣ Create Order
    const order = await Order.create({
      customerId,
      shippingAddressSnapshot,
      billingAddressSnapshot,
      items,
      subtotal,
      discount,
      coupon,
      shippingFee,
      tax,
      totalAmount,
      finalPayable,
      paymentMethod,
      paymentStatus: paymentMethod === "cod" ? "pending" : "pending",
      source,
      isGiftOrder,
      analytics,
    });

    res.status(201).json({ message: "Order created successfully", order });
  } catch (error) {
    console.error("❌ Create Order Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
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
      .populate("items.productId", "title price thumbnail")
      .populate("coupon", "code discountType discountValue")
      .sort({ createdAt: -1 });

    res.status(200).json(orders);
  } catch (error) {
    console.error("❌ Fetch Orders Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/* ============================================================
   GET ORDER BY ID
============================================================ */
export const getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("customerId", "name email phone")
      .populate("items.productId", "title price thumbnail")
      .populate("coupon", "code discountType discountValue");

    if (!order) return res.status(404).json({ message: "Order not found" });

    res.status(200).json(order);
  } catch (error) {
    console.error("❌ Fetch Order Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/* ============================================================
   GET ORDERS OF SPECIFIC CUSTOMER
============================================================ */
export const getOrdersByCustomer = async (req, res) => {
  try {
    const orders = await Order.find({ customerId: req.params.customerId })
      .populate("items.productId", "title price thumbnail")
      .sort({ createdAt: -1 });

    res.status(200).json(orders);
  } catch (error) {
    console.error("❌ Customer Orders Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
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

    res.status(200).json({ message: "Order updated", order: updatedOrder });
  } catch (error) {
    console.error("❌ Update Order Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
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

    res.status(200).json({ message: "Order status updated", order });
  } catch (error) {
    console.error("❌ Update Status Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/* ============================================================
   UPDATE TRACKING
============================================================ */
export const updateTracking = async (req, res) => {
  try {
    const { trackingId, courierName, shippedAt, deliveredAt } = req.body;

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    order.trackingDetails = {
      ...order.trackingDetails,
      trackingId,
      courierName,
      shippedAt,
      deliveredAt,
    };

    await order.save();

    res.status(200).json({ message: "Tracking updated", order });
  } catch (error) {
    console.error("❌ Tracking Update Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/* ============================================================
   DELETE ORDER
============================================================ */
export const deleteOrder = async (req, res) => {
  try {
    const deletedOrder = await Order.findByIdAndDelete(req.params.id);
    if (!deletedOrder) return res.status(404).json({ message: "Order not found" });

    res.status(200).json({ message: "Order deleted" });
  } catch (error) {
    console.error("❌ Delete Order Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
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

    res.status(200).json({
      totalOrders,
      totalRevenue: totalRevenue[0]?.sum || 0,
      codOrders,
      prepaidOrders,
    });
  } catch (error) {
    console.error("❌ Analytics Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
