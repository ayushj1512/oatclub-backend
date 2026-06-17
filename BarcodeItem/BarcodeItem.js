import mongoose from "mongoose";

const { Schema } = mongoose;

const ALLOWED_SIZES = [
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "XXL",
  "3XL",
  "4XL",
  "5XL",
  "FREE",
];

const BRAND = "OATCLUB";

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

  return `${BRAND}-${pid}-${sz}-${pr}`;
}

function parseBarcode(barcode) {
  const text = String(barcode ?? "").trim();
  const parts = text.split("-");

  if (parts.length !== 4) {
    throw new Error(`Invalid barcode format. Expected ${BRAND}-productId-size-price`);
  }

  const [brand, productId, size, price] = parts;

  if (brand !== BRAND) {
    throw new Error(`Invalid brand prefix. Expected ${BRAND}`);
  }

  return {
    productId,
    size: String(size).toUpperCase(),
    price: Number(price),
  };
}

const BarcodeItemSchema = new Schema(
  {
    productId: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: (v) => !String(v).includes("-"),
        message: "productId must not contain '-'",
      },
    },

    size: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      enum: ALLOWED_SIZES,
    },

    price: {
      type: Number,
      required: true,
      min: 0,
    },

    barcode: {
      type: String,
      unique: true,
      index: true,
      required: true,
    },
  },
  { timestamps: true }
);

BarcodeItemSchema.pre("validate", function (next) {
  try {
    this.barcode = makeBarcode({
      productId: this.productId,
      size: this.size,
      price: this.price,
    });

    next();
  } catch (err) {
    next(err);
  }
});

BarcodeItemSchema.statics.fromScannedBarcode = function (barcodeText) {
  const parsed = parseBarcode(barcodeText);

  if (!Number.isFinite(parsed.price)) {
    throw new Error("Price in barcode is not a valid number");
  }

  return {
    productId: parsed.productId,
    size: parsed.size,
    price: parsed.price,
    barcode: barcodeText,
  };
};

BarcodeItemSchema.index({ productId: 1, size: 1, price: 1 }, { unique: true });

export const BarcodeItem =
  mongoose.models.BarcodeItem ||
  mongoose.model("BarcodeItem", BarcodeItemSchema);

export { makeBarcode, parseBarcode, ALLOWED_SIZES };