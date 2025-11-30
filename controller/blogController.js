import Blog from "../models/Blogs.js";

/**
 * 🟢 Create a new blog
 * POST /api/blogs
 */
export const createBlog = async (req, res) => {
  try {
    const { title, slug, hashtags, image, content, author, isPublished } = req.body;

    // Check if slug already exists
    const existingBlog = await Blog.findOne({ slug });
    if (existingBlog) {
      return res.status(400).json({ message: "Slug already exists. Choose a different one." });
    }

    const blog = await Blog.create({
      title,
      slug,
      hashtags,
      image,
      content,
      author,
      isPublished,
    });

    res.status(201).json({
      message: "Blog created successfully",
      blog,
    });
  } catch (error) {
    console.error("Error creating blog:", error);
    res.status(500).json({ message: "Server error while creating blog" });
  }
};

/**
 * 🟡 Get all blogs (optionally filter by published status)
 * GET /api/blogs
 */
export const getAllBlogs = async (req, res) => {
  try {
    const { published } = req.query;
    const filter = published ? { isPublished: published === "true" } : {};

    const blogs = await Blog.find(filter)
      .populate("author", "name email")
      .sort({ createdAt: -1 });

    res.status(200).json(blogs);
  } catch (error) {
    console.error("Error fetching blogs:", error);
    res.status(500).json({ message: "Server error while fetching blogs" });
  }
};

/**
 * 🟡 Get a single blog by ID or slug
 * GET /api/blogs/:idOrSlug
 */
export const getBlogByIdOrSlug = async (req, res) => {
  try {
    const { idOrSlug } = req.params;

    const blog = await Blog.findOne({
      $or: [{ _id: idOrSlug }, { slug: idOrSlug }],
    }).populate("author", "name email");

    if (!blog) {
      return res.status(404).json({ message: "Blog not found" });
    }

    res.status(200).json(blog);
  } catch (error) {
    console.error("Error fetching blog:", error);
    res.status(500).json({ message: "Server error while fetching blog" });
  }
};

/**
 * 🟠 Update an existing blog
 * PUT /api/blogs/:id
 */
export const updateBlog = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const updatedBlog = await Blog.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    });

    if (!updatedBlog) {
      return res.status(404).json({ message: "Blog not found" });
    }

    res.status(200).json({
      message: "Blog updated successfully",
      blog: updatedBlog,
    });
  } catch (error) {
    console.error("Error updating blog:", error);
    res.status(500).json({ message: "Server error while updating blog" });
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

    if (!deletedBlog) {
      return res.status(404).json({ message: "Blog not found" });
    }

    res.status(200).json({
      message: "Blog deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting blog:", error);
    res.status(500).json({ message: "Server error while deleting blog" });
  }
};
