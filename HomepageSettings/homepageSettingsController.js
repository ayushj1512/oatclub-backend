import HomepageSettings from "./HomepageSettings.js";

/* =========================================================
   Helpers
========================================================= */

// Validate category row items
const validateCategoryRow = (items = []) => {
  if (!Array.isArray(items)) return "categoryRow must be an array";

  for (const item of items) {
    if (!item.name) return "Each categoryRow item must have a name";

    if (!item.navigationType)
      return "Each categoryRow item must have navigationType";

    if (!["collection", "category"].includes(item.navigationType))
      return "navigationType must be either collection or category";

    if (!item.slug)
      return "Each categoryRow item must have a slug";

    if (!item.image && !item.video)
      return "Each categoryRow item must have image or video";
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
    console.error(err);
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
    }

    if (updates.heroBanners) {
      const err = validateHeroBanners(updates.heroBanners);
      if (err) return res.status(400).json({ message: err });
    }

    await getOrCreateDefaultSettings();

    const updated = await HomepageSettings.findOneAndUpdate(
      { key: "default" },
      { ...updates, key: "default" },
      { new: true, runValidators: true }
    );

    res.json(updated);
  } catch (err) {
    console.error(err);
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
      { heroBanners },
      { new: true, runValidators: true }
    );

    res.json(updated);
  } catch (err) {
    console.error(err);
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
      { categoryRow },
      { new: true, runValidators: true }
    );

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};
