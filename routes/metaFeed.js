// routes/metaFeed.js
import express from "express";
import Product from "../Products/Products.js";

const router = express.Router();

const SITE_BASE = "https://www.mirayfashions.com";
const BRAND = "Miray Fashions";
const CURRENCY = "INR";
const CACHE_TTL_MS = 55 * 60 * 1000;
const ALWAYS_IN_STOCK = true;

let cache = { xml: "", etag: "", expiresAt: 0, meta: { count: 0, builtAt: null } };

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const clamp = (s, n) => {
  const t = String(s ?? "").trim();
  return t.length > n ? t.slice(0, n).trim() : t;
};

const slugify = (s) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "products";

const pickImage = (p) => String(p?.thumbnail || p?.images?.[0] || "").trim();

const buildLink = (p) => {
  const cat = slugify(p?.categories?.[0]);
  const slug = String(p?.slug ?? "").trim();
  const id = String(p?._id ?? "").trim();
  return `${SITE_BASE}/category/${encodeURIComponent(cat)}/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`;
};

const fmtPrice = (n) => `${(Number.isFinite(Number(n)) ? Number(n) : 0).toFixed(2)} ${CURRENCY}`;

const buildXml = (products) => {
  const items = products
    .map((p) => {
      const id = String(p?._id ?? "");
      const title = clamp(p?.title, 65);
      const desc = clamp(p?.shortDescription || p?.description || "", 5000);
      const link = buildLink(p);
      const image = pickImage(p);
      const availability = ALWAYS_IN_STOCK ? "in stock" : p?.isInStock ? "in stock" : "out of stock";

      return `<item>
<g:id>${esc(id)}</g:id>
<g:title>${esc(title)}</g:title>
<g:description>${esc(desc)}</g:description>
<g:link>${esc(link)}</g:link>
${image ? `<g:image_link>${esc(image)}</g:image_link>` : ""}
<g:price>${esc(fmtPrice(p?.price))}</g:price>
<g:availability>${availability}</g:availability>
<g:condition>new</g:condition>
<g:brand>${esc(BRAND)}</g:brand>
</item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>${esc("Miray Fashions Product Feed")}</title>
<link>${esc(SITE_BASE)}</link>
<description>${esc("Latest catalog feed for Meta/Google Commerce.")}</description>
${items}
</channel>
</rss>`;
};

async function rebuildFeed() {
  const products = await Product.find({ isActive: true, isDraft: false })
    .select("title slug shortDescription description categories thumbnail images price isInStock updatedAt")
    .sort({ updatedAt: -1 })
    .lean();

  const xml = buildXml(products);
  const t = Date.now();
  cache = { xml, etag: `W/"${xml.length}-${t}"`, expiresAt: t + CACHE_TTL_MS, meta: { count: products.length, builtAt: new Date(t).toISOString() } };
  return cache;
}

async function getFeed(force = false) {
  const t = Date.now();
  if (!force && cache.xml && cache.expiresAt > t) return cache;
  return rebuildFeed();
}

/* quick test */
router.get("/test", (req, res) => res.send("meta feed router OK"));

/* public xml */
router.get("/xml", async (req, res) => {
  try {
    const feed = await getFeed(false);
    if (req.headers["if-none-match"] === feed.etag) return res.status(304).end();
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=1800");
    res.setHeader("ETag", feed.etag);
    return res.status(200).send(feed.xml);
  } catch (e) {
    console.error("❌ Meta XML feed failed:", e?.message || e);
    return res.status(500).send("Feed generation failed");
  }
});

/* manual refresh (for admin button) */
router.post("/meta-feed/refresh", async (req, res) => {
  try {
    const feed = await getFeed(true);
    return res.json({ ok: true, count: feed.meta.count, builtAt: feed.meta.builtAt });
  } catch (e) {
    console.error("❌ Meta feed refresh failed:", e?.message || e);
    return res.status(500).json({ ok: false, message: e?.message || "Refresh failed" });
  }
});

/* status (for admin page) */
router.get("/meta-feed/status", (req, res) => {
  return res.json({ ok: true, count: cache.meta.count, builtAt: cache.meta.builtAt, cached: !!cache.xml, expiresAt: cache.expiresAt });
});

export default router;

/*
Mount:
app.use("/", metaFeedRouter);

URLs:
GET  /xml
GET  /test
POST /meta-feed/refresh
GET  /meta-feed/status
*/
