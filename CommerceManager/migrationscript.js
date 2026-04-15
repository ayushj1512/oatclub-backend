import mongoose from "mongoose";
import dotenv from "dotenv";
import CommerceManager from "./CommerceManager.js";

dotenv.config();

/* -----------------------------
   CONNECT DB
----------------------------- */
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ DB connected");
  } catch (err) {
    console.error("❌ DB connection failed:", err.message);
    process.exit(1);
  }
};

/* -----------------------------
   NORMALIZE TO 5 DIGITS
----------------------------- */
const normalizeTo5 = (code) => {
  const raw = String(code ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

  if (!raw) return "";

  if (/^\d+$/.test(raw)) {
    return String(Number(raw)).padStart(5, "0");
  }

  return raw;
};

/* -----------------------------
   DRY RUN
----------------------------- */
const dryRun = async () => {
  const doc = await CommerceManager.getSingleton();

  const oldCodes = doc.selectedProductCodes || [];
  const newCodes = [
    ...new Set(oldCodes.map(normalizeTo5).filter(Boolean)),
  ];

  console.log("\n🔍 DRY RUN RESULT\n");

  console.log("Total Old Codes:", oldCodes.length);
  console.log("Total New Codes:", newCodes.length);

  console.log("\nSample Changes:");
  oldCodes.slice(0, 20).forEach((code, i) => {
    console.log(`${code}  →  ${normalizeTo5(code)}`);
  });

  console.log("\n⚠️ No data was modified (dry run)");
};

/* -----------------------------
   ACTUAL MIGRATION
----------------------------- */
const runMigration = async () => {
  const doc = await CommerceManager.getSingleton();

  const oldCodes = doc.selectedProductCodes || [];
  const newCodes = [
    ...new Set(oldCodes.map(normalizeTo5).filter(Boolean)),
  ];

  doc.selectedProductCodes = newCodes;
  doc.lastUpdatedAt = new Date();
  doc.lastUpdatedBy = "migration-script";

  await doc.save();

  console.log("\n🚀 MIGRATION COMPLETED\n");
  console.log("Old Count:", oldCodes.length);
  console.log("New Count:", newCodes.length);
};

/* -----------------------------
   EXECUTION
----------------------------- */
const main = async () => {
  await connectDB();

  const mode = process.argv[2]; // dry / run

  if (mode === "dry") {
    await dryRun();
  } else if (mode === "run") {
    await runMigration();
  } else {
    console.log("\n❌ Invalid command");
    console.log("Use:");
    console.log("node migrationscript.js dry");
    console.log("node migrationscript.js run");
  }

  process.exit();
};

main();