import mongoose from "mongoose";

const marketingSpendSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },

    // where spend happened (Meta Ads, Google Ads, Influencer, etc.)
    source: { type: String, required: true, trim: true, index: true },

    // spend date (for monthly budgeting)
    spentAt: { type: Date, required: true, index: true },

    currency: { type: String, default: "INR", trim: true },

    notes: { type: String, default: "", trim: true },

    // optional: who added it (if you have admin auth)
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
  },
  { timestamps: true }
);

// helpful compound index (monthly queries + filtering)
marketingSpendSchema.index({ spentAt: -1, source: 1 });

const MarketingSpend =
  mongoose.models.MarketingSpend ||
  mongoose.model("MarketingSpend", marketingSpendSchema);

export default MarketingSpend;