import mongoose from "mongoose";

const { Schema } = mongoose;

/* =========================================================
   CONSTANTS
========================================================= */

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
const COUNTER_KEY = "oatclub-global-barcode-counter";
const SERIAL_PADDING = 8;
const MAX_BATCH_SIZE = 5000;

/* =========================================================
   NORMALIZERS
========================================================= */

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeProductId(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeSize(value) {
  return normalizeText(value).toUpperCase();
}

function normalizePrice(value) {
  const price = Number(value);

  if (!Number.isFinite(price)) {
    throw new Error("price must be a valid number");
  }

  if (price < 0) {
    throw new Error("price must be greater than or equal to 0");
  }

  return price;
}

function normalizeQuantity(value) {
  const quantity = Number(value);

  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error("quantity must be a positive integer");
  }

  if (quantity > MAX_BATCH_SIZE) {
    throw new Error(
      `Maximum ${MAX_BATCH_SIZE} barcodes can be generated at once`
    );
  }

  return quantity;
}

/* =========================================================
   SERIAL HELPERS
========================================================= */

function formatSerialNumber(serialNumber) {
  const serial = Number(serialNumber);

  if (!Number.isSafeInteger(serial) || serial <= 0) {
    throw new Error("serialNumber must be a positive integer");
  }

  return String(serial).padStart(SERIAL_PADDING, "0");
}

/* =========================================================
   COUNTER MODEL
========================================================= */

const BarcodeCounterSchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    sequence: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

BarcodeCounterSchema.index({ key: 1 }, { unique: true });

const BarcodeCounter =
  mongoose.models.BarcodeCounter ||
  mongoose.model("BarcodeCounter", BarcodeCounterSchema);

/**
 * Generates one globally unique serial number.
 *
 * MongoDB $inc is atomic, so simultaneous requests
 * cannot receive the same serial number.
 */
