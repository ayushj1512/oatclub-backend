import Review from "./Review.js";
import Product from "../Products/Products.js";
import Customer from "../Customer/Customer.js";
import { uploadToCloudinary } from "../config/cloudinary.js";

/* -------------------------------------------------------------
  Helpers
------------------------------------------------------------- */

// ✅ rating guard (1..5)
const parseRating = (rating) => {
  const r = Number(rating);
  return Number.isFinite(r) && r >= 1 && r <= 5 ? r : null;
};

// ✅ recalc product avg + count using APPROVED reviews only
const updateProductRating = async (productId) => {
  const [stats] = await Review.aggregate([
    { $match: { product: productId, status: "approved" } },
    { $group: { _id: "$product", avg: { $avg: "$rating" }, total: { $sum: 1 } } },
  ]);

  await Product.findByIdAndUpdate(productId, {
    averageRating: Math.round((stats?.avg ?? 0) * 10) / 10,
    totalReviews: stats?.total ?? 0,
  });
};

// ✅ upload images -> cloudinary secure URLs
const uploadReviewImages = async (files = []) => {
  if (!files?.length) return [];
  const urls = [];
  for (const f of files) {
    try {
      const up = await uploadToCloudinary(f, "reviews");
      if (up?.secure_url) urls.push(up.secure_url);
    } catch (e) {
      console.error("Cloudinary upload failed:", e?.message || e);
    }
  }
  return urls;
};

// ✅ safe regex for search
const escapeRegex = (s = "") => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ✅ map sort keys
const getSort = (sort = "latest") => {
  switch (sort) {
    case "oldest":
      return { createdAt: 1 };
    case "ratingHigh":
      return { rating: -1, createdAt: -1 };
    case "ratingLow":
      return { rating: 1, createdAt: -1 };
    default:
      return { createdAt: -1 };
  }
};

