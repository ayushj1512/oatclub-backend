/* scripts/backfillCustomerPhones.js */
import "dotenv/config";
import mongoose from "mongoose";

// IMPORTANT: apne existing models ka path correct rakhna
import Customer from "../Customer/Customer.js";
import Address from "../Address/Address.js";

const MONGO_URI = (process.env.MONGO_URI || "").trim();

const normalizePhone = (p) => String(p || "").trim();

// ✅ treat empty OR masked as "missing"
const isMaskedPhone = (p) => {
  const s = normalizePhone(p);
  if (!s) return true; // empty / blank

  // ********** or **** (only stars)
  if (/^\*+$/.test(s)) return true;

  // optional: ******1234 (stars + last digits) => treat as missing
  if (/^\*+\d{2,4}$/.test(s)) return true;

  return false;
};

// ✅ usable phone must NOT be missing/masked
const isUsablePhone = (p) => !isMaskedPhone(p);

async function main() {
  if (!MONGO_URI) {
    console.error("❌ MONGO_URI missing in .env");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const DRY_RUN = !args.includes("--commit"); // default dry-run
  const LIMIT_ARG = args.find((a) => a.startsWith("--limit="));
  const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split("=")[1]) : 0;

  await mongoose.connect(MONGO_URI, { autoIndex: false });
  console.log(`✅ Connected. Mode: ${DRY_RUN ? "DRY-RUN" : "COMMIT"}`);

  // 1) find customers where phone missing/empty/masked
  const matchStage = {
    $or: [
      { phone: { $exists: false } },
      { phone: null },
      { phone: "" },
      { phone: /^\s+$/ },

      // ✅ masked variants
      { phone: /^\*+$/ },        // **********
      { phone: /^\*+\d{2,4}$/ }, // ******1234 (optional)
    ],
  };

  const pipeline = [
    { $match: matchStage },

    // 2) lookup addresses for that customer _id
    {
      $lookup: {
        from: Address.collection.name, // usually "addresses"
        let: { cid: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$customerId", "$$cid"] } } },

          // Prefer default shipping, then latest updatedAt, then createdAt
          {
            $sort: {
              isDefaultShipping: -1,
              updatedAt: -1,
              createdAt: -1,
            },
          },

          { $limit: 1 },
          { $project: { phone: 1, isDefaultShipping: 1, updatedAt: 1, createdAt: 1 } },
        ],
        as: "bestAddress",
      },
    },

    { $unwind: { path: "$bestAddress", preserveNullAndEmptyArrays: false } },

    // 3) only where address has a string phone (we'll validate in JS too)
    {
      $match: {
        "bestAddress.phone": { $type: "string" },
      },
    },

    {
      $project: {
        _id: 1,
        customerId: 1,
        email: 1,
        currentPhone: "$phone",
        newPhone: "$bestAddress.phone",
        addrIsDefaultShipping: "$bestAddress.isDefaultShipping",
        addrUpdatedAt: "$bestAddress.updatedAt",
      },
    },
  ];

  if (LIMIT && Number.isFinite(LIMIT) && LIMIT > 0) pipeline.push({ $limit: LIMIT });

  const candidates = await Customer.aggregate(pipeline).allowDiskUse(true);

  // ✅ clean + keep only usable address phones
  const cleaned = candidates
    .map((c) => ({ ...c, newPhone: normalizePhone(c.newPhone) }))
    .filter((c) => isUsablePhone(c.newPhone));

  const totalFound = cleaned.length;

  console.log(`\n🔎 Customers with missing/masked phone AND address phone available: ${totalFound}`);

  // show few samples
  const sample = cleaned.slice(0, 10);
  if (sample.length) {
    console.log("\n📌 Sample (up to 10):");
    for (const s of sample) {
      console.log(
        `- ${s.customerId || s._id} | ${s.email || "-"} | "${s.currentPhone || ""}" -> "${s.newPhone}" | defaultShip=${!!s.addrIsDefaultShipping}`
      );
    }
  }

  if (DRY_RUN) {
    console.log("\n✅ DRY-RUN done. No updates performed.");
    console.log('➡️ Commit run: node scripts/backfillCustomerPhones.js --commit');
    process.exit(0);
  }

  // 4) bulk update (only if phone still missing/masked at update time)
  const ops = cleaned.map((c) => ({
    updateOne: {
      filter: {
        _id: c._id,
        $or: [
          { phone: { $exists: false } },
          { phone: null },
          { phone: "" },
          { phone: /^\s+$/ },

          { phone: /^\*+$/ },
          { phone: /^\*+\d{2,4}$/ },
        ],
      },
      update: { $set: { phone: c.newPhone } },
    },
  }));

  if (!ops.length) {
    console.log("ℹ️ Nothing to update.");
    process.exit(0);
  }

  const res = await Customer.bulkWrite(ops, { ordered: false });
  console.log("\n✅ Update complete:");
  console.log(`- matched:  ${res.matchedCount}`);
  console.log(`- modified: ${res.modifiedCount}`);

  process.exit(0);
}

main().catch((e) => {
  console.error("❌ Error:", e?.message || e);
  process.exit(1);
});