async function getNextSerialNumber() {
  const counter = await BarcodeCounter.findOneAndUpdate(
    {
      key: COUNTER_KEY,
    },
    {
      $inc: {
        sequence: 1,
      },
      $setOnInsert: {
        key: COUNTER_KEY,
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  ).lean();

  if (!counter?.sequence) {
    throw new Error("Unable to generate barcode serial number");
  }

  return counter.sequence;
}

/**
 * Atomically reserves a range of serial numbers.
 *
 * Example:
 * Current sequence: 100
 * Requested quantity: 5
 * Returned: [101, 102, 103, 104, 105]
 */
async function getNextSerialNumbers(quantity = 1) {
  const count = normalizeQuantity(quantity);

  const counter = await BarcodeCounter.findOneAndUpdate(
    {
      key: COUNTER_KEY,
    },
    {
      $inc: {
        sequence: count,
      },
      $setOnInsert: {
        key: COUNTER_KEY,
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  ).lean();

  if (!counter?.sequence) {
    throw new Error("Unable to generate barcode serial numbers");
  }

  const endSerial = counter.sequence;
  const startSerial = endSerial - count + 1;

  return Array.from(
    {
      length: count,
    },
    (_, index) => startSerial + index
  );
}

/* =========================================================
   BARCODE HELPERS
========================================================= */

/**
 * Barcode format:
 *
 * OATCLUB-productId-size-price-serial
 *
 * Example:
 * OATCLUB-1081-XS-1499-00000001
 */
function makeBarcode({
  productId,
  size,
  price,
  serialNumber,
}) {
  const pid = normalizeProductId(productId);
  const normalizedSize = normalizeSize(size);
  const normalizedPrice = normalizePrice(price);
  const serialCode = formatSerialNumber(serialNumber);

  if (!pid) {
    throw new Error("productId is required");
  }

  if (!normalizedSize) {
    throw new Error("size is required");
  }

  if (pid.includes("-")) {
    throw new Error("productId must not contain '-'");
  }

  if (normalizedSize.includes("-")) {
    throw new Error("size must not contain '-'");
  }

  if (!ALLOWED_SIZES.includes(normalizedSize)) {
    throw new Error(
      `size must be one of: ${ALLOWED_SIZES.join(", ")}`
    );
  }

  return [
    BRAND,
    pid,
    normalizedSize,
    normalizedPrice,
    serialCode,
  ].join("-");
}

/**
 * Parses:
 *
 * OATCLUB-1081-XS-1499-00000001
 */
function parseBarcode(barcode) {
  const text = normalizeText(barcode).toUpperCase();
  const parts = text.split("-");

  if (parts.length !== 5) {
    throw new Error(
      `Invalid barcode format. Expected ${BRAND}-productId-size-price-serial`
    );
  }

  const [
    brand,
    productId,
    size,
    priceText,
    serialText,
  ] = parts;

  if (brand !== BRAND) {
    throw new Error(
      `Invalid brand prefix. Expected ${BRAND}`
    );
  }

  if (!productId) {
    throw new Error("productId is missing in barcode");
  }

  if (!ALLOWED_SIZES.includes(size)) {
    throw new Error(
      `Invalid size. Expected one of: ${ALLOWED_SIZES.join(", ")}`
    );
  }

  if (!/^\d+$/.test(serialText)) {
    throw new Error("Serial number in barcode is invalid");
  }

  const price = Number(priceText);
  const serialNumber = Number(serialText);

  if (!Number.isFinite(price) || price < 0) {
    throw new Error("Price in barcode is not a valid number");
  }

  if (
    !Number.isSafeInteger(serialNumber) ||
    serialNumber <= 0
  ) {
    throw new Error("Serial number in barcode is invalid");
  }

  return {
    brand,
    productId,
    size,
    price,
    serialNumber,
    serialCode: formatSerialNumber(serialNumber),
    barcode: text,
  };
}

/* =========================================================
   BARCODE ITEM SCHEMA
========================================================= */

const BarcodeItemSchema = new Schema(
  {
    /**
     * Global numeric serial:
     *
     * 1
     * 2
     * 3
     */
    serialNumber: {
      type: Number,
      required: true,
      unique: true,
      immutable: true,
      min: 1,
    },

    /**
     * Display-friendly serial:
     *
     * 00000001
     * 00000002
     */
    serialCode: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
    },

    productId: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
      validate: {
        validator: (value) =>
          !String(value).includes("-"),
        message: "productId must not contain '-'",
      },
    },

    size: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      enum: ALLOWED_SIZES,
      index: true,
    },

    price: {
      type: Number,
      required: true,
      min: 0,
    },

    /**
     * Example:
     *
     * OATCLUB-1081-XS-1499-00000001
     */
    barcode: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      uppercase: true,
      trim: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

/* =========================================================
   DOCUMENT MIDDLEWARE
========================================================= */

/**
 * Automatically generates a global serial number and barcode
 * whenever BarcodeItem.create() or document.save() is used.
 */
BarcodeItemSchema.pre("validate", async function () {
  this.productId = normalizeProductId(this.productId);
  this.size = normalizeSize(this.size);
  this.price = normalizePrice(this.price);

  if (!this.isNew) {
    return;
  }

  if (!this.serialNumber) {
    this.serialNumber = await getNextSerialNumber();
  }

  this.serialCode = formatSerialNumber(
    this.serialNumber
  );

  this.barcode = makeBarcode({
    productId: this.productId,
    size: this.size,
    price: this.price,
    serialNumber: this.serialNumber,
  });
});

/* =========================================================
   STATIC METHODS
========================================================= */

/**
 * Parses a scanned barcode.
 *
 * BarcodeItem.fromScannedBarcode(
 *   "OATCLUB-1081-XS-1499-00000001"
 * );
 */
BarcodeItemSchema.statics.fromScannedBarcode = function (
  barcodeText
) {
  return parseBarcode(barcodeText);
};

/**
 * Finds an existing physical item by scanned barcode.
 */
BarcodeItemSchema.statics.findByScannedBarcode = function (
  barcodeText
) {
  const parsed = parseBarcode(barcodeText);

  return this.findOne({
    barcode: parsed.barcode,
  });
};

/**
 * Creates multiple physical pieces of the same variant.
 *
 * Example:
 *
 * await BarcodeItem.createBatch({
 *   productId: "1081",
 *   size: "XS",
 *   price: 1499,
 *   quantity: 50
 * });
 */
BarcodeItemSchema.statics.createBatch = async function ({
  productId,
  size,
  price,
  quantity,
}) {
  const count = normalizeQuantity(quantity);
  const pid = normalizeProductId(productId);
  const normalizedSize = normalizeSize(size);
  const normalizedPrice = normalizePrice(price);

  if (!pid) {
    throw new Error("productId is required");
  }

  if (pid.includes("-")) {
    throw new Error("productId must not contain '-'");
  }

  if (!ALLOWED_SIZES.includes(normalizedSize)) {
    throw new Error(
      `size must be one of: ${ALLOWED_SIZES.join(", ")}`
    );
  }

  const serialNumbers =
    await getNextSerialNumbers(count);

  const documents = serialNumbers.map(
    (serialNumber) => {
      const serialCode =
        formatSerialNumber(serialNumber);

      return {
        serialNumber,
        serialCode,
        productId: pid,
        size: normalizedSize,
        price: normalizedPrice,
        barcode: makeBarcode({
          productId: pid,
          size: normalizedSize,
          price: normalizedPrice,
          serialNumber,
        }),
      };
    }
  );

  /*
   * insertMany does not run document pre-save middleware.
   * Therefore serial and barcode are generated above.
   */
  return this.insertMany(documents, {
    ordered: true,
  });
};

/* =========================================================
   INDEXES
========================================================= */

BarcodeItemSchema.index(
  {
    serialNumber: 1,
  },
  {
    unique: true,
  }
);

BarcodeItemSchema.index(
  {
    serialCode: 1,
  },
  {
    unique: true,
  }
);

BarcodeItemSchema.index(
  {
    barcode: 1,
  },
  {
    unique: true,
  }
);

/**
 * Not unique because the same product variant can have
 * multiple individual physical pieces.
 */
BarcodeItemSchema.index({
  productId: 1,
  size: 1,
  price: 1,
});

BarcodeItemSchema.index({
  createdAt: -1,
  serialNumber: -1,
});

/* =========================================================
   MODEL
========================================================= */

const BarcodeItem =
  mongoose.models.BarcodeItem ||
  mongoose.model(
    "BarcodeItem",
    BarcodeItemSchema
  );

export {
  BarcodeItem,
  BarcodeCounter,
  makeBarcode,
  parseBarcode,
  formatSerialNumber,
  getNextSerialNumber,
  getNextSerialNumbers,
  ALLOWED_SIZES,
};