import HomepageSettings from "./HomepageSettings.js";

/* =========================================================
   CONSTANTS
========================================================= */

const ALLOWED_NAVIGATION_TYPES = ["collection", "category", "custom"];

/* =========================================================
   COMMON HELPERS
========================================================= */

const isProvided = (value) => value !== undefined;

const sortByOrder = (items = []) =>
  [...items].sort(
    (firstItem, secondItem) =>
      Number(firstItem?.sortOrder || 0) -
      Number(secondItem?.sortOrder || 0)
  );

const getActiveItems = (items = []) =>
  sortByOrder(items.filter((item) => item?.isActive !== false));

/* =========================================================
   VALIDATION HELPERS
========================================================= */

const validateCategoryRow = (items = []) => {
  if (!Array.isArray(items)) {
    return "categoryRow must be an array";
  }

  for (const item of items) {
    if (!item?.name?.trim()) {
      return "Each categoryRow item must have a name";
    }

    if (!item?.navigationType) {
      return "Each categoryRow item must have navigationType";
    }

    if (!ALLOWED_NAVIGATION_TYPES.includes(item.navigationType)) {
      return "navigationType must be collection, category or custom";
    }

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

const validateHeroBanners = (banners = [], fieldName = "heroBanners") => {
  if (!Array.isArray(banners)) {
    return `${fieldName} must be an array`;
  }

  for (const banner of banners) {
    if (!banner?.image?.trim()) {
      return `Each ${fieldName} item must have an image`;
    }
  }

  return null;
};

const validateCategoryBanners = (banners = []) => {
  if (!Array.isArray(banners)) {
    return "categoryBanners must be an array";
  }

  for (const banner of banners) {
    if (!banner?.categoryName?.trim()) {
      return "Each category banner must have a categoryName";
    }

    if (!banner?.categorySlug?.trim()) {
      return "Each category banner must have a categorySlug";
    }

    if (!banner?.image?.trim()) {
      return "Each category banner must have an image";
    }
  }

  return null;
};

/* =========================================================
   NORMALIZATION HELPERS
========================================================= */

const normalizeCategoryRow = (items = []) =>
  items.map((item, index) => {
    const navigationType = item?.navigationType || "category";

    return {
      name: item?.name?.trim() || "",
      navigationType,

      slug: ["collection", "category"].includes(navigationType)
        ? item?.slug?.trim() || ""
        : "",

      customRoute:
        navigationType === "custom"
          ? item?.customRoute?.trim() || ""
          : "",

      tag: item?.tag?.trim() || "",
      image: item?.image?.trim() || "",
      video: item?.video?.trim() || "",

      isActive: item?.isActive !== false,

      sortOrder: Number.isFinite(Number(item?.sortOrder))
        ? Number(item.sortOrder)
        : index,
    };
  });

const normalizeHeroBanners = (banners = []) =>
  banners.map((banner, index) => ({
    image: banner?.image?.trim() || "",
    link: banner?.link?.trim() || "",
    title: banner?.title?.trim() || "",

    isActive: banner?.isActive !== false,

    sortOrder: Number.isFinite(Number(banner?.sortOrder))
      ? Number(banner.sortOrder)
      : index,
  }));

const normalizeCategoryBanners = (banners = []) =>
  banners.map((banner, index) => {
    const categoryName = banner?.categoryName?.trim() || "";
    const categorySlug = banner?.categorySlug?.trim() || "";

    return {
      categoryName,
      categorySlug,

      title: banner?.title?.trim() || categoryName,
      subtitle: banner?.subtitle?.trim() || "",

      image: banner?.image?.trim() || "",

      link:
        banner?.link?.trim() ||
        (categorySlug ? `/category/${categorySlug}` : ""),

      isActive: banner?.isActive !== false,

      sortOrder: Number.isFinite(Number(banner?.sortOrder))
        ? Number(banner.sortOrder)
        : index,
    };
  });

/* =========================================================
   DEFAULT SETTINGS
========================================================= */

const getOrCreateDefaultSettings = async () => {
  let settings = await HomepageSettings.findOne({
    key: "default",
  });

  if (!settings) {
    settings = await HomepageSettings.create({
      key: "default",
      desktopHeroBanners: [],
      mobileHeroBanners: [],
      categoryRow: [],
      categoryBanners: [],
    });
  }

  return settings;
};

/* =========================================================
   FORMAT SETTINGS RESPONSE
========================================================= */

const formatSettingsResponse = (
  settings,
  { activeOnly = false } = {}
) => {
  const plainSettings =
    typeof settings?.toObject === "function"
      ? settings.toObject()
      : settings;

  const formatItems = activeOnly ? getActiveItems : sortByOrder;

  return {
    ...plainSettings,

    desktopHeroBanners: formatItems(
      plainSettings?.desktopHeroBanners || []
    ),

    mobileHeroBanners: formatItems(
      plainSettings?.mobileHeroBanners || []
    ),

    categoryRow: formatItems(plainSettings?.categoryRow || []),

    categoryBanners: formatItems(
      plainSettings?.categoryBanners || []
    ),
  };
};

/* =========================================================
   GET HOMEPAGE SETTINGS
========================================================= */

export const getHomepageSettings = async (req, res) => {
  try {
    const settings = await getOrCreateDefaultSettings();

    return res.status(200).json(
      formatSettingsResponse(settings, {
        activeOnly: true,
      })
    );
  } catch (error) {
    console.error("getHomepageSettings error:", error);

    return res.status(500).json({
      message: error.message || "Failed to fetch homepage settings",
    });
  }
};

/* =========================================================
   UPDATE HOMEPAGE SETTINGS
========================================================= */

export const updateHomepageSettings = async (req, res) => {
  try {
    const updates = {};

    if (isProvided(req.body?.desktopHeroBanners)) {
      const error = validateHeroBanners(
        req.body.desktopHeroBanners,
        "desktopHeroBanners"
      );

      if (error) {
        return res.status(400).json({
          message: error,
        });
      }

      updates.desktopHeroBanners = normalizeHeroBanners(
        req.body.desktopHeroBanners
      );
    }

    if (isProvided(req.body?.mobileHeroBanners)) {
      const error = validateHeroBanners(
        req.body.mobileHeroBanners,
        "mobileHeroBanners"
      );

      if (error) {
        return res.status(400).json({
          message: error,
        });
      }

      updates.mobileHeroBanners = normalizeHeroBanners(
        req.body.mobileHeroBanners
      );
    }

    if (isProvided(req.body?.categoryRow)) {
      const error = validateCategoryRow(req.body.categoryRow);

      if (error) {
        return res.status(400).json({
          message: error,
        });
      }

      updates.categoryRow = normalizeCategoryRow(
        req.body.categoryRow
      );
    }

    if (isProvided(req.body?.categoryBanners)) {
      const error = validateCategoryBanners(
        req.body.categoryBanners
      );

      if (error) {
        return res.status(400).json({
          message: error,
        });
      }

      updates.categoryBanners = normalizeCategoryBanners(
        req.body.categoryBanners
      );
    }

    if (req.user?._id) {
      updates.updatedBy = req.user._id;
    }

    await getOrCreateDefaultSettings();

    const updatedSettings =
      await HomepageSettings.findOneAndUpdate(
        {
          key: "default",
        },
        {
          $set: {
            ...updates,
            key: "default",
          },
        },
        {
          new: true,
          runValidators: true,
        }
      );

    return res.status(200).json(
      formatSettingsResponse(updatedSettings)
    );
  } catch (error) {
    console.error("updateHomepageSettings error:", error);

    return res.status(500).json({
      message: error.message || "Failed to update homepage settings",
    });
  }
};

/* =========================================================
   GET HERO BANNERS ONLY
========================================================= */

export const getHeroBanners = async (req, res) => {
  try {
    const settings = await getOrCreateDefaultSettings();

    return res.status(200).json({
      desktopHeroBanners: getActiveItems(
        settings.desktopHeroBanners || []
      ),

      mobileHeroBanners: getActiveItems(
        settings.mobileHeroBanners || []
      ),
    });
  } catch (error) {
    console.error("getHeroBanners error:", error);

    return res.status(500).json({
      message: error.message || "Failed to fetch hero banners",
    });
  }
};

/* =========================================================
   UPDATE ALL HERO BANNERS
========================================================= */

export const updateHeroBanners = async (req, res) => {
  try {
    const {
      desktopHeroBanners,
      mobileHeroBanners,
    } = req.body;

    if (
      !isProvided(desktopHeroBanners) &&
      !isProvided(mobileHeroBanners)
    ) {
      return res.status(400).json({
        message:
          "desktopHeroBanners or mobileHeroBanners is required",
      });
    }

    const updates = {};

    if (isProvided(desktopHeroBanners)) {
      const error = validateHeroBanners(
        desktopHeroBanners,
        "desktopHeroBanners"
      );

      if (error) {
        return res.status(400).json({
          message: error,
        });
      }

      updates.desktopHeroBanners = normalizeHeroBanners(
        desktopHeroBanners
      );
    }

    if (isProvided(mobileHeroBanners)) {
      const error = validateHeroBanners(
        mobileHeroBanners,
        "mobileHeroBanners"
      );

      if (error) {
        return res.status(400).json({
          message: error,
        });
      }

      updates.mobileHeroBanners = normalizeHeroBanners(
        mobileHeroBanners
      );
    }

    if (req.user?._id) {
      updates.updatedBy = req.user._id;
    }

    await getOrCreateDefaultSettings();

    const updatedSettings =
      await HomepageSettings.findOneAndUpdate(
        {
          key: "default",
        },
        {
          $set: updates,
        },
        {
          new: true,
          runValidators: true,
        }
      );

    return res.status(200).json({
      desktopHeroBanners: sortByOrder(
        updatedSettings.desktopHeroBanners || []
      ),

      mobileHeroBanners: sortByOrder(
        updatedSettings.mobileHeroBanners || []
      ),
    });
  } catch (error) {
    console.error("updateHeroBanners error:", error);

    return res.status(500).json({
      message: error.message || "Failed to update hero banners",
    });
  }
};

/* =========================================================
   UPDATE DESKTOP HERO BANNERS ONLY
========================================================= */

export const updateDesktopHeroBanners = async (req, res) => {
  try {
    const { desktopHeroBanners } = req.body;

    const error = validateHeroBanners(
      desktopHeroBanners,
      "desktopHeroBanners"
    );

    if (error) {
      return res.status(400).json({
        message: error,
      });
    }

    await getOrCreateDefaultSettings();

    const updateData = {
      desktopHeroBanners: normalizeHeroBanners(
        desktopHeroBanners
      ),
    };

    if (req.user?._id) {
      updateData.updatedBy = req.user._id;
    }

    const updatedSettings =
      await HomepageSettings.findOneAndUpdate(
        {
          key: "default",
        },
        {
          $set: updateData,
        },
        {
          new: true,
          runValidators: true,
        }
      );

    return res.status(200).json({
      desktopHeroBanners: sortByOrder(
        updatedSettings.desktopHeroBanners || []
      ),
    });
  } catch (error) {
    console.error("updateDesktopHeroBanners error:", error);

    return res.status(500).json({
      message:
        error.message || "Failed to update desktop hero banners",
    });
  }
};

/* =========================================================
   UPDATE MOBILE HERO BANNERS ONLY
========================================================= */

export const updateMobileHeroBanners = async (req, res) => {
  try {
    const { mobileHeroBanners } = req.body;

    const error = validateHeroBanners(
      mobileHeroBanners,
      "mobileHeroBanners"
    );

    if (error) {
      return res.status(400).json({
        message: error,
      });
    }

    await getOrCreateDefaultSettings();

    const updateData = {
      mobileHeroBanners: normalizeHeroBanners(
        mobileHeroBanners
      ),
    };

    if (req.user?._id) {
      updateData.updatedBy = req.user._id;
    }

    const updatedSettings =
      await HomepageSettings.findOneAndUpdate(
        {
          key: "default",
        },
        {
          $set: updateData,
        },
        {
          new: true,
          runValidators: true,
        }
      );

    return res.status(200).json({
      mobileHeroBanners: sortByOrder(
        updatedSettings.mobileHeroBanners || []
      ),
    });
  } catch (error) {
    console.error("updateMobileHeroBanners error:", error);

    return res.status(500).json({
      message:
        error.message || "Failed to update mobile hero banners",
    });
  }
};

/* =========================================================
   GET CATEGORY BANNERS ONLY
========================================================= */

export const getCategoryBanners = async (req, res) => {
  try {
    const settings = await getOrCreateDefaultSettings();

    return res.status(200).json({
      categoryBanners: getActiveItems(
        settings.categoryBanners || []
      ),
    });
  } catch (error) {
    console.error("getCategoryBanners error:", error);

    return res.status(500).json({
      message: error.message || "Failed to fetch category banners",
    });
  }
};

/* =========================================================
   UPDATE CATEGORY BANNERS ONLY
========================================================= */

export const updateCategoryBanners = async (req, res) => {
  try {
    const { categoryBanners } = req.body;

    const error = validateCategoryBanners(categoryBanners);

    if (error) {
      return res.status(400).json({
        message: error,
      });
    }

    await getOrCreateDefaultSettings();

    const updateData = {
      categoryBanners:
        normalizeCategoryBanners(categoryBanners),
    };

    if (req.user?._id) {
      updateData.updatedBy = req.user._id;
    }

    const updatedSettings =
      await HomepageSettings.findOneAndUpdate(
        {
          key: "default",
        },
        {
          $set: updateData,
        },
        {
          new: true,
          runValidators: true,
        }
      );

    return res.status(200).json({
      categoryBanners: sortByOrder(
        updatedSettings.categoryBanners || []
      ),
    });
  } catch (error) {
    console.error("updateCategoryBanners error:", error);

    return res.status(500).json({
      message:
        error.message || "Failed to update category banners",
    });
  }
};

/* =========================================================
   GET CATEGORY ROW ONLY
========================================================= */

export const getCategoryRow = async (req, res) => {
  try {
    const settings = await getOrCreateDefaultSettings();

    return res.status(200).json({
      categoryRow: getActiveItems(settings.categoryRow || []),
    });
  } catch (error) {
    console.error("getCategoryRow error:", error);

    return res.status(500).json({
      message: error.message || "Failed to fetch category row",
    });
  }
};

/* =========================================================
   UPDATE CATEGORY ROW ONLY
========================================================= */

export const updateCategoryRow = async (req, res) => {
  try {
    const { categoryRow } = req.body;

    const error = validateCategoryRow(categoryRow);

    if (error) {
      return res.status(400).json({
        message: error,
      });
    }

    await getOrCreateDefaultSettings();

    const updateData = {
      categoryRow: normalizeCategoryRow(categoryRow),
    };

    if (req.user?._id) {
      updateData.updatedBy = req.user._id;
    }

    const updatedSettings =
      await HomepageSettings.findOneAndUpdate(
        {
          key: "default",
        },
        {
          $set: updateData,
        },
        {
          new: true,
          runValidators: true,
        }
      );

    return res.status(200).json({
      categoryRow: sortByOrder(
        updatedSettings.categoryRow || []
      ),
    });
  } catch (error) {
    console.error("updateCategoryRow error:", error);

    return res.status(500).json({
      message: error.message || "Failed to update category row",
    });
  }
};