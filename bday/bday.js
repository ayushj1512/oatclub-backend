import express from "express";
import mongoose from "mongoose";

const router = express.Router();

const bdayWishSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: 80,
    },
    message: {
      type: String,
      required: [true, "Birthday message is required"],
      trim: true,
      maxlength: 500,
    },
  },
  { timestamps: true }
);

const BdayWish =
  mongoose.models.BdayWish ||
  mongoose.model("BdayWish", bdayWishSchema);

// CREATE WISH
router.post("/", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const message = String(req.body?.message || "").trim();

    if (!name || !message) {
      return res.status(400).json({
        success: false,
        message: "Name and birthday message are required",
      });
    }

    const wish = await BdayWish.create({ name, message });

    return res.status(201).json({
      success: true,
      message: "Birthday wish submitted successfully",
      couponCode: "BOSSBDAY20",
      discount: 20,
      wish,
    });
  } catch (error) {
    console.error("Create birthday wish error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to submit birthday wish",
    });
  }
});

// READ ALL WISHES
router.get("/", async (req, res) => {
  try {
    const wishes = await BdayWish.find()
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: wishes.length,
      wishes,
    });
  } catch (error) {
    console.error("Get birthday wishes error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch birthday wishes",
    });
  }
});

export default router;
