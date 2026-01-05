import mongoose from "mongoose";

const wishlistSchema = new mongoose.Schema(
  {
    // ✅ Firebase UID = main identifier (unique)
    firebaseUID: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },

    // ✅ Store firebaseUID here too (optional but avoids null + duplicate key bug)
    // If you don't need it, you can remove this field entirely.
    customerId: {
      type: String,          // ✅ was ObjectId → caused cast error
      required: true,        // ✅ avoid null
      unique: true,          // ✅ ensure one wishlist per customer
      trim: true,
      index: true,
    },

    // ✅ Product IDs as string array
    productIds: [
      {
        type: String,
        trim: true,
      },
    ],
  },
  { timestamps: true }
);

// ✅ Remove duplicates automatically (extra safety)
wishlistSchema.pre("save", function (next) {
  if (Array.isArray(this.productIds)) {
    this.productIds = [...new Set(this.productIds.map(String))];
  }
  next();
});

export default mongoose.models.Wishlist ||
  mongoose.model("Wishlist", wishlistSchema);
