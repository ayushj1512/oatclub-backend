import mongoose from "mongoose";
import Counter from "../models/Counter.js";

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

const INVENTORY_STATUSES = [
  "available",
  "reserved",
  "allocated",
  "packed",
  "shipped",
  "delivered",
  "returned",
  "damaged",
  "lost",
  "removed",
];

const INVENTORY_SOURCES = [
  "production",
  "vendor",
  "return",
  "manual",
  "opening-stock",
  "other",
];

const COUNTER_NAME = "barcode-item";
const MAX_BATCH_SIZE = 5000;

/* =========================================================
   NORMALIZERS
========================================================= */

function normalizeText(value = "") {
  return String(value ?? "").trim();
}

function normalizeUppercase(value = "") {
  return normalizeText(value).toUpperCase();
}

function normalizeProductCode(value = "") {
  const productCode = normalizeUppercase(value);

  if (!productCode) {
    throw new Error("productCode is required");
  }

  if (productCode.includes("-")) {
    throw new Error("productCode must not contain '-'");
  }

  return productCode;
}

function normalizeSize(value = "") {
  const size = normalizeUppercase(value);

  if (!size) {
    throw new Error("size is required");
  }

  if (!ALLOWED_SIZES.includes(size)) {
    throw new Error(
      `size must be one of: ${ALLOWED_SIZES.join(", ")}`
    );
  }

  return size;
}

function normalizeQuantity(value = 1) {
  const quantity = Number(value);

  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error("quantity must be a positive integer");
  }

  if (quantity > MAX_BATCH_SIZE) {
    throw new Error(
      `Maximum ${MAX_BATCH_SIZE} barcode items can be created at once`
    );
  }

  return quantity;
}

function normalizeOptionalNumber(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    throw new Error(
      "Snapshot value must be a valid number greater than or equal to 0"
    );
  }

  return number;
}

/* =========================================================
   UNIQUE ID HELPERS
========================================================= */

function formatUniqueId(sequence) {
  const number = Number(sequence);

  if (
    !Number.isSafeInteger(number) ||
    number <= 0
  ) {
    throw new Error(
      "sequence must be a positive integer"
    );
  }

  return String(number);
}

