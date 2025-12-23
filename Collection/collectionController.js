import Collection from "./Collection.js";
import slugify from "slugify";

/**
 * @desc    Create a new collection
 * @route   POST /api/collections
 * @access  Private (admin)
 */
export const createCollection = async (req, res) => {
  try {
    const { name, description, bannerImage, thumbnailImage, products, tags, category, isActive, launchDate, expiryDate, type, createdBy } = req.body;

    // Auto-generate slug if not provided
    const slug = slugify(name, { lower: true, strict: true });

    // Check duplicate slug
    const existing = await Collection.findOne({ slug });
    if (existing) return res.status(400).json({ message: "Slug already exists" });

    const collection = await Collection.create({
      name,
      slug,
      description,
      bannerImage,
      thumbnailImage,
      products,
      tags,
      category,
      isActive,
      launchDate,
      expiryDate,
      type,
      createdBy,
    });

    res.status(201).json({ message: "Collection created successfully", collection });
  } catch (error) {
    console.error("Error creating collection:", error);
    res.status(500).json({ message: "Server error while creating collection", error: error.message });
  }
};

/**
 * @desc    Get all collections
 * @route   GET /api/collections
 * @access  Public
 */
export const getAllCollections = async (req, res) => {
  try {
    const collections = await Collection.find()
      .populate("products", "name price images")
      .populate("tags", "name slug")
      .populate("category", "name")
      .populate("createdBy", "username role")
      .sort({ createdAt: -1 });

    res.status(200).json(collections);
  } catch (error) {
    console.error("Error fetching collections:", error);
    res.status(500).json({ message: "Server error while fetching collections", error: error.message });
  }
};

/**
 * @desc    Get a single collection by ID or slug
 * @route   GET /api/collections/:idOrSlug
 * @access  Public
 */
export const getCollectionById = async (req, res) => {
  try {
    const { idOrSlug } = req.params;
    const query = mongoose.isValidObjectId(idOrSlug)
      ? { _id: idOrSlug }
      : { slug: idOrSlug };

    const collection = await Collection.findOne(query)
      .populate("products", "name price images")
      .populate("tags", "name slug")
      .populate("category", "name")
      .populate("createdBy", "username role");

    if (!collection) return res.status(404).json({ message: "Collection not found" });

    res.status(200).json(collection);
  } catch (error) {
    console.error("Error fetching collection:", error);
    res.status(500).json({ message: "Server error while fetching collection", error: error.message });
  }
};

/**
 * @desc    Update a collection
 * @route   PUT /api/collections/:id
 * @access  Private (admin)
 */
export const updateCollection = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };

    if (updates.name) {
      updates.slug = slugify(updates.name, { lower: true, strict: true });
    }

    const updatedCollection = await Collection.findByIdAndUpdate(id, updates, {
      new: true,
    })
      .populate("products", "name price images")
      .populate("tags", "name slug")
      .populate("category", "name")
      .populate("createdBy", "username role");

    if (!updatedCollection)
      return res.status(404).json({ message: "Collection not found" });

    res.status(200).json({ message: "Collection updated successfully", collection: updatedCollection });
  } catch (error) {
    console.error("Error updating collection:", error);
    res.status(500).json({ message: "Server error while updating collection", error: error.message });
  }
};

/**
 * @desc    Delete a collection
 * @route   DELETE /api/collections/:id
 * @access  Private (admin)
 */
export const deleteCollection = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Collection.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ message: "Collection not found" });

    res.status(200).json({ message: "Collection deleted successfully" });
  } catch (error) {
    console.error("Error deleting collection:", error);
    res.status(500).json({ message: "Server error while deleting collection", error: error.message });
  }
};
