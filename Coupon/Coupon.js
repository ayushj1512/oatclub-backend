import mongoose from "mongoose";
import Counter from "../models/Counter.js";

const normalizeEmail = (v) => (v ? String(v).trim().toLowerCase() : null);

const normalizePhone = (v) => {
  if (!v) return null;
  const digits = String(v).replace(/\D/g, "");
  return digits.length ? digits : null;
};

const singleCartRuleSchema = new mongoose.Schema(
  {
    ruleType: {
      type: String,
      enum: [
        "primary_required",
        "secondary_required",
        "category_required",
        "collection_required",
      ],
      required: true,
    },

    categories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category",
      },
    ],

    collections: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Collection",
      },
    ],

    matchMode: {
      type: String,
      enum: ["any", "all"],
      default: "any",
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
);

const couponSchema = new mongoose.Schema(
  {
    couponNumber: {
      type: String,
      unique: true,
      sparse: true,
    },

    code: {
      type: String,
      required: [true, "Coupon code is required"],
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },

    type: {
      type: String,
      enum: ["general", "influencer", "system", "company"],
      default: "general",
      required: true,
      index: true,
    },

    visibility: {
      type: String,
      enum: ["public", "private"],
      default: "public",
      required: true,
      index: true,
    },

    description: { type: String, trim: true, default: "" },

    autoApply: {
      type: Boolean,
      default: false,
      index: true,
    },

    discountType: {
      type: String,
      enum: ["percentage", "flat"],
      required: [true, "Discount type is required"],
    },

    discountValue: {
      type: Number,
      required: [true, "Discount value is required"],
      min: [0, "Discount cannot be negative"],
    },

    minPurchase: {
      type: Number,
      default: 0,
      min: [0, "Minimum purchase cannot be negative"],
    },

    maxDiscount: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * ✅ NEW: multiple cart rules
     *
     * Example Budget Bees:
     * cartRules: [
     *   { ruleType: "primary_required" },
     *   { ruleType: "collection_required", collections: ["BUDGET_BEES_ID"] }
     * ]
     */
    cartRules: {
      type: [singleCartRuleSchema],
      default: [],
    },

    /**
     * ✅ Discount target after all rules pass
     *
     * cart                => whole cart
     * primary_products    => primary products only
     * secondary_products  => secondary products only
     * category_products   => selected category products
     * collection_products => selected collection products
     * matched_products    => category OR collection matched products
     */
    discountTarget: {
      type: String,
      enum: [
        "cart",
        "primary_products",
        "secondary_products",
        "category_products",
        "collection_products",
        "matched_products",
      ],
      default: "cart",
      index: true,
    },

    applyToAllEligibleItems: {
      type: Boolean,
      default: true,
    },

    /**
     * ✅ Keep global targeting also for easy admin filters.
     * These can be auto-filled from cartRules or manually set.
     */
    categories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category",
        index: true,
      },
    ],

    collections: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Collection",
        index: true,
      },
    ],

    /**
     * ✅ OLD FIELD kept for backward compatibility only.
     * New code should use cartRules + discountTarget.
     */
    cartRule: {
      enabled: { type: Boolean, default: false },
      ruleType: {
        type: String,
        enum: ["none", "primary_secondary", "category_collection"],
        default: "none",
      },
      requiresPrimaryProduct: { type: Boolean, default: false },
      requiresSecondaryProduct: { type: Boolean, default: false },
      discountTarget: {
        type: String,
        enum: [
          "cart",
          "primary_products",
          "secondary_products",
          "category_products",
          "collection_products",
          "matched_products",
        ],
        default: "cart",
      },
      matchMode: {
        type: String,
        enum: ["any", "all"],
        default: "any",
      },
      applyToAllEligibleItems: { type: Boolean, default: true },
    },

    influencerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
      index: true,
    },

    issuedBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },

    validFrom: {
      type: Date,
      default: Date.now,
    },

    validTill: {
      type: Date,
      required: [true, "Coupon expiry date is required"],
      index: true,
    },

    usageLimit: {
      type: Number,
      default: 0,
      min: 0,
    },

    usedCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    usageLimitPerCustomer: {
      type: Number,
      default: 1,
      min: 0,
    },

    usedBy: [{ type: String, trim: true, lowercase: true }],

    targetEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
      index: true,
    },

    targetPhone: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

/* ------------------------------------------------------------------
HELPERS
------------------------------------------------------------------- */

function uniqueIds(arr = []) {
  return [
    ...new Set(
      arr
        .filter(Boolean)
        .map((id) => String(id?._id || id))
        .filter(Boolean)
    ),
  ];
}

