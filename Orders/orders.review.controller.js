import mongoose from "mongoose";
import Order from "./Orders.js";

export const sendReviewWhatsappManually = async (req, res) => {
  try {
    const { orderIdOrNumber } = req.params;
    const force = req.query.force === "true";

    if (!orderIdOrNumber) {
      return res.status(400).json({
        success: false,
        message: "orderIdOrNumber is required",
      });
    }

    const query = mongoose.Types.ObjectId.isValid(orderIdOrNumber)
      ? { _id: orderIdOrNumber }
      : { orderNumber: orderIdOrNumber };

    const order = await Order.findOne(query);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (force) {
      order.reviewRequest = {
        ...(order.reviewRequest || {}),
        sent: false,
        sentAt: null,
        channel: "fast2sms",
        error: "",
      };

      await order.save();
    }

    const result = await Order.sendReviewRequestWhatsapp(order._id);

    return res.status(result.success ? 200 : 400).json({
      success: result.success,
      skipped: Boolean(result.skipped),
      message: result.skipped
        ? result.reason
        : "Review WhatsApp trigger executed",
      order: {
        id: order._id,
        orderNumber: order.orderNumber,
        eligibleForRma: order.eligibleForRma,
        reviewRequest: order.reviewRequest,
      },
      result,
    });
  } catch (err) {
    console.error("❌ Manual review WhatsApp error:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to send review WhatsApp",
      error: err.message,
    });
  }
};