// controllers/categoryController.js
import Category from "../models/Category.js";
import slugify from "slugify";

/* ============================================================================
   CREATE CATEGORY  (100% FIXED)
============================================================================ */
export const createCategory = async (req, res) => {
  try {
    console.log("🔥 RAW REQUEST BODY:", req.body);

    let {
      name,
      slug,
      parent,
      sortOrder,
      number,
      description,
      image,
      icon,
      isActive,
      isFeatured,
      metaTitle,
      metaDescription,
      keywords,
      attributes,
    } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Category name is required" });
    }

    // Convert empty string → null
if (parent === "" || parent === undefined || parent === "undefined" || parent === null) {
  parent = null;
}
    console.log("🔥 FINAL parent VALUE:", parent);

    // Auto-generate slug
    slug = slug ? slugify(slug, { lower: true }) : slugify(name, { lower: true });

    // Prevent duplicate
    const existing = await Category.findOne({
      $or: [{ name }, { slug }],
    });

    if (existing) {
      return res.status(400).json({
        message: "Category with same name or slug already exists.",
      });
    }

    // Build category data object
    const categoryData = {
      name,
      slug,
      parent: parent || null,
      sortOrder: sortOrder || 0,
      number: number || null,
      description,
      image,
      icon,
      isActive: isActive ?? true,
      isFeatured: isFeatured ?? false,
      metaTitle,
      metaDescription,
      keywords,
      attributes,
    };

    console.log("🔥 CATEGORY DATA SENT TO DB:", categoryData);

    const category = await Category.create(categoryData);

    // Populate parent after creation so response includes it
    const populated = await Category.findById(category._id).populate(
      "parent",
      "name slug"
    );

    res.status(201).json({
      message: "Category created successfully",
      category: populated,
    });
  } catch (error) {
    console.error("❌ Create Category Error:", error);
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

/* ============================================================================
   GET ALL CATEGORIES
============================================================================ */
export const getAllCategories = async (req, res) => {
  try {
    const { search, active, featured, parent } = req.query;
    const filter = {};

    if (active !== undefined) filter.isActive = active === "true";
    if (featured !== undefined) filter.isFeatured = featured === "true";

    if (parent !== undefined) {
      filter.parent = parent === "null" ? null : parent;
    }

    if (search) {
      filter.$or = [
        { name: new RegExp(search, "i") },
        { slug: new RegExp(search, "i") },
        { description: new RegExp(search, "i") },
      ];
    }

    const categories = await Category.find(filter)
      .populate("parent", "name slug")
      .populate("attributes", "name type values")
      .sort({ sortOrder: 1, name: 1 });

    console.log("📦 RETURNING CATEGORY LIST:", categories.length);

    res.status(200).json(categories);
  } catch (error) {
    console.error("❌ Get Categories Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/* ============================================================================
   GET CATEGORY BY ID
============================================================================ */
export const getCategoryById = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id)
      .populate("parent", "name slug")
      .populate("attributes", "name type values");

    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    res.status(200).json(category);
  } catch (error) {
    console.error("❌ Get Category Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/* ============================================================================
   UPDATE CATEGORY  
============================================================================ */
export const updateCategory = async (req, res) => {
  try {
    const updates = { ...req.body };

    console.log("✏️ RAW UPDATE BODY:", updates);

    // Convert "" → null
    if (updates.parent === "" || updates.parent === undefined)
      updates.parent = null;

    // Auto-update slug
    if (updates.name && !updates.slug) {
      updates.slug = slugify(updates.name, { lower: true });
    } else if (updates.slug) {
      updates.slug = slugify(updates.slug, { lower: true });
    }

    // Prevent duplicate
    if (updates.name || updates.slug) {
      const existing = await Category.findOne({
        $or: [{ name: updates.name }, { slug: updates.slug }],
        _id: { $ne: req.params.id },
      });

      if (existing) {
        return res.status(400).json({
          message: "Another category already exists with that name or slug.",
        });
      }
    }

    const updatedCategory = await Category.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    )
      .populate("parent", "name slug")
      .populate("attributes", "name type values");

    if (!updatedCategory) {
      return res.status(404).json({ message: "Category not found" });
    }

    res.status(200).json({
      message: "Category updated successfully",
      category: updatedCategory,
    });
  } catch (error) {
    console.error("❌ Update Category Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/* ============================================================================
   DELETE CATEGORY (block if subcategories exist)
============================================================================ */
export const deleteCategory = async (req, res) => {
  try {
    const categoryId = req.params.id;

    const child = await Category.findOne({ parent: categoryId });
    if (child) {
      return res.status(400).json({
        message: "This category has subcategories. Delete them first.",
      });
    }

    const deleted = await Category.findByIdAndDelete(categoryId);

    if (!deleted) {
      return res.status(404).json({ message: "Category not found" });
    }

    res.status(200).json({
      message: "Category deleted successfully",
    });
  } catch (error) {
    console.error("❌ Delete Category Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
