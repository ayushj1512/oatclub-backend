// controllers/sizeChartController.js
import mongoose from "mongoose";
import SizeChart from "./SizeChart.js";

/* ---------------- helpers ---------------- */
const normalizeObjectIds = (val) => {
  if (!val) return [];

  const arr = Array.isArray(val)
    ? val
    : typeof val === "string"
    ? val.split(",")
    : [];

  return arr
    .map((id) => String(id).trim())
    .filter((id) => mongoose.Types.ObjectId.isValid(id));
};

/* =========================================================
   CREATE SIZE CHART
========================================================= */
export const createSizeChart = async (req, res) => {
  try {
    const {
      title,
      unit = "cm",
      headers,
      rows,
      note = "",
      categories,
    } = req.body;

    /* ---------------- basic validation ---------------- */
    if (
      !title ||
      !Array.isArray(headers) ||
      headers.length === 0 ||
      !Array.isArray(rows) ||
      rows.length === 0
    ) {
      return res.status(400).json({
        message: "Title, headers and rows are required",
      });
    }

    /* ---------------- table validation ---------------- */
    const invalidRow = rows.find((r) => r.length !== headers.length);
    if (invalidRow) {
      return res.status(400).json({
        message: "Each row length must match headers length",
      });
    }

    /* ---------------- categories ---------------- */
    const finalCategories = normalizeObjectIds(categories);

    const sizeChart = await SizeChart.create({
      title: title.trim(),
      unit,
      headers,
      rows,
      note: String(note || "").trim(),
      categories: finalCategories,
    });

    const populated = await SizeChart.findById(sizeChart._id).populate(
      "categories",
      "name slug"
    );

    return res.status(201).json(populated);
  } catch (err) {
    console.error("Create size chart error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* =========================================================
   GET ALL SIZE CHARTS
========================================================= */
export const getAllSizeCharts = async (req, res) => {
  try {
    const charts = await SizeChart.find()
      .populate("categories", "name slug")
      .sort({ createdAt: -1 });

    res.json(charts);
  } catch (err) {
    console.error("Fetch size charts error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* =========================================================
   GET SIZE CHART BY ID
========================================================= */
export const getSizeChartById = async (req, res) => {
  try {
    const chart = await SizeChart.findById(req.params.id).populate(
      "categories",
      "name slug"
    );

    if (!chart) {
      return res.status(404).json({ message: "Size chart not found" });
    }

    res.json(chart);
  } catch (err) {
    console.error("Fetch size chart error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* =========================================================
   UPDATE SIZE CHART
========================================================= */
export const updateSizeChart = async (req, res) => {
  try {
    const updates = { ...req.body };

    /* ---------------- headers / rows validation ---------------- */
    if (updates.headers && updates.rows) {
      const invalidRow = updates.rows.find(
        (r) => r.length !== updates.headers.length
      );

      if (invalidRow) {
        return res.status(400).json({
          message: "Each row length must match headers length",
        });
      }
    }

    /* ---------------- normalize categories ---------------- */
    if (updates.categories !== undefined) {
      updates.categories = normalizeObjectIds(updates.categories);
    }

    if (updates.title !== undefined) {
      updates.title = String(updates.title).trim();
    }

    if (updates.note !== undefined) {
      updates.note = String(updates.note || "").trim();
    }

    const updatedChart = await SizeChart.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    ).populate("categories", "name slug");

    if (!updatedChart) {
      return res.status(404).json({ message: "Size chart not found" });
    }

    res.json(updatedChart);
  } catch (err) {
    console.error("Update size chart error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* =========================================================
   DELETE SIZE CHART
========================================================= */
export const deleteSizeChart = async (req, res) => {
  try {
    const deleted = await SizeChart.findByIdAndDelete(req.params.id);

    if (!deleted) {
      return res.status(404).json({ message: "Size chart not found" });
    }

    res.json({ message: "Size chart deleted successfully" });
  } catch (err) {
    console.error("Delete size chart error:", err);
    res.status(500).json({ message: err.message });
  }
};
