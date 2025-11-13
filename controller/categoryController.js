import Category from "../models/Category.js";

/**
 * @desc    Create a new category
 * @route   POST /api/categories
 * @access  Private (admin)
 */
export const createCategory = async (req, res) => {
  try {
    const { name, number, description, isActive } = req.body;

    // Prevent duplicates
    const existing = await Category.findOne({ $or: [{ name }, { number }] });
    if (existing) {
      return res.status(400).json({ message: "Category with same name or number already exists." });
    }

    const category = await Category.create({
      name,
      number,
      description,
      isActive,
    });

    res.status(201).json({ message: "Category created successfully", category });
  } catch (error) {
    res.status(500).json({ message: "Error creating category", error: error.message });
  }
};

/**
 * @desc    Get all categories
 * @route   GET /api/categories
 * @access  Public
 */
export const getAllCategories = async (req, res) => {
  try {
    const { active } = req.query;
    const filter = active ? { isActive: active === "true" } : {};

    const categories = await Category.find(filter).sort({ createdAt: -1 });
    res.status(200).json(categories);
  } catch (error) {
    res.status(500).json({ message: "Error fetching categories", error: error.message });
  }
};

/**
 * @desc    Get a single category by ID
 * @route   GET /api/categories/:id
 * @access  Public
 */
export const getCategoryById = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }
    res.status(200).json(category);
  } catch (error) {
    res.status(500).json({ message: "Error fetching category", error: error.message });
  }
};

/**
 * @desc    Update a category
 * @route   PUT /api/categories/:id
 * @access  Private (admin)
 */
export const updateCategory = async (req, res) => {
  try {
    const { name, number, description, isActive } = req.body;
    const category = await Category.findByIdAndUpdate(
      req.params.id,
      { name, number, description, isActive },
      { new: true, runValidators: true }
    );

    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    res.status(200).json({ message: "Category updated successfully", category });
  } catch (error) {
    res.status(500).json({ message: "Error updating category", error: error.message });
  }
};

/**
 * @desc    Delete a category
 * @route   DELETE /api/categories/:id
 * @access  Private (admin)
 */
export const deleteCategory = async (req, res) => {
  try {
    const category = await Category.findByIdAndDelete(req.params.id);
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    res.status(200).json({ message: "Category deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting category", error: error.message });
  }
};
