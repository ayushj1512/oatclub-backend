import fse from "fs-extra";
import slugify from "slugify";

const INPUT = "./scripts/31stdec/products.mapped.json";
const OUTPUT = "./scripts/31stdec/products.mapped.fixed.json";

const toSlug = (s) =>
  slugify(String(s || ""), { lower: true, strict: true });

async function run() {
  const data = await fse.readJSON(INPUT);
  const products = Array.isArray(data.products) ? data.products : [];

  const slugCount = new Map();
  const fixed = [];

  for (const p of products) {
    let base = toSlug(p.slug || p.title);
    if (!base) base = "product";

    const current = slugCount.get(base) || 0;
    slugCount.set(base, current + 1);

    // if duplicate, append suffix
    const newSlug = current === 0 ? base : `${base}-${current + 1}`;

    fixed.push({
      ...p,
      slug: newSlug,
    });
  }

  await fse.writeJSON(OUTPUT, { products: fixed }, { spaces: 2 });

  // report duplicates
  const dups = [...slugCount.entries()].filter(([k, v]) => v > 1);
  console.log("✅ Total products:", fixed.length);
  console.log("⚠️ Duplicate base slugs found:", dups.length);

  if (dups.length) {
    console.log("Sample duplicates:", dups.slice(0, 15));
  }

  console.log("📦 Saved fixed file:", OUTPUT);
}

run().catch(console.error);
