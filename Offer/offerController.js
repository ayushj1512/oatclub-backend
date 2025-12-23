import Offer from "./Offer.js";

/**
 * @desc Create a new offer
 * @route POST /api/offers
 * @access Private/Admin
 */
export const createOffer = async (req, res) => {
  try {
    const {
      title,
      description,
      type,
      discountValue,
      applicableCategories,
      applicableTags,
      applicableProducts,
      minPurchaseAmount,
      maxDiscountAmount,
      startDate,
      endDate,
      applicableTo,
      influencerCode,
      isActive,
      createdBy,
    } = req.body;

    const offer = await Offer.create({
      title,
      description,
      type,
      discountValue,
      applicableCategories,
      applicableTags,
      applicableProducts,
      minPurchaseAmount,
      maxDiscountAmount,
      startDate,
      endDate,
      applicableTo,
      influencerCode,
      isActive,
      createdBy,
    });

    res.status(201).json({ message: "Offer created successfully", offer });
  } catch (error) {
    console.error("Error creating offer:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Get all offers (with optional filters)
 * @route GET /api/offers
 * @access Public/Admin
 */
export const getAllOffers = async (req, res) => {
  try {
    const { isActive, categoryId, tagId, productId } = req.query;

    const filters = {};

    if (isActive !== undefined) filters.isActive = isActive === "true";
    if (categoryId) filters.applicableCategories = categoryId;
    if (tagId) filters.applicableTags = tagId;
    if (productId) filters.applicableProducts = productId;

    const offers = await Offer.find(filters)
      .populate("applicableCategories", "name")
      .populate("applicableTags", "name")
      .populate("applicableProducts", "title price")
      .sort({ createdAt: -1 });

    res.status(200).json(offers);
  } catch (error) {
    console.error("Error fetching offers:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Get single offer by ID
 * @route GET /api/offers/:id
 * @access Public/Admin
 */
export const getOfferById = async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id)
      .populate("applicableCategories", "name")
      .populate("applicableTags", "name")
      .populate("applicableProducts", "title price");

    if (!offer) return res.status(404).json({ message: "Offer not found" });

    res.status(200).json(offer);
  } catch (error) {
    console.error("Error fetching offer:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Update an existing offer
 * @route PUT /api/offers/:id
 * @access Private/Admin
 */
export const updateOffer = async (req, res) => {
  try {
    const updatedOffer = await Offer.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!updatedOffer) return res.status(404).json({ message: "Offer not found" });

    res.status(200).json({ message: "Offer updated successfully", offer: updatedOffer });
  } catch (error) {
    console.error("Error updating offer:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Delete an offer
 * @route DELETE /api/offers/:id
 * @access Private/Admin
 */
export const deleteOffer = async (req, res) => {
  try {
    const deleted = await Offer.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Offer not found" });

    res.status(200).json({ message: "Offer deleted successfully" });
  } catch (error) {
    console.error("Error deleting offer:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
