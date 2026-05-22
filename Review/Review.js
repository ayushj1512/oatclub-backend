// Review.js
import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },

    productCode: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },

    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
      index: true,
    },

    orderNumber: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
      index: true,
    },

    orderLineId: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },

    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
      index: true,
    },

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

    rating: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
      index: true,
    },

    reviewText: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },

    verifiedPurchase: {
      type: Boolean,
      default: true,
      index: true,
    },

    source: {
      type: String,
      enum: ["order_link", "admin", "website"],
      default: "order_link",
      index: true,
    },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "approved",
      index: true,
    },

    helpfulCount: { type: Number, default: 0 },
    reportedCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

/* Same customer can review same product only once */
reviewSchema.index(
  { product: 1, customer: 1 },
  {
    unique: true,
    partialFilterExpression: { customer: { $type: "objectId" } },
  }
);

/* Same order item can be reviewed only once */
reviewSchema.index(
  { order: 1, orderLineId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      order: { $type: "objectId" },
      orderLineId: { $type: "string", $gt: "" },
    },
  }
);

/* Fallback: same order number + product once */
reviewSchema.index(
  { orderNumber: 1, product: 1 },
  {
    unique: true,
    partialFilterExpression: {
      orderNumber: { $type: "string", $gt: "" },
    },
  }
);

reviewSchema.pre("validate", function (next) {
  try {
    const text = String(this.reviewText || "").trim();

    if (text && text.length < 3) {
      return next(new Error("Review text is too short"));
    }

    next();
  } catch (e) {
    next(e);
  }
});

reviewSchema.pre("validate", async function (next) {
  try {
    if (!this.productCode && this.product) {
      const Product = mongoose.model("Product");
      const p = await Product.findById(this.product)
        .select("productCode")
        .lean();

      if (p?.productCode) this.productCode = p.productCode;
    }

    if (
      this.order &&
      (!this.orderNumber ||
        !this.customer ||
        !this.customerName ||
        !this.customerEmail ||
        !this.customerPhone ||
        !this.orderLineId)
    ) {
      const Order = mongoose.model("Order");

      const order = await Order.findById(this.order)
        .select(
          "orderNumber customerId shippingAddressSnapshot billingAddressSnapshot items"
        )
        .lean();

      if (order) {
        if (!this.orderNumber && order.orderNumber) {
          this.orderNumber = order.orderNumber;
        }

        if (!this.customer && order.customerId) {
          this.customer = order.customerId;
        }

        const shipping = order.shippingAddressSnapshot || {};
        const billing = order.billingAddressSnapshot || {};

        if (!this.customerName) {
          this.customerName = shipping.fullName || billing.fullName || "";
        }

        if (!this.customerEmail) {
          this.customerEmail = shipping.email || billing.email || "";
        }

        if (!this.customerPhone) {
          this.customerPhone = shipping.phone || billing.phone || "";
        }

        if (!this.orderLineId && Array.isArray(order.items)) {
          const matchedItem = order.items.find(
            (item) => String(item.productId) === String(this.product)
          );

          if (matchedItem?.lineId) {
            this.orderLineId = matchedItem.lineId;
          }
        }

        this.verifiedPurchase = true;
        this.source = "order_link";
      }
    }

    next();
  } catch (e) {
    next(e);
  }
});

export default mongoose.models.Review || mongoose.model("Review", reviewSchema);