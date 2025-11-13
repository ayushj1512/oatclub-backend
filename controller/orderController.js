import Order from "../models/Order.js";

/**
 * @desc Create a new order
 * @route POST /api/orders
 * @access Private
 */
export const createOrder = async (req, res) => {
  try {
    const orderData = req.body;

    const order = await Order.create(orderData);

    res.status(201).json({ message: "Order created successfully", order });
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Get all orders
 * @route GET /api/orders
 * @access Private/Admin
 */
export const getAllOrders = async (req, res) => {
  try {
    const { customerId, status, fulfillmentStatus } = req.query;

    const filters = {};
    if (customerId) filters.customerId = customerId;
    if (status) filters.paymentStatus = status;
    if (fulfillmentStatus) filters.fulfillmentStatus = fulfillmentStatus;

    const orders = await Order.find(filters)
      .populate("customerId", "name email phone")
      .populate("shippingAddress billingAddress")
      .populate("items.productId", "title price")
      .populate("coupon", "code discountType discountValue")
      .sort({ orderDate: -1 });

    res.status(200).json(orders);
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Get single order by ID
 * @route GET /api/orders/:id
 * @access Private/Admin
 */
export const getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("customerId", "name email phone")
      .populate("shippingAddress billingAddress")
      .populate("items.productId", "title price")
      .populate("coupon", "code discountType discountValue");

    if (!order) return res.status(404).json({ message: "Order not found" });

    res.status(200).json(order);
  } catch (error) {
    console.error("Error fetching order:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Update order (status, tracking, items, etc.)
 * @route PUT /api/orders/:id
 * @access Private/Admin
 */
export const updateOrder = async (req, res) => {
  try {
    const updatedOrder = await Order.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!updatedOrder) return res.status(404).json({ message: "Order not found" });

    res.status(200).json({ message: "Order updated successfully", order: updatedOrder });
  } catch (error) {
    console.error("Error updating order:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Delete an order
 * @route DELETE /api/orders/:id
 * @access Private/Admin
 */
export const deleteOrder = async (req, res) => {
  try {
    const deletedOrder = await Order.findByIdAndDelete(req.params.id);
    if (!deletedOrder) return res.status(404).json({ message: "Order not found" });

    res.status(200).json({ message: "Order deleted successfully" });
  } catch (error) {
    console.error("Error deleting order:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
