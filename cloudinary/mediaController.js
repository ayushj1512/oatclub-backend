import Media from "./Media.js";
import { uploadToCloudinary, deleteFromCloudinary } from "../config/cloudinary.js";

export const uploadMedia = async (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ message: "No files uploaded" });

    const folder = (req.body.folder && String(req.body.folder)) || "miray/media";

    const created = [];
    for (const file of req.files) {
      const result = await uploadToCloudinary(file, folder, "auto");

      const doc = await Media.create({
        url: result.secure_url,
        publicId: result.public_id,
        resourceType: result.resource_type || "image",
        format: result.format || "",
        bytes: result.bytes || 0,
        width: result.width || 0,
        height: result.height || 0,
        folder,
        originalName: file.originalname || "",
      });

      created.push(doc);
    }

    return res.status(201).json({ message: "Uploaded", media: created });
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

    const skip = (Number(page) - 1) * Number(limit);

    const [items, total] = await Promise.all([
      Media.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      Media.countDocuments(filter),
    ]);

    return res.json({
      items: items || [],
      total: total || 0,
      page: Number(page),
      pages: Math.ceil((total || 0) / Number(limit)),
    });
  } catch (err) {
    console.error("❌ getMedia:", err);
    return res.status(500).json({ message: err.message });
  }
};

export const deleteMedia = async (req, res) => {
  try {
    const media = await Media.findById(req.params.id);
    if (!media) return res.status(404).json({ message: "Media not found" });

    await deleteFromCloudinary(media.publicId, media.resourceType);
    await media.deleteOne();

    return res.json({ message: "Deleted" });
  } catch (err) {
    console.error("❌ deleteMedia:", err);
    return res.status(500).json({ message: err.message });
  }
};
