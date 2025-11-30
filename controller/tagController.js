import Tag from "../models/Tags.js"; // ✅ adjust path if your file is in /models

/**
 * @desc    Create a new tag
 * @route   POST /api/tags
 * @access  Private/Admin
 */
export const createTag = async (req, res) => {
  try {
    const { name, slug, color, description, isActive } = req.body;

    // Validation
    if (!name || !slug) {
      return res.status(400).json({ message: "Name and slug are required" });
    }

    // Check if tag already exists
    const existingTag = await Tag.findOne({ $or: [{ name }, { slug }] });
    if (existingTag) {
      return res.status(409).json({ message: "Tag name or slug already exists" });
    }

    const newTag = await Tag.create({
      name,
      slug,
      color,
      description,
      isActive,
    });

    res.status(201).json({
      message: "Tag created successfully",
      tag: newTag,
    });
  } catch (error) {
    console.error("❌ Error creating tag:", error);
    res.status(500).json({ message: "Server error while creating tag", error: error.message });
  }
};

/**
 * @desc    Get all tags
 * @route   GET /api/tags
 * @access  Public
 */
export const getAllTags = async (req, res) => {
  try {
    const tags = await Tag.find().sort({ createdAt: -1 });
    res.status(200).json(tags);
  } catch (error) {
    console.error("❌ Error fetching tags:", error);
    res.status(500).json({ message: "Server error while fetching tags", error: error.message });
  }
};

/**
 * @desc    Get tag by ID
 * @route   GET /api/tags/:id
 * @access  Public
 */
export const getTagById = async (req, res) => {
  try {
    const tag = await Tag.findById(req.params.id);
    if (!tag) {
      return res.status(404).json({ message: "Tag not found" });
    }
    res.status(200).json(tag);
  } catch (error) {
    console.error("❌ Error fetching tag:", error);
    res.status(500).json({ message: "Server error while fetching tag", error: error.message });
  }
};

/**
 * @desc    Update tag
 * @route   PUT /api/tags/:id
 * @access  Private/Admin
 */
export const updateTag = async (req, res) => {
  try {
    const { name, slug, color, description, isActive } = req.body;

    const updatedTag = await Tag.findByIdAndUpdate(
      req.params.id,
      { name, slug, color, description, isActive },
      { new: true, runValidators: true }
    );

    if (!updatedTag) {
      return res.status(404).json({ message: "Tag not found" });
    }

    res.status(200).json({
      message: "Tag updated successfully",
      tag: updatedTag,
    });
  } catch (error) {
    console.error("❌ Error updating tag:", error);
    res.status(500).json({ message: "Server error while updating tag", error: error.message });
  }
};

/**
 * @desc    Delete tag
 * @route   DELETE /api/tags/:id
 * @access  Private/Admin
 */
export const deleteTag = async (req, res) => {
  try {
    const deletedTag = await Tag.findByIdAndDelete(req.params.id);

    if (!deletedTag) {
      return res.status(404).json({ message: "Tag not found" });
    }

    res.status(200).json({
      message: "Tag deleted successfully",
    });
  } catch (error) {
    console.error("❌ Error deleting tag:", error);
    res.status(500).json({ message: "Server error while deleting tag", error: error.message });
  }
};
