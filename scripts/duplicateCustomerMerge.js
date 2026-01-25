import "dotenv/config";
import mongoose from "mongoose";
import Customer from "../Customer/Customer.js";

/**
 * -----------------------------
 * CONFIG
 * -----------------------------
 */

// Add all collections/fields where customer is referenced.
// You MUST update these to match your DB.
const REF_UPDATES = [
  // Most common:
  { collection: "orders", objectIdFields: ["customerId", "customer"], stringFields: ["customerIdStr"] },
  { collection: "carts", objectIdFields: ["customerId"], stringFields: [] },
  { collection: "abandonedcarts", objectIdFields: ["customerId"], stringFields: [] },

  // If you store customerId string inside any doc, add it here:
  // { collection: "shipments", objectIdFields: ["customerId"], stringFields: ["customerId"] },
];

const DRY_RUN = false;          // set true to test without writing
const DELETE_DUPLICATES = false; // keep false (recommended)

// -----------------------------
// Helpers
// -----------------------------
const isNonEmpty = (v) =>
  v !== null && v !== undefined && String(v).trim() !== "";

const oidStr = (x) => (x ? String(x) : "");

function mergeUniqueStrings(a = [], b = []) {
  const set = new Set();
  const out = [];
  for (const v of [...a, ...b]) {
    const s = String(v || "").trim();
    if (!s) continue;
    if (!set.has(s)) {
      set.add(s);
      out.push(s);
    }
  }
  return out;
}

function mergeObjectIds(a = [], b = []) {
  const set = new Set();
  const out = [];
  for (const v of [...a, ...b]) {
    if (!v) continue;
    const k = String(v);
    if (!set.has(k)) {
      set.add(k);
      out.push(v);
    }
  }
  return out;
}

function mergeCartAdds(masterAdds = [], dupAdds = []) {
  // unique by productCode, keep latest lastAddedAt
  const map = new Map();

  const addOne = (it) => {
    if (!it?.productCode) return;
    const code = String(it.productCode).trim();
    if (!code) return;

    const newT = it.lastAddedAt ? new Date(it.lastAddedAt).getTime() : 0;
    const prev = map.get(code);
    if (!prev) {
      map.set(code, { productCode: code, lastAddedAt: it.lastAddedAt || new Date() });
      return;
    }
    const prevT = prev.lastAddedAt ? new Date(prev.lastAddedAt).getTime() : 0;
    if (newT > prevT) map.set(code, { productCode: code, lastAddedAt: it.lastAddedAt || new Date() });
  };

  masterAdds.forEach(addOne);
  dupAdds.forEach(addOne);

  return [...map.values()]
    .sort((a, b) => new Date(b.lastAddedAt) - new Date(a.lastAddedAt))
    .slice(0, 80);
}

function mergeCart(masterCart = {}, dupCart = {}) {
  const out = { ...masterCart };

  if (!out.activeCartId && dupCart.activeCartId) out.activeCartId = dupCart.activeCartId;
  if (!out.lastAbandonedCartId && dupCart.lastAbandonedCartId) out.lastAbandonedCartId = dupCart.lastAbandonedCartId;

  out.activeCartType = out.activeCartType || dupCart.activeCartType || "cart";

  out.cartCount = Math.max(Number(out.cartCount || 0), Number(dupCart.cartCount || 0));
  out.abandonedCartCount = Math.max(
    Number(out.abandonedCartCount || 0),
    Number(dupCart.abandonedCartCount || 0)
  );

  const a = out.lastCartActivityAt ? new Date(out.lastCartActivityAt).getTime() : 0;
  const b = dupCart.lastCartActivityAt ? new Date(dupCart.lastCartActivityAt).getTime() : 0;
  out.lastCartActivityAt = a >= b ? out.lastCartActivityAt : dupCart.lastCartActivityAt;

  return out;
}

function mergeAnalytics(master = {}, dup = {}) {
  const out = { ...master };
  const keys = ["totalOrders", "totalSpend", "wishlistCount", "couponUses", "creditsEarned"];
  for (const k of keys) {
    out[k] = Math.max(Number(out[k] || 0), Number(dup[k] || 0));
  }
  out.avgOrderValue = out.totalOrders > 0 ? out.totalSpend / out.totalOrders : 0;
  return out;
}

/**
 * Merge DUP into MASTER (mutates master doc)
 * - customerId stays master.customerId
 */
