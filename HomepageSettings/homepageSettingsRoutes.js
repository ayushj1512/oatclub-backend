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

  getOatGallery,
  getAdminOatGallery,
  updateOatGallery,

  getCollectionRowBanners,
  getAdminCollectionRowBanners,
  updateCollectionRowBanners,
} from "./homepageSettingsController.js";

const router = express.Router();

/* Complete homepage settings */
router.get("/", getHomepageSettings);
router.put("/", updateHomepageSettings);

/* Hero banners */
router.get("/hero-banners", getHeroBanners);
router.put("/hero-banners", updateHeroBanners);
router.put("/hero-banners/desktop", updateDesktopHeroBanners);
router.put("/hero-banners/mobile", updateMobileHeroBanners);

/* Category banners */
router.get("/category-banners", getCategoryBanners);
router.put("/category-banners", updateCategoryBanners);

/* Category row */
router.get("/category-row", getCategoryRow);
router.put("/category-row", updateCategoryRow);

/* OAT Gallery */
router.get("/oat-gallery", getOatGallery);
router.get("/oat-gallery/admin", getAdminOatGallery);
router.put("/oat-gallery", updateOatGallery);

/* Collection row banners */
router.get("/collection-row-banners", getCollectionRowBanners);
router.get(
  "/collection-row-banners/admin",
  getAdminCollectionRowBanners
);
router.put(
  "/collection-row-banners",
  updateCollectionRowBanners
);

export default router;
