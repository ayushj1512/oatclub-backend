import { sendEmail } from "./mailer.js";

/**
 * ✅ Customer Onboarding
 */
export const onboardingMail = async (user) => {
  return sendEmail({
    to: user.email,
    subject: "Welcome to MIRAY FASHIONS 🎉",
    text: `Hi ${user.name || ""}, welcome to MIRAY FASHIONS!`,
    html: `<h2>Welcome ${user.name || ""} 🎉</h2><p>We’re excited to have you at <b>MIRAY FASHIONS</b>.</p>`,
  });
};

/**
 * ✅ Order Placed
 */
export const orderPlacedMail = async (user, order) => {
  return sendEmail({
    to: user.email,
    subject: `Order Confirmed ✅ (#${order.orderId})`,
    text: `Hi ${user.name || ""}, your order #${order.orderId} has been placed.`,
    html: `<h2>Order Confirmed ✅</h2><p>Order ID: <b>${order.orderId}</b></p>`,
  });
};

/**
 * ✅ Order Delivered
 */
export const deliveredMail = async (user, order) => {
  return sendEmail({
    to: user.email,
    subject: `Order Delivered 📦 (#${order.orderId})`,
    text: `Hi ${user.name || ""}, your order #${order.orderId} has been delivered.`,
    html: `<h2>Delivered 📦</h2><p>Order ID: <b>${order.orderId}</b></p>`,
  });
};

/**
 * ✅ RMA Request
 */
export const rmaRequestMail = async (user, rma) => {
  return sendEmail({
    to: user.email,
    subject: `RMA Request Received 🛠️ (#${rma.rmaId})`,
    text: `Hi ${user.name || ""}, we received your RMA request.`,
    html: `<h2>RMA Request Received 🛠️</h2><p>RMA ID: <b>${rma.rmaId}</b></p>`,
  });
};

/**
 * ✅ Newsletter Subscription
 */
export const newsSubscriptionMail = async (subscriber) => {
  return sendEmail({
    to: subscriber.email,
    subject: "Subscribed to MIRAY FASHIONS Newsletter 📰",
    text: "Thanks for subscribing! You'll now receive updates.",
    html: `<h2>Subscribed 📰</h2><p>Thanks for subscribing to <b>MIRAY FASHIONS</b>!</p>`,
  });
};
