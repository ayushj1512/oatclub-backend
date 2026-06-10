// Razorpay/razorpay.instance.js

import Razorpay from "razorpay";

const key_id = process.env.RAZORPAY_KEY_ID;
const key_secret = process.env.RAZORPAY_KEY_SECRET;

let razorpay = null;

if (!key_id || !key_secret) {
  console.warn("⚠️ Razorpay not configured.");
  console.warn("RAZORPAY_KEY_ID:", key_id ? "✅ set" : "❌ missing");
  console.warn(
    "RAZORPAY_KEY_SECRET:",
    key_secret ? "✅ set" : "❌ missing"
  );
  console.warn(
    "Payment creation/verification APIs will be unavailable."
  );
} else {
  razorpay = new Razorpay({
    key_id,
    key_secret,
  });
}

export { razorpay };

export function isRazorpayConfigured() {
  return Boolean(key_id && key_secret);
}