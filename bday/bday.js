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
    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
      maxlength: 254,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email"],
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
      trim: true,
      match: [/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian phone number"],
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

// Accepts 10 digits, +91, 91, or a leading 0.
const normalizePhone = (value) => {
  const digits = String(value ?? "").replace(/[\s()+-]/g, "");

  if (/^91[6-9]\d{9}$/.test(digits)) {
    return digits.slice(2);
  }

  if (/^0[6-9]\d{9}$/.test(digits)) {
    return digits.slice(1);
  }

  return digits;
};

// CREATE WISH
router.post("/", async (req, res) => {
  try {
    const name = String(req.body?.name ?? "").trim();
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const phone = normalizePhone(req.body?.phone);
    const message = String(req.body?.message ?? "").trim();

    if (!name || !email || !phone || !message) {
      return res.status(400).json({
        success: false,
        message: "Name, email, phone number and birthday message are required",
      });
    }

    const wish = await BdayWish.create({
      name,
      email,
      phone,
      message,
    });

    return res.status(201).json({
      success: true,
      message: "Birthday wish submitted successfully",
      couponCode: "BOSSBDAY20",
      discount: 20,
      wish,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: Object.values(error.errors)
          .map((item) => item.message)
          .join(", "),
      });
    }

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
