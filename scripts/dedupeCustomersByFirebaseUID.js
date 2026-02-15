/* scripts/dedupeCustomersByFirebaseUID.js */
import "dotenv/config";
import mongoose from "mongoose";
import Customer from "../Customer/Customer.js";

const MONGO_URI = (process.env.MONGO_URI || "").trim();
const argv = process.argv.slice(2);

const COMMIT = argv.includes("--commit"); // default DRY RUN
const SOFT_DELETE = argv.includes("--soft-delete"); // recommended
const LIMIT_ARG = argv.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split("=")[1]) : 0;
const BATCH_ARG = argv.find((a) => a.startsWith("--batch="));
const BATCH = BATCH_ARG ? Math.max(10, Number(BATCH_ARG.split("=")[1]) || 200) : 200;
const LOG_ARG = argv.find((a) => a.startsWith("--log="));
const LOG = LOG_ARG ? Math.max(0, Number(LOG_ARG.split("=")[1]) || 20) : 20;

const isNonEmpty = (v) => v != null && String(v).trim().length > 0;

const scoreDoc = (d) => {
  let s = 0;
  if (isNonEmpty(d.customerId)) s += 5;
  if (isNonEmpty(d.phone)) s += 4;
  if (isNonEmpty(d.email)) s += 3;
  if (isNonEmpty(d.name)) s += 2;
  if (isNonEmpty(d.firebaseUID)) s += 1;
  return s;
};

function pickKeepAndOthers(docs) {
  const sorted = [...docs].sort((a, b) => {
    const sa = scoreDoc(a);
    const sb = scoreDoc(b);
    if (sb !== sa) return sb - sa;
    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
  });
  return { keep: sorted[0], others: sorted.slice(1) };
}

function buildMergeUpdate(keep, others) {
  const set = {};
  const fill = (key) => {
    if (isNonEmpty(keep?.[key])) return;
    const found = others.find((x) => isNonEmpty(x?.[key]));
    if (found) set[key] = found[key];
  };

  fill("name");
  fill("email");
  fill("phone");
  fill("profileImage");
  fill("dateOfBirth");
  fill("gender");
  fill("ageGroup");
  fill("country");
  fill("state");
  fill("city");

  // preferences merge
  const catSet = new Set([...(keep?.preferences?.categories || []).map(String)]);
  for (const o of others) for (const c of o?.preferences?.categories || []) catSet.add(String(c));
  const mergedCategories = [...catSet].filter(Boolean);

  const brandSet = new Set([...(keep?.preferences?.favoriteBrands || [])].map((x) => String(x).trim()));
  for (const o of others) for (const b of o?.preferences?.favoriteBrands || []) brandSet.add(String(b).trim());
  const mergedBrands = [...brandSet].filter(Boolean);

  // cartAdds union
  const key = (x) =>
    `${String(x?.productCode || "").trim()}|${String(x?.size || "").trim()}|${String(x?.variantId || "")}`;
  const map = new Map();
  for (const a of keep?.cartAdds || []) map.set(key(a), a);
  for (const o of others) {
    for (const a of o?.cartAdds || []) {
      const k = key(a);
      if (!map.has(k)) map.set(k, a);
      else {
        const cur = map.get(k);
        const t1 = new Date(cur?.lastAddedAt || 0).getTime();
        const t2 = new Date(a?.lastAddedAt || 0).getTime();
        if (t2 > t1) map.set(k, { ...cur, lastAddedAt: a.lastAddedAt });
      }
    }
  }

  const update = { $set: {} };
  if (Object.keys(set).length) Object.assign(update.$set, set);

  // always write merged arrays (safe)
  update.$set["preferences.categories"] = mergedCategories
    .filter(Boolean)
    .map((id) => new mongoose.Types.ObjectId(id));
  update.$set["preferences.favoriteBrands"] = mergedBrands;
  update.$set.cartAdds = [...map.values()];

  return Object.keys(update.$set).length ? update : null;
}

async function countActiveFirebaseDuplicates() {
  const res = await Customer.aggregate([
    { $match: { firebaseUID: { $exists: true, $type: "string" }, isActive: true } },
    { $group: { _id: "$firebaseUID", c: { $sum: 1 } } },
    { $match: { c: { $gt: 1 } } },
    { $count: "activeDupCount" },
  ]).allowDiskUse(true);

  return res?.[0]?.activeDupCount || 0;
}

async function unsetActiveEmptyFirebaseUID() {
  // ✅ because older Mongo doesn't allow $ne:"" in partial index
  // We must ensure active docs don't have firebaseUID:""
  const q = { isActive: true, firebaseUID: "" };
  const count = await Customer.countDocuments(q);
  if (!count) return 0;

  if (!COMMIT) {
    console.log(`🧪 [DRY] Active docs with firebaseUID=="" : ${count} (would $unset firebaseUID)`);
    return count;
  }

  const res = await Customer.updateMany(q, { $unset: { firebaseUID: "" } });
  console.log(`🧹 Unset firebaseUID on active empty-string docs: ${res.modifiedCount || 0}`);
  return res.modifiedCount || 0;
}

