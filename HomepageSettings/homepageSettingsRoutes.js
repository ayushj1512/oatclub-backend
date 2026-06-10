import express from "express";
import {
  getCategoryBanners,
  getHomepageSettings,
  updateHomepageSettings,
  updateHeroBanners,
  updateCategoryBanners,
  updateCategoryRow,
} from "./homepageSettingsController.js";

const router = express.Router();

/* ================= HOMEPAGE SETTINGS ROUTES ================= */

// Get full homepage settings
router.get("/", getHomepageSettings);

// Update full homepage settings
// Supports:
// - heroBanners: desktopImage + mobileImage
// - categoryRow
// - categoryBanners: single image only
router.put("/", updateHomepageSettings);

// Update only hero banners
// Each hero banner requires desktopImage + mobileImage
router.put("/hero-banners", updateHeroBanners);

// Get only homepage category banners
router.get("/category-banners", getCategoryBanners);

// Update only homepage category banners
// Each category banner requires only image
router.put("/category-banners", updateCategoryBanners);

// Update only category row
router.put("/category-row", updateCategoryRow);

export default router;