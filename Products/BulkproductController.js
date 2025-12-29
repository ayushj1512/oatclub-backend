import csv from "csvtojson";
import Product from "./Products.js";

export const bulkPreviewProducts = async (req, res) => {
  try {
    const rows = await csv().fromFile(req.file.path);

    const preview = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];

      const title = String(r.title || "").trim();
      const price = Number(r.price);
      const category = String(r.category || "").trim();

      const errors = [];

      if (!title) errors.push("Missing title");
      if (!Number.isFinite(price)) errors.push("Invalid price");
      if (!category) errors.push("Missing category");

      preview.push({
        row: i + 1,
        title,
        price,
        compareAtPrice: r.compareAtPrice
          ? Number(r.compareAtPrice)
          : null,
        categories: category ? [category] : [],
        sku: r.sku || "",
        stock: Number(r.stock || 0),
        tags: r.tags
          ? r.tags.split(",").map((t) => t.trim().toLowerCase())
          : [],
        shortDescription: r.shortDescription || "",
        isValid: errors.length === 0,
        errors,
      });
    }

    res.json({ preview });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
};

export const bulkCreateDraftProducts = async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ message: "No rows provided" });
    }

    const docs = [];

    for (const r of rows) {
      const data = {
        title: r.title,
        slug: slugify(r.title, { lower: true }),
        price: Number(r.price),
        compareAtPrice: r.compareAtPrice ?? null,
        categories: r.categories,
        stock: Number(r.stock || 0),
        sku: r.sku || undefined,
        tags: tagsNorm(r.tags),
        shortDescription: r.shortDescription || "",

        // IMPORTANT FLAGS
        images: [],
        thumbnail: "",
        variants: [],
        attributes: [],

        isDraft: true,
        isActive: false,
        importSource: "bulk",
      };

      await ensureSKUs(data);

      docs.push(data);
    }

    const created = await Product.insertMany(docs, {
      ordered: false, // continue even if some fail
    });

    res.json({
      message: "Bulk draft products created",
      createdCount: created.length,
    });
  } catch (e) {
    console.error("❌ Bulk Draft Create Error:", e);
    res.status(500).json({ message: e.message });
  }
};
