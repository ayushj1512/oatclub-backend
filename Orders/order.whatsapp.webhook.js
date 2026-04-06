import mongoose from "mongoose";
import crypto from "crypto";
import Order from "./Orders.js";
import { confirmOrder, cancelOrder } from "./orderController.js";

const str = (v) => (v == null ? "" : String(v));

const getByPath = (obj, path) => {
  try {
    return path.split(".").reduce((acc, key) => acc?.[key], obj);
  } catch {
    return undefined;
  }
};

const pickFirst = (obj, paths = []) => {
  for (const path of paths) {
    const value = getByPath(obj, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
};

const verifyWhatsappSignature = (req) => {
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (!secret) return true;

  const signature =
    req.headers["x-hub-signature-256"] ||
    req.headers["x-signature"] ||
    req.headers["x-webhook-signature"];

  if (!signature) return false;

  const rawBody = req.rawBody || "";
  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex")}`;

  return signature === expected;
};

const extractOrderRef = (payload = {}) => {
  return (
    pickFirst(payload, [
      "orderId",
      "meta.orderId",
      "metaData.orderId",
      "metadata.orderId",
      "custom.orderId",
    ]) ||
    pickFirst(payload, [
      "orderNumber",
      "meta.orderNumber",
      "metaData.orderNumber",
      "metadata.orderNumber",
      "custom.orderNumber",
    ])
  );
};

const findOrderFromPayload = async (payload = {}) => {
  const ref = extractOrderRef(payload);
  if (!ref) return null;

  if (mongoose.Types.ObjectId.isValid(String(ref))) {
    const byId = await Order.findById(ref);
    if (byId) return byId;
  }

  const byOrderNumber = await Order.findOne({
    orderNumber: String(ref).trim(),
  });

  return byOrderNumber || null;
};

const buildWhatsappMeta = (order, payload, responseType) => ({
  ...(order?.whatsappConfirmation || {}),
  customerResponse: responseType,
  respondedAt: new Date(),
  lastWebhookAt: new Date(),
  lastWebhookPayload: payload,
});

const makeMockRes = () => {
  const result = {
    statusCode: 200,
    body: null,
  };

  return {
    result,
    status(code) {
      result.statusCode = code;
      return this;
    },
    json(payload) {
      result.body = payload;
      return this;
    },
    send(payload) {
      result.body = payload;
      return this;
    },
  };
};

export const verifyWhatsappWebhook = async (req, res) => {
  try {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (
      mode === "subscribe" &&
      token &&
      token === process.env.WHATSAPP_VERIFY_TOKEN
    ) {
      return res.status(200).send(challenge);
    }

    return res.status(403).send("Verification failed");
  } catch (error) {
    console.error("❌ WhatsApp verify webhook error:", error);
    return res.status(500).send("Webhook verify error");
  }
};

export const whatsappConfirmOrderWebhook = async (req, res) => {
  try {
    if (!verifyWhatsappSignature(req)) {
      return res.status(401).json({
        ok: false,
        message: "Invalid signature",
      });
    }

    const payload = req.body || {};
    const order = await findOrderFromPayload(payload);

    if (!order) {
      return res.status(404).json({
        ok: false,
        message: "Order not found",
      });
    }

    const mockReq = {
      ...req,
      params: {
        ...(req.params || {}),
        id: String(order._id),
      },
      body: {
        ...(req.body || {}),
      },
    };

    const mockRes = makeMockRes();

    await confirmOrder(mockReq, mockRes);

    if (mockRes.result.statusCode >= 400) {
      return res.status(mockRes.result.statusCode).json({
        ok: false,
        ...(mockRes.result.body || {}),
      });
    }

    const updatedOrder = await Order.findById(order._id);

    if (updatedOrder) {
      updatedOrder.confirmationStatus = "confirmed";
      updatedOrder.whatsappConfirmation = buildWhatsappMeta(
        updatedOrder,
        payload,
        "confirmed"
      );
      await updatedOrder.save();
    }

    return res.status(200).json({
      ok: true,
      message: "Order confirmed successfully",
      order: updatedOrder || null,
      controllerResponse: mockRes.result.body || null,
    });
  } catch (error) {
    console.error("❌ WhatsApp confirm webhook error:", error);
    return res.status(500).json({
      ok: false,
      message: error?.message || "Confirm webhook failed",
    });
  }
};

export const whatsappCancelOrderWebhook = async (req, res) => {
  try {
    if (!verifyWhatsappSignature(req)) {
      return res.status(401).json({
        ok: false,
        message: "Invalid signature",
      });
    }

    const payload = req.body || {};
    const order = await findOrderFromPayload(payload);

    if (!order) {
      return res.status(404).json({
        ok: false,
        message: "Order not found",
      });
    }

    const mockReq = {
      ...req,
      params: {
        ...(req.params || {}),
        id: String(order._id),
      },
      body: {
        ...(req.body || {}),
        cancelReason:
          req.body?.cancelReason ||
          "Cancelled by customer via WhatsApp",
      },
    };

    const mockRes = makeMockRes();

    await cancelOrder(mockReq, mockRes);

    if (mockRes.result.statusCode >= 400) {
      return res.status(mockRes.result.statusCode).json({
        ok: false,
        ...(mockRes.result.body || {}),
      });
    }

    const updatedOrder = await Order.findById(order._id);

    if (updatedOrder) {
      updatedOrder.whatsappConfirmation = buildWhatsappMeta(
        updatedOrder,
        payload,
        "cancelled"
      );
      if (!updatedOrder.cancellationReason) {
        updatedOrder.cancellationReason = "Cancelled by customer via WhatsApp";
      }
      await updatedOrder.save();
    }

    return res.status(200).json({
      ok: true,
      message: "Order cancelled successfully",
      order: updatedOrder || null,
      controllerResponse: mockRes.result.body || null,
    });
  } catch (error) {
    console.error("❌ WhatsApp cancel webhook error:", error);
    return res.status(500).json({
      ok: false,
      message: error?.message || "Cancel webhook failed",
    });
  }
};