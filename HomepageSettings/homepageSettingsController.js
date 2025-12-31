import HomepageSettings from "./HomepageSettings.js";

/* =========================================================
   Helpers
========================================================= */

// Validate category row items
const validateCategoryRow = (items = []) => {
  if (!Array.isArray(items)) return "categoryRow must be an array";

  for (const item of items) {
    const hasSlugOrTag = Boolean(item.slug) || Boolean(item.tag);
    const hasImageOrVideo = Boolean(item.image) || Boolean(item.video);

    if (!item.name) return "Each categoryRow item must have a name";
    if (!hasSlugOrTag) return "Each categoryRow item must have slug or tag";
    if (!hasImageOrVideo) return "Each categoryRow item must have image or video";
  }

  return null;
};

// Validate hero banners
const validateHeroBanners = (banners = []) => {
  if (!Array.isArray(banners)) return "heroBanners must be an array";

  for (const b of banners) {
    if (!b.image) return "Each hero banner must have an image";
  }

  return null;
};

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
   GET HOMEPAGE SETTINGS (default)
   GET /api/homepage-settings
========================================================= */
export const getHomepageSettings = async (req, res) => {
  try {
    const settings = await getOrCreateDefaultSettings();

    // Optional: return only active items
    const heroBanners = (settings.heroBanners || [])
      .filter((b) => b.isActive !== false)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

    const categoryRow = (settings.categoryRow || [])
      .filter((c) => c.isActive !== false)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

    return res.json({
      ...settings.toObject(),
      heroBanners,
      categoryRow,
    });
  } catch (err) {
    console.error("Get homepage settings error:", err);
    return res.status(500).json({ message: err.message });
  }
};

/* =========================================================
   UPDATE HOMEPAGE SETTINGS (default)
   PUT /api/homepage-settings
========================================================= */
export const updateHomepageSettings = async (req, res) => {
  try {
    const updates = { ...req.body };

    // ✅ Validations
    if (updates.categoryRow) {
      const errMsg = validateCategoryRow(updates.categoryRow);
      if (errMsg) return res.status(400).json({ message: errMsg });
    }

    if (updates.heroBanners) {
      const errMsg = validateHeroBanners(updates.heroBanners);
      if (errMsg) return res.status(400).json({ message: errMsg });
    }

    // ✅ Ensure default settings exist
    await getOrCreateDefaultSettings();

    const updated = await HomepageSettings.findOneAndUpdate(
      { key: "default" },
      {
        ...updates,
        key: "default",
      },
      { new: true, runValidators: true }
    );

    return res.json(updated);
  } catch (err) {
    console.error("Update homepage settings error:", err);
    return res.status(500).json({ message: err.message });
  }
};

/* =========================================================
   UPDATE ONLY HERO BANNERS
   PUT /api/homepage-settings/hero-banners
========================================================= */
export const updateHeroBanners = async (req, res) => {
  try {
    const { heroBanners } = req.body;

    const errMsg = validateHeroBanners(heroBanners);
    if (errMsg) return res.status(400).json({ message: errMsg });

    await getOrCreateDefaultSettings();

    const updated = await HomepageSettings.findOneAndUpdate(
      { key: "default" },
      { heroBanners },
      { new: true, runValidators: true }
    );

    return res.json(updated);
  } catch (err) {
    console.error("Update hero banners error:", err);
    return res.status(500).json({ message: err.message });
  }
};

/* =========================================================
   UPDATE ONLY CATEGORY ROW
   PUT /api/homepage-settings/category-row
========================================================= */
export const updateCategoryRow = async (req, res) => {
  try {
    const { categoryRow } = req.body;

    const errMsg = validateCategoryRow(categoryRow);
    if (errMsg) return res.status(400).json({ message: errMsg });

    await getOrCreateDefaultSettings();

    const updated = await HomepageSettings.findOneAndUpdate(
      { key: "default" },
      { categoryRow },
      { new: true, runValidators: true }
    );

    return res.json(updated);
  } catch (err) {
    console.error("Update category row error:", err);
    return res.status(500).json({ message: err.message });
  }
};
