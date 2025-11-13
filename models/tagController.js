import Tag from "../models/Tag.js";

/**
 * @desc Create a new tag
 * @route POST /api/tags
 * @access Private/Admin
 */
export const createTag = async (req, res) => {
  try {
    const { name, slug, color, description, isActive } = req.body;

    // Check if tag with same slug or name exists
    const existingTag = await Tag.findOne({ $or: [{ name }, { slug }] });
    if (existingTag) {
      return res.status(400).json({ message: "Tag with same name or slug already exists" });
    }

    const tag = await Tag.create({ name, slug, color, description, isActive });
    res.status(201).json({ message: "Tag created successfully", tag });
  } catch (error) {
    console.error("Error creating tag:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Get all tags
 * @route GET /api/tags
 * @access Public
 */
export const getAllTags = async (req, res) => {
  try {
    const { isActive } = req.query;
    const filter = {};

    if (isActive !== undefined) filter.isActive = isActive === "true";

    const tags = await Tag.find(filter).sort({ createdAt: -1 });
    res.status(200).json(tags);
  } catch (error) {
    console.error("Error fetching tags:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Get a single tag by ID
 * @route GET /api/tags/:id
 * @access Public
 */
export const getTagById = async (req, res) => {
  try {
    const tag = await Tag.findById(req.params.id);
    if (!tag) return res.status(404).json({ message: "Tag not found" });

    res.status(200).json(tag);
  } catch (error) {
    console.error("Error fetching tag:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Update a tag by ID
 * @route PUT /api/tags/:id
 * @access Private/Admin
 */
export const updateTag = async (req, res) => {
  try {
    const { name, slug, color, description, isActive } = req.body;

    const updatedTag = await Tag.findByIdAndUpdate(
      req.params.id,
      { name, slug, color, description, isActive },
      { new: true, runValidators: true }
    );

    if (!updatedTag) return res.status(404).json({ message: "Tag not found" });

    res.status(200).json({ message: "Tag updated successfully", tag: updatedTag });
  } catch (error) {
    console.error("Error updating tag:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Delete a tag by ID
 * @route DELETE /api/tags/:id
 * @access Private/Admin
 */
export const deleteTag = async (req, res) => {
  try {
    const deletedTag = await Tag.findByIdAndDelete(req.params.id);
    if (!deletedTag) return res.status(404).json({ message: "Tag not found" });

    res.status(200).json({ message: "Tag deleted successfully" });
  } catch (error) {
    console.error("Error deleting tag:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
