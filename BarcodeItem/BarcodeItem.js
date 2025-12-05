import mongoose from "mongoose";

const { Schema } = mongoose;

const ALLOWED_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL", "FREE"];

function makeBarcode({ productId, size, price }) {
  const pid = String(productId ?? "").trim();
  const sz = String(size ?? "").trim().toUpperCase();
  const pr = String(price ?? "").trim();

  if (!pid) throw new Error("productId is required");
  if (!sz) throw new Error("size is required");
  if (!pr) throw new Error("price is required");

  if (pid.includes("-")) throw new Error("productId must not contain '-'");
  if (sz.includes("-")) throw new Error("size must not contain '-'");
  if (pr.includes("-")) throw new Error("price must not contain '-'");

  return `MIRAY-${pid}-${sz}-${pr}`;
}

function parseBarcode(barcode) {
  const text = String(barcode ?? "").trim();
  const parts = text.split("-");
  if (parts.length !== 4) throw new Error("Invalid barcode format (expected MIRAY-productId-size-price)");
  const [brand, productId, size, price] = parts;
  if (brand !== "MIRAY") throw new Error("Invalid brand prefix (expected MIRAY)");
  return { brand, productId, size, price };
}

const BarcodeItemSchema = new Schema(
  {
    brand: {
      type: String,
      default: "MIRAY",
      enum: ["MIRAY"],
      immutable: true,
      required: true
    },

    productId: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: (v) => !String(v).includes("-"),
        message: "productId must not contain '-'"
      }
    },

    size: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      enum: ALLOWED_SIZES
    },

    price: {
      type: Number,
      required: true,
      min: 0
    },

    barcode: {
      type: String,
      unique: true,
      index: true,
      required: true
    }
  },
  { timestamps: true }
);

// Generate barcode from fields, always consistent
BarcodeItemSchema.pre("validate", function (next) {
  try {
    this.brand = "MIRAY";
    this.barcode = makeBarcode({
      productId: this.productId,
      size: this.size,
      price: this.price
    });
    next();
  } catch (e) {
    next(e);
  }
});

// Build doc data from scanned barcode text
BarcodeItemSchema.statics.fromScannedBarcode = function (barcodeText) {
  const { productId, size, price } = parseBarcode(barcodeText);
  const numPrice = Number(price);
  if (!Number.isFinite(numPrice)) throw new Error("Price in barcode is not a number");
  return { productId, size, price: numPrice, barcode: barcodeText, brand: "MIRAY" };
};

export const BarcodeItem =
  mongoose.models.BarcodeItem || mongoose.model("BarcodeItem", BarcodeItemSchema);

export { makeBarcode, parseBarcode, ALLOWED_SIZES };
