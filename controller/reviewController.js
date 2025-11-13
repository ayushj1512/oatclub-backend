import Review from "../models/Review.js";

/**
 * @desc Create a new review
 * @route POST /api/reviews
 * @access Public / Customer
 */
export const createReview = async (req, res) => {
  try {
    const { product, customer, rating, reviewText, images, verifiedPurchase } = req.body;

    // Ensure customer can review a product only once
    const existing = await Review.findOne({ product, customer });
    if (existing) {
      return res.status(400).json({ message: "You have already reviewed this product" });
    }

    const review = await Review.create({
      product,
      customer,
      rating,
      reviewText,
      images,
      verifiedPurchase,
    });

    res.status(201).json({ message: "Review added successfully", review });
  } catch (error) {
    console.error("Error creating review:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Get all reviews (optionally filter by product or customer)
 * @route GET /api/reviews
 * @access Public
 */
export const getAllReviews = async (req, res) => {
  try {
    const { product, customer, status } = req.query;
    const filter = {};

    if (product) filter.product = product;
    if (customer) filter.customer = customer;
    if (status) filter.status = status;

    const reviews = await Review.find(filter)
      .populate("product", "title slug")
      .populate("customer", "name email")
      .sort({ createdAt: -1 });

    res.status(200).json(reviews);
  } catch (error) {
    console.error("Error fetching reviews:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Get a single review by ID
 * @route GET /api/reviews/:id
 * @access Public
 */
export const getReviewById = async (req, res) => {
  try {
    const review = await Review.findById(req.params.id)
      .populate("product", "title slug")
      .populate("customer", "name email");

    if (!review) return res.status(404).json({ message: "Review not found" });

    res.status(200).json(review);
  } catch (error) {
    console.error("Error fetching review:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Update a review by ID (rating, text, images, status)
 * @route PUT /api/reviews/:id
 * @access Private / Admin
 */
export const updateReview = async (req, res) => {
  try {
    const updatedReview = await Review.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!updatedReview) return res.status(404).json({ message: "Review not found" });

    res.status(200).json({ message: "Review updated successfully", review: updatedReview });
  } catch (error) {
    console.error("Error updating review:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Delete a review by ID
 * @route DELETE /api/reviews/:id
 * @access Private / Admin
 */
export const deleteReview = async (req, res) => {
  try {
    const deletedReview = await Review.findByIdAndDelete(req.params.id);

    if (!deletedReview) return res.status(404).json({ message: "Review not found" });

    res.status(200).json({ message: "Review deleted successfully" });
  } catch (error) {
    console.error("Error deleting review:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
