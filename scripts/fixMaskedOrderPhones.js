import mongoose from "mongoose";
import Order from "../Orders/Orders.js";      // adjust path
import Customer from "../Customer/Customer.js"; // adjust path
import "dotenv/config";

const MONGO_URI = process.env.MONGO_URI;

const onlyDigits = (s) => String(s || "").replace(/\D/g, "");
const isMaskedOrInvalid = (phone) => {
  const p = String(phone || "").trim();
  if (!p) return true;
  if (p.includes("*")) return true;
  const d = onlyDigits(p);
  // keep it flexible: if < 8 digits, treat as invalid
  return d.length < 8;
};

const normalizePhone = (phone) => {
  const raw = String(phone || "").trim();
  if (!raw) return "";
  // keep original formatting if you want; or normalize to digits:
  // return onlyDigits(raw);
  return raw;
};

async function main() {
  if (!MONGO_URI) throw new Error("MONGO_URI missing in env");

  await mongoose.connect(MONGO_URI);
  console.log("✅ Connected");

  // Find candidates
  const cursor = Order.find(
    {
      $or: [
        { "shippingAddressSnapshot.phone": { $regex: "\\*", $options: "i" } },
        { "billingAddressSnapshot.phone": { $regex: "\\*", $options: "i" } },
        { "shippingAddressSnapshot.phone": { $in: [null, ""] } },
        { "billingAddressSnapshot.phone": { $in: [null, ""] } },
      ],
    },
    { customerId: 1, shippingAddressSnapshot: 1, billingAddressSnapshot: 1 }
  ).cursor();

  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  for await (const order of cursor) {
    scanned++;

    const customer = await Customer.findById(order.customerId, { phone: 1 }).lean();
    const cPhone = normalizePhone(customer?.phone);

    if (!cPhone) {
      skipped++;
      continue;
    }

    const shipPhone = order?.shippingAddressSnapshot?.phone;
    const billPhone = order?.billingAddressSnapshot?.phone;

    const set = {};

    if (isMaskedOrInvalid(shipPhone)) set["shippingAddressSnapshot.phone"] = cPhone;
    if (isMaskedOrInvalid(billPhone)) set["billingAddressSnapshot.phone"] = cPhone;

    if (Object.keys(set).length === 0) {
      skipped++;
      continue;
    }

    await Order.updateOne({ _id: order._id }, { $set: set });
    updated++;
  }

  console.log({ scanned, updated, skipped });
  await mongoose.disconnect();
  console.log("✅ Done");
}

main().catch((e) => {
  console.error("❌ Failed:", e);
  process.exit(1);
});
