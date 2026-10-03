// oatclub-backend/cloudinary/mediaController.js

import Media from "./Media.js";

import {
  uploadToCloudinary,
  deleteFromCloudinary,
  searchCloudinaryMedia,
  getCloudinaryName,
  CLOUDINARY_SOURCES,
} from "../config/cloudinary.js";

/* =====================================================
   SOURCES
===================================================== */

const CLOUDINARY_1_SOURCE = CLOUDINARY_SOURCES.LEGACY;
const CLOUDINARY_2_SOURCE = CLOUDINARY_SOURCES.SECONDARY;
const CLOUDINARY_3_SOURCE = CLOUDINARY_SOURCES.ACTIVE;

const ALLOWED_SOURCES = [
  CLOUDINARY_1_SOURCE,
  CLOUDINARY_2_SOURCE,
  CLOUDINARY_3_SOURCE,
];

const ALLOWED_TYPES = ["image", "video", "raw"];

/* =====================================================
   HELPERS
===================================================== */

const getPositiveNumber = (
  value,
  fallback,
  max = Number.MAX_SAFE_INTEGER,
) => {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 1) {
    return fallback;
  }

  return Math.min(Math.floor(number), max);
};

const normalizeDate = (value) => {
  if (!value) return new Date();

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? new Date() : date;
};

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildMediaPayload = ({
  result,
  originalName = "",
  cloudinarySource,
  cloudName,
  folder = "",
}) => ({
  url: result.secure_url,
  publicId: result.public_id,

  cloudinarySource,
  cloudName,

  resourceType: result.resource_type || "image",
  format: result.format || "",
  bytes: result.bytes || 0,
  width: result.width || 0,
  height: result.height || 0,
  folder: result.folder || result.asset_folder || folder,

  originalName:
    originalName ||
    result.original_filename ||
    result.filename ||
    result.public_id?.split("/").pop() ||
    "",

  uploadedAt: normalizeDate(result.created_at),
});

const fetchCloudinaryResources = async ({
  source,
  maxResults,
}) => {
  let cloudName = "";

  try {
    cloudName = getCloudinaryName(source);

    const result = await searchCloudinaryMedia({
      source,
      maxResults,
    });

    return {
      source,
      cloudName,

      resources: (result.resources || []).map((item) =>
        buildMediaPayload({
          result: item,
          cloudinarySource: source,
          cloudName,
        }),
      ),

      nextCursor: result.next_cursor || null,
      error: null,
    };
  } catch (error) {
    console.error(`❌ Cloudinary sync failed for ${source}:`, error);

    return {
      source,
      cloudName,
      resources: [],
      nextCursor: null,
      error: error.message || "Unable to fetch account media",
    };
  }
};

/* =====================================================
   UPLOAD MEDIA
   All new uploads go to Cloudinary 3.
===================================================== */

export const uploadMedia = async (req, res) => {
  const created = [];

  try {
    if (!req.files?.length) {
      return res.status(400).json({
        message: "No files uploaded",
      });
    }

    const folder =
      String(req.body?.folder || "").trim() || "oatclub/media";

    const activeCloudName = getCloudinaryName(CLOUDINARY_3_SOURCE);

    for (const file of req.files) {
      const result = await uploadToCloudinary(
        file,
        folder,
        "auto",
      );

      const mediaPayload = buildMediaPayload({
        result,
        originalName: file.originalname || "",
        cloudinarySource:
          result.cloudinarySource || CLOUDINARY_3_SOURCE,
        cloudName: result.cloudName || activeCloudName,
        folder,
      });

      const doc = await Media.create(mediaPayload);
      created.push(doc);
    }

    return res.status(201).json({
      message: "Media uploaded successfully",
      uploadedTo: CLOUDINARY_3_SOURCE,
      cloudName: activeCloudName,
      count: created.length,
      media: created,
    });
  } catch (err) {
    console.error("❌ uploadMedia:", err);

    return res.status(500).json({
      message: err.message || "Unable to upload media",
      uploadedCount: created.length,
      media: created,
    });
  }
};

/* =====================================================
   GET MEDIA
   Reads all three accounts from MongoDB.
===================================================== */

