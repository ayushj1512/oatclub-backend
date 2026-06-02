import Media from "./Media.js";
import {
  uploadToCloudinary,
  deleteFromCloudinary,
  cloudinary,
} from "../config/cloudinary.js";

export const uploadMedia = async (req, res) => {
  try {
    if (!req.files?.length) {
      return res.status(400).json({ message: "No files uploaded" });
    }

    const created = [];

    for (const file of req.files) {
      const result = await uploadToCloudinary(file, "", "auto");

      const doc = await Media.create({
        url: result.secure_url,
        publicId: result.public_id,
        resourceType: result.resource_type || "image",
        format: result.format || "",
        bytes: result.bytes || 0,
        width: result.width || 0,
        height: result.height || 0,
        folder: result.folder || "",
        originalName: file.originalname || "",
      });

      created.push(doc);
    }

    return res.status(201).json({
      message: "Uploaded",
      media: created,
    });
  } catch (err) {
    console.error("❌ uploadMedia:", err);
    return res.status(500).json({ message: err.message });
  }
};

export const getMedia = async (req, res) => {
  try {
    const { page = 1, limit = 48, q = "", type = "" } = req.query;

    const filter = {};

    if (type) filter.resourceType = type;

    if (q) {
      filter.$or = [
        { originalName: { $regex: q, $options: "i" } },
        { publicId: { $regex: q, $options: "i" } },
        { folder: { $regex: q, $options: "i" } },
      ];
    }

    const pageNum = Math.max(Number(page), 1);
    const limitNum = Math.max(Number(limit), 1);
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      Media.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Media.countDocuments(filter),
    ]);

    return res.json({
      items,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    console.error("❌ getMedia:", err);
    return res.status(500).json({ message: err.message });
  }
};

export const syncCloudinaryMedia = async (req, res) => {
  try {
    const { max = 100 } = req.query;

    const result = await cloudinary.search
      .expression("resource_type:image OR resource_type:video")
      .sort_by("created_at", "desc")
      .max_results(Number(max))
      .execute();

    const resources = result.resources || [];
    const synced = [];

    for (const item of resources) {
      const exists = await Media.findOne({ publicId: item.public_id });

      if (exists) continue;

      const doc = await Media.create({
        url: item.secure_url,
        publicId: item.public_id,
        resourceType: item.resource_type || "image",
        format: item.format || "",
        bytes: item.bytes || 0,
        width: item.width || 0,
        height: item.height || 0,
        folder: item.folder || "",
        originalName: item.filename || item.public_id?.split("/").pop() || "",
      });

      synced.push(doc);
    }

    return res.json({
      message: "Cloudinary media synced",
      syncedCount: synced.length,
      totalFound: resources.length,
      media: synced,
    });
  } catch (err) {
    console.error("❌ syncCloudinaryMedia:", err);
    return res.status(500).json({ message: err.message });
  }
};

export const deleteMedia = async (req, res) => {
  try {
    const media = await Media.findById(req.params.id);

    if (!media) {
      return res.status(404).json({ message: "Media not found" });
    }

    await deleteFromCloudinary(media.publicId, media.resourceType);
    await media.deleteOne();

    return res.json({ message: "Deleted" });
  } catch (err) {
    console.error("❌ deleteMedia:", err);
    return res.status(500).json({ message: err.message });
  }
};