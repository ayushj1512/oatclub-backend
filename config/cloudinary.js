import { v2 as cloudinary } from "cloudinary";
import multer from "multer";
import dotenv from "dotenv";
dotenv.config();

const CLOUDINARY_CLOUD_NAME = (process.env.CLOUDINARY_CLOUD_NAME || "").trim();
const CLOUDINARY_API_KEY = (process.env.CLOUDINARY_API_KEY || "").trim();
const CLOUDINARY_API_SECRET = (process.env.CLOUDINARY_API_SECRET || "").trim();

console.log("CLOUDINARY:", {
  name: CLOUDINARY_CLOUD_NAME,
  key: CLOUDINARY_API_KEY,
  secretLen: CLOUDINARY_API_SECRET.length,
  secretLast4: CLOUDINARY_API_SECRET.slice(-4),
});

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
});

const storage = multer.memoryStorage();

const allowedImageMimeTypes = ["image/jpeg", "image/png", "image/webp", "image/jpg"];

export const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!allowedImageMimeTypes.includes(file.mimetype)) {
      return cb(new Error("Only JPG, PNG, WEBP images allowed"), false);
    }
    cb(null, true);
  },
});

export const uploadAny = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
});

export const uploadToCloudinary = (file, folder = "products", resourceType = "auto") => {
  return new Promise((resolve, reject) => {
    if (!file?.buffer) return reject(new Error("File buffer not found"));

    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: resourceType },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );

    uploadStream.end(file.buffer);
  });
};

export const deleteFromCloudinary = async (publicId, resourceType = "image") => {
  if (!publicId) throw new Error("publicId is required");
  return cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
};

export { cloudinary };
