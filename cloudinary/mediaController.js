// oatclub-backend/cloudinary/mediaController.js

import Media from "./Media.js";

import {
  uploadToCloudinary,
  deleteFromCloudinary,
  searchCloudinaryMedia,
  CLOUDINARY_SOURCES,
} from "../config/cloudinary.js";

/* =====================================================
   CONSTANTS
===================================================== */

const CLOUDINARY_1_SOURCE = CLOUDINARY_SOURCES.LEGACY;
const CLOUDINARY_2_SOURCE = CLOUDINARY_SOURCES.ACTIVE;

const CLOUDINARY_1_NAME = (
  process.env.CLOUDINARY_CLOUD_NAME || ""
).trim();

const CLOUDINARY_2_NAME = (
  process.env.CLOUDINARY_2_CLOUD_NAME || ""
).trim();

/* =====================================================
   HELPERS
===================================================== */

const getPositiveNumber = (
  value,
  fallback,
  max = Number.MAX_SAFE_INTEGER
) => {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(number), max);
};

const normalizeDate = (value) => {
  if (!value) return new Date();

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? new Date()
    : date;
};

const buildMediaPayload = ({
  result,
  originalName = "",
  cloudinarySource,
  cloudName,
}) => {
  return {
    url: result.secure_url,
    publicId: result.public_id,

    cloudinarySource,
    cloudName,

    resourceType: result.resource_type || "image",
    format: result.format || "",
    bytes: result.bytes || 0,
    width: result.width || 0,
    height: result.height || 0,
    folder: result.folder || "",

    originalName:
      originalName ||
      result.original_filename ||
      result.filename ||
      result.public_id?.split("/").pop() ||
      "",

    uploadedAt: normalizeDate(result.created_at),
  };
};

const normalizeCloudinaryResource = ({
  item,
  cloudinarySource,
  cloudName,
}) => {
  return {
    url: item.secure_url,
    publicId: item.public_id,

    cloudinarySource,
    cloudName,

    resourceType: item.resource_type || "image",
    format: item.format || "",
    bytes: item.bytes || 0,
    width: item.width || 0,
    height: item.height || 0,
    folder: item.folder || "",

    originalName:
      item.original_filename ||
      item.filename ||
      item.public_id?.split("/").pop() ||
      "",

    uploadedAt: normalizeDate(item.created_at),
  };
};

const fetchCloudinaryResources = async ({
  source,
  cloudName,
  maxResults,
}) => {
  try {
    const result = await searchCloudinaryMedia({
      source,
      maxResults,
    });

    return {
      source,
      cloudName,
      resources: (result.resources || []).map((item) =>
        normalizeCloudinaryResource({
          item,
          cloudinarySource: source,
          cloudName,
        })
      ),
      nextCursor: result.next_cursor || null,
      error: null,
    };
  } catch (error) {
    console.error(
      `❌ Cloudinary sync failed for ${source}:`,
      error
    );

    return {
      source,
      cloudName,
      resources: [],
      nextCursor: null,
      error: error.message,
    };
  }
};

/* =====================================================
   UPLOAD MEDIA
   All new uploads go to Cloudinary 2
===================================================== */

export const uploadMedia = async (req, res) => {
  const created = [];

  try {
    if (!req.files?.length) {
      return res.status(400).json({
        message: "No files uploaded",
      });
    }

    for (const file of req.files) {
      const result = await uploadToCloudinary(
        file,
        "oatclub/media",
        "auto"
      );

      const mediaPayload = buildMediaPayload({
        result,
        originalName: file.originalname || "",
        cloudinarySource:
          result.cloudinarySource ||
          CLOUDINARY_2_SOURCE,
        cloudName:
          result.cloudName ||
          CLOUDINARY_2_NAME,
      });

      const doc = await Media.create(mediaPayload);

      created.push(doc);
    }

    return res.status(201).json({
      message: "Media uploaded successfully",
      uploadedTo: CLOUDINARY_2_SOURCE,
      cloudName: CLOUDINARY_2_NAME,
      count: created.length,
      media: created,
    });
  } catch (err) {
    console.error("❌ uploadMedia:", err);

    return res.status(500).json({
      message:
        err.message ||
        "Unable to upload media",
      uploadedCount: created.length,
      media: created,
    });
  }
};

