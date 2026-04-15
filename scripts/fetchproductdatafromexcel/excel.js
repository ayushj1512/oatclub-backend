import fs from "fs";
import path from "path";
import axios from "axios";
import ExcelJS from "exceljs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_CSV = path.join(
  __dirname,
  "miraydb.products 14th april 2026.csv"
);
const OUTPUT_XLSX = path.join(
  __dirname,
  "miray_products_with_images.xlsx"
);

const normalizeCode = (value) => {
  if (value == null) return "";
  let raw = String(value).trim();
  if (raw.endsWith(".0")) raw = raw.slice(0, -2);
  raw = raw.replace(/\s+/g, "").toUpperCase();
  if (!raw) return "";
  if (/^\d+$/.test(raw)) return raw.padStart(5, "0");
  return raw;
};

const parseCsvLine = (line) => {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out;
};

const parseCsv = (csvText) => {
  const lines = csvText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim());

  if (!lines.length) return [];

  const headers = parseCsvLine(lines[0]).map((h) => h.trim());

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};

    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });

    return row;
  });
};

const toNumber = (value) => {
  if (value == null || value === "") return "";
  const num = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(num) ? num : "";
};

const getImageBuffer = async (url) => {
  if (!url || typeof url !== "string" || !url.startsWith("http")) return null;

  try {
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 15000,
      maxRedirects: 5,
    });

    const contentType = String(res.headers["content-type"] || "").toLowerCase();

    let extension = "png";
    if (contentType.includes("jpeg") || contentType.includes("jpg")) {
      extension = "jpeg";
    } else if (contentType.includes("png")) {
      extension = "png";
    } else if (contentType.includes("webp")) {
      extension = "png";
    }

    return {
      buffer: Buffer.from(res.data),
      extension,
    };
  } catch (error) {
    console.log(`Image fetch failed: ${url}`);
    return null;
  }
};

const main = async () => {
  if (!fs.existsSync(INPUT_CSV)) {
    throw new Error(`CSV not found at: ${INPUT_CSV}`);
  }

  const csvText = fs.readFileSync(INPUT_CSV, "utf8");
  const rows = parseCsv(csvText);

  if (!rows.length) {
    throw new Error("CSV is empty.");
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Products");

  sheet.columns = [
    { header: "Image", key: "image", width: 18 },
    { header: "Product Code", key: "productCode", width: 14 },
    { header: "Product Title", key: "title", width: 42 },
    { header: "Price", key: "price", width: 12 },
    { header: "Compare At Price", key: "compareAtPrice", width: 16 },
  ];

  sheet.getRow(1).height = 22;
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

  let excelRow = 2;

  for (const item of rows) {
    const imageUrl = item["images[0]"] || "";
    const productCode = normalizeCode(item.productCode);
    const title = item.title || "";
    const price = toNumber(item.price);
    const compareAtPrice = toNumber(item.compareAtPrice);

    sheet.addRow({
      image: "",
      productCode,
      title,
      price,
      compareAtPrice,
    });

    sheet.getRow(excelRow).height = 78;
    sheet.getCell(`B${excelRow}`).alignment = { vertical: "middle" };
    sheet.getCell(`C${excelRow}`).alignment = {
      vertical: "middle",
      wrapText: true,
    };
    sheet.getCell(`D${excelRow}`).alignment = { vertical: "middle" };
    sheet.getCell(`E${excelRow}`).alignment = { vertical: "middle" };

    const img = await getImageBuffer(imageUrl);

    if (img?.buffer) {
      try {
        const imageId = workbook.addImage({
          buffer: img.buffer,
          extension: img.extension === "webp" ? "png" : img.extension,
        });

        sheet.addImage(imageId, {
          tl: { col: 0.2, row: excelRow - 1 + 0.15 },
          ext: { width: 72, height: 72 },
        });
      } catch (error) {
        console.log(`Image embed failed for row ${excelRow}`);
      }
    }

    excelRow++;
  }

  sheet.getColumn("D").numFmt = "0";
  sheet.getColumn("E").numFmt = "0";
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  await workbook.xlsx.writeFile(OUTPUT_XLSX);

  console.log(`Done: ${OUTPUT_XLSX}`);
};

main().catch((error) => {
  console.error("Export failed:", error.message);
  process.exit(1);
});