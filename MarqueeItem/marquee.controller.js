import MarqueeItem from "../MarqueeItem/MarqueeItem.js"; // ✅ adjust if your relative path differs

const safe = (v) => (v == null ? "" : String(v));
const cleanUrl = (v) => safe(v).trim();

/**
 * PUBLIC
 * GET /api/public/marquee
 * Returns active marquee items with href generated from productCode
 */
export async function getPublicMarquee(req, res) {
  try {
    const items = await MarqueeItem.find({ isActive: true })
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();

    const out = (items || []).map((i) => {
      const productCode = safe(i.productCode).trim();

      return {
        _id: safe(i._id),
        imageUrl: cleanUrl(i.imageUrl),
        alt: safe(i.alt),
        productCode,

        // ✅ change this route if needed
        href: productCode ? `/products/${encodeURIComponent(productCode)}` : null,
      };
    });

    return res.json({ ok: true, items: out });
  } catch (e) {
    console.error("getPublicMarquee error:", e);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

/**
 * ADMIN
 * POST /api/admin/marquee
 */
export async function createMarqueeItem(req, res) {
  try {
    const { imageUrl, productCode, isActive, sortOrder, alt } = req.body || {};

    if (!imageUrl || !productCode) {
      return res.status(400).json({ ok: false, message: "imageUrl and productCode are required" });
    }

    const doc = await MarqueeItem.create({
      imageUrl: cleanUrl(imageUrl),
      productCode: safe(productCode).trim(),
      isActive: typeof isActive === "boolean" ? isActive : true,
      sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
      alt: safe(alt),
    });

    return res.json({ ok: true, item: doc });
  } catch (e) {
    console.error("createMarqueeItem error:", e);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

/**
 * ADMIN
 * PATCH /api/admin/marquee/:id
 */
export async function updateMarqueeItem(req, res) {
  try {
    const { id } = req.params;

    const patch = {};
    if (req.body?.imageUrl != null) patch.imageUrl = cleanUrl(req.body.imageUrl);
    if (req.body?.productCode != null) patch.productCode = safe(req.body.productCode).trim();
    if (req.body?.alt != null) patch.alt = safe(req.body.alt);
    if (req.body?.isActive != null) patch.isActive = !!req.body.isActive;
    if (req.body?.sortOrder != null) patch.sortOrder = Number(req.body.sortOrder) || 0;

    const updated = await MarqueeItem.findByIdAndUpdate(id, patch, { new: true });
    if (!updated) return res.status(404).json({ ok: false, message: "Not found" });

    return res.json({ ok: true, item: updated });
  } catch (e) {
    console.error("updateMarqueeItem error:", e);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

/**
 * ADMIN
 * DELETE /api/admin/marquee/:id
 */
export async function deleteMarqueeItem(req, res) {
  try {
    const { id } = req.params;

    const deleted = await MarqueeItem.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ ok: false, message: "Not found" });

    return res.json({ ok: true });
  } catch (e) {
    console.error("deleteMarqueeItem error:", e);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}