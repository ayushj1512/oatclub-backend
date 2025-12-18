import mongoose from "mongoose";
import Product from "../models/Products.js";

/* -------------------------------------------------------
   INCREMENT PRODUCT VIEW (ATOMIC)
------------------------------------------------------- */
export const incrementProductView = async (req, res) => {
  try {
    const { productId } = req.body;

    // Basic validation
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ message: "Invalid productId" });
    }

    // Atomic increment (no race condition)
    const updated = await Product.findByIdAndUpdate(
      productId,
      { $inc: { "analytics.views": 1 } },
      { new: false } // we don't need the document back
    );

    // Product not found
    if (!updated) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Silent success
    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Increment Product View Error:", err);
    return res.status(500).json({ message: "Failed to track product view" });
  }
};