async function getNextBarcodeSequence() {
  const counter = await Counter.findOneAndUpdate(
    {
      name: COUNTER_NAME,
    },
    {
      $inc: {
        seq: 1,
      },
      $setOnInsert: {
        name: COUNTER_NAME,
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  ).lean();

  if (
    !counter ||
    !Number.isSafeInteger(counter.seq) ||
    counter.seq <= 0
  ) {
    throw new Error(
      "Unable to generate barcode unique ID"
    );
  }

  return counter.seq;
}

async function getNextBarcodeSequences(quantity = 1) {
  const count = normalizeQuantity(quantity);

  const counter = await Counter.findOneAndUpdate(
    {
      name: COUNTER_NAME,
    },
    {
      $inc: {
        seq: count,
      },
      $setOnInsert: {
        name: COUNTER_NAME,
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  ).lean();

  if (
    !counter ||
    !Number.isSafeInteger(counter.seq) ||
    counter.seq <= 0
  ) {
    throw new Error(
      "Unable to generate barcode unique IDs"
    );
  }

  const endSequence = counter.seq;
  const startSequence =
    endSequence - count + 1;

  return Array.from(
    {
      length: count,
    },
    (_, index) => startSequence + index
  );
}

/* =========================================================
   SKU / BARCODE HELPERS
========================================================= */

/**
 * Variant SKU:
 *
 * 00034-M
 */
function makeVariantSku({ productCode, size }) {
  return `${normalizeProductCode(
    productCode
  )}-${normalizeSize(size)}`;
}

/**
 * Physical piece barcode:
 *
 * 00034-M-00000029
 */
function makePieceSku({
  productCode,
  size,
  sequence,
  uniqueId,
}) {
  const variantSku = makeVariantSku({
    productCode,
    size,
  });

  const numericUniqueId = Number(
    uniqueId ?? sequence
  );

  if (
    !Number.isSafeInteger(numericUniqueId) ||
    numericUniqueId <= 0
  ) {
    throw new Error(
      "uniqueId must be a positive integer"
    );
  }

  return `${variantSku}-${numericUniqueId}`;
}

/**
 * Parses:
 *
 * 00034-M-00000029
 */
function parseBarcode(barcodeText) {
  const barcode =
    normalizeUppercase(barcodeText);

  const parts = barcode.split("-");

  if (parts.length !== 3) {
    throw new Error(
      "Invalid barcode format. Expected productCode-size-uniqueId"
    );
  }

  const [
    productCode,
    size,
    uniqueIdText,
  ] = parts;

  const normalizedProductCode =
    normalizeProductCode(productCode);

  const normalizedSize =
    normalizeSize(size);

  if (!/^\d+$/.test(uniqueIdText)) {
    throw new Error(
      "Barcode uniqueId must contain digits only"
    );
  }

  const sequence =
    Number(uniqueIdText);

  if (
    !Number.isSafeInteger(sequence) ||
    sequence <= 0
  ) {
    throw new Error(
      "Barcode uniqueId must be a positive integer"
    );
  }

  const uniqueId = String(sequence);

  const variantSku = makeVariantSku({
    productCode:
      normalizedProductCode,
    size: normalizedSize,
  });

  const pieceSku = makePieceSku({
    productCode:
      normalizedProductCode,
    size: normalizedSize,
    uniqueId,
  });

  return {
    productCode:
      normalizedProductCode,
    size: normalizedSize,
    sequence,
    uniqueId,
    variantSku,
    pieceSku,
    barcode: pieceSku,
  };
}

/* =========================================================
   ASSIGNMENT HISTORY
========================================================= */

const assignmentHistorySchema = new Schema(
  {
    order: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },

    orderNumber: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
      index: true,
    },

    action: {
      type: String,
      required: true,
      enum: [
        "reserved",
        "allocated",
        "packed",
        "shipped",
        "delivered",
        "released",
        "returned",
        "damaged",
        "lost",
      ],
    },

    note: {
      type: String,
      trim: true,
      default: "",
    },

    performedBy: {
      type: Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },

    performedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: true,
    timestamps: false,
  }
);

/* =========================================================
   BARCODE ITEM SCHEMA
========================================================= */

const barcodeItemSchema = new Schema(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      default: null,
      index: true,
    },

    variantId: {
      type: Schema.Types.ObjectId,
      default: null,
      index: true,
    },

    productCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      immutable: true,
      index: true,
      validate: {
        validator(value) {
          return (
            Boolean(value) &&
            !String(value).includes("-")
          );
        },
        message:
          "productCode is required and must not contain '-'",
      },
    },

    size: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      immutable: true,
      enum: ALLOWED_SIZES,
      index: true,
    },

    variantSku: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      immutable: true,
      index: true,
    },

    sequence: {
      type: Number,
      required: true,
      unique: true,
      immutable: true,
      min: 1,
    },

    uniqueId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
      index: true,
      validate: {
        validator(value) {
          return /^\d+$/.test(
            String(value || "")
          );
        },
        message:
          "uniqueId must contain digits only",
      },
    },

    pieceSku: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      immutable: true,
      index: true,
    },

    barcode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      immutable: true,
      index: true,
    },

    priceSnapshot: {
      type: Number,
      min: 0,
      default: null,
    },

    mrpSnapshot: {
      type: Number,
      min: 0,
      default: null,
    },

    status: {
      type: String,
      enum: INVENTORY_STATUSES,
      default: "available",
      index: true,
    },

    assignedOrder: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      default: null,
      index: true,
    },

    assignedOrderNumber: {
      type: String,
      uppercase: true,
      trim: true,
      default: "",
      index: true,
    },

    assignedAt: {
      type: Date,
      default: null,
    },

    packedAt: {
      type: Date,
      default: null,
    },

    shippedAt: {
      type: Date,
      default: null,
    },

    deliveredAt: {
      type: Date,
      default: null,
    },

    assignmentHistory: {
      type: [assignmentHistorySchema],
      default: [],
    },

    inwardBatchCode: {
      type: String,
      uppercase: true,
      trim: true,
      default: "",
      index: true,
    },

    inwardAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    vendor: {
      type: Schema.Types.ObjectId,
      ref: "VendorUser",
      default: null,
      index: true,
    },

    source: {
      type: String,
      enum: INVENTORY_SOURCES,
      default: "production",
      index: true,
    },

    notes: {
      type: String,
      trim: true,
      default: "",
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

barcodeItemSchema.pre(
  "validate",
  async function () {
    this.productCode =
      normalizeProductCode(this.productCode);

    this.size = normalizeSize(this.size);

    this.priceSnapshot =
      normalizeOptionalNumber(
        this.priceSnapshot
      );

    this.mrpSnapshot =
      normalizeOptionalNumber(
        this.mrpSnapshot
      );

    if (!this.isNew) {
      return;
    }

    if (!this.sequence) {
      this.sequence =
        await getNextBarcodeSequence();
    }

    this.uniqueId =
      formatUniqueId(this.sequence);

    this.variantSku = makeVariantSku({
      productCode: this.productCode,
      size: this.size,
    });

    this.pieceSku = makePieceSku({
      productCode: this.productCode,
      size: this.size,
      uniqueId: this.uniqueId,
    });

    this.barcode = this.pieceSku;
  }
);

/* =========================================================
   INSTANCE METHODS
========================================================= */

barcodeItemSchema.methods.assignToOrder =
  async function ({
    orderId = null,
    orderNumber,
    status = "allocated",
    performedBy = null,
    note = "",
  }) {
    const normalizedOrderNumber =
      normalizeUppercase(orderNumber);

    if (!normalizedOrderNumber) {
      throw new Error(
        "orderNumber is required"
      );
    }

    if (
      !["reserved", "allocated"].includes(
        status
      )
    ) {
      throw new Error(
        "Assignment status must be reserved or allocated"
      );
    }

    if (
      this.assignedOrderNumber &&
      this.assignedOrderNumber !==
        normalizedOrderNumber
    ) {
      throw new Error(
        `Piece ${this.pieceSku} is already assigned to ${this.assignedOrderNumber}`
      );
    }

    if (
      [
        "packed",
        "shipped",
        "delivered",
        "damaged",
        "lost",
        "removed",
      ].includes(this.status)
    ) {
      throw new Error(
        `Piece cannot be assigned while status is ${this.status}`
      );
    }

    this.assignedOrder = orderId || null;
    this.assignedOrderNumber =
      normalizedOrderNumber;
    this.assignedAt =
      this.assignedAt || new Date();
    this.status = status;

    this.assignmentHistory.push({
      order: orderId || null,
      orderNumber: normalizedOrderNumber,
      action: status,
      note,
      performedBy,
      performedAt: new Date(),
    });

    return this.save();
  };

barcodeItemSchema.methods.releaseFromOrder =
  async function ({
    performedBy = null,
    note = "",
  } = {}) {
    if (!this.assignedOrderNumber) {
      return this;
    }

    if (
      ["shipped", "delivered"].includes(
        this.status
      )
    ) {
      throw new Error(
        `Cannot release a piece with status ${this.status}`
      );
    }

    const previousOrder =
      this.assignedOrder;

    const previousOrderNumber =
      this.assignedOrderNumber;

    this.assignmentHistory.push({
      order: previousOrder,
      orderNumber: previousOrderNumber,
      action: "released",
      note,
      performedBy,
      performedAt: new Date(),
    });

    this.assignedOrder = null;
    this.assignedOrderNumber = "";
    this.assignedAt = null;
    this.packedAt = null;
    this.status = "available";

    return this.save();
  };

/* =========================================================
   STATIC METHODS
========================================================= */

barcodeItemSchema.statics.parseScan =
  function (barcodeText) {
    return parseBarcode(barcodeText);
  };

barcodeItemSchema.statics.findByScan =
  function (barcodeText) {
    const parsed =
      parseBarcode(barcodeText);

    return this.findOne({
      barcode: parsed.barcode,
    });
  };

barcodeItemSchema.statics.createBatch =
  async function ({
    product = null,
    variantId = null,
    productCode,
    size,
    quantity,
    priceSnapshot = null,
    mrpSnapshot = null,
    inwardBatchCode = "",
    vendor = null,
    source = "production",
    notes = "",
  }) {
    const count =
      normalizeQuantity(quantity);

    const normalizedProductCode =
      normalizeProductCode(productCode);

    const normalizedSize =
      normalizeSize(size);

    const normalizedPrice =
      normalizeOptionalNumber(
        priceSnapshot
      );

    const normalizedMrp =
      normalizeOptionalNumber(
        mrpSnapshot
      );

    const normalizedSource =
      normalizeText(source).toLowerCase();

    if (
      !INVENTORY_SOURCES.includes(
        normalizedSource
      )
    ) {
      throw new Error(
        `source must be one of: ${INVENTORY_SOURCES.join(
          ", "
        )}`
      );
    }

    const variantSku = makeVariantSku({
      productCode: normalizedProductCode,
      size: normalizedSize,
    });

    const sequences =
      await getNextBarcodeSequences(count);

    const now = new Date();

    const documents = sequences.map(
      (sequence) => {
        const uniqueId =
          formatUniqueId(sequence);

        const pieceSku = makePieceSku({
          productCode:
            normalizedProductCode,
          size: normalizedSize,
          uniqueId,
        });

        return {
          product,
          variantId,
          productCode:
            normalizedProductCode,
          size: normalizedSize,
          variantSku,
          sequence,
          uniqueId,
          pieceSku,
          barcode: pieceSku,
          priceSnapshot:
            normalizedPrice,
          mrpSnapshot: normalizedMrp,
          status: "available",
          assignedOrder: null,
          assignedOrderNumber: "",
          assignmentHistory: [],
          inwardBatchCode:
            normalizeUppercase(
              inwardBatchCode
            ),
          inwardAt: now,
          vendor,
          source: normalizedSource,
          notes: normalizeText(notes),
        };
      }
    );

    return this.insertMany(documents, {
      ordered: true,
    });
  };

/* =========================================================
   INDEXES
========================================================= */

barcodeItemSchema.index({
  productCode: 1,
  size: 1,
  status: 1,
  inwardAt: 1,
  sequence: 1,
});

barcodeItemSchema.index({
  assignedOrderNumber: 1,
  status: 1,
});

barcodeItemSchema.index({
  assignedOrder: 1,
  status: 1,
});

barcodeItemSchema.index({
  variantSku: 1,
  status: 1,
});

barcodeItemSchema.index({
  product: 1,
  variantId: 1,
  status: 1,
});

barcodeItemSchema.index({
  inwardBatchCode: 1,
  createdAt: -1,
});

/* =========================================================
   MODEL
========================================================= */

const BarcodeItem =
  mongoose.models.BarcodeItem ||
  mongoose.model(
    "BarcodeItem",
    barcodeItemSchema
  );

export {
  BarcodeItem,
  ALLOWED_SIZES,
  INVENTORY_STATUSES,
  INVENTORY_SOURCES,
  MAX_BATCH_SIZE,
  formatUniqueId,
  makeVariantSku,
  makePieceSku,
  parseBarcode,
  getNextBarcodeSequence,
  getNextBarcodeSequences,
};

export default BarcodeItem;