// Review.js
import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
  {
    /* ---------------------------------------------------------
      PRODUCT (REQUIRED)
    --------------------------------------------------------- */
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },

    /**
     * ✅ Store productCode snapshot (denormalized)
     * Helps you query reviews by productCode without extra populate.
     */
    productCode: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    /* ---------------------------------------------------------
      CUSTOMER (OPTIONAL now)
      - Admin can add reviews without linking to Customer
      - If customer exists, keep snapshots + unique rule
    --------------------------------------------------------- */
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: false,
      index: true,
      default: null,
    },

    /**
     * ✅ Store customer snapshot fields (denormalized)
     * (Name, email, phone/mobile at the time of review)
     * - Admin can type these manually even if customer is null
     */
    customerName: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },

    customerEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
      index: true,
    },

    customerPhone: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },

    /* ---------------------------------------------------------
      PRODUCT RATING (OPTIONAL)
      - If someone only wants to rate the product without text
      - Allows empty title/reviewText, but rating is still required
    --------------------------------------------------------- */
    rating: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
      index: true,
    },

    /* ---------------------------------------------------------
      OPTIONAL TITLE OF REVIEW
    --------------------------------------------------------- */
    title: {
      type: String,
      trim: true,
      maxlength: 100,
      default: "",
    },

    /* ---------------------------------------------------------
      LONG/TEXT REVIEW
    --------------------------------------------------------- */
    reviewText: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },

    /* ---------------------------------------------------------
      IMAGES (CLOUDINARY URLS)
    --------------------------------------------------------- */
    images: [{ type: String, default: "" }],

    /* ---------------------------------------------------------
      VERIFIED PURCHASE TAG
    --------------------------------------------------------- */
    verifiedPurchase: {
      type: Boolean,
      default: false,
    },

    /* ---------------------------------------------------------
      STATUS
    --------------------------------------------------------- */
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "approved",
      index: true,
    },

    /* ---------------------------------------------------------
      ANALYTICS
    --------------------------------------------------------- */
    helpfulCount: { type: Number, default: 0 },
    reportedCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

/* ---------------------------------------------------------
  UNIQUE REVIEW RULE (UPDATED):
  A customer should review a product only once
  ✅ but only enforce when customer exists
--------------------------------------------------------- */
reviewSchema.index(
  { product: 1, customer: 1 },
  {
    unique: true,
    partialFilterExpression: { customer: { $type: "objectId" } },
  }
);

/* ---------------------------------------------------------
  OPTIONAL QUALITY RULE:
  If user is only rating, allow empty title/reviewText.
  But if they provided text, enforce minimum length (optional).
--------------------------------------------------------- */
reviewSchema.pre("validate", function (next) {
  try {
    const title = String(this.title || "").trim();
    const text = String(this.reviewText || "").trim();

    // ✅ rating-only is allowed (no title/text needed)
    // If you want to enforce minimum when text exists:
    if (text && text.length < 3) {
      return next(new Error("Review text is too short"));
    }
    if (title && title.length < 2) {
      return next(new Error("Title is too short"));
    }

    next();
  } catch (e) {
    next(e);
  }
});

/* ---------------------------------------------------------
  HOOKS: auto-fill snapshots if only ObjectIds provided
--------------------------------------------------------- */
reviewSchema.pre("validate", async function (next) {
  try {
    // Fill productCode from Product if missing
    if (!this.productCode && this.product) {
      const Product = mongoose.model("Product");
      const p = await Product.findById(this.product).select("productCode").lean();
      if (p?.productCode) this.productCode = p.productCode;
    }

    // Fill customer snapshot fields from Customer if missing AND customer provided
    if (
      this.customer &&
      (!this.customerName || !this.customerEmail || !this.customerPhone)
    ) {
      const Customer = mongoose.model("Customer");
      const c = await Customer.findById(this.customer)
        .select("name email phone")
        .lean();

      if (!this.customerName && c?.name) this.customerName = c.name;
      if (!this.customerEmail && c?.email) this.customerEmail = c.email;
      if (!this.customerPhone && c?.phone) this.customerPhone = c.phone;
    }

    next();
  } catch (e) {
    next(e);
  }
});

export default mongoose.models.Review || mongoose.model("Review", reviewSchema);
