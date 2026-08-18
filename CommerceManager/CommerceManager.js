import mongoose from "mongoose";

const normalizeCode = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

const normalizeSlug = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");

const CommerceManagerSchema = new mongoose.Schema(
  {
    /**
     * Human-readable set name.
     *
     * Examples:
     * - Default Feed
     * - August Dresses
     * - Trending Tops
     */
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },

    /**
     * Public XML feed identifier.
     *
     * Example:
     * /api/commerce-manager/xml/august-dresses
     */
    slug: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
      set: normalizeSlug,
    },

    platform: {
      type: String,
      enum: ["meta", "google"],
      default: "meta",
      index: true,
    },

    /**
     * Base product codes only.
     *
     * Store:
     * APP-00046
     *
     * Do not store:
     * APP-00046-XS
     * APP-00046-S
     */
    selectedProductCodes: {
      type: [String],
      default: [],
      set: (arr) => {
        if (!Array.isArray(arr)) return [];

        return [
          ...new Set(
            arr
              .map(normalizeCode)
              .filter(Boolean),
          ),
        ];
      },
    },

    /**
     * Disabled feeds should not generate XML.
     */
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    /**
     * Keeps backward compatibility with the old singleton feed.
     *
     * Only one document should have isDefault: true.
     */
    isDefault: {
      type: Boolean,
      default: false,
      index: true,
    },

    notes: {
      type: String,
      trim: true,
      default: "",
      maxlength: 1000,
    },

    /**
     * Feed-level configuration.
     */
    feedSettings: {
      title: {
        type: String,
        trim: true,
        default: "",
        maxlength: 200,
      },

      description: {
        type: String,
        trim: true,
        default: "",
        maxlength: 1000,
      },

      forceInStock: {
        type: Boolean,
        default: true,
      },

      forcedInventory: {
        type: Number,
        default: 999999,
        min: 0,
      },

      includeOutOfStock: {
        type: Boolean,
        default: false,
      },

      includeInactiveProducts: {
        type: Boolean,
        default: false,
      },

      includeAdditionalImages: {
        type: Boolean,
        default: true,
      },

      maxAdditionalImages: {
        type: Number,
        default: 10,
        min: 0,
        max: 10,
      },

      customLabel0: {
        type: String,
        trim: true,
        default: "",
      },

      customLabel1: {
        type: String,
        trim: true,
        default: "",
      },
    },

    lastUpdatedAt: {
      type: Date,
      default: Date.now,
    },

    lastUpdatedBy: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
  },
);

/**
 * Helpful indexes for admin searching.
 */
CommerceManagerSchema.index({
  name: "text",
  slug: "text",
  selectedProductCodes: "text",
});

/**
 * Prevent multiple default feeds.
 *
 * The partial index only applies where isDefault is true.
 */
CommerceManagerSchema.index(
  { isDefault: 1 },
  {
    unique: true,
    partialFilterExpression: {
      isDefault: true,
    },
  },
);

/**
 * Normalize fields before validation.
 */
CommerceManagerSchema.pre("validate", function (next) {
  if (!this.name?.trim()) {
    this.name = "Default Feed";
  }

  if (!this.slug?.trim()) {
    this.slug = normalizeSlug(this.name);
  }

  if (!this.slug) {
    this.slug = `feed-${Date.now()}`;
  }

  this.selectedProductCodes = Array.isArray(this.selectedProductCodes)
    ? [
      ...new Set(
        this.selectedProductCodes
          .map(normalizeCode)
          .filter(Boolean),
      ),
    ]
    : [];

  next();
});

/**
 * Automatically update audit timestamp.
 */
CommerceManagerSchema.pre("save", function (next) {
  if (this.isModified()) {
    this.lastUpdatedAt = new Date();
  }

  next();
});

/**
 * Update audit timestamp for query-based updates.
 */
CommerceManagerSchema.pre(
  ["findOneAndUpdate", "updateOne", "updateMany"],
  function (next) {
    const update = this.getUpdate() || {};

    if (!update.$set) {
      update.$set = {};
    }

    update.$set.lastUpdatedAt = new Date();

    this.setUpdate(update);

    next();
  },
);

