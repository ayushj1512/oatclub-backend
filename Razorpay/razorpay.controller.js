import crypto from "crypto";
import mongoose from "mongoose";
import { razorpay } from "./razorpay.instance.js";
import Order from "../Orders/Orders.js";
import { debitWalletForOrderInternal } from "../Customer/customerCredit.service.js";
import { creditOrderWalletRewardInternal } from "../Customer/orderWalletReward.service.js";

import { reserveInventoryForOrderNumberInternal } from "../InventoryReservation/inventoryWebhook.js";

import {
  sendPartialCodConfirmationWhatsapp,
  sendPrepaidOrderConfirmationWhatsapp,
} from "../fast2sms/index.js";

import {
  triggerOrderEmails,
} from "../Orders/order.emails.js";


const triggerPaymentConfirmation = (order) => {
  if (!order?._id) return;

  setImmediate(async () => {
    try {
      triggerOrderEmails(order);
    } catch (err) {
      console.error(
        "⚠️ Payment confirmation email failed:",
        err?.message || err,
      );
    }

    try {
      const paymentMethod = String(
        order.paymentMethod || "",
      ).toLowerCase();

      let result;

      if (paymentMethod === "partial_cod") {
        const amountPaid = Number(
          order.partialPayment?.upfrontAmount ??
          order.paymentBreakdown?.razorpayAmount ??
          0,
        );

        const remainingAmount = Number(
          order.partialPayment?.remainingCodAmount ??
          order.paymentBreakdown?.codAmount ??
          0,
        );

        result =
          await sendPartialCodConfirmationWhatsapp({
            order,
            amountPaid,
            remainingAmount,
          });
      } else {
        result =
          await sendPrepaidOrderConfirmationWhatsapp({
            order,
          });
      }

      if (!result?.success) {
        console.error(
          "⚠️ Payment Fast2SMS failed:",
          result?.error ||
          result?.data ||
          result,
        );
        return;
      }

      console.log(
        `✅ ${paymentMethod === "partial_cod"
          ? "Partial COD"
          : "Prepaid"
        } Fast2SMS sent:`,
        order.orderNumber,
      );
    } catch (err) {
      console.error(
        "⚠️ Payment Fast2SMS error:",
        err?.message || err,
      );
    }
  });
};


const debitWalletAfterRazorpaySuccess = async (order) => {
  if (
    order?.walletCredit?.used === true &&
    Number(order?.walletCredit?.amount || 0) > 0 &&
    !order?.walletCredit?.debitedAt
  ) {
    const debitResult = await debitWalletForOrderInternal({
      customerId: order.customerId,
      amount: Number(order.walletCredit.amount),
      orderId: order._id,
      orderNumber: order.orderNumber,
    });

    order.walletCredit.transactionId = debitResult?.log?.creditId || "";
    order.walletCredit.balanceAfterDebit = debitResult?.balance || 0;
    order.walletCredit.debitedAt = new Date();
  }
};

/**
 * POST /api/razorpay/create-order
 */
