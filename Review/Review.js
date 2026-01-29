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
       CUSTOMER (REQUIRED)
    --------------------------------------------------------- */
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },

    /**
     * ✅ Store customer snapshot fields (denormalized)
     * (Name, email, phone/mobile at the time of review)
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
       RATING (1–5)
    --------------------------------------------------------- */
    rating: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
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
    images: [
      {
        type: String,
        default: "",
      },
    ],

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
    helpfulCount: {
      type: Number,
      default: 0,
    },

    reportedCount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

/* ---------------------------------------------------------
   UNIQUE REVIEW RULE:
   A customer should review a product only once
--------------------------------------------------------- */
reviewSchema.index({ product: 1, customer: 1 }, { unique: true });

/* ---------------------------------------------------------
   HOOKS: auto-fill snapshots if only ObjectIds provided
   (requires Product + Customer models to exist)
--------------------------------------------------------- */
reviewSchema.pre("validate", async function (next) {
  try {
    // Fill productCode from Product if missing
    if (!this.productCode && this.product) {
      const Product = mongoose.model("Product");
      const p = await Product.findById(this.product).select("productCode").lean();
      if (p?.productCode) this.productCode = p.productCode;
    }

    // Fill customer snapshot fields from Customer if missing
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
