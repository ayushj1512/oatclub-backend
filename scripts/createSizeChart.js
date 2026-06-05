import "dotenv/config";
import mongoose from "mongoose";
import SizeChart from "../SizeChart/SizeChart.js";

const CATEGORY_IDS = [
  "6a2069c90d2c8e58a5afadef",
  "6a2069c90d2c8e58a5afade3",
  "6a2069c90d2c8e58a5afadf3",
  "6a2069c90d2c8e58a5afade9",
  "6a2069ae0d2c8e58a5afaddf",
  "6a2069ae0d2c8e58a5afade0",
  "6a2069c90d2c8e58a5afadea",
  "6a2069c90d2c8e58a5afade4",
  "6a2069c90d2c8e58a5afadf4",
  "6a2069c90d2c8e58a5afadf0",
  "6a2069ae0d2c8e58a5afade1",
  "6a2069c90d2c8e58a5afadf1",
  "6a2069c90d2c8e58a5afadeb",
  "6a2069c90d2c8e58a5afade5",
  "6a2069c90d2c8e58a5afadf5",
  "6a2069c90d2c8e58a5afadec",
  "6a2069ae0d2c8e58a5afade2",
  "6a2069c90d2c8e58a5afadf6",
  "6a2069c90d2c8e58a5afadf2",
  "6a2069c90d2c8e58a5afade6",
  "6a2069c90d2c8e58a5afade7",
  "6a2069c90d2c8e58a5afaded",
  "6a2069c90d2c8e58a5afadf7",
  "6a2069c90d2c8e58a5afade8",
  "6a2069c90d2c8e58a5afadf8",
  "6a2069c90d2c8e58a5afadee",
];

const sizeChartData = {
  title: "Women Standard Size Chart",
  unit: "cm",
  headers: ["Size", "Bust", "Waist", "Hips"],
  rows: [
    ["XS", '82 cm (32")', '62 cm (24.5")', '90 cm (35.5")'],
    ["S", '86 cm (34")', '66 cm (26")', '94 cm (37")'],
    ["M", '90 cm (35.5")', '70 cm (27.5")', '98 cm (38.5")'],
    ["L", '96 cm (37.5")', '76 cm (30")', '104 cm (41")'],
    ["XL", '102 cm (40")', '82 cm (32.5")', '110 cm (43.5")'],
  ],
  note: "Measurements are body measurements. Minor variation may occur.",
  categories: CATEGORY_IDS,
};

async function run() {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI missing in .env");
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected");

    const existing = await SizeChart.findOne({ title: sizeChartData.title });

    if (existing) {
      existing.unit = sizeChartData.unit;
      existing.headers = sizeChartData.headers;
      existing.rows = sizeChartData.rows;
      existing.note = sizeChartData.note;
      existing.categories = sizeChartData.categories;

      await existing.save();

      console.log("Size chart updated:", existing._id.toString());
    } else {
      const created = await SizeChart.create(sizeChartData);
      console.log("Size chart created:", created._id.toString());
    }
  } catch (error) {
    console.error("Size chart script failed:", error.message);
  } finally {
    await mongoose.disconnect();
    console.log("MongoDB disconnected");
  }
}

run();