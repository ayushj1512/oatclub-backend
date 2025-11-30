import Wishlist from "../models/Wishlist.js";

/* ------------------------------------------------------
   GET WISHLIST BY FIREBASE UID
   GET /api/wishlist/firebase/:firebaseUID
------------------------------------------------------ */
export const getWishlistByFirebaseUID = async (req, res) => {
  try {
    const { firebaseUID } = req.params;

    if (!firebaseUID) {
      return res.status(400).json({ message: "Firebase UID is required" });
    }

    const wishlist = await Wishlist.findOne({ firebaseUID });

    if (!wishlist) {
      return res.status(200).json({
        success: true,
        message: "Wishlist empty",
        wishlist: { firebaseUID, productIds: [] }
      });
    }

    res.status(200).json({ success: true, wishlist });

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
   ADD PRODUCT TO WISHLIST (firebaseUID)
   POST /api/wishlist/firebase/:firebaseUID/add
------------------------------------------------------ */
export const addToWishlist = async (req, res) => {
  try {
    const { firebaseUID } = req.params;
    const { productId, customerId } = req.body;

    if (!firebaseUID) {
      return res.status(400).json({ message: "Firebase UID is required" });
    }

    if (!productId) {
      return res.status(400).json({ message: "Product ID is required" });
    }

    let wishlist = await Wishlist.findOne({ firebaseUID });

    // Create wishlist if not exists
    if (!wishlist) {
      wishlist = await Wishlist.create({
        firebaseUID,
        customerId: customerId || null,
        productIds: [productId],
      });
    } else {
      // Avoid duplicates
      if (wishlist.productIds.includes(productId)) {
        return res.status(400).json({ message: "Product already in wishlist" });
      }

      wishlist.productIds.push(productId);
      await wishlist.save();
    }

    const updatedWishlist = await Wishlist.findOne({ firebaseUID });

    res.status(200).json({
      success: true,
      message: "Product added to wishlist",
      wishlist: updatedWishlist,
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
   REMOVE PRODUCT FROM WISHLIST
   POST /api/wishlist/firebase/:firebaseUID/remove
------------------------------------------------------ */
export const removeFromWishlist = async (req, res) => {
  try {
    const { firebaseUID } = req.params;
    const { productId } = req.body;

    if (!firebaseUID) {
      return res.status(400).json({ message: "Firebase UID is required" });
    }

    if (!productId) {
      return res.status(400).json({ message: "Product ID is required" });
    }

    const wishlist = await Wishlist.findOne({ firebaseUID });

    if (!wishlist) {
      return res.status(404).json({ message: "Wishlist not found" });
    }

    wishlist.productIds = wishlist.productIds.filter(
      (id) => id !== productId
    );

    await wishlist.save();

    const updatedWishlist = await Wishlist.findOne({ firebaseUID });

    res.status(200).json({
      success: true,
      message: "Product removed from wishlist",
      wishlist: updatedWishlist,
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
   CLEAR WISHLIST
   DELETE /api/wishlist/firebase/:firebaseUID
------------------------------------------------------ */
export const clearWishlist = async (req, res) => {
  try {
    const { firebaseUID } = req.params;

    if (!firebaseUID) {
      return res.status(400).json({ message: "Firebase UID is required" });
    }

    const wishlist = await Wishlist.findOne({ firebaseUID });

    if (!wishlist) {
      return res.status(404).json({ message: "Wishlist not found" });
    }

    wishlist.productIds = [];
    await wishlist.save();

    res.status(200).json({
      success: true,
      message: "Wishlist cleared successfully",
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
