import "dotenv/config";
import mongoose from "mongoose";
import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { fileURLToPath } from "url";

import Product from "../Products/Products.js";
import Media from "../cloudinary/Media.js";
import { cloudinary } from "../config/cloudinary.js";

const CLOUDINARY_HOSTS = [
  "res.cloudinary.com",
  "cloudinary.com",
];

const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split("=")[1]) : 0;

const isCloudinaryUrl = (url = "") => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return CLOUDINARY_HOSTS.some((h) => host.includes(h));
  } catch {
    return false;
  }
};

const isHttpUrl = (url = "") => /^https?:\/\//i.test(String(url || "").trim());

const getExtFromContentType = (contentType = "") => {
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("gif")) return ".gif";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return ".jpg";
  if (contentType.includes("mp4")) return ".mp4";
  if (contentType.includes("webm")) return ".webm";
  return ".jpg";
};

const downloadToTemp = async (url) => {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 OatclubImageMigrator/1.0",
    },
  });

  if (!res.ok) {
    throw new Error(`Download failed ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get("content-type") || "";
  const buffer = Buffer.from(await res.arrayBuffer());

  if (!buffer.length) {
    throw new Error("Downloaded empty file");
  }

  const ext = getExtFromContentType(contentType);
  const fileName = `oatclub-${crypto.randomUUID()}${ext}`;
  const tempPath = path.join(os.tmpdir(), fileName);

  await fs.writeFile(tempPath, buffer);

  return {
    tempPath,
    contentType,
    bytes: buffer.length,
  };
};

const uploadLocalFile = async ({ tempPath, product, oldUrl, field }) => {
  const safeCode = String(product.productCode || product._id).replace(/[^\w-]/g, "");
  const safeField = String(field || "image").replace(/[^\w-]/g, "");

  const result = await cloudinary.uploader.upload(tempPath, {
    folder: `oatclub/products/${safeCode}`,
    resource_type: "auto",
    public_id: `${safeField}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
    overwrite: false,
  });

  await Media.findOneAndUpdate(
    { publicId: result.public_id },
    {
      $setOnInsert: {
        url: result.secure_url,
        publicId: result.public_id,
        resourceType: result.resource_type || "image",
        format: result.format || "",
        bytes: result.bytes || 0,
        width: result.width || 0,
        height: result.height || 0,
        folder: result.folder || "",
        originalName:
          oldUrl.split("/").pop()?.split("?")[0] ||
          `${safeCode}-${safeField}`,
      },
    },
    { upsert: true, new: true }
  );

  return result.secure_url;
};

const migrateOneUrl = async ({ url, product, field }) => {
  if (!isHttpUrl(url)) return url;
  if (isCloudinaryUrl(url)) return url;

  let tempPath = "";

  try {
    const downloaded = await downloadToTemp(url);
    tempPath = downloaded.tempPath;

    const newUrl = await uploadLocalFile({
      tempPath,
      product,
      oldUrl: url,
      field,
    });

    return newUrl;
  } finally {
    if (tempPath) {
      await fs.unlink(tempPath).catch(() => {});
    }
  }
};

const main = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI missing in .env");
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ MongoDB connected");

  const query = {
    $or: [
      { images: { $elemMatch: { $regex: /^https?:\/\//i } } },
      { thumbnail: { $regex: /^https?:\/\//i } },
      { video: { $regex: /^https?:\/\//i } },
    ],
  };

  const products = await Product.find(query)
    .select("_id productCode title images thumbnail video")
    .limit(LIMIT > 0 ? LIMIT : 0);

  console.log(`🔎 Products found: ${products.length}`);
  console.log(`🧪 Dry run: ${DRY_RUN ? "YES" : "NO"}`);

  let updatedProducts = 0;
  let replacedUrls = 0;
  let failedUrls = 0;

  for (const product of products) {
    let changed = false;

    const nextImages = [];

    for (let i = 0; i < (product.images || []).length; i++) {
      const oldUrl = product.images[i];

      try {
        const newUrl = await migrateOneUrl({
          url: oldUrl,
          product,
          field: `image-${i + 1}`,
        });

        if (newUrl !== oldUrl) {
          changed = true;
          replacedUrls++;
          console.log(`✅ ${product.productCode} image ${i + 1}`);
        }

        nextImages.push(newUrl);
      } catch (err) {
        failedUrls++;
        nextImages.push(oldUrl);
        console.error(`❌ ${product.productCode} image ${i + 1}: ${err.message}`);
      }
    }

    let nextThumbnail = product.thumbnail || "";
    if (nextThumbnail) {
      try {
        const newUrl = await migrateOneUrl({
          url: nextThumbnail,
          product,
          field: "thumbnail",
        });

        if (newUrl !== nextThumbnail) {
          changed = true;
          replacedUrls++;
          nextThumbnail = newUrl;
          console.log(`✅ ${product.productCode} thumbnail`);
        }
      } catch (err) {
        failedUrls++;
        console.error(`❌ ${product.productCode} thumbnail: ${err.message}`);
      }
    }

    let nextVideo = product.video || "";
    if (nextVideo) {
      try {
        const newUrl = await migrateOneUrl({
          url: nextVideo,
          product,
          field: "video",
        });

        if (newUrl !== nextVideo) {
          changed = true;
          replacedUrls++;
          nextVideo = newUrl;
          console.log(`✅ ${product.productCode} video`);
        }
      } catch (err) {
        failedUrls++;
        console.error(`❌ ${product.productCode} video: ${err.message}`);
      }
    }

    if (changed && !DRY_RUN) {
      product.images = nextImages;
      product.thumbnail = nextThumbnail;
      product.video = nextVideo;
      await product.save();
      updatedProducts++;
    }

    if (changed && DRY_RUN) {
      updatedProducts++;
    }
  }

  console.log("\n====== DONE ======");
  console.log(`Updated products: ${updatedProducts}`);
  console.log(`Replaced URLs: ${replacedUrls}`);
  console.log(`Failed URLs: ${failedUrls}`);

  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error("❌ Migration failed:", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});