/* -------------------------------------------------------------
  PUBLIC: CREATE REVIEW
  - saves productCode + customer snapshots
------------------------------------------------------------- */
export const createReview = async (req, res) => {
  try {
    const {
      product,
      customer,
      rating,
      reviewText = "",
      title = "",
      verifiedPurchase = false,
    } = req.body;

    if (!product || !customer || rating === undefined)
      return res.status(400).json({ message: "Product, customer & rating are required" });

    const r = parseRating(rating);
    if (!r) return res.status(400).json({ message: "Rating must be between 1 and 5" });

    // prevent duplicates
    const exists = await Review.findOne({ product, customer }).lean();
    if (exists) return res.status(400).json({ message: "You have already reviewed this product" });

    // snapshots
    const [p, c] = await Promise.all([
      Product.findById(product).select("productCode").lean(),
      Customer.findById(customer).select("name email phone").lean(),
    ]);

    if (!p) return res.status(404).json({ message: "Product not found" });
    if (!c) return res.status(404).json({ message: "Customer not found" });

    const images = await uploadReviewImages(req.files);

    const review = await Review.create({
      product,
      productCode: p.productCode,
      customer,
      customerName: c?.name || "",
      customerEmail: c?.email || "",
      customerPhone: c?.phone || "",
      rating: r,
      title,
      reviewText,
      verifiedPurchase: !!verifiedPurchase,
      images,
    });

    // keep Product.reviews[] in sync
    await Product.findByIdAndUpdate(product, { $addToSet: { reviews: review._id } });

    // update rating stats
    await updateProductRating(product);

    return res.status(201).json({ message: "Review added successfully", review });
  } catch (error) {
    console.error("❌ Error creating review:", error);

    if (error?.code === 11000)
      return res.status(400).json({ message: "You have already reviewed this product" });

    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

/* -------------------------------------------------------------
  PUBLIC: GET ALL REVIEWS
  - supports: product, productCode, customer, status
------------------------------------------------------------- */
export const getAllReviews = async (req, res) => {
  try {
    const { product, productCode, customer, status } = req.query;

    const filter = {
      ...(product && { product }),
      ...(productCode && { productCode: String(productCode).trim() }),
      ...(customer && { customer }),
      ...(status && { status }),
    };

    const reviews = await Review.find(filter)
      .populate("product", "title slug thumbnail productCode")
      .populate("customer", "name email phone")
      .sort({ createdAt: -1 });

    return res.status(200).json(reviews);
  } catch (error) {
    console.error("❌ Error fetching reviews:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

/* -------------------------------------------------------------
  PUBLIC: GET REVIEW BY ID
------------------------------------------------------------- */
export const getReviewById = async (req, res) => {
  try {
    const review = await Review.findById(req.params.id)
      .populate("product", "title slug thumbnail productCode")
      .populate("customer", "name email phone");

    if (!review) return res.status(404).json({ message: "Review not found" });
    return res.status(200).json(review);
  } catch (error) {
    console.error("❌ Error fetching review:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

/* -------------------------------------------------------------
  PUBLIC/ADMIN: UPDATE REVIEW
  - can update: rating, title, reviewText, status, verifiedPurchase
  - if product/customer changed: refresh snapshots + sync product.reviews[]
------------------------------------------------------------- */
export const updateReview = async (req, res) => {
  try {
    const { rating, reviewText, title, status, verifiedPurchase, product, customer } = req.body;

    const current = await Review.findById(req.params.id).select("product").lean();
    if (!current) return res.status(404).json({ message: "Review not found" });

    const update = {};
    if (rating !== undefined) {
      const r = parseRating(rating);
      if (!r) return res.status(400).json({ message: "Rating must be between 1 and 5" });
      update.rating = r;
    }
    if (reviewText !== undefined) update.reviewText = reviewText;
    if (title !== undefined) update.title = title;
    if (status !== undefined) update.status = status;
    if (verifiedPurchase !== undefined) update.verifiedPurchase = !!verifiedPurchase;

    // product change -> productCode snapshot
    if (product) {
      const p = await Product.findById(product).select("productCode").lean();
      if (!p) return res.status(404).json({ message: "Product not found" });
      update.product = product;
      update.productCode = p.productCode;
    }

    // customer change -> customer snapshots
    if (customer) {
      const c = await Customer.findById(customer).select("name email phone").lean();
      if (!c) return res.status(404).json({ message: "Customer not found" });
      update.customer = customer;
      update.customerName = c?.name || "";
      update.customerEmail = c?.email || "";
      update.customerPhone = c?.phone || "";
    }

    const updated = await Review.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    });

    const oldProductId = String(current.product);
    const newProductId = String(updated.product);

    // moved products -> sync arrays + recalc both
    if (product && oldProductId !== newProductId) {
      await Promise.all([
        Product.findByIdAndUpdate(oldProductId, { $pull: { reviews: updated._id } }),
        Product.findByIdAndUpdate(newProductId, { $addToSet: { reviews: updated._id } }),
      ]);
      await Promise.all([updateProductRating(oldProductId), updateProductRating(newProductId)]);
    } else {
      await updateProductRating(updated.product);
    }

    return res.status(200).json({ message: "Review updated successfully", review: updated });
  } catch (error) {
    console.error("❌ Error updating review:", error);

    if (error?.code === 11000)
      return res
        .status(400)
        .json({ message: "A review already exists for this product by this customer" });

    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

/* -------------------------------------------------------------
  PUBLIC/ADMIN: DELETE REVIEW
------------------------------------------------------------- */
export const deleteReview = async (req, res) => {
  try {
    const deleted = await Review.findByIdAndDelete(req.params.id).lean();
    if (!deleted) return res.status(404).json({ message: "Review not found" });

    await Product.findByIdAndUpdate(deleted.product, { $pull: { reviews: deleted._id } });
    await updateProductRating(deleted.product);

    return res.status(200).json({ message: "Review deleted successfully" });
  } catch (error) {
    console.error("❌ Error deleting review:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

/* =============================================================
  ✅ ADMIN CONTROLLERS
============================================================= */

/* -------------------------------------------------------------
  ADMIN: LIST REVIEWS (pagination + filters + search)
  Query:
   - page, limit
   - status, rating, productCode, customerEmail
   - q (search in title/reviewText/customerName/customerEmail)
   - sort: latest | oldest | ratingHigh | ratingLow
------------------------------------------------------------- */
export const adminGetReviews = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      rating,
      productCode,
      customerEmail,
      q,
      sort = "latest",
    } = req.query;

    const pageNum = Math.max(Number(page) || 1, 1);
    const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 100);

    const filter = {
      ...(status && { status }),
      ...(productCode && { productCode: String(productCode).trim() }),
      ...(customerEmail && { customerEmail: String(customerEmail).trim().toLowerCase() }),
      ...(rating && { rating: Number(rating) }),
    };

    // search text
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      filter.$or = [
        { title: rx },
        { reviewText: rx },
        { customerName: rx },
        { customerEmail: rx },
        { customerPhone: rx },
        { productCode: rx },
      ];
    }

    const [items, total] = await Promise.all([
      Review.find(filter)
        .populate("product", "title slug thumbnail productCode")
        .populate("customer", "name email phone")
        .sort(getSort(sort))
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      Review.countDocuments(filter),
    ]);

    return res.status(200).json({
      items,
      meta: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching admin reviews:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

/* -------------------------------------------------------------
  ADMIN: BULK STATUS UPDATE
  Body: { ids: ["..."], status: "approved"|"rejected"|"pending" }
------------------------------------------------------------- */
export const adminBulkUpdateStatus = async (req, res) => {
  try {
    const { ids = [], status } = req.body;

    if (!Array.isArray(ids) || ids.length === 0)
      return res.status(400).json({ message: "ids[] is required" });

    if (!["approved", "rejected", "pending"].includes(status))
      return res.status(400).json({ message: "Invalid status" });

    // get affected products BEFORE update
    const affected = await Review.find({ _id: { $in: ids } }).select("product").lean();
    const productIds = [...new Set(affected.map((r) => String(r.product)))];

    await Review.updateMany({ _id: { $in: ids } }, { $set: { status } });

    // refresh ratings for affected products
    await Promise.all(productIds.map((pid) => updateProductRating(pid)));

    return res.status(200).json({ message: "Status updated", count: ids.length });
  } catch (error) {
    console.error("❌ Error bulk updating status:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

/* -------------------------------------------------------------
  ADMIN: BULK DELETE REVIEWS
  Body: { ids: ["..."] }
------------------------------------------------------------- */
export const adminBulkDeleteReviews = async (req, res) => {
  try {
    const { ids = [] } = req.body;

    if (!Array.isArray(ids) || ids.length === 0)
      return res.status(400).json({ message: "ids[] is required" });

    // fetch reviews to know product ids + sync Product.reviews[]
    const reviews = await Review.find({ _id: { $in: ids } }).select("product").lean();
    const productIds = [...new Set(reviews.map((r) => String(r.product)))];

    await Review.deleteMany({ _id: { $in: ids } });

    // pull deleted review ids from all products (safe)
    await Product.updateMany({}, { $pull: { reviews: { $in: ids } } });

    // refresh ratings
    await Promise.all(productIds.map((pid) => updateProductRating(pid)));

    return res.status(200).json({ message: "Reviews deleted", count: ids.length });
  } catch (error) {
    console.error("❌ Error bulk deleting reviews:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};
