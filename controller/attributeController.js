import Attribute from "../models/Attribute.js";
import slugify from "slugify";

/* ============================================================================
   CREATE ATTRIBUTE
============================================================================ */
export const createAttribute = async (req, res) => {
  try {
    let { name, slug, type, values, isActive } = req.body;

    if (!name) return res.status(400).json({ message: "Name is required" });

    slug = slug ? slugify(slug, { lower: true }) : slugify(name, { lower: true });

    const exists = await Attribute.findOne({ slug });
    if (exists) {
      return res.status(400).json({ message: "Attribute already exists" });
    }

    const attribute = await Attribute.create({
      name,
      slug,
      type,
      values,
      isActive: isActive ?? true,
    });

    res.status(201).json({ message: "Attribute created", attribute });
  } catch (error) {
    console.error("Create Attribute Error:", error);
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

/* ============================================================================
   GET ALL ATTRIBUTES
============================================================================ */
export const getAllAttributes = async (req, res) => {
  try {
    const attributes = await Attribute.find().sort({ name: 1 });
    res.status(200).json(attributes);
  } catch (error) {
    console.error("Get Attributes Error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

/* ============================================================================
   GET ATTRIBUTE BY ID
============================================================================ */
export const getAttributeById = async (req, res) => {
  try {
    const attribute = await Attribute.findById(req.params.id);
    if (!attribute)
      return res.status(404).json({ message: "Attribute not found" });

    res.status(200).json(attribute);
  } catch (error) {
    console.error("Get Attribute Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

/* ============================================================================
   UPDATE ATTRIBUTE
============================================================================ */
export const updateAttribute = async (req, res) => {
  try {
    const updates = { ...req.body };

    if (updates.name && !updates.slug) {
      updates.slug = slugify(updates.name, { lower: true });
    } else if (updates.slug) {
      updates.slug = slugify(updates.slug, { lower: true });
    }

    const attribute = await Attribute.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true }
    );

    if (!attribute)
      return res.status(404).json({ message: "Attribute not found" });

    res.status(200).json({
      message: "Attribute updated",
      attribute,
    });
  } catch (error) {
    console.error("Update Attribute Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

/* ============================================================================
   DELETE ATTRIBUTE
============================================================================ */
export const deleteAttribute = async (req, res) => {
  try {
    const deleted = await Attribute.findByIdAndDelete(req.params.id);
    if (!deleted)
      return res.status(404).json({ message: "Attribute not found" });

    res.status(200).json({ message: "Attribute deleted" });
  } catch (error) {
    console.error("Delete Attribute Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
