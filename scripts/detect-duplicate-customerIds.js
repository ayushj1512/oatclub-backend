/* scripts/detect-duplicates-by-firebase.js */
import "dotenv/config";
import mongoose from "mongoose";

// ✅ apna correct path
import Customer from "../Customer/Customer.js";

const MONGO_URI = (process.env.MONGO_URI || "").trim();

const isFirebaseMatch = {
  firebaseUID: { $exists: true, $type: "string", $ne: "" },
};

async function main() {
  if (!MONGO_URI) {
    console.error("❌ MONGO_URI missing in .env");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI, { autoIndex: false });
  console.log("✅ Connected");

  /* -------------------------------------------
     A) Duplicate firebaseUID (same firebase id in multiple docs)
  -------------------------------------------- */
  const dupFirebase = await Customer.aggregate([
    { $match: isFirebaseMatch },
    {
      $group: {
        _id: "$firebaseUID",
        count: { $sum: 1 },
        customers: {
          $push: {
            _id: "$_id",
            customerId: "$customerId",
            email: "$email",
            phone: "$phone",
            name: "$name",
            createdAt: "$createdAt",
          },
        },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1, _id: 1 } },
  ]);

  console.log("\n==============================");
  console.log("A) DUPLICATE firebaseUID GROUPS");
  console.log("==============================");
  if (!dupFirebase.length) console.log("✅ No duplicate firebaseUID found.");
  else {
    console.log(`⚠️ Found ${dupFirebase.length} duplicate firebaseUID groups.\n`);
    for (const g of dupFirebase) {
      console.log(`🔁 firebaseUID: ${g._id} (count: ${g.count})`);
      for (const c of g.customers.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))) {
        console.log(
          "   -",
          JSON.stringify({
            _id: String(c._id),
            customerId: c.customerId,
            email: c.email,
            phone: c.phone,
            name: c.name,
            createdAt: c.createdAt,
          })
        );
      }
      console.log("");
    }
  }

  /* -------------------------------------------
     B) Duplicate customerId + show firebaseUIDs (trace via firebase)
  -------------------------------------------- */
  const dupCustomerId = await Customer.aggregate([
    {
      $match: {
        customerId: { $exists: true, $type: "string", $ne: "" },
      },
    },
    {
      $group: {
        _id: "$customerId",
        count: { $sum: 1 },
        customers: {
          $push: {
            _id: "$_id",
            firebaseUID: "$firebaseUID",
            email: "$email",
            phone: "$phone",
            name: "$name",
            createdAt: "$createdAt",
          },
        },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1, _id: 1 } },
  ]);

  console.log("\n==============================");
  console.log("B) DUPLICATE customerId GROUPS (with firebaseUID)");
  console.log("==============================");
  if (!dupCustomerId.length) console.log("✅ No duplicate customerId found.");
  else {
    console.log(`⚠️ Found ${dupCustomerId.length} duplicate customerId groups.\n`);
    for (const g of dupCustomerId) {
      console.log(`🔁 customerId: ${g._id} (count: ${g.count})`);
      for (const c of g.customers.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))) {
        console.log(
          "   -",
          JSON.stringify({
            _id: String(c._id),
            firebaseUID: c.firebaseUID || "",
            email: c.email,
            phone: c.phone,
            name: c.name,
            createdAt: c.createdAt,
          })
        );
      }
      console.log("");
    }
  }

  /* -------------------------------------------
     C) Same firebaseUID mapped to multiple customerIds (identity split)
  -------------------------------------------- */
  const firebaseToManyCustomerIds = await Customer.aggregate([
    { $match: isFirebaseMatch },
    {
      $group: {
        _id: "$firebaseUID",
        customerIds: { $addToSet: "$customerId" },
        count: { $sum: 1 },
      },
    },
    {
      $addFields: {
        customerIdCount: { $size: "$customerIds" },
      },
    },
    { $match: { customerIdCount: { $gt: 1 } } },
    { $sort: { customerIdCount: -1, _id: 1 } },
  ]);

  console.log("\n==============================");
  console.log("C) firebaseUID -> MULTIPLE customerIds");
  console.log("==============================");
  if (!firebaseToManyCustomerIds.length) console.log("✅ No firebaseUID mapped to multiple customerIds.");
  else {
    console.log(`⚠️ Found ${firebaseToManyCustomerIds.length} firebaseUIDs mapped to multiple customerIds.\n`);
    for (const g of firebaseToManyCustomerIds) {
      console.log(
        `🔀 firebaseUID: ${g._id} | customerIds: ${JSON.stringify(
          (g.customerIds || []).filter(Boolean)
        )} | docs: ${g.count}`
      );
    }
  }

  // Optional JSON output
  const fs = await import("fs");
  const path = await import("path");
  const outPath = path.resolve(process.cwd(), "firebase-duplicate-report.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        dupFirebaseUIDGroups: dupFirebase,
        dupCustomerIdGroups: dupCustomerId,
        firebaseUIDToManyCustomerIds: firebaseToManyCustomerIds,
      },
      null,
      2
    )
  );
  console.log(`\n📝 Saved report -> ${outPath}`);

  process.exit(0);
}

main().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
