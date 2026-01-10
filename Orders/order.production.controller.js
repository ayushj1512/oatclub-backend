import mongoose from "mongoose";
import Order from "./Orders.js";

/* ============================================================
   ✅ PRODUCTION QUEUE (Confirmed Orders Only)
   - Production me wahi aayenge jo confirmed hain
   - Default: fulfillmentStatus = processing
   - You can filter via query param
============================================================ */
export const getProductionQueue = async (req, res) => {
  try {
    const { fulfillmentStatus = "processing" } = req.query;

    const filters = {
      isConfirmed: true,
      fulfillmentStatus,
    };

    const orders = await Order.find(filters)
      .populate("customerId", "name email phone")
      .populate("items.productId")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (error) {
    console.error("❌ getProductionQueue Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/* ============================================================
   ✅ MARK PRODUCTION COMPLETE (Update fulfillmentStatus)
   - Production done -> mark shipped
   - NO shiprocket booking here (already happens on confirm)
============================================================ */
export const markOrderShippedFromProduction = async (req, res) => {
  const session = await mongoose.startSession();
  const TAG = "🏭[PRODUCTION->SHIPPED]";

  try {
    const orderId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order id",
      });
    }

    let updatedOrder = null;

    await session.withTransaction(async () => {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw new Error("Order not found");

      // ✅ Guard: order must be confirmed first
      if (!order.isConfirmed) {
        throw new Error("Order must be confirmed before production/shipping");
      }

      // ✅ Guard: cannot mark shipped if already cancelled
      if (order.fulfillmentStatus === "cancelled") {
        throw new Error("Cancelled order cannot be shipped");
      }

      // ✅ Idempotent
      if (order.fulfillmentStatus === "shipped") {
        updatedOrder = order;
        return;
      }

      // ✅ Mark shipped
      order.fulfillmentStatus = "shipped";

      // ✅ Optional: update shipment.status too (keeps admin UI aligned)
      order.shipment = order.shipment || {};
      if (order.shipment.status && order.shipment.status !== "cancelled") {
        order.shipment.status = "shipped";
      }

      await order.save({ session });
      updatedOrder = order;
    });

    const finalOrder = await Order.findById(updatedOrder._id).lean();

    console.log(`${TAG} ✅ Order marked shipped`, {
      orderNumber: finalOrder?.orderNumber,
      orderId: String(finalOrder?._id),
    });

    return res.status(200).json({
      success: true,
      message:
        finalOrder.fulfillmentStatus === "shipped"
          ? "Order marked shipped from production"
          : "Order already shipped",
      order: finalOrder,
    });
  } catch (error) {
    console.error(`${TAG} ❌ Error:`, error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  } finally {
    session.endSession();
  }
};

/* ============================================================
   ✅ PRODUCTION SUMMARY (Counts for dashboard)
   - Only confirmed orders considered
============================================================ */
export const getProductionSummary = async (req, res) => {
  try {
    const [summary] = await Order.aggregate([
      { $match: { isConfirmed: true } },
      {
        $group: {
          _id: null,
          processing: {
            $sum: {
              $cond: [{ $eq: ["$fulfillmentStatus", "processing"] }, 1, 0],
            },
          },
          packed: {
            $sum: { $cond: [{ $eq: ["$fulfillmentStatus", "packed"] }, 1, 0] },
          },
          shipped: {
            $sum: { $cond: [{ $eq: ["$fulfillmentStatus", "shipped"] }, 1, 0] },
          },
          delivered: {
            $sum: {
              $cond: [{ $eq: ["$fulfillmentStatus", "delivered"] }, 1, 0],
            },
          },
          cancelled: {
            $sum: {
              $cond: [{ $eq: ["$fulfillmentStatus", "cancelled"] }, 1, 0],
            },
          },
        },
      },
    ]);

    return res.status(200).json({
      success: true,
      summary: summary || {
        processing: 0,
        packed: 0,
        shipped: 0,
        delivered: 0,
        cancelled: 0,
      },
    });
  } catch (err) {
    console.error("❌ getProductionSummary Error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Server error",
    });
  }
};