export const createRazorpayOrder = async (req, res, next) => {
  try {
    const { mongoOrderId } = req.body;

    if (
      !mongoOrderId ||
      !mongoose.Types.ObjectId.isValid(mongoOrderId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid mongoOrderId",
      });
    }

    const order = await Order.findById(mongoOrderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const paymentMethod = String(
      order.paymentMethod || "",
    ).toLowerCase();

    const paymentStatus = String(
      order.paymentStatus || "",
    ).toLowerCase();

    const alreadyCompleted =
      paymentStatus === "paid" ||
      (
        paymentMethod === "partial_cod" &&
        paymentStatus === "partially_paid"
      );

    if (alreadyCompleted) {
      return res.status(400).json({
        success: false,
        message: "Order payment already completed",
      });
    }

    if (
      !["razorpay", "partial_cod"].includes(
        paymentMethod,
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Order is not eligible for Razorpay payment",
      });
    }

    // ✅ Full prepaid = full payable
    // ✅ Partial COD = only upfront 10%
    const amount =
      paymentMethod === "partial_cod"
        ? Number(
          order.partialPayment?.upfrontAmount ||
          order.paymentBreakdown?.razorpayAmount ||
          0,
        )
        : Number(order.finalPayable || 0);

    const amountPaise = Math.round(amount * 100);

    if (!amountPaise || amountPaise < 100) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment amount",
      });
    }

    const rpOrder = await razorpay.orders.create({
      amount: amountPaise,
      currency: order.currency || "INR",
      receipt: String(order.orderNumber),
      notes: {
        mongoOrderId: String(order._id),
        orderNumber: String(order.orderNumber),
        paymentMethod,
      },
    });

    order.razorpay = order.razorpay || {};
    order.razorpay.orderId = rpOrder.id;
    order.razorpay.amount = rpOrder.amount;
    order.razorpay.currency = rpOrder.currency;

    if (paymentMethod === "partial_cod") {
      order.partialPayment = order.partialPayment || {};
      order.partialPayment.razorpayOrderId =
        rpOrder.id;
    }

    order.paymentStatus = "pending";

    await order.save();

    return res.json({
      success: true,
      razorpayOrderId: rpOrder.id,
      amount: rpOrder.amount,
      currency: rpOrder.currency,

      paymentMethod,

      mongoOrderId: String(order._id),
      orderNumber: order.orderNumber,

      customer: {
        name:
          order.shippingAddressSnapshot?.fullName ||
          "",
        email:
          order.shippingAddressSnapshot?.email ||
          "",
        phone:
          order.shippingAddressSnapshot?.phone ||
          "",
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/razorpay/verify
 */
export const verifyRazorpayPayment = async (
  req,
  res,
  next,
) => {
  try {
    const {
      mongoOrderId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    const order =
      await Order.findById(mongoOrderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const paymentMethod = String(
      order.paymentMethod || "",
    ).toLowerCase();

    if (
      !["razorpay", "partial_cod"].includes(
        paymentMethod,
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment method",
      });
    }

    const alreadyCompleted =
      order.paymentStatus === "paid" ||
      (
        paymentMethod === "partial_cod" &&
        order.paymentStatus === "partially_paid"
      );

    if (alreadyCompleted) {
      await debitWalletAfterRazorpaySuccess(order);
      await order.save();

      return res.json({
        success: true,
        alreadyProcessed: true,
      });
    }

    const body =
      `${razorpay_order_id}|${razorpay_payment_id}`;

    const expectedSignature = crypto
      .createHmac(
        "sha256",
        process.env.RAZORPAY_KEY_SECRET,
      )
      .update(body)
      .digest("hex");

    if (
      expectedSignature !== razorpay_signature
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid signature",
      });
    }

    const now = new Date();

    // ========================================================
    // ✅ PARTIAL COD
    // ========================================================
    if (paymentMethod === "partial_cod") {
      order.paymentStatus = "partially_paid";

      order.partialPayment =
        order.partialPayment || {};

      order.partialPayment.upfrontPaid = true;

      order.partialPayment.upfrontPaidAt =
        order.partialPayment.upfrontPaidAt ||
        now;

      order.partialPayment.razorpayOrderId =
        razorpay_order_id;

      order.partialPayment.razorpayPaymentId =
        razorpay_payment_id;
    }

    // ========================================================
    // ✅ FULL PREPAID
    // ========================================================
    if (paymentMethod === "razorpay") {
      order.paymentStatus = "paid";
    }

    // ✅ Both successful flows auto confirm
    order.isConfirmed = true;

    order.confirmedAt =
      order.confirmedAt || now;

    order.confirmedBy =
      order.confirmedBy || "auto";

    order.razorpay = order.razorpay || {};

    order.razorpay.orderId =
      razorpay_order_id ||
      order.razorpay.orderId;

    order.razorpay.paymentId =
      razorpay_payment_id;

    order.razorpay.signature =
      razorpay_signature;

    order.razorpay.paidAt =
      order.razorpay.paidAt || now;

    // ✅ Wallet debit only after payment succeeds
    await debitWalletAfterRazorpaySuccess(
      order,
    );

    await order.save();

    await creditOrderWalletRewardInternal({
      orderId: order._id,
    }).catch((err) => {
      console.error(
        "⚠️ Wallet reward credit failed:",
        err?.message || err,
      );
    });

    const finalOrder =
      await Order.findById(order._id)
        .populate(
          "customerId",
          "name email phone",
        )
        .lean();

    // ✅ Confirmation email + WhatsApp
    triggerPaymentConfirmation(finalOrder);

    // ✅ Reserve inventory only after payment succeeds
    const orderNumber = String(
      order.orderNumber || "",
    ).trim();

    if (orderNumber) {
      setImmediate(async () => {
        try {
          await reserveInventoryForOrderNumberInternal({
            orderNumber,
            allowedFulfillment: [
              "processing",
              "packed",
            ],
            confirmedOnly: true,
            debug: false,
          });
        } catch (err) {
          console.error(
            "⚠️ reserve after Razorpay verify failed:",
            err?.message || err,
          );
        }
      });
    }

    return res.json({
      success: true,
      paymentStatus:
        order.paymentStatus,
      paymentMethod:
        order.paymentMethod,
      order: finalOrder,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/razorpay/webhook
 * Mounted with express.raw()
 */
export const razorpayWebhook = async (
  req,
  res,
) => {
  try {
    const signature =
      req.headers["x-razorpay-signature"];

    const secret =
      process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!secret) {
      console.error(
        "❌ RAZORPAY_WEBHOOK_SECRET missing",
      );

      return res
        .status(500)
        .send(
          "Webhook secret not configured",
        );
    }

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(req.body)
      .digest("hex");

    if (
      expectedSignature !== signature
    ) {
      return res
        .status(401)
        .send("Invalid signature");
    }

    const event = JSON.parse(
      req.body.toString("utf8"),
    );

    const type = event.event;

    const paymentEntity =
      event?.payload?.payment?.entity;

    const orderEntity =
      event?.payload?.order?.entity;

    const mongoOrderId =
      paymentEntity?.notes?.mongoOrderId ||
      orderEntity?.notes?.mongoOrderId;

    if (!mongoOrderId) {
      return res.json({
        received: true,
      });
    }

    const order =
      await Order.findById(mongoOrderId);

    if (!order) {
      return res.json({
        received: true,
      });
    }

    const paymentMethod = String(
      order.paymentMethod || "",
    ).toLowerCase();

    // ========================================================
    // ✅ SUCCESS
    // ========================================================
    if (
      type === "payment.captured" ||
      type === "order.paid"
    ) {
      const wasCompleted =
        order.paymentStatus === "paid" ||
        (
          paymentMethod === "partial_cod" &&
          order.paymentStatus ===
          "partially_paid"
        );

      const now = new Date();

      if (paymentMethod === "partial_cod") {
        order.paymentStatus =
          "partially_paid";

        order.partialPayment =
          order.partialPayment || {};

        order.partialPayment.upfrontPaid =
          true;

        order.partialPayment.upfrontPaidAt =
          order.partialPayment
            .upfrontPaidAt || now;

        order.partialPayment.razorpayOrderId =
          paymentEntity?.order_id ||
          orderEntity?.id ||
          order.razorpay?.orderId ||
          "";

        order.partialPayment.razorpayPaymentId =
          paymentEntity?.id || "";
      } else {
        order.paymentStatus = "paid";
      }

      order.isConfirmed = true;
      order.confirmedAt =
        order.confirmedAt || now;
      order.confirmedBy =
        order.confirmedBy || "auto";

      order.razorpay =
        order.razorpay || {};

      order.razorpay.paymentId =
        paymentEntity?.id ||
        order.razorpay.paymentId;

      order.razorpay.orderId =
        paymentEntity?.order_id ||
        orderEntity?.id ||
        order.razorpay.orderId;

      order.razorpay.paidAt =
        order.razorpay.paidAt || now;

      await debitWalletAfterRazorpaySuccess(
        order,
      );

      await order.save();

      await creditOrderWalletRewardInternal({
        orderId: order._id,
      }).catch((err) => {
        console.error(
          "⚠️ Wallet reward credit failed:",
          err?.message || err,
        );
      });

      if (!wasCompleted) {
        const finalOrder =
          await Order.findById(order._id)
            .populate(
              "customerId",
              "name email phone",
            )
            .lean();

        triggerPaymentConfirmation(
          finalOrder,
        );

        const orderNumber = String(
          order.orderNumber || "",
        ).trim();

        if (orderNumber) {
          setImmediate(async () => {
            try {
              await reserveInventoryForOrderNumberInternal({
                orderNumber,
                allowedFulfillment: [
                  "processing",
                  "packed",
                ],
                confirmedOnly: true,
                debug: false,
              });
            } catch (err) {
              console.error(
                "⚠️ reserve after Razorpay webhook failed:",
                err?.message || err,
              );
            }
          });
        }
      }
    }

    // ========================================================
    // ❌ FAILED
    // ========================================================
    if (type === "payment.failed") {
      order.paymentStatus = "failed";

      await order.save();
    }

    return res.json({
      received: true,
    });
  } catch (err) {
    console.error(
      "❌ Webhook error:",
      err,
    );

    return res
      .status(500)
      .send("Webhook error");
  }
};

// RazorpayController.js

export const resendPrepaidConfirmation = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId)
      .populate("customerId", "name email phone")
      .lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (
      String(order.paymentMethod || "").toLowerCase() !== "razorpay" ||
      String(order.paymentStatus || "").toLowerCase() !== "paid"
    ) {
      return res.status(400).json({
        success: false,
        message: "Only paid Razorpay orders are allowed",
      });
    }

    try {
      triggerOrderEmails(order);
    } catch (err) {
      console.error(
        "⚠️ Manual prepaid email failed:",
        err?.message || err
      );
    }

    const whatsapp =
      await sendPrepaidOrderConfirmationWhatsapp({
        order,
      });

    return res.json({
      success: true,
      message: "Confirmation triggered",
      whatsappSuccess: whatsapp?.success === true,
    });
  } catch (err) {
    next(err);
  }
};

export const webhook = razorpayWebhook;
