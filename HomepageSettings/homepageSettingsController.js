import HomepageSettings from "./HomepageSettings.js";

/* =========================================================
   Helpers
========================================================= */

const ALLOWED_NAVIGATION_TYPES = ["collection", "category", "custom"];

const validateCategoryRow = (items = []) => {
  if (!Array.isArray(items)) return "categoryRow must be an array";

  for (const item of items) {
    if (!item?.name?.trim()) return "Each categoryRow item must have a name";

    if (!item?.navigationType)
      return "Each categoryRow item must have navigationType";

    if (!ALLOWED_NAVIGATION_TYPES.includes(item.navigationType))
      return "navigationType must be collection, category or custom";

    if (
      ["collection", "category"].includes(item.navigationType) &&
      !item?.slug?.trim()
    ) {
      return "Each collection/category item must have a slug";
    }

    if (item.navigationType === "custom" && !item?.customRoute?.trim()) {
      return "Each custom item must have a customRoute";
    }

    if (!item?.image?.trim() && !item?.video?.trim()) {
      return "Each categoryRow item must have image or video";
    }
  }

  return null;
};

const validateHeroBanners = (banners = []) => {
  if (!Array.isArray(banners)) return "heroBanners must be an array";

  for (const b of banners) {
    if (!b?.desktopImage?.trim())
      return "Each hero banner must have a desktopImage";

    if (!b?.mobileImage?.trim())
      return "Each hero banner must have a mobileImage";
  }

  return null;
};

const validateCategoryBanners = (banners = []) => {
  if (!Array.isArray(banners)) return "categoryBanners must be an array";

  for (const b of banners) {
    if (!b?.categoryName?.trim())
      return "Each category banner must have a categoryName";

    if (!b?.categorySlug?.trim())
      return "Each category banner must have a categorySlug";

    if (!b?.image?.trim()) return "Each category banner must have an image";
  }

  return null;
};

const normalizeCategoryRow = (items = []) =>
  items.map((item, index) => {
    const navigationType = item?.navigationType || "category";

    return {
      name: item?.name?.trim() || "",
      navigationType,
      slug:
        navigationType === "collection" || navigationType === "category"
          ? item?.slug?.trim() || ""
          : "",
      customRoute:
        navigationType === "custom" ? item?.customRoute?.trim() || "" : "",
      tag: item?.tag?.trim() || "",
      image: item?.image?.trim() || "",
      video: item?.video?.trim() || "",
      isActive: item?.isActive !== false,
      sortOrder: typeof item?.sortOrder === "number" ? item.sortOrder : index,
    };
  });

const normalizeHeroBanners = (banners = []) =>
  banners.map((b, index) => ({
    desktopImage: b?.desktopImage?.trim() || "",
    mobileImage: b?.mobileImage?.trim() || "",
    link: b?.link?.trim() || "",
    title: b?.title?.trim() || "",
    isActive: b?.isActive !== false,
    sortOrder: typeof b?.sortOrder === "number" ? b.sortOrder : index,
  }));

const normalizeCategoryBanners = (banners = []) =>
  banners.map((b, index) => {
    const categorySlug = b?.categorySlug?.trim() || "";

    return {
      categoryName: b?.categoryName?.trim() || "",
      categorySlug,
      title: b?.title?.trim() || b?.categoryName?.trim() || "",
      subtitle: b?.subtitle?.trim() || "",
      image: b?.image?.trim() || "",
      link: b?.link?.trim() || (categorySlug ? `/category/${categorySlug}` : ""),
      isActive: b?.isActive !== false,
      sortOrder: typeof b?.sortOrder === "number" ? b.sortOrder : index,
    };
  });

const getOrCreateDefaultSettings = async () => {
  let doc = await HomepageSettings.findOne({ key: "default" });

  if (!doc) {
    doc = await HomepageSettings.create({
      key: "default",
      heroBanners: [],
      categoryRow: [],
      categoryBanners: [],
    });
  }

  return doc;
};

