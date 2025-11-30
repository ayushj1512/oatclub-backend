import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import cors from "cors";
import morgan from "morgan";

// Import routes
import addressRoutes from "./routes/addressRouter.js";
import blogRoutes from "./routes/blogRouter.js";
import categoryRoutes from "./routes/categoryRouter.js";
import collectionRoutes from "./routes/collectionRouter.js";
import couponRoutes from "./routes/couponRouter.js";
import creditRoutes from "./routes/creditRouter.js";
import customerRoutes from "./routes/customerRouter.js";
import newsletterRoutes from "./routes/newsletterRouter.js";
import offerRoutes from "./routes/offerRouter.js";
import orderRoutes from "./routes/orderRouter.js";
import productRoutes from "./routes/productRouter.js";
import queryRoutes from "./routes/queryRouter.js";
import reviewRoutes from "./routes/reviewRouter.js";
import tagRoutes from "./routes/tagRouter.js";
import wishlistRoutes from "./routes/wishlistRouter.js";
import adminUserRoutes from "./routes/admin/adminUserRouter.js";
import inventoryRoutes from "./routes/admin/inventoryRouter.js";
import pingRoutes from "./routes/pingRouter.js";
import superadminRoutes from "./routes/superadmin.js";

// 🔥 New Ticket Route
import ticketRoutes from "./routes/admin/tickets.js";

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
app.use("/api/ping", pingRoutes);
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
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/admins", adminUserRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/superadmin", superadminRoutes);

// 🔥 Register Ticket Routes
app.use("/api/tickets", ticketRoutes);

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