function mergeCustomerDoc(master, dup) {
  // basics (fill missing only)
  if (!isNonEmpty(master.name) && isNonEmpty(dup.name)) master.name = dup.name;
  if (!isNonEmpty(master.email) && isNonEmpty(dup.email)) master.email = dup.email;
  if (!isNonEmpty(master.phone) && isNonEmpty(dup.phone)) master.phone = dup.phone;
  if (!isNonEmpty(master.profileImage) && isNonEmpty(dup.profileImage)) master.profileImage = dup.profileImage;

  if (!master.dateOfBirth && dup.dateOfBirth) master.dateOfBirth = dup.dateOfBirth;
  if ((master.gender === "unknown" || !master.gender) && dup.gender && dup.gender !== "unknown") master.gender = dup.gender;
  if ((master.ageGroup === "Unknown" || !master.ageGroup) && dup.ageGroup && dup.ageGroup !== "Unknown") master.ageGroup = dup.ageGroup;

  if (!isNonEmpty(master.country) && isNonEmpty(dup.country)) master.country = dup.country;
  if (!isNonEmpty(master.state) && isNonEmpty(dup.state)) master.state = dup.state;
  if (!isNonEmpty(master.city) && isNonEmpty(dup.city)) master.city = dup.city;

  // referral
  if (!isNonEmpty(master.referralCode) && isNonEmpty(dup.referralCode)) master.referralCode = dup.referralCode;
  if (!master.referredBy && dup.referredBy) master.referredBy = dup.referredBy;

  // arrays & nested
  master.cartAdds = mergeCartAdds(master.cartAdds || [], dup.cartAdds || []);
  master.cart = mergeCart(master.cart || {}, dup.cart || {});

  master.preferences = master.preferences || {};
  dup.preferences = dup.preferences || {};

  master.preferences.categories = mergeObjectIds(
    master.preferences.categories || [],
    dup.preferences.categories || []
  );

  master.preferences.favoriteBrands = mergeUniqueStrings(
    master.preferences.favoriteBrands || [],
    dup.preferences.favoriteBrands || []
  );

  const mMin = Number(master.preferences?.budgetRange?.min || 0);
  const mMax = Number(master.preferences?.budgetRange?.max || 0);
  const dMin = Number(dup.preferences?.budgetRange?.min || 0);
  const dMax = Number(dup.preferences?.budgetRange?.max || 0);

  master.preferences.budgetRange = {
    min: Math.min(mMin, dMin),
    max: Math.max(mMax, dMax),
  };

  master.analytics = mergeAnalytics(master.analytics || {}, dup.analytics || {});

  // joinedAt earliest
  if (master.joinedAt && dup.joinedAt) {
    master.joinedAt = new Date(master.joinedAt) <= new Date(dup.joinedAt) ? master.joinedAt : dup.joinedAt;
  } else if (!master.joinedAt && dup.joinedAt) {
    master.joinedAt = dup.joinedAt;
  }

  // audit trail (these fields not in schema, but mongoose will still store if strict is false; if strict true, ignore)
  master.mergedFromCustomerObjectIds = mergeUniqueStrings(
    master.mergedFromCustomerObjectIds || [],
    [oidStr(dup._id)]
  );
  master.mergedCustomerIds = mergeUniqueStrings(
    master.mergedCustomerIds || [],
    [dup.customerId].filter(Boolean)
  );
  master.mergedReferralCodes = mergeUniqueStrings(
    master.mergedReferralCodes || [],
    [dup.referralCode].filter(Boolean)
  );

  master.updatedAt = new Date();
}

function chooseMaster(customers) {
  // Keep the earliest created record as master (stable customerId)
  return [...customers].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];
}

