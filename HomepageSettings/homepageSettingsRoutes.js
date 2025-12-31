import express from "express";
import {
  getHomepageSettings,
  updateHomepageSettings,
  updateHeroBanners,
  updateCategoryRow,
} from "./homepageSettingsController.js";

const router = express.Router();

/* ================= HOMEPAGE SETTINGS ROUTES ================= */

// Get default homepage settings
router.get("/", getHomepageSettings);

// Update full homepage settings (hero + category row + anything)
router.put("/", updateHomepageSettings);

// Update only hero banners
router.put("/hero-banners", updateHeroBanners);

// Update only category row
router.put("/category-row", updateCategoryRow);

export default router;
