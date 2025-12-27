// controller/blogController.js
import Blog from "./Blogs.js";
import slugify from "slugify";
import mongoose from "mongoose";

/* ---------------- helpers ---------------- */
const normalizeArray = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean).map((v) => String(v).trim());
  if (typeof val === "string") return val.split(",").map((v) => v.trim()).filter(Boolean);
  return [];
};

const normalizeObjectIds = (val) => {
  if (!val) return [];

  const arr = Array.isArray(val)
    ? val
    : typeof val === "string"
    ? val.split(",")
    : [];

  return arr
    .map((id) => String(id).trim())
    .filter((id) => mongoose.Types.ObjectId.isValid(id));
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
      products, // ✅ NEW
      // backward-compat:
      hashtags,
    } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({ message: "Blog title is required" });
    }

    /* ---------------- slug ---------------- */
    const finalSlug = slug
      ? slugify(String(slug), { lower: true, strict: true })
      : slugify(String(title), { lower: true, strict: true });

    /* ---------------- tags ---------------- */
    const finalTags = normalizeArray(tags?.length ? tags : hashtags);

    /* ---------------- date ---------------- */
    const finalDate = normalizeDate(date);

    /* ---------------- products ---------------- */
    const finalProducts = normalizeObjectIds(products);

    /* ---------------- slug uniqueness ---------------- */
    const exists = await Blog.findOne({ slug: finalSlug });
    if (exists) {
      return res
        .status(400)
        .json({ message: "Slug already exists. Choose a different one." });
    }

    /* ---------------- create blog ---------------- */
    const blog = await Blog.create({
      title: title.trim(),
      slug: finalSlug,

      excerpt: String(excerpt || "").trim(),
      date: finalDate, // can be null

      category: String(category || "").trim(),
      tags: finalTags,

      image: String(image || "").trim(),
      content: String(content || ""),

      products: finalProducts, // ✅ NEW

      author,
      isPublished: Boolean(isPublished),
    });

    /* ---------------- populate ---------------- */
    const populated = await Blog.findById(blog._id)
      .populate("author", "name email")
      .populate("products", "title price thumbnail slug");

    return res.status(201).json({
      message: "Blog created successfully",
      blog: populated,
    });
  } catch (error) {
    console.error("Error creating blog:", error);
    return res.status(500).json({
      message: error.message || "Server error while creating blog",
    });
  }
};


/**
 * 🟡 Get all blogs (filters + pagination)
 * GET /api/blogs?published=true&q=west&page=1&limit=20&category=Fashion&sort=newest
 */
export const getAllBlogs = async (req, res) => {
  try {
    const {
      published,
      q,
      page = 1,
      limit = 50,
      category,
      sort = "newest",
    } = req.query;

    /* ---------------- filters ---------------- */
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

    /* ---------------- sorting ---------------- */
    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      date_newest: { date: -1, createdAt: -1 },
      date_oldest: { date: 1, createdAt: -1 },
    };
    const sortObj = sortMap[sort] || sortMap.newest;

    /* ---------------- pagination ---------------- */
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const skip = (pageNum - 1) * limitNum;

    /* ---------------- query ---------------- */
    const [blogs, total] = await Promise.all([
      Blog.find(filter)
        .populate("author", "name email")
        .populate("products", "title price thumbnail slug") // ✅ NEW
        .sort(sortObj)
        .skip(skip)
        .limit(limitNum)
        .lean(), // ✅ faster for listing
      Blog.countDocuments(filter),
    ]);

    return res.status(200).json({
      items: blogs,
      total,
      page: pageNum,
      pages: Math.max(1, Math.ceil(total / limitNum)),
    });
  } catch (error) {
    console.error("Error fetching blogs:", error);
    return res.status(500).json({
      message: error.message || "Server error while fetching blogs",
    });
  }
};


/**
 * 🟡 Get a single blog by ID or slug
 * GET /api/blogs/:idOrSlug
 */
export const getBlogByIdOrSlug = async (req, res) => {
  try {
    const { idOrSlug } = req.params;

    let blog = await Blog.findOne({ slug: idOrSlug })
      .populate("author", "name email")
      .populate("products", "title price thumbnail slug");

    // fallback: try ObjectId
    if (!blog && mongoose.Types.ObjectId.isValid(idOrSlug)) {
      blog = await Blog.findById(idOrSlug)
        .populate("author", "name email")
        .populate("products", "title price thumbnail slug");
    }

    if (!blog) {
      return res.status(404).json({ message: "Blog not found" });
    }

    return res.status(200).json(blog);
  } catch (error) {
    console.error("Error fetching blog:", error);
    return res.status(500).json({
      message: error.message || "Server error while fetching blog",
    });
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

    /* ---------------- tags / hashtags ---------------- */
    if (updates.tags !== undefined || updates.hashtags !== undefined) {
      updates.tags = normalizeArray(
        updates.tags?.length ? updates.tags : updates.hashtags
      );
      delete updates.hashtags;
    }

    /* ---------------- products ---------------- */
    if (updates.products !== undefined) {
      updates.products = normalizeObjectIds(updates.products); // ✅ NEW
    }

    /* ---------------- date ---------------- */
    if (updates.date !== undefined) {
      updates.date = normalizeDate(updates.date);
    }

    /* ---------------- normalize strings ---------------- */
    if (updates.title !== undefined)
      updates.title = String(updates.title).trim();

    if (updates.excerpt !== undefined)
      updates.excerpt = String(updates.excerpt || "").trim();

    if (updates.category !== undefined)
      updates.category = String(updates.category || "").trim();

    if (updates.image !== undefined)
      updates.image = String(updates.image || "").trim();

    if (updates.content !== undefined)
      updates.content = String(updates.content || "");

    /* ---------------- slug handling ---------------- */
    if (updates.slug !== undefined) {
      updates.slug = slugify(String(updates.slug), {
        lower: true,
        strict: true,
      });
    } else if (updates.title) {
      // safer: keep existing slug
      // uncomment if you WANT auto-update slug
      // updates.slug = slugify(String(updates.title), { lower: true, strict: true });
    }

    /* ---------------- slug uniqueness ---------------- */
    if (updates.slug) {
      const exists = await Blog.findOne({
        slug: updates.slug,
        _id: { $ne: id },
      });

      if (exists) {
        return res
          .status(400)
          .json({ message: "Slug already exists. Choose a different one." });
      }
    }

    /* ---------------- update ---------------- */
    const updatedBlog = await Blog.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    })
      .populate("author", "name email")
      .populate("products", "title price thumbnail slug"); // ✅ NEW

    if (!updatedBlog) {
      return res.status(404).json({ message: "Blog not found" });
    }

    return res.status(200).json({
      message: "Blog updated successfully",
      blog: updatedBlog,
    });
  } catch (error) {
    console.error("Error updating blog:", error);
    return res.status(500).json({
      message: error.message || "Server error while updating blog",
    });
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
