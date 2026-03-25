import HomepageSettings from "./HomepageSettings.js";

/* =========================================================
   Helpers
========================================================= */

const ALLOWED_NAVIGATION_TYPES = ["collection", "category", "custom"];

// Validate category row items
const validateCategoryRow = (items = []) => {
  if (!Array.isArray(items)) return "categoryRow must be an array";

  for (const item of items) {
    if (!item?.name?.trim())
      return "Each categoryRow item must have a name";

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

// Validate hero banners
const validateHeroBanners = (banners = []) => {
  if (!Array.isArray(banners)) return "heroBanners must be an array";

  for (const b of banners) {
    if (!b?.image?.trim()) return "Each hero banner must have an image";
  }

  return null;
};

// Normalize category row items
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
      sortOrder:
        typeof item?.sortOrder === "number" ? item.sortOrder : index,
    };
  });

// Normalize hero banners
const normalizeHeroBanners = (banners = []) =>
  banners.map((b, index) => ({
    image: b?.image?.trim() || "",
    link: b?.link?.trim() || "",
    title: b?.title?.trim() || "",
    isActive: b?.isActive !== false,
    sortOrder: typeof b?.sortOrder === "number" ? b.sortOrder : index,
  }));

// Get or create default settings
const getOrCreateDefaultSettings = async () => {
  let doc = await HomepageSettings.findOne({ key: "default" });

  if (!doc) {
    doc = await HomepageSettings.create({
      key: "default",
      heroBanners: [],
      categoryRow: [],
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

    res.json({
      ...settings.toObject(),
      heroBanners,
      categoryRow,
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