async function ensureFirebaseUniqueIndex() {
  const coll = Customer.collection;

  // Drop old indexes if present
  const idx = await coll.indexes();
  const names = idx.map((i) => i.name);
  for (const name of ["uniq_firebaseUID_partial", "uniq_firebaseUID_active"]) {
    if (names.includes(name)) {
      console.log("🗑️ Dropping old index:", name);
      await coll.dropIndex(name);
    }
  }

  // ✅ Compatible partial filter (NO $ne:"")
  console.log("🧱 Creating unique partial index (only active string firebaseUID)...");
  await coll.createIndex(
    { firebaseUID: 1 },
    {
      unique: true,
      name: "uniq_firebaseUID_active",
      partialFilterExpression: {
        firebaseUID: { $exists: true, $type: "string" },
        isActive: true,
      },
    }
  );

  console.log("✅ Index ensured: uniq_firebaseUID_active");
}

async function main() {
  if (!MONGO_URI) {
    console.error("❌ MONGO_URI missing in .env");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI, { autoIndex: false });
  console.log(
    `✅ Connected | Mode: ${COMMIT ? "COMMIT" : "DRY-RUN"} | batch=${BATCH} | limit=${LIMIT || "∞"} | log=${LOG} | ${
      SOFT_DELETE ? "SOFT" : "HARD"
    }`
  );

  const basePipeline = [
    { $match: { firebaseUID: { $exists: true, $type: "string", $ne: "" } } }, // aggregation match is fine even if index can't use $ne
    { $group: { _id: "$firebaseUID", count: { $sum: 1 }, ids: { $push: "$_id" } } },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1, _id: 1 } },
  ];

  let page = 0;
  let printed = 0;

  let groups = 0;
  let totalExtraDocs = 0;
  let keepCount = 0;
  let mergeUpdateCount = 0;
  let removedCount = 0;

  while (true) {
    const pipeline = [...basePipeline, { $skip: page * BATCH }, { $limit: BATCH }];
    const batchGroups = await Customer.aggregate(pipeline).allowDiskUse(true);
    if (!batchGroups.length) break;

    for (const g of batchGroups) {
      groups += 1;
      if (LIMIT && groups > LIMIT) break;

      const docs = await Customer.find({ _id: { $in: g.ids } })
        .select(
          "_id customerId firebaseUID name email phone profileImage dateOfBirth gender ageGroup country state city preferences cartAdds isActive createdAt updatedAt"
        )
        .sort({ createdAt: 1 })
        .lean();

      if (docs.length <= 1) continue;

      const { keep, others } = pickKeepAndOthers(docs);
      const otherIds = others.map((x) => x._id);

      keepCount += 1;
      totalExtraDocs += docs.length - 1;

      if (!COMMIT && printed < LOG) {
        console.log(`\n[DRY] firebaseUID=${g._id} count=${docs.length}`);
        console.log(
          `  KEEP -> ${keep._id} | customerId=${keep.customerId || ""} | phone=${keep.phone || ""} | email=${keep.email || ""}`
        );
        for (const o of others) {
          console.log(
            `  DROP -> ${o._id} | customerId=${o.customerId || ""} | phone=${o.phone || ""} | email=${o.email || ""}`
          );
        }
        printed += 1;
      }

      if (!COMMIT) continue;

      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const upd = buildMergeUpdate(keep, others);
          if (upd) {
            await Customer.updateOne({ _id: keep._id }, upd, { session });
            mergeUpdateCount += 1;
          }

          if (SOFT_DELETE) {
            const res = await Customer.updateMany(
              { _id: { $in: otherIds } },
              { $set: { isActive: false } },
              { session }
            );
            removedCount += res.modifiedCount || 0;
          } else {
            const res = await Customer.deleteMany({ _id: { $in: otherIds } }, { session });
            removedCount += res.deletedCount || 0;
          }
        });
      } finally {
        await session.endSession();
      }
    }

    if (LIMIT && groups >= LIMIT) break;
    page += 1;
  }

  console.log("\n================ SUMMARY ================");
  console.log("Duplicate firebaseUID groups processed:", groups);
  console.log("Keep docs:", keepCount);
  console.log("Extra docs (to remove):", totalExtraDocs);

  if (!COMMIT) {
    console.log("DRY-RUN only (no changes).");
    console.log("Run commit like: node scripts/dedupeCustomersByFirebaseUID.js --commit --soft-delete");
    process.exit(0);
  }

  console.log("Merged keep docs:", mergeUpdateCount);
  console.log(SOFT_DELETE ? "Soft-deactivated docs:" : "Deleted docs:", removedCount);

  // ✅ Fix active firebaseUID == "" before index
  await unsetActiveEmptyFirebaseUID();

  // ✅ Check active duplicates (should be 0 now)
  const activeDup = await countActiveFirebaseDuplicates();
  console.log("Active duplicate firebaseUID remaining:", activeDup);

  // ✅ Create index (compatible)
  await ensureFirebaseUniqueIndex();

  console.log("✅ Done");
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
