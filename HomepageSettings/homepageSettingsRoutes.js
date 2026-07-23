import express from "express";

import {
  getHomepageSettings,
  updateHomepageSettings,

  getHeroBanners,
  updateHeroBanners,
  updateDesktopHeroBanners,
  updateMobileHeroBanners,

  getCategoryBanners,
  updateCategoryBanners,

  getCategoryRow,
  updateCategoryRow,
} from "./homepageSettingsController.js";

const router = express.Router();

/* =========================================================
   HOMEPAGE SETTINGS
========================================================= */

// Get complete homepage settings
router.get("/", getHomepageSettings);

// Update complete homepage settings
// Supports:
// - desktopHeroBanners
// - mobileHeroBanners
// - categoryRow
// - categoryBanners
router.put("/", updateHomepageSettings);

/* =========================================================
   HERO BANNERS
========================================================= */

// Get active desktop and mobile hero banners
router.get("/hero-banners", getHeroBanners);

// Update desktop and/or mobile hero banners
router.put("/hero-banners", updateHeroBanners);

// Update desktop hero banners only
router.put(
  "/hero-banners/desktop",
  updateDesktopHeroBanners
);

// Update mobile hero banners only
router.put(
  "/hero-banners/mobile",
  updateMobileHeroBanners
);

/* =========================================================
   CATEGORY BANNERS
========================================================= */

// Get active homepage category banners
router.get("/category-banners", getCategoryBanners);

// Update homepage category banners
router.put("/category-banners", updateCategoryBanners);

/* =========================================================
   CATEGORY ROW
========================================================= */

// Get active homepage category row
router.get("/category-row", getCategoryRow);

// Update homepage category row
router.put("/category-row", updateCategoryRow);

export default router;