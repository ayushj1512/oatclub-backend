import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

import Order from "../Orders/Orders.js";
import Customer from "../Customer/Customer.js";
import Address from "../Address/Address.js";

const MONGO_URI = process.env.MONGO_URI;

const DRY_RUN = process.argv.includes("--dry");
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split("=")[1] || 0) : 0;

const isMasked = (v) => /^[*xX#]+$/.test(String(v ?? "").trim());
const cleanPhone = (v) => {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (isMasked(s)) return "";
  const digits = s.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits.length >= 10 ? digits.slice(-10) : "";
};
const normEmail = (v) => String(v ?? "").trim().toLowerCase();

const needsFixPhone = (v) => !cleanPhone(v);

async function findPhoneFromAddress({ customerObjectId, email }) {
  // 1) Address by customerId (latest)
  if (customerObjectId) {
    const a = await Address.findOne({ customerId: customerObjectId })
      .sort({ updatedAt: -1, createdAt: -1 })
      .select("phone email")
      .lean();
    const p = cleanPhone(a?.phone);
    if (p) return p;
  }

  // 2) Address by email (latest)
  const e = normEmail(email);
  if (e) {
    const a2 = await Address.findOne({ email: e })
      .sort({ updatedAt: -1, createdAt: -1 })
      .select("phone email")
      .lean();
    const p2 = cleanPhone(a2?.phone);
    if (p2) return p2;
  }

  return "";
}

const run = async () => {
  if (!MONGO_URI) {
    console.error("❌ MONGO_URI missing in .env");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI, { autoIndex: false });
  console.log("✅ Connected");

  // 1) Find customers with missing/masked phone
  const custQuery = {
    $or: [
      { phone: { $exists: false } },
      { phone: "" },
      { phone: null },
      { phone: { $regex: /^[*xX#]+$/ } },
    ],
    email: { $exists: true, $ne: "" },
  };

  let cq = Customer.find(custQuery)
    .select("_id customerId name email phone")
    .sort({ updatedAt: -1, createdAt: -1 });

  if (LIMIT && Number.isFinite(LIMIT) && LIMIT > 0) cq = cq.limit(LIMIT);

  const customers = await cq.lean();
  console.log(`🔎 Customers missing/masked phone: ${customers.length}`);

  let customerUpdates = 0;
  let orderUpdates = 0;

  const customerOps = [];
  const orderOps = [];

  for (const c of customers) {
    const email = normEmail(c.email);
    const foundPhone = await findPhoneFromAddress({
      customerObjectId: c._id,
      email,
    });

    if (!foundPhone) continue;

    // --- Update Customer.phone ---
    customerOps.push({
      updateOne: {
        filter: { _id: c._id },
        update: { $set: { phone: foundPhone } },
      },
    });
    customerUpdates++;

    // --- Update Orders snapshots for this customer (masked/missing) ---
    // shipping/billing snapshots often have masked phone -> replace
    const oQuery = {
      customerId: c._id,
      $or: [
        { "shippingAddressSnapshot.phone": { $exists: false } },
        { "shippingAddressSnapshot.phone": "" },
        { "shippingAddressSnapshot.phone": null },
        { "shippingAddressSnapshot.phone": { $regex: /^[*xX#]+$/ } },

        { "billingAddressSnapshot.phone": { $exists: false } },
        { "billingAddressSnapshot.phone": "" },
        { "billingAddressSnapshot.phone": null },
        { "billingAddressSnapshot.phone": { $regex: /^[*xX#]+$/ } },
      ],
    };

    const orders = await Order.find(oQuery).select("_id").lean();

    for (const o of orders) {
      orderOps.push({
        updateOne: {
          filter: { _id: o._id },
          update: {
            $set: {
              "shippingAddressSnapshot.phone": foundPhone,
              "billingAddressSnapshot.phone": foundPhone,
            },
          },
        },
      });
      orderUpdates++;
    }
  }

  console.log("\n🧾 Prepared:");
  console.log(`- Customer updates: ${customerOps.length}`);
  console.log(`- Order snapshot updates: ${orderOps.length}`);
  console.log(DRY_RUN ? "🟡 DRY RUN (no writes)" : "🟢 WRITE mode");

  if (!DRY_RUN) {
    if (customerOps.length) {
      const r1 = await Customer.bulkWrite(customerOps, { ordered: false });
      console.log("✅ Customers bulkWrite:", {
        matched: r1.matchedCount,
        modified: r1.modifiedCount,
      });
    }

    if (orderOps.length) {
      const r2 = await Order.bulkWrite(orderOps, { ordered: false });
      console.log("✅ Orders bulkWrite:", {
        matched: r2.matchedCount,
        modified: r2.modifiedCount,
      });
    }
  }

  await mongoose.disconnect();
  console.log("\n✅ Done");
};

run().catch(async (e) => {
  console.error("❌ Error:", e);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