/* =========================================================
   GET HOMEPAGE SETTINGS
========================================================= */
export const getHomepageSettings = async (req, res) => {
  try {
    const settings = await getOrCreateDefaultSettings();

    const heroBanners = (settings.heroBanners || [])
      .filter((b) => b.isActive !== false)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

    const categoryRow = (settings.categoryRow || [])
      .filter((c) => c.isActive !== false)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

    const categoryBanners = (settings.categoryBanners || [])
      .filter((c) => c.isActive !== false)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

    res.json({
      ...settings.toObject(),
      heroBanners,
      categoryRow,
      categoryBanners,
    });
  } catch (err) {
    console.error("getHomepageSettings error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* =========================================================
   UPDATE HOMEPAGE SETTINGS
========================================================= */
export const updateHomepageSettings = async (req, res) => {
  try {
    const updates = { ...req.body };

    if (updates.categoryRow) {
      const err = validateCategoryRow(updates.categoryRow);
      if (err) return res.status(400).json({ message: err });
      updates.categoryRow = normalizeCategoryRow(updates.categoryRow);
    }

    if (updates.heroBanners) {
      const err = validateHeroBanners(updates.heroBanners);
      if (err) return res.status(400).json({ message: err });
      updates.heroBanners = normalizeHeroBanners(updates.heroBanners);
    }

    if (updates.categoryBanners) {
      const err = validateCategoryBanners(updates.categoryBanners);
      if (err) return res.status(400).json({ message: err });
      updates.categoryBanners = normalizeCategoryBanners(updates.categoryBanners);
    }

    await getOrCreateDefaultSettings();

    const updated = await HomepageSettings.findOneAndUpdate(
      { key: "default" },
      { ...updates, key: "default" },
      { new: true, runValidators: true }
    );

    res.json(updated);
  } catch (err) {
    console.error("updateHomepageSettings error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* =========================================================
   GET CATEGORY BANNERS ONLY
========================================================= */
export const getCategoryBanners = async (req, res) => {
  try {
    const settings = await getOrCreateDefaultSettings();

    const categoryBanners = (settings.categoryBanners || [])
      .filter((c) => c.isActive !== false)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

    res.json({ categoryBanners });
  } catch (err) {
    console.error("getCategoryBanners error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* =========================================================
   UPDATE CATEGORY BANNERS ONLY
========================================================= */
export const updateCategoryBanners = async (req, res) => {
  try {
    const { categoryBanners } = req.body;

    const err = validateCategoryBanners(categoryBanners);
    if (err) return res.status(400).json({ message: err });

    await getOrCreateDefaultSettings();

    const updated = await HomepageSettings.findOneAndUpdate(
      { key: "default" },
      { categoryBanners: normalizeCategoryBanners(categoryBanners) },
      { new: true, runValidators: true }
    );

    res.json(updated);
  } catch (err) {
    console.error("updateCategoryBanners error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* =========================================================
   UPDATE HERO BANNERS ONLY
========================================================= */
export const updateHeroBanners = async (req, res) => {
  try {
    const { heroBanners } = req.body;

    const err = validateHeroBanners(heroBanners);
    if (err) return res.status(400).json({ message: err });

    await getOrCreateDefaultSettings();

    const updated = await HomepageSettings.findOneAndUpdate(
      { key: "default" },
      { heroBanners: normalizeHeroBanners(heroBanners) },
      { new: true, runValidators: true }
    );

    res.json(updated);
  } catch (err) {
    console.error("updateHeroBanners error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* =========================================================
   UPDATE CATEGORY ROW ONLY
========================================================= */
export const updateCategoryRow = async (req, res) => {
  try {
    const { categoryRow } = req.body;

    const err = validateCategoryRow(categoryRow);
    if (err) return res.status(400).json({ message: err });

    await getOrCreateDefaultSettings();

    const updated = await HomepageSettings.findOneAndUpdate(
      { key: "default" },
      { categoryRow: normalizeCategoryRow(categoryRow) },
      { new: true, runValidators: true }
    );

    res.json(updated);
  } catch (err) {
    console.error("updateCategoryRow error:", err);
    res.status(500).json({ message: err.message });
  }
};