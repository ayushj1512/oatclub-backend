import mongoose from "mongoose";
import xlsx from "xlsx";
import dotenv from "dotenv";

import NewsletterSubscription from "../../Newsletter/NewsletterSubscription.js";

dotenv.config();

/* ---------------- HELPERS ---------------- */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeEmail = (email) => String(email || "").toLowerCase().trim();
const isValidEmail = (email) => EMAIL_REGEX.test(email);

/* ---------------- MAIN SCRIPT ---------------- */

const seedSubscribersFromExcel = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB Connected");

    const filePath = "scripts/newsletter/file.xlsx";

    /* ✅ LOAD EXCEL */
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const rows = xlsx.utils.sheet_to_json(sheet);

    console.log(`📦 Loaded ${rows.length} rows from Excel`);

    if (!rows.length) {
      console.log("❌ Excel is empty.");
      process.exit(0);
    }

    // ✅ Excel column confirmed: customer_email
    let totalEmailsFound = 0;
    let failedEmails = [];
    let validEmailsSet = new Set();

    rows.forEach((row, index) => {
      const rawEmail =
        row.customer_email || // ✅ YOUR COLUMN
        row.email ||
        row.Email ||
        row.EMAIL;

      if (!rawEmail) {
        failedEmails.push({
          row: index + 1,
          reason: "Missing email field",
        });
        return;
      }

      totalEmailsFound++;

      const email = normalizeEmail(rawEmail);

      if (!isValidEmail(email)) {
        failedEmails.push({
          row: index + 1,
          email,
          reason: "Invalid email format",
        });
        return;
      }

      validEmailsSet.add(email);
    });

    const validEmails = [...validEmailsSet];

    const duplicatesIgnored = Math.max(
      totalEmailsFound - failedEmails.length - validEmails.length,
      0
    );

    console.log(`✅ Total emails found: ${totalEmailsFound}`);
    console.log(`✅ Valid unique emails: ${validEmails.length}`);
    console.log(`❌ Failed emails: ${failedEmails.length}`);
    console.log(`⚠️ Duplicates ignored: ${duplicatesIgnored}`);

    if (!validEmails.length) {
      console.log("❌ No valid emails to upload.");
      process.exit(0);
    }

    const now = new Date();

    /* ✅ BULK UPSERT */
    const ops = validEmails.map((email) => ({
      updateOne: {
        filter: { email },
        update: {
          $setOnInsert: {
            subscribedAt: now,
            source: "import",
          },
          $set: {
            isActive: true,
            unsubscribedAt: null,
          },
        },
        upsert: true,
      },
    }));

    const result = await NewsletterSubscription.bulkWrite(ops, {
      ordered: false,
    });

    const inserted = result.upsertedCount || 0;
    const updated = result.modifiedCount || 0;

    console.log("\n🎉 IMPORT COMPLETE!");
    console.log("📊 SUMMARY REPORT:");
    console.log({
      totalRows: rows.length,
      totalEmailsFound,
      validUniqueEmails: validEmails.length,
      inserted,
      updated,
      failed: failedEmails.length,
      duplicatesIgnored,
    });

    /* ✅ SHOW FAILED ROWS (first 20 only) */
    if (failedEmails.length) {
      console.log("\n❌ FAILED ROWS (first 20):");
      failedEmails.slice(0, 20).forEach((f) =>
        console.log(`Row ${f.row}: ${f.email || "N/A"} → ${f.reason}`)
      );

      if (failedEmails.length > 20) {
        console.log(`...and ${failedEmails.length - 20} more`);
      }
    }

    process.exit(0);
  } catch (err) {
    console.error("❌ Seed script failed:", err);
    process.exit(1);
  }
};

seedSubscribersFromExcel();