CommerceManagerSchema.methods.touch = function (updatedBy = "") {
  this.lastUpdatedAt = new Date();

  if (updatedBy) {
    this.lastUpdatedBy = String(updatedBy).trim();
  }

  return this;
};

/**
 * Public XML URL path.
 */
CommerceManagerSchema.virtual("xmlPath").get(function () {
  return `/api/commerce-manager/xml/${this.slug}`;
});

/**
 * Backward-compatible default feed getter.
 *
 * Existing code using getSingleton() will continue working.
 */
CommerceManagerSchema.statics.getSingleton = async function () {
  let doc = await this.findOne({
    $or: [
      { isDefault: true },
      { slug: "default" },
      { name: "default" },
    ],
  }).sort({
    isDefault: -1,
    createdAt: 1,
  });

  if (!doc) {
    doc = await this.create({
      name: "Default Feed",
      slug: "default",
      selectedProductCodes: [],
      isActive: true,
      isDefault: true,
      notes: "",
      feedSettings: {
        title: "OATCLUB Commerce Manager Feed",
        description:
          "Selected products feed for Meta Commerce Manager.",
        forceInStock: true,
        forcedInventory: 999999,
        includeOutOfStock: false,
        includeInactiveProducts: false,
        includeAdditionalImages: true,
        maxAdditionalImages: 10,
      },
    });

    return doc;
  }

  let changed = false;

  if (!doc.slug) {
    doc.slug = "default";
    changed = true;
  }

  if (!doc.name || doc.name === "default") {
    doc.name = "Default Feed";
    changed = true;
  }

  if (!doc.isDefault) {
    const existingDefault = await this.exists({
      isDefault: true,
      _id: {
        $ne: doc._id,
      },
    });

    if (!existingDefault) {
      doc.isDefault = true;
      changed = true;
    }
  }

  if (changed) {
    await doc.save();
  }

  return doc;
};

/**
 * Fetch a public feed using slug.
 */
CommerceManagerSchema.statics.getActiveBySlug = async function (slug) {
  const normalizedSlug = normalizeSlug(slug);

  if (!normalizedSlug) {
    return null;
  }

  return this.findOne({
    slug: normalizedSlug,
    isActive: true,
  });
};

/**
 * Create a safe unique slug.
 */
CommerceManagerSchema.statics.generateUniqueSlug = async function (
  value,
  excludeId = null,
) {
  const baseSlug = normalizeSlug(value) || "commerce-feed";

  let slug = baseSlug;
  let suffix = 2;

  while (true) {
    const filter = {
      slug,
    };

    if (excludeId && mongoose.Types.ObjectId.isValid(excludeId)) {
      filter._id = {
        $ne: excludeId,
      };
    }

    const exists = await this.exists(filter);

    if (!exists) {
      return slug;
    }

    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
};

/**
 * Add product codes without removing existing products.
 */
CommerceManagerSchema.methods.addProductCodes = function (codes = []) {
  const currentCodes = Array.isArray(this.selectedProductCodes)
    ? this.selectedProductCodes
    : [];

  const incomingCodes = Array.isArray(codes) ? codes : [codes];

  this.selectedProductCodes = [
    ...new Set(
      [...currentCodes, ...incomingCodes]
        .map(normalizeCode)
        .filter(Boolean),
    ),
  ];

  return this;
};

/**
 * Remove selected product codes.
 */
CommerceManagerSchema.methods.removeProductCodes = function (
  codes = [],
) {
  const codesToRemove = new Set(
    (Array.isArray(codes) ? codes : [codes])
      .map(normalizeCode)
      .filter(Boolean),
  );

  this.selectedProductCodes = (
    this.selectedProductCodes || []
  ).filter((code) => !codesToRemove.has(normalizeCode(code)));

  return this;
};

CommerceManagerSchema.set("toJSON", {
  virtuals: true,
});

CommerceManagerSchema.set("toObject", {
  virtuals: true,
});

const CommerceManager =
  mongoose.models.CommerceManager ||
  mongoose.model("CommerceManager", CommerceManagerSchema);

export {
  normalizeCode,
  normalizeSlug,
};

export default CommerceManager;