async function updateReferences(session, fromCustomerObjId, toCustomerObjId, fromCustomerIdStr, toCustomerIdStr) {
  for (const cfg of REF_UPDATES) {
    const col = mongoose.connection.collection(cfg.collection);

    // ObjectId refs
    for (const f of cfg.objectIdFields || []) {
      const q = { [f]: fromCustomerObjId };
      const u = { $set: { [f]: toCustomerObjId } };

      if (DRY_RUN) {
        const c = await col.countDocuments(q);
        if (c) console.log(`    🧪 Would update ${cfg.collection}.${f} ObjectId: ${c}`);
      } else {
        const r = await col.updateMany(q, u, { session });
        if (r.matchedCount || r.modifiedCount) {
          console.log(`    ✅ Updated ${cfg.collection}.${f} ObjectId: matched=${r.matchedCount}, modified=${r.modifiedCount}`);
        }
      }
    }

    // String refs (customerId like "0350")
    for (const f of cfg.stringFields || []) {
      if (!fromCustomerIdStr || !toCustomerIdStr) continue;

      const q = { [f]: fromCustomerIdStr };
      const u = { $set: { [f]: toCustomerIdStr } };

      if (DRY_RUN) {
        const c = await col.countDocuments(q);
        if (c) console.log(`    🧪 Would update ${cfg.collection}.${f} String: ${c}`);
      } else {
        const r = await col.updateMany(q, u, { session });
        if (r.matchedCount || r.modifiedCount) {
          console.log(`    ✅ Updated ${cfg.collection}.${f} String: matched=${r.matchedCount}, modified=${r.modifiedCount}`);
        }
      }
    }
  }
}

// -----------------------------
// Main
// -----------------------------
async function main() {
  if (!process.env.MONGO_URI) throw new Error("❌ MONGO_URI missing in .env");

  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ Connected");

  const dupGroups = await Customer.aggregate([
    { $match: { firebaseUID: { $type: "string", $ne: "" } } },
    { $group: { _id: "$firebaseUID", ids: { $push: "$_id" }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);

  if (!dupGroups.length) {
    console.log("✅ No duplicate firebaseUID customers found.");
    await mongoose.disconnect();
    return;
  }

  console.log(`⚠️ Found ${dupGroups.length} duplicate firebaseUID groups`);

  for (const g of dupGroups) {
    const uid = g._id;
    const customers = await Customer.find({ _id: { $in: g.ids } }).sort({ createdAt: 1 });

    console.log("\n==============================");
    console.log(`🔁 firebaseUID: ${uid}`);
    console.log(`   Records: ${customers.map((c) => `${c.customerId}:${c._id}`).join(" | ")}`);

    const master = chooseMaster(customers); // keeps earliest customerId
    const dups = customers.filter((c) => oidStr(c._id) !== oidStr(master._id));

    console.log(`⭐ Master: ${master.customerId}:${master._id}`);

    // Merge data from all dups into master
    for (const dup of dups) mergeCustomerDoc(master, dup);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      if (!DRY_RUN) {
        await master.save({ session });
      } else {
        console.log("  🧪 DRY_RUN: would save merged master");
      }

      for (const dup of dups) {
        console.log(`  ➜ Move refs ${dup.customerId}:${dup._id} -> ${master.customerId}:${master._id}`);
        await updateReferences(session, dup._id, master._id, dup.customerId, master.customerId);

        if (DELETE_DUPLICATES) {
          if (DRY_RUN) {
            console.log(`  🧪 DRY_RUN: would delete dup ${dup._id}`);
          } else {
            await Customer.deleteOne({ _id: dup._id }, { session });
            console.log(`  🗑️ Deleted dup ${dup._id}`);
          }
        } else {
          // Soft disable + remove unique keys (prevents unique-index conflicts)
          const soft = {
            isActive: false,
            mergedIntoCustomerObjectId: master._id,
            updatedAt: new Date(),
          };

          // IMPORTANT: to avoid conflicts on unique firebaseUID index, unset it.
          // Your partial index is { firebaseUID: { $type: "string" } } — empty string is still string.
          // Best: unset field completely, or set to null (null is not string).
          const unset = { firebaseUID: 1, email: 1 }; // email optional

          if (DRY_RUN) {
            console.log(`  🧪 DRY_RUN: would soft-disable + unset firebaseUID/email for dup ${dup._id}`);
          } else {
            await Customer.updateOne(
              { _id: dup._id },
              { $set: soft, $unset: unset },
              { session }
            );
            console.log(`  📴 Soft-disabled dup ${dup._id}`);
          }
        }
      }

      if (!DRY_RUN) await session.commitTransaction();
      console.log("✅ Group merged successfully");
    } catch (e) {
      await session.abortTransaction();
      console.error("❌ Merge failed, transaction aborted:", e?.message || e);
    } finally {
      session.endSession();
    }
  }

  await mongoose.disconnect();
  console.log("\n✅ Done");
}

main().catch((e) => {
  console.error("❌ Script error:", e);
  process.exit(1);
});
