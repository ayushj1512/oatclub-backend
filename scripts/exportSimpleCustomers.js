import "dotenv/config";
import dns from "dns";
import mongoose from "mongoose";
import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";

// ✅ DNS Fix
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const OUT_DIR = path.join(process.cwd(), "exports");

const OUT_FILE = path.join(
  OUT_DIR,
  `simple-customers-${new Date().toISOString().slice(0, 10)}.xlsx`
);

const cleanPhone = (phone = "") =>
  String(phone).replace(/\D/g, "").slice(-10);

const connectDB = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI missing in .env");
  }

  console.log("🔎 Process: DNS SRV Lookup Resolution");
  console.log("🌐 DNS Servers:", dns.getServers());

  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 30000,
    connectTimeoutMS: 30000,
    socketTimeoutMS: 45000,
  });

  console.log("✅ MongoDB connected");
};

const main = async () => {
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    await connectDB();

    const customers = await mongoose.connection
      .collection("customers")
      .find(
        {},
        {
          projection: {
            customerId: 1,
            name: 1,
            email: 1,
            phone: 1,
            city: 1,
            state: 1,
            createdAt: 1,
          },
        }
      )
      .toArray();

    console.log(`👥 Customers Found: ${customers.length}`);

    // ✅ remove duplicates
    const uniqueMap = new Map();

    for (const c of customers) {
      const email = String(c.email || "")
        .trim()
        .toLowerCase();

      const phone = cleanPhone(c.phone);

      // skip empty
      if (!email && !phone) continue;

      const key = email || phone;

      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, {
          customerId: c.customerId || "",
          name: c.name || "",
          email,
          phone,
          city: c.city || "",
          state: c.state || "",
          joinedAt: c.createdAt || "",
        });
      }
    }

    const rows = [...uniqueMap.values()];

    console.log(`✅ Unique Customers: ${rows.length}`);

    const workbook = new ExcelJS.Workbook();

    workbook.creator = "Miray Fashions";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Customers");

    sheet.columns = [
      { header: "Customer ID", key: "customerId", width: 16 },
      { header: "Name", key: "name", width: 28 },
      { header: "Email", key: "email", width: 34 },
      { header: "Phone", key: "phone", width: 18 },
      { header: "City", key: "city", width: 20 },
      { header: "State", key: "state", width: 20 },
      { header: "Joined At", key: "joinedAt", width: 24 },
    ];

    // ✅ Description Row
    sheet.insertRow(1, [
      "Basic customer export containing name, email, phone and location details for marketing/CRM usage.",
    ]);

    sheet.mergeCells("A1:G1");

    sheet.getCell("A1").font = {
      bold: true,
      size: 12,
    };

    sheet.getCell("A1").alignment = {
      wrapText: true,
      vertical: "middle",
    };

    sheet.getRow(1).height = 32;

    sheet.addRows(rows);

    // ✅ Freeze header
    sheet.views = [{ state: "frozen", ySplit: 2 }];

    // ✅ Header Style
    const header = sheet.getRow(2);

    header.font = {
      bold: true,
      color: { argb: "FFFFFFFF" },
    };

    header.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF111827" },
    };

    // ✅ Borders
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.alignment = {
          vertical: "middle",
          wrapText: true,
        };

        cell.border = {
          top: { style: "thin", color: { argb: "FFE5E7EB" } },
          left: { style: "thin", color: { argb: "FFE5E7EB" } },
          bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
          right: { style: "thin", color: { argb: "FFE5E7EB" } },
        };
      });
    });

    await workbook.xlsx.writeFile(OUT_FILE);

    console.log("✅ Excel Exported:");
    console.log(OUT_FILE);

    await mongoose.disconnect();

    console.log("🔌 MongoDB disconnected");
  } catch (error) {
    console.error("❌ Export failed:", error);

    await mongoose.disconnect().catch(() => {});

    process.exit(1);
  }
};

main();