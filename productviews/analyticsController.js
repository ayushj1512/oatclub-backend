import mongoose from "mongoose";
import Product from "../Products/Products.js";

/* -------------------------------------------------------
   PRODUCT ANALYTICS TRACKER (ATOMIC + EXTENSIBLE)
------------------------------------------------------- */
export const trackProductAnalytics = async (req, res) => {
  try {
    const { productId, event } = req.body;

    /* -----------------------------
       Validation
    ------------------------------ */
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ message: "Invalid productId" });
    }

    if (!event || typeof event !== "string") {
      return res.status(400).json({ message: "Invalid analytics event" });
    }

    /* -----------------------------
       Event → Field mapping
    ------------------------------ */
    const EVENT_MAP = {
      view: "analytics.views",
      purchase: "analytics.purchases",
      wishlist_add: "analytics.wishlistCount",
      cart_add: "analytics.cartAdds",
      search: "analytics.searchAppearances",
    };

    const fieldToIncrement = EVENT_MAP[event];

    if (!fieldToIncrement) {
      return res.status(400).json({
        message: "Unsupported analytics event",
        supportedEvents: Object.keys(EVENT_MAP),
      });
    }

    /* -----------------------------
       Atomic Increment
    ------------------------------ */
    const result = await Product.findByIdAndUpdate(
      productId,
      { $inc: { [fieldToIncrement]: 1 } },
      { new: false }
    );

    if (!result) {
      return res.status(404).json({ message: "Product not found" });
    }

    /* -----------------------------
       Silent Success
    ------------------------------ */
    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Product Analytics Error:", err);
    return res.status(500).json({ message: "Failed to track analytics" });
  }
};