function syncCartRules(doc) {
  const rules = Array.isArray(doc.cartRules) ? doc.cartRules : [];

  // ✅ collect categories/collections from rules for fast filtering
  const ruleCategories = [];
  const ruleCollections = [];

  for (const rule of rules) {
    if (!rule?.isActive) continue;

    if (Array.isArray(rule.categories)) {
      ruleCategories.push(...rule.categories);
    }

    if (Array.isArray(rule.collections)) {
      ruleCollections.push(...rule.collections);
    }
  }

  const existingCategories = Array.isArray(doc.categories) ? doc.categories : [];
  const existingCollections = Array.isArray(doc.collections)
    ? doc.collections
    : [];

  doc.categories = uniqueIds([...existingCategories, ...ruleCategories]);
  doc.collections = uniqueIds([...existingCollections, ...ruleCollections]);

  // ✅ Backward compatibility: convert old cartRule into new cartRules if needed
  if ((!rules || rules.length === 0) && doc.cartRule?.enabled) {
    if (doc.cartRule.ruleType === "primary_secondary") {
      doc.cartRules = [
        { ruleType: "primary_required", isActive: true },
        { ruleType: "secondary_required", isActive: true },
      ];
      doc.discountTarget = "secondary_products";
      doc.applyToAllEligibleItems = true;
    }

    if (doc.cartRule.ruleType === "category_collection") {
      const nextRules = [];

      if (doc.categories?.length) {
        nextRules.push({
          ruleType: "category_required",
          categories: doc.categories,
          matchMode: doc.cartRule.matchMode || "any",
          isActive: true,
        });
      }

      if (doc.collections?.length) {
        nextRules.push({
          ruleType: "collection_required",
          collections: doc.collections,
          matchMode: doc.cartRule.matchMode || "any",
          isActive: true,
        });
      }

      doc.cartRules = nextRules;
      doc.discountTarget =
        doc.cartRule.discountTarget === "cart"
          ? "matched_products"
          : doc.cartRule.discountTarget || "matched_products";
      doc.applyToAllEligibleItems = true;
    }
  }
}

function syncCoupon(doc) {
  if (doc.validTill) {
    doc.isActive = new Date(doc.validTill) >= new Date();
  }

  if (doc.targetEmail !== undefined) {
    doc.targetEmail = normalizeEmail(doc.targetEmail);
  }

  if (doc.targetPhone !== undefined) {
    doc.targetPhone = normalizePhone(doc.targetPhone);
  }

  if (doc.code) {
    doc.code = String(doc.code).trim().toUpperCase();
  }

  syncCartRules(doc);
}

function normalizeUpdate(update = {}) {
  const set = update.$set || update;

  if (set.validTill) {
    set.isActive = new Date(set.validTill) >= new Date();
  }

  if (set.targetEmail !== undefined) {
    set.targetEmail = set.targetEmail ? normalizeEmail(set.targetEmail) : null;
  }

  if (set.targetPhone !== undefined) {
    set.targetPhone = set.targetPhone ? normalizePhone(set.targetPhone) : null;
  }

  if (set.code) {
    set.code = String(set.code).trim().toUpperCase();
  }

  if (Array.isArray(set.cartRules)) {
    const ruleCategories = [];
    const ruleCollections = [];

    for (const rule of set.cartRules) {
      if (Array.isArray(rule.categories)) {
        ruleCategories.push(...rule.categories);
      }

      if (Array.isArray(rule.collections)) {
        ruleCollections.push(...rule.collections);
      }
    }

    set.categories = uniqueIds([...(set.categories || []), ...ruleCategories]);
    set.collections = uniqueIds([
      ...(set.collections || []),
      ...ruleCollections,
    ]);
  }

  if (update.$set) update.$set = set;
  else Object.assign(update, set);

  return update;
}

/* ------------------------------------------------------------------
HOOKS
------------------------------------------------------------------- */

couponSchema.pre("validate", async function (next) {
  try {
    if (!this.couponNumber) {
      const counter = await Counter.findOneAndUpdate(
        { name: "coupon" },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      this.couponNumber = String(counter.seq).padStart(3, "0");
    }

    next();
  } catch (error) {
    next(error);
  }
});

couponSchema.pre("save", function (next) {
  syncCoupon(this);
  next();
});

couponSchema.pre(["findOneAndUpdate", "updateOne", "updateMany"], function (next) {
  const update = normalizeUpdate(this.getUpdate() || {});
  this.setUpdate(update);
  next();
});

/* ------------------------------------------------------------------
INDEXES
------------------------------------------------------------------- */

couponSchema.index({ couponNumber: 1 }, { unique: true, sparse: true });
couponSchema.index({ code: 1, isActive: 1 });
couponSchema.index({ isActive: 1, validTill: 1 });
couponSchema.index({ visibility: 1, isActive: 1, validTill: 1 });
couponSchema.index({ autoApply: 1, isActive: 1, validTill: 1 });
couponSchema.index({ categories: 1, isActive: 1 });
couponSchema.index({ collections: 1, isActive: 1 });
couponSchema.index({ "cartRules.ruleType": 1 });
couponSchema.index({ "cartRules.collections": 1 });
couponSchema.index({ "cartRules.categories": 1 });
couponSchema.index({ discountTarget: 1 });
couponSchema.index({ code: 1, targetEmail: 1, isActive: 1 });
couponSchema.index({ code: 1, targetPhone: 1, isActive: 1 });

export default mongoose.models.Coupon ||
  mongoose.model("Coupon", couponSchema);