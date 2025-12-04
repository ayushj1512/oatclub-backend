// controller/blogController.js
import Blog from "../models/Blogs.js";
import slugify from "slugify";

/* ---------------- helpers ---------------- */
const normalizeArray = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean).map((v) => String(v).trim());
  if (typeof val === "string") return val.split(",").map((v) => v.trim()).filter(Boolean);
  return [];
};

const normalizeDate = (val) => {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

/**
 * 🟢 Create a new blog
 * POST /api/blogs
 * Supports: title, slug?, excerpt, date?, category, tags[], image, content, author?, isPublished?
 */
export const createBlog = async (req, res) => {
  try {
    let {
      title,
      slug,
      excerpt = "",
      date,
      category = "",
      tags,
      image = "",
      content = "",
      author = null,
      isPublished = true,
      // backward-compat:
      hashtags,
    } = req.body;

    if (!title?.trim()) return res.status(400).json({ message: "Blog title is required" });

    // ✅ slug auto
    const finalSlug = slug
      ? slugify(String(slug), { lower: true, strict: true })
      : slugify(String(title), { lower: true, strict: true });

    // ✅ tags (new) or hashtags (old)
    const finalTags = normalizeArray(tags?.length ? tags : hashtags);

    // ✅ date
    const finalDate = normalizeDate(date);

    const exists = await Blog.findOne({ slug: finalSlug });
    if (exists) return res.status(400).json({ message: "Slug already exists. Choose a different one." });

    const blog = await Blog.create({
      title: title.trim(),
      slug: finalSlug,

      excerpt: String(excerpt || "").trim(),
      date: finalDate, // can be null

      category: String(category || "").trim(),
      tags: finalTags,

      image: String(image || "").trim(),
      content: String(content || ""),

      author,
      isPublished: Boolean(isPublished),
    });

    const populated = await Blog.findById(blog._id).populate("author", "name email");

    return res.status(201).json({
      message: "Blog created successfully",
      blog: populated,
    });
  } catch (error) {
    console.error("Error creating blog:", error);
    return res.status(500).json({ message: error.message || "Server error while creating blog" });
  }
};

/**
 * 🟡 Get all blogs (filters + pagination)
 * GET /api/blogs?published=true&q=west&page=1&limit=20&category=Fashion&sort=newest
 */
export const getAllBlogs = async (req, res) => {
  try {
    const { published, q, page = 1, limit = 50, category, sort = "newest" } = req.query;

    const filter = {};
    if (published !== undefined) filter.isPublished = published === "true";
    if (category) filter.category = String(category);

    if (q) {
      filter.$or = [
        { title: { $regex: q, $options: "i" } },
        { excerpt: { $regex: q, $options: "i" } },
        { content: { $regex: q, $options: "i" } },
        { tags: { $in: [new RegExp(q, "i")] } },
        { slug: { $regex: q, $options: "i" } },
      ];
    }

    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      date_newest: { date: -1, createdAt: -1 },
      date_oldest: { date: 1, createdAt: -1 },
    };
    const sortObj = sortMap[sort] || sortMap.newest;

    const skip = (Number(page) - 1) * Number(limit);

    const [blogs, total] = await Promise.all([
      Blog.find(filter)
        .populate("author", "name email")
        .sort(sortObj)
        .skip(skip)
        .limit(Number(limit)),
      Blog.countDocuments(filter),
    ]);

    return res.status(200).json({
      items: blogs,
      total,
      page: Number(page),
      pages: Math.max(1, Math.ceil(total / Number(limit))),
    });
  } catch (error) {
    console.error("Error fetching blogs:", error);
    return res.status(500).json({ message: error.message || "Server error while fetching blogs" });
  }
};

/**
 * 🟡 Get a single blog by ID or slug
 * GET /api/blogs/:idOrSlug
 */
export const getBlogByIdOrSlug = async (req, res) => {
  try {
    const { idOrSlug } = req.params;

    const blog =
      (await Blog.findOne({ slug: idOrSlug }).populate("author", "name email")) ||
      (await Blog.findById(idOrSlug).populate("author", "name email"));

    if (!blog) return res.status(404).json({ message: "Blog not found" });

    return res.status(200).json(blog);
  } catch (error) {
    console.error("Error fetching blog:", error);
    return res.status(500).json({ message: error.message || "Server error while fetching blog" });
  }
};

/**
 * 🟠 Update an existing blog
 * PUT /api/blogs/:id
 * Supports same fields + auto slug if title changes and slug not provided
 */
export const updateBlog = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };

    // normalize tags/hashtags
    if (updates.tags !== undefined || updates.hashtags !== undefined) {
      updates.tags = normalizeArray(updates.tags?.length ? updates.tags : updates.hashtags);
      delete updates.hashtags;
    }

    // normalize date
    if (updates.date !== undefined) updates.date = normalizeDate(updates.date);

    // normalize category/excerpt/image/title/content
    if (updates.title !== undefined) updates.title = String(updates.title).trim();
    if (updates.excerpt !== undefined) updates.excerpt = String(updates.excerpt || "").trim();
    if (updates.category !== undefined) updates.category = String(updates.category || "").trim();
    if (updates.image !== undefined) updates.image = String(updates.image || "").trim();
    if (updates.content !== undefined) updates.content = String(updates.content || "");

    // slug handling
    if (updates.slug !== undefined) {
      updates.slug = slugify(String(updates.slug), { lower: true, strict: true });
    } else if (updates.title) {
      // if slug not provided but title changed, keep existing slug (safer)
      // (uncomment next line if you WANT auto-update slug)
      // updates.slug = slugify(String(updates.title), { lower: true, strict: true });
    }

    // prevent duplicate slug
    if (updates.slug) {
      const exists = await Blog.findOne({ slug: updates.slug, _id: { $ne: id } });
      if (exists) return res.status(400).json({ message: "Slug already exists. Choose a different one." });
    }

    const updatedBlog = await Blog.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    }).populate("author", "name email");

    if (!updatedBlog) return res.status(404).json({ message: "Blog not found" });

    return res.status(200).json({
      message: "Blog updated successfully",
      blog: updatedBlog,
    });
  } catch (error) {
    console.error("Error updating blog:", error);
    return res.status(500).json({ message: error.message || "Server error while updating blog" });
  }
};

/**
 * 🔴 Delete a blog
 * DELETE /api/blogs/:id
 */
export const deleteBlog = async (req, res) => {
  try {
    const { id } = req.params;

    const deletedBlog = await Blog.findByIdAndDelete(id);
    if (!deletedBlog) return res.status(404).json({ message: "Blog not found" });

    return res.status(200).json({ message: "Blog deleted successfully" });
  } catch (error) {
    console.error("Error deleting blog:", error);
    return res.status(500).json({ message: error.message || "Server error while deleting blog" });
  }
};
