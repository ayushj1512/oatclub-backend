import Review from "../models/Review.js";
import Product from "../models/Products.js";
import { uploadToCloudinary } from "../config/cloudinary.js";

/* -------------------------------------------------------------
   🔧 Helper: Recalculate product rating (approved only)
------------------------------------------------------------- */
const updateProductRating = async (productId) => {
  const stats = await Review.aggregate([
    { $match: { product: productId, status: "approved" } },
    {
      $group: {
        _id: "$product",
        avgRating: { $avg: "$rating" },
        total: { $sum: 1 },
      },
    },
  ]);

  const avg = stats.length > 0 ? stats[0].avgRating : 0;
  const total = stats.length > 0 ? stats[0].total : 0;

  await Product.findByIdAndUpdate(productId, {
    averageRating: Math.round(avg * 10) / 10,
    totalReviews: total,
  });
};

/* -------------------------------------------------------------
   📌 CREATE REVIEW (with Cloudinary image upload)
------------------------------------------------------------- */
export const createReview = async (req, res) => {
  try {
    const {
      product,
      customer,
      rating,
      reviewText,
      title,
      verifiedPurchase,
    } = req.body;

    if (!product || !customer || !rating) {
      return res.status(400).json({
        message: "Product, customer & rating are required",
      });
    }

    if (rating < 1 || rating > 5) {
      return res
        .status(400)
        .json({ message: "Rating must be between 1 and 5" });
    }

    /* ------- Prevent duplicate review by same customer ------- */
    const existing = await Review.findOne({ product, customer });
    if (existing) {
      return res.status(400).json({
        message: "You have already reviewed this product",
      });
    }

    /* ---------------- Upload Images to Cloudinary ---------------- */
    let uploadedImages = [];

    if (req.files?.length > 0) {
      for (const file of req.files) {
        try {
          const uploaded = await uploadToCloudinary(file, "reviews");
          uploadedImages.push(uploaded.secure_url);
        } catch (err) {
          console.error("Cloudinary upload failed:", err);
        }
      }
    }

    /* ---------------- Create Review ---------------- */
    const review = await Review.create({
      product,
      customer,
      rating: Number(rating),
      title: title || "",
      reviewText: reviewText || "",
      verifiedPurchase: verifiedPurchase || false,
      images: uploadedImages,
    });

    /* ---------------- Update product rating ---------------- */
    await updateProductRating(product);

    return res.status(201).json({
      message: "Review added successfully",
      review,
    });
  } catch (error) {
    console.error("❌ Error creating review:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

/* -------------------------------------------------------------
   📌 GET ALL REVIEWS (filter supported)
------------------------------------------------------------- */
export const getAllReviews = async (req, res) => {
  try {
    const { product, customer, status } = req.query;

    const filter = {};
    if (product) filter.product = product;
    if (customer) filter.customer = customer;
    if (status) filter.status = status;

    const reviews = await Review.find(filter)
      .populate("product", "title slug thumbnail")
      .populate("customer", "name email")
      .sort({ createdAt: -1 });

    return res.status(200).json(reviews);
  } catch (error) {
    console.error("❌ Error fetching reviews:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

/* -------------------------------------------------------------
   📌 GET REVIEW BY ID
------------------------------------------------------------- */
export const getReviewById = async (req, res) => {
  try {
    const review = await Review.findById(req.params.id)
      .populate("product", "title slug")
      .populate("customer", "name email");

    if (!review)
      return res.status(404).json({ message: "Review not found" });

    return res.status(200).json(review);
  } catch (error) {
    console.error("❌ Error fetching review:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

/* -------------------------------------------------------------
   📌 UPDATE REVIEW (Admin OR Customer)
------------------------------------------------------------- */
export const updateReview = async (req, res) => {
  try {
    const { rating, reviewText, title, status } = req.body;

    const updatedReview = await Review.findByIdAndUpdate(
      req.params.id,
      {
        ...(rating && { rating }),
        ...(reviewText && { reviewText }),
        ...(title && { title }),
        ...(status && { status }),
      },
      { new: true, runValidators: true }
    );

    if (!updatedReview)
      return res.status(404).json({ message: "Review not found" });

    /* Recalculate rating */
    await updateProductRating(updatedReview.product);

    return res.status(200).json({
      message: "Review updated successfully",
      review: updatedReview,
    });
  } catch (error) {
    console.error("❌ Error updating review:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

/* -------------------------------------------------------------
   📌 DELETE REVIEW
------------------------------------------------------------- */
export const deleteReview = async (req, res) => {
  try {
    const deleted = await Review.findByIdAndDelete(req.params.id);

    if (!deleted)
      return res.status(404).json({ message: "Review not found" });

    /* Update product rating */
    await updateProductRating(deleted.product);

    return res.status(200).json({
      message: "Review deleted successfully",
    });
  } catch (error) {
    console.error("❌ Error deleting review:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};
