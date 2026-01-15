import Wishlist from "./Wishlist.js";

/* ------------------------------------------------------
   ✅ GET WISHLIST BY FIREBASE UID
   GET /api/wishlist/firebase/:firebaseUID
------------------------------------------------------ */
export const getWishlistByFirebaseUID = async (req, res) => {
  try {
    const { firebaseUID } = req.params;
    if (!firebaseUID)
      return res.status(400).json({ success: false, message: "Firebase UID is required" });

    const wishlist = await Wishlist.findOne({ firebaseUID });

    return res.status(200).json({
      success: true,
      wishlist: wishlist || { firebaseUID, productIds: [] },
    });
  } catch (error) {
    console.error("❌ Error fetching wishlist:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching wishlist",
      error: error.message,
    });
  }
};


/* ------------------------------------------------------
   ✅ ADD PRODUCT TO WISHLIST (backend only)
   POST /api/wishlist/firebase/:firebaseUID/add
------------------------------------------------------ */
export const addToWishlist = async (req, res) => {
  try {
    const { firebaseUID } = req.params;
    const { productId } = req.body;

    if (!firebaseUID)
      return res.status(400).json({ success: false, message: "Firebase UID is required" });

    if (!productId)
      return res.status(400).json({ success: false, message: "Product ID is required" });

    // ✅ customerId NEVER null: fallback to firebaseUID
    const customerId = req.body.customerId || firebaseUID;

    // ✅ upsert + addToSet -> creates wishlist if missing, avoids duplicates
    const wishlist = await Wishlist.findOneAndUpdate(
      { firebaseUID },
      {
        $setOnInsert: { firebaseUID, customerId }, // only on create
        $addToSet: { productIds: productId },      // prevents duplicate product
      },
      { new: true, upsert: true }
    );

    return res.status(200).json({
      success: true,
      message: "Product added to wishlist",
      wishlist,
    });

  } catch (error) {
    console.error("❌ Error adding to wishlist:", error);
    res.status(500).json({
      success: false,
      message: "Server error while adding to wishlist",
      error: error.message,
    });
  }
};


/* ------------------------------------------------------
   ✅ REMOVE PRODUCT FROM WISHLIST
   POST /api/wishlist/firebase/:firebaseUID/remove
------------------------------------------------------ */
export const removeFromWishlist = async (req, res) => {
  try {
    const { firebaseUID } = req.params;
    const { productId } = req.body;

    if (!firebaseUID)
      return res.status(400).json({ success: false, message: "Firebase UID is required" });

    if (!productId)
      return res.status(400).json({ success: false, message: "Product ID is required" });

    // ✅ pull removes item if exists
    const wishlist = await Wishlist.findOneAndUpdate(
      { firebaseUID },
      { $pull: { productIds: productId } },
      { new: true }
    );

    if (!wishlist)
      return res.status(404).json({ success: false, message: "Wishlist not found" });

    return res.status(200).json({
      success: true,
      message: "Product removed from wishlist",
      wishlist,
    });

  } catch (error) {
    console.error("❌ Error removing from wishlist:", error);
    res.status(500).json({
      success: false,
      message: "Server error while removing from wishlist",
      error: error.message,
    });
  }
};


/* ------------------------------------------------------
   ✅ CLEAR WISHLIST
   DELETE /api/wishlist/firebase/:firebaseUID
------------------------------------------------------ */
export const clearWishlist = async (req, res) => {
  try {
    const { firebaseUID } = req.params;

    if (!firebaseUID)
      return res.status(400).json({ success: false, message: "Firebase UID is required" });

    const wishlist = await Wishlist.findOneAndUpdate(
      { firebaseUID },
      { $set: { productIds: [] } },
      { new: true }
    );

    if (!wishlist)
      return res.status(404).json({ success: false, message: "Wishlist not found" });

    return res.status(200).json({
      success: true,
      message: "Wishlist cleared successfully",
      wishlist,
    });

  } catch (error) {
    console.error("❌ Error clearing wishlist:", error);
    res.status(500).json({
      success: false,
      message: "Server error while clearing wishlist",
      error: error.message,
    });
  }
};

/* ------------------------------------------------------
   ✅ GET ALL WISHLISTS
   GET /api/wishlist
------------------------------------------------------ */
export const getAllWishlists = async (req, res) => {
  try {
    // Optional: add pagination support
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 200);
    const skip = (page - 1) * limit;

    const [wishlists, total] = await Promise.all([
      Wishlist.find({})
        .sort({ updatedAt: -1 }) // latest updated first (works if timestamps enabled)
        .skip(skip)
        .limit(limit),
      Wishlist.countDocuments({}),
    ]);

    return res.status(200).json({
      success: true,
      total,
      page,
      limit,
      wishlists,
    });
  } catch (error) {
    console.error("❌ Error fetching all wishlists:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching wishlists",
      error: error.message,
    });
  }
};