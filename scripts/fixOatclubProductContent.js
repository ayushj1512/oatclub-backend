import mongoose from "mongoose";
import dotenv from "dotenv";
import Product from "../Products/Products.js";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("❌ MONGO_URI missing in .env");
  process.exit(1);
}

const updates = [
  {
    slug: "coastal-muse-one-shoulder-ruched-top",
    data: {
      metaTitle: "Dusty Blue One Shoulder Ruched Ribbed Top",
      metaDescription:
        "A chic dusty blue one-shoulder top featuring adjustable ruched sides, premium rib-knit fabric, and a flattering contemporary fit.",
      keywords: [
        "one shoulder top",
        "ruched crop top",
        "blue ribbed top",
        "asymmetric top women",
        "crop top women",
        "vacation wear women",
        "casual chic top",
        "fitted ribbed top",
        "sleeveless top women",
        "oatclub top",
      ],
      collections: [],
      fabrics: [],
      specifications: [
        { key: "Color", value: "Dusty Blue" },
        { key: "Pattern", value: "Solid" },
        { key: "Type", value: "One Shoulder Top" },
        { key: "Neckline", value: "Asymmetric One Shoulder" },
        { key: "Sleeve Type", value: "Sleeveless" },
        { key: "Length", value: "Cropped" },
        { key: "Fit", value: "Slim Fit" },
        { key: "Occasion", value: "Casual, Vacation, Brunch, Day Out" },
        { key: "Fabric", value: "Rib Knit Stretch Blend" },
        { key: "Season", value: "Spring, Summer" },
        { key: "Closure", value: "Pull-On" },
        { key: "Stretch", value: "High Stretch" },
        { key: "Texture", value: "Ribbed" },
        { key: "Detail", value: "Dual Drawstring Sides" },
      ],
    },
  },
  {
    slug: "lavender-muse-ribbed-mini-dress",
    data: {
      categories: ["dresses", "mini-dresses"],
      metaTitle: "Lavender Ribbed Tie Front Mini Dress",
      metaDescription:
        "Discover effortless style with this lavender ribbed mini dress featuring a tie-front neckline, adjustable straps, and a flattering bodycon silhouette.",
      keywords: [
        "lavender dress",
        "ribbed mini dress",
        "bodycon mini dress",
        "tie front dress",
        "summer mini dress",
        "vacation outfit women",
        "pastel dress women",
        "sleeveless dress",
        "fitted dress women",
        "oatclub dress",
      ],
      collections: [],
      fabrics: [],
      specifications: [
        { key: "Color", value: "Lavender" },
        { key: "Pattern", value: "Solid" },
        { key: "Type", value: "Bodycon Dress" },
        { key: "Neckline", value: "Tie-Front Scoop Neck" },
        { key: "Sleeve Type", value: "Sleeveless" },
        { key: "Length", value: "Mini" },
        { key: "Fit", value: "Slim Fit" },
        { key: "Occasion", value: "Vacation, Brunch, Day Out, Party" },
        { key: "Fabric", value: "Rib Knit Stretch Blend" },
        { key: "Season", value: "Spring, Summer" },
        { key: "Closure", value: "Pull-On" },
        { key: "Stretch", value: "High Stretch" },
        { key: "Texture", value: "Ribbed" },
        { key: "Hemline", value: "Lettuce Edge Hem" },
        { key: "Strap Type", value: "Adjustable Spaghetti Straps" },
      ],
    },
  },
  {
    slug: "midnight-contrast-ribbed-midi-dress",
    data: {
      shortDescription:
        "A refined ribbed midi dress designed with a statement contrast square neckline and a sculpted silhouette. Crafted to contour the body while maintaining effortless elegance from day to evening.",
      howToStyle:
        "Pair with pointed heels, a structured shoulder bag, and minimal jewelry for elevated evening dressing. Layer with a tailored blazer for a polished city look.",
      fabricDetails:
        "Premium stretch rib knit construction offers structure, comfort, and shape retention. The soft-touch finish creates a smooth silhouette with all-day ease.",
      keyFeatures: [
        "Ribbed knit fabric",
        "Contrast square neckline",
        "Body-skimming silhouette",
        "Full sleeves",
        "Midi length",
        "Stretch comfort",
        "Minimalist design",
        "Day-to-evening versatility",
      ],
      categories: ["dresses", "midi-dresses"],
      tags: [
        "black midi dress",
        "bodycon midi dress",
        "square neck dress",
        "ribbed dress",
        "elegant black dress",
        "long sleeve dress",
        "evening dress women",
        "minimalist fashion",
        "luxury basics",
        "date night dress",
      ],
      metaTitle: "Black Ribbed Square Neck Midi Dress for Women",
      metaDescription:
        "Elevate your wardrobe with this black ribbed midi dress featuring a contrast square neckline, full sleeves, and a flattering sculpted silhouette.",
      keywords: [
        "black midi dress",
        "ribbed midi dress",
        "square neck dress",
        "bodycon dress women",
        "elegant black dress",
        "long sleeve midi dress",
        "fitted dress",
        "evening dress",
        "minimal dress",
        "oatclub dress",
      ],
      collections: [],
      fabrics: [],
      specifications: [
        { key: "Color", value: "Black" },
        { key: "Pattern", value: "Solid" },
        { key: "Type", value: "Bodycon Dress" },
        { key: "Neckline", value: "Contrast Square Neck" },
        { key: "Sleeve Type", value: "Full Sleeves" },
        { key: "Length", value: "Midi" },
        { key: "Fit", value: "Slim Fit" },
        { key: "Occasion", value: "Evening, Dinner, Smart Casual" },
        { key: "Fabric", value: "Rib Knit Stretch Blend" },
        { key: "Season", value: "All Season" },
        { key: "Closure", value: "Pull-On" },
        { key: "Stretch", value: "High Stretch" },
        { key: "Texture", value: "Ribbed" },
        { key: "Silhouette", value: "Column" },
      ],
    },
  },
];

async function run() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ MongoDB connected");

    for (const item of updates) {
      const product = await Product.findOne({ slug: item.slug });

      if (!product) {
        console.log(`⚠️ Product not found: ${item.slug}`);
        continue;
      }

      await Product.updateOne(
        { slug: item.slug },
        {
          $set: item.data,
        }
      );

      console.log(`✅ Updated: ${item.slug}`);
    }
  } catch (error) {
    console.error("❌ Script failed:", error);
  } finally {
    await mongoose.disconnect();
    console.log("✅ MongoDB disconnected");
  }
}

run();