/* =====================================================
   GET MEDIA
   Reads both accounts from MongoDB
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

    const allowedTypes = [
      "image",
      "video",
      "raw",
    ];

    const allowedSources = [
      CLOUDINARY_1_SOURCE,
      CLOUDINARY_2_SOURCE,
    ];

    if (type && allowedTypes.includes(type)) {
      filter.resourceType = type;
    }

    if (
      source &&
      allowedSources.includes(source)
    ) {
      filter.cloudinarySource = source;
    }

    const searchText = String(q || "").trim();

    if (searchText) {
      filter.$or = [
        {
          originalName: {
            $regex: searchText,
            $options: "i",
          },
        },
        {
          publicId: {
            $regex: searchText,
            $options: "i",
          },
        },
        {
          folder: {
            $regex: searchText,
            $options: "i",
          },
        },
        {
          cloudName: {
            $regex: searchText,
            $options: "i",
          },
        },
      ];
    }

    const pageNum = getPositiveNumber(
      page,
      1
    );

    const limitNum = getPositiveNumber(
      limit,
      48,
      100
    );

    const skip =
      (pageNum - 1) * limitNum;

    const [items, total] =
      await Promise.all([
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
      pages: Math.ceil(
        total / limitNum
      ),
    });
  } catch (err) {
    console.error("❌ getMedia:", err);

    return res.status(500).json({
      message:
        err.message ||
        "Unable to fetch media",
    });
  }
};

/* =====================================================
   SYNC CLOUDINARY 1 + CLOUDINARY 2
===================================================== */

export const syncCloudinaryMedia = async (
  req,
  res
) => {
  try {
    const maxResults =
      getPositiveNumber(
        req.query.max,
        100,
        500
      );

    const [
      cloudinary1Result,
      cloudinary2Result,
    ] = await Promise.all([
      fetchCloudinaryResources({
        source:
          CLOUDINARY_1_SOURCE,
        cloudName:
          CLOUDINARY_1_NAME,
        maxResults,
      }),

      fetchCloudinaryResources({
        source:
          CLOUDINARY_2_SOURCE,
        cloudName:
          CLOUDINARY_2_NAME,
        maxResults,
      }),
    ]);

    const allResources = [
      ...cloudinary1Result.resources,
      ...cloudinary2Result.resources,
    ];

    const operations =
      allResources.map((item) => ({
        updateOne: {
          filter: {
            cloudinarySource:
              item.cloudinarySource,
            publicId:
              item.publicId,
          },

          update: {
            $set: {
              url: item.url,
              cloudName:
                item.cloudName,
              resourceType:
                item.resourceType,
              format: item.format,
              bytes: item.bytes,
              width: item.width,
              height: item.height,
              folder: item.folder,
              originalName:
                item.originalName,
              uploadedAt:
                item.uploadedAt,
            },

            $setOnInsert: {
              publicId:
                item.publicId,
              cloudinarySource:
                item.cloudinarySource,
            },
          },

          upsert: true,
        },
      }));

    let bulkResult = null;

    if (operations.length) {
      bulkResult =
        await Media.bulkWrite(
          operations,
          {
            ordered: false,
          }
        );
    }

    const items = await Media.find()
      .sort({
        uploadedAt: -1,
        createdAt: -1,
      })
      .limit(maxResults)
      .lean();

    return res.json({
      message:
        "Cloudinary accounts synced successfully",

      accounts: {
        cloudinary_1: {
          source:
            CLOUDINARY_1_SOURCE,
          cloudName:
            CLOUDINARY_1_NAME,
          totalFound:
            cloudinary1Result
              .resources.length,
          nextCursor:
            cloudinary1Result
              .nextCursor,
          error:
            cloudinary1Result.error,
        },

        cloudinary_2: {
          source:
            CLOUDINARY_2_SOURCE,
          cloudName:
            CLOUDINARY_2_NAME,
          totalFound:
            cloudinary2Result
              .resources.length,
          nextCursor:
            cloudinary2Result
              .nextCursor,
          error:
            cloudinary2Result.error,
        },
      },

      totalFound:
        allResources.length,

      database: {
        matchedCount:
          bulkResult?.matchedCount ||
          0,
        modifiedCount:
          bulkResult?.modifiedCount ||
          0,
        upsertedCount:
          bulkResult?.upsertedCount ||
          0,
      },

      items,
    });
  } catch (err) {
    console.error(
      "❌ syncCloudinaryMedia:",
      err
    );

    return res.status(500).json({
      message:
        err.message ||
        "Unable to sync Cloudinary media",
    });
  }
};

/* =====================================================
   DELETE MEDIA
   Deletes from correct account
===================================================== */

export const deleteMedia = async (
  req,
  res
) => {
  try {
    const media =
      await Media.findById(
        req.params.id
      );

    if (!media) {
      return res.status(404).json({
        message: "Media not found",
      });
    }

    // Old records without source belong to Cloudinary 1
    const cloudinarySource =
      media.cloudinarySource ||
      CLOUDINARY_1_SOURCE;

    const result =
      await deleteFromCloudinary(
        media.publicId,
        media.resourceType ||
          "image",
        cloudinarySource
      );

    if (
      result?.result &&
      !["ok", "not found"].includes(
        result.result
      )
    ) {
      return res.status(400).json({
        message:
          "Cloudinary deletion failed",
        cloudinaryResult:
          result.result,
      });
    }

    await media.deleteOne();

    return res.json({
      message:
        "Media deleted successfully",
      deletedFrom:
        cloudinarySource,
      publicId:
        media.publicId,
    });
  } catch (err) {
    console.error(
      "❌ deleteMedia:",
      err
    );

    return res.status(500).json({
      message:
        err.message ||
        "Unable to delete media",
    });
  }
};