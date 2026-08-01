import { v2 as cloudinary } from "cloudinary";
import multer from "multer";
import dotenv from "dotenv";

dotenv.config();

/* =====================================================
   CLOUDINARY 1 — EXISTING / LEGACY
===================================================== */

const CLOUDINARY_1_CONFIG = {
  cloud_name: (process.env.CLOUDINARY_CLOUD_NAME || "").trim(),
  api_key: (process.env.CLOUDINARY_API_KEY || "").trim(),
  api_secret: (process.env.CLOUDINARY_API_SECRET || "").trim(),
};

/* =====================================================
   CLOUDINARY 2 — NEW / ACTIVE
===================================================== */

const CLOUDINARY_2_CONFIG = {
  cloud_name: (process.env.CLOUDINARY_2_CLOUD_NAME || "").trim(),
  api_key: (process.env.CLOUDINARY_2_API_KEY || "").trim(),
  api_secret: (process.env.CLOUDINARY_2_API_SECRET || "").trim(),
};

const CLOUDINARY_2_UPLOAD_ENABLED =
  String(
    process.env.CLOUDINARY_2_UPLOAD_ENABLED || "false"
  ).toLowerCase() === "true";

export const CLOUDINARY_SOURCES = {
  LEGACY: "cloudinary_1",
  ACTIVE: "cloudinary_2",
};

/* =====================================================
   DEFAULT GLOBAL CONFIG = CLOUDINARY 1

   Existing project imports remain compatible.
===================================================== */

cloudinary.config({
  ...CLOUDINARY_1_CONFIG,
  secure: true,
});

const isConfigValid = (config) =>
  Boolean(
    config.cloud_name &&
      config.api_key &&
      config.api_secret
  );

export const isCloudinary1Configured =
  isConfigValid(CLOUDINARY_1_CONFIG);

export const isCloudinary2Configured =
  isConfigValid(CLOUDINARY_2_CONFIG);

console.log("☁️ Cloudinary accounts:", {
  cloudinary_1: {
    cloudName: CLOUDINARY_1_CONFIG.cloud_name,
    configured: isCloudinary1Configured,
    role: "legacy",
  },
  cloudinary_2: {
    cloudName: CLOUDINARY_2_CONFIG.cloud_name,
    configured: isCloudinary2Configured,
    uploadEnabled: CLOUDINARY_2_UPLOAD_ENABLED,
    role: "active",
  },
});

/* =====================================================
   MULTER
===================================================== */

const storage = multer.memoryStorage();

const allowedImageMimeTypes = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
];

export const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (!allowedImageMimeTypes.includes(file.mimetype)) {
      return cb(
        new Error(
          "Only JPG, JPEG, PNG and WEBP images are allowed"
        ),
        false
      );
    }

    cb(null, true);
  },
});

export const uploadAny = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 25,
  },
});

/* =====================================================
   CONFIG HELPERS
===================================================== */

export const getCloudinaryConfig = (
  source = CLOUDINARY_SOURCES.ACTIVE
) => {
  if (source === CLOUDINARY_SOURCES.LEGACY) {
    if (!isCloudinary1Configured) {
      throw new Error("Cloudinary 1 is not configured");
    }

    return CLOUDINARY_1_CONFIG;
  }

  if (source === CLOUDINARY_SOURCES.ACTIVE) {
    if (!isCloudinary2Configured) {
      throw new Error("Cloudinary 2 is not configured");
    }

    return CLOUDINARY_2_CONFIG;
  }

  throw new Error(
    `Unsupported Cloudinary source: ${source}`
  );
};

export const getCloudinaryName = (source) => {
  return getCloudinaryConfig(source).cloud_name;
};

/* =====================================================
   CREATE TEMPORARY ACCOUNT CLIENT

   SDK global config ko permanently change nahi karta.
===================================================== */

const createAccountApi = (source) => {
  const config = getCloudinaryConfig(source);

  const accountOptions = {
    cloud_name: config.cloud_name,
    api_key: config.api_key,
    api_secret: config.api_secret,
  };

  return {
    uploader: {
      uploadStream(options, callback) {
        return cloudinary.uploader.upload_stream(
          {
            ...options,
            ...accountOptions,
          },
          callback
        );
      },

      destroy(publicId, options = {}) {
        return cloudinary.uploader.destroy(publicId, {
          ...options,
          ...accountOptions,
        });
      },
    },

    search: {
      execute({
        expression,
        maxResults = 100,
        nextCursor = null,
      }) {
        let searchQuery = cloudinary.search
          .expression(expression)
          .sort_by("created_at", "desc")
          .max_results(maxResults);

        if (nextCursor) {
          searchQuery = searchQuery.next_cursor(nextCursor);
        }

        return searchQuery.execute({
          ...accountOptions,
        });
      },
    },
  };
};

/* =====================================================
   UPLOAD — ALL NEW UPLOADS TO CLOUDINARY 2
===================================================== */

export const uploadToCloudinary = (
  file,
  folder = "products",
  resourceType = "auto"
) => {
  return uploadToCloudinarySource(file, {
    source: CLOUDINARY_SOURCES.ACTIVE,
    folder,
    resourceType,
  });
};

export const uploadToCloudinarySource = (
  file,
  {
    source = CLOUDINARY_SOURCES.ACTIVE,
    folder = "oatclub/media",
    resourceType = "auto",
  } = {}
) => {
  return new Promise((resolve, reject) => {
    if (!file?.buffer) {
      return reject(new Error("File buffer not found"));
    }

    if (
      source === CLOUDINARY_SOURCES.ACTIVE &&
      !CLOUDINARY_2_UPLOAD_ENABLED
    ) {
      return reject(
        new Error(
          "Cloudinary 2 uploads are currently disabled"
        )
      );
    }

    let account;

    try {
      account = createAccountApi(source);
    } catch (error) {
      return reject(error);
    }

    const cleanFolder =
      String(folder || "").trim() || "oatclub/media";

    const uploadStream = account.uploader.uploadStream(
      {
        folder: cleanFolder,
        resource_type: resourceType,
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }

        if (!result) {
          return reject(
            new Error(
              "Cloudinary returned an empty upload result"
            )
          );
        }

        resolve({
          ...result,
          cloudinarySource: source,
          cloudName: getCloudinaryName(source),
        });
      }
    );

    uploadStream.on("error", reject);
    uploadStream.end(file.buffer);
  });
};

/* =====================================================
   DELETE FROM CORRECT ACCOUNT
===================================================== */

export const deleteFromCloudinary = async (
  publicId,
  resourceType = "image",
  source = CLOUDINARY_SOURCES.LEGACY
) => {
  if (!publicId) {
    throw new Error("publicId is required");
  }

  const account = createAccountApi(source);

  return account.uploader.destroy(publicId, {
    resource_type: resourceType || "image",
    invalidate: true,
  });
};

/* =====================================================
   SEARCH ACCOUNT MEDIA
===================================================== */

export const searchCloudinaryMedia = async ({
  source,
  maxResults = 100,
  nextCursor = null,
}) => {
  const account = createAccountApi(source);

  return account.search.execute({
    expression:
      "resource_type:image OR resource_type:video OR resource_type:raw",
    maxResults,
    nextCursor,
  });
};

/* =====================================================
   EXISTING EXPORT
===================================================== */

export { cloudinary };