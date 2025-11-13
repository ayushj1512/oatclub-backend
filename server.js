// server.js
import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import cors from "cors";
import morgan from "morgan";

// Import routes
import addressRoutes from "./routes/addressRoutes.js";
import blogRoutes from "./routes/blogRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import collectionRoutes from "./routes/collectionRoutes.js";
import couponRoutes from "./routes/couponRoutes.js";
import creditRoutes from "./routes/creditRoutes.js";
import customerRoutes from "./routes/customerRoutes.js";
import newsletterRoutes from "./routes/newsletterRoutes.js";
import offerRoutes from "./routes/offerRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import queryRoutes from "./routes/queryRoutes.js";
import reviewRoutes from "./routes/reviewRoutes.js";
import tagRoutes from "./routes/tagRoutes.js";
import wishlistRoutes from "./routes/wishlistRoutes.js";
import adminUserRoutes from "./routes/adminUserRoutes.js";
import inventoryRoutes from "./routes/inventoryRoutes.js";
import pingRoutes from "./routes/pingRoutes.js"; // ✅ Ping route

// Import Cloudinary config
import { cloudinary } from "./config/cloudinary.js";

dotenv.config();
const app = express();

// 🔹 Middleware
app.use(cors());
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// 🔹 MongoDB connection
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// 🔹 Routes
app.use("/api/ping", pingRoutes); // ✅ Health check route for uptime
app.use("/api/addresses", addressRoutes);
app.use("/api/blogs", blogRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/collections", collectionRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/credits", creditRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/newsletters", newsletterRoutes);
app.use("/api/offers", offerRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/products", productRoutes);
app.use("/api/queries", queryRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/tags", tagRoutes);
app.use("/api/wishlists", wishlistRoutes);
app.use("/api/admins", adminUserRoutes);
app.use("/api/inventory", inventoryRoutes);

// 🔹 Root route
app.get("/", (req, res) => {
  res.send("🛒 E-commerce API running...");
});

// 🔹 404 handler
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// 🔹 Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Server Error",
  });
});

// 🔹 Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
