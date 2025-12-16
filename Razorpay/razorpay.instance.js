// Razorpay/razorpay.instance.js
import Razorpay from "razorpay";

const key_id = process.env.RAZORPAY_KEY_ID;
const key_secret = process.env.RAZORPAY_KEY_SECRET;

if (!key_id || !key_secret) {
  console.error("❌ Razorpay env missing:");
  console.error("RAZORPAY_KEY_ID:", key_id ? "✅ set" : "❌ missing");
  console.error("RAZORPAY_KEY_SECRET:", key_secret ? "✅ set" : "❌ missing");
  console.error("👉 Fix: add these in backend .env (no spaces) and restart server.");
  // Throw to stop app early with a clear reason
  throw new Error("Razorpay keys missing in environment");
}

export const razorpay = new Razorpay({ key_id, key_secret });