export const getMedia = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 48,
      q = "",
      type = "",
      source = "",
    } = req.query;

    const filter = {};

    if (type && ALLOWED_TYPES.includes(type)) {
      filter.resourceType = type;
    }

    if (source && ALLOWED_SOURCES.includes(source)) {
      filter.cloudinarySource = source;
    }

    const searchText = String(q || "").trim();

    if (searchText) {
      const searchRegex = escapeRegex(searchText);

      filter.$or = [
        {
          originalName: {
            $regex: searchRegex,
            $options: "i",
          },
        },
        {
          publicId: {
            $regex: searchRegex,
            $options: "i",
          },
        },
        {
          folder: {
            $regex: searchRegex,
            $options: "i",
          },
        },
        {
          cloudName: {
            $regex: searchRegex,
            $options: "i",
          },
        },
      ];
    }

    const pageNum = getPositiveNumber(page, 1);
    const limitNum = getPositiveNumber(limit, 48, 100);
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      Media.find(filter)
        .sort({
          uploadedAt: -1,
          createdAt: -1,
        })
        .skip(skip)
        .limit(limitNum)
        .lean(),

      Media.countDocuments(filter),
    ]);

    return res.json({
      items,
      total,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    console.error("❌ getMedia:", err);

    return res.status(500).json({
      message: err.message || "Unable to fetch media",
    });
  }
};

/* =====================================================
   SYNC CLOUDINARY 1 + 2 + 3
   Imports one page from each account per request.
===================================================== */

export const syncCloudinaryMedia = async (req, res) => {
  try {
    const maxResults = getPositiveNumber(
      req.query.max,
      100,
      500,
    );

    const results = await Promise.all(
      ALLOWED_SOURCES.map((source) =>
        fetchCloudinaryResources({
          source,
          maxResults,
        }),
      ),
    );

    const allResources = results.flatMap(
      (result) => result.resources,
    );

    const operations = allResources.map((item) => ({
      updateOne: {
        filter: {
          cloudinarySource: item.cloudinarySource,
          publicId: item.publicId,
        },

        update: {
          $set: {
            url: item.url,
            cloudName: item.cloudName,
            resourceType: item.resourceType,
            format: item.format,
            bytes: item.bytes,
            width: item.width,
            height: item.height,
            folder: item.folder,
            originalName: item.originalName,
            uploadedAt: item.uploadedAt,
          },

          $setOnInsert: {
            publicId: item.publicId,
            cloudinarySource: item.cloudinarySource,
          },
        },

        upsert: true,
      },
    }));

    let bulkResult = null;

    if (operations.length) {
      bulkResult = await Media.bulkWrite(operations, {
        ordered: false,
      });
    }

    const items = await Media.find()
      .sort({
        uploadedAt: -1,
        createdAt: -1,
      })
      .limit(maxResults)
      .lean();

    const accounts = Object.fromEntries(
      results.map((result) => [
        result.source,
        {
          source: result.source,
          cloudName: result.cloudName,
          totalFound: result.resources.length,
          nextCursor: result.nextCursor,
          error: result.error,
        },
      ]),
    );

    const failedAccounts = results.filter(
      (result) => result.error,
    ).length;

    const allFailed = failedAccounts === results.length;

    return res.status(allFailed ? 502 : 200).json({
      message: allFailed
        ? "Unable to sync any Cloudinary account"
        : failedAccounts
          ? "Cloudinary sync completed with account errors"
          : "Cloudinary accounts synced successfully",

      accounts,
      totalFound: allResources.length,

      database: {
        matchedCount: bulkResult?.matchedCount || 0,
        modifiedCount: bulkResult?.modifiedCount || 0,
        upsertedCount: bulkResult?.upsertedCount || 0,
      },

      items,
    });
  } catch (err) {
    console.error("❌ syncCloudinaryMedia:", err);

    return res.status(500).json({
      message: err.message || "Unable to sync Cloudinary media",
    });
  }
};

/* =====================================================
   DELETE MEDIA
   Uses the source saved on the Media document.
===================================================== */

export const deleteMedia = async (req, res) => {
  try {
    const media = await Media.findById(req.params.id);

    if (!media) {
      return res.status(404).json({
        message: "Media not found",
      });
    }

    // Old records without a source belong to Cloudinary 1.
    const cloudinarySource =
      media.cloudinarySource || CLOUDINARY_1_SOURCE;

    const result = await deleteFromCloudinary(
      media.publicId,
      media.resourceType || "image",
      cloudinarySource,
    );

    if (!["ok", "not found"].includes(result?.result)) {
      return res.status(400).json({
        message: "Cloudinary deletion failed",
        cloudinaryResult: result?.result || "Unknown result",
      });
    }

    await media.deleteOne();

    return res.json({
      message: "Media deleted successfully",
      deletedFrom: cloudinarySource,
      publicId: media.publicId,
    });
  } catch (err) {
    console.error("❌ deleteMedia:", err);

    return res.status(500).json({
      message: err.message || "Unable to delete media",
    });
  }
};
