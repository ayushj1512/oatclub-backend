// --------------------------------------------------
// server.js (MIRAY FASHIONS Backend)
// --------------------------------------------------

import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import cors from "cors";
import morgan from "morgan";

// --------------------------------------------------
// ROUTES (MAIN)
// --------------------------------------------------
import pingRoutes from "./routes/pingRouter.js";
import newsletterRouter from "./Newsletter/newsletterRouter.js";
import addressRoutes from "./Address/addressRouter.js";
import blogRoutes from "./Blogs/blogRouter.js";
import categoryRoutes from "./Category/categoryRouter.js";
import collectionRoutes from "./Collection/collectionRouter.js";
import couponRoutes from "./Coupon/couponRouter.js";
import creditRoutes from "./Credit/creditRouter.js";
import customerRoutes from "./Customer/customerRouter.js";
import newsletterRoutes from "./Newsletter/newsletterRouter.js";
import offerRoutes from "./Offer/offerRouter.js";
import orderRoutes from "./Orders/orderRouter.js";
import productRoutes from "./Products/productRouter.js";
import queryRoutes from "./Query/queryRouter.js";
import reviewRoutes from "./Review/reviewRouter.js";
import wishlistRoutes from "./Wishlist/wishlistRouter.js";
import fabricRoutes from "./Fabric/fabric.routes.js";
import sizeChartRoutes from "./SizeChart/sizeChartRoutes.js";

import attributeRoutes from "./Attribute/attributeRoutes.js";
import shiprocketRoutes from "./shiprocket/shipping.routes.js";

// --------------------------------------------------
// ROUTES (ADMIN / SUPERADMIN)
// --------------------------------------------------
import inventoryRoutes from "./routes/admin/inventoryRouter.js";
import ticketRoutes from "./routes/admin/tickets.js";

import superadminRoutes from "./routes/superadmin.js";

// --------------------------------------------------
// EXTRA FEATURES
// --------------------------------------------------

// ✅ Analytics
import productViewAnalyticsRoutes from "./productviews/analytics.routes.js";

// ✅ Reels
import reelsRoutes from "./reels/reels.router.js";

// ✅ Razorpay
import razorpayRoutes from "./Razorpay/razorpay.router.js";
import { webhook as razorpayWebhook } from "./Razorpay/razorpay.controller.js";

// ✅ Cloudinary
import { cloudinary } from "./config/cloudinary.js";
import mediaRoutes from "./cloudinary/mediaRoutes.js";

// ✅ Customer Support Tickets
import customerTicketRoutes from "./CustomerTicket/customerTicket.routes.js";

// ✅ Barcode
import barcodeItemRoutes from "./BarcodeItem/barcodeItem.routes.js";

// ✅ Abandoned carts
import abandonedCartRoutes from "./AbandonedCart/AbandonedCartRoutes.js";



import homepageSettingsRoutes from "./HomepageSettings/homepageSettingsRoutes.js";
import adminUserRoutes from "./AdminUsers/adminUserRoutes.js"; // ✅ import routes

// --------------------------------------------------
// CONFIG
// --------------------------------------------------
dotenv.config();
const app = express();

// ✅ For deployment environments like Render/NGINX
app.set("trust proxy", 1);

// --------------------------------------------------
// ✅ CORS CONFIG (CENTRALIZED)
// --------------------------------------------------
const ALLOWED_ORIGINS = [
  // Local
  "http://localhost:3000",
  "http://localhost:3001",

  // ✅ Frontend
  "https://www.mirayfashions.in",
  "https://mirayfashions.in",

  // ✅ Admin Panel
  "https://admin.mirayfashions.com",

  // ✅ Backend itself (optional)
  "https://miray-backend.onrender.com",
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow Postman / server-to-server / curl
      if (!origin) return callback(null, true);

      // Allow listed origins
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);

      // ❌ Block others silently
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// --------------------------------------------------
// MIDDLEWARE
// --------------------------------------------------
app.use(morgan("dev"));

/**
 * ✅ Razorpay webhook MUST be BEFORE JSON parser
 */
app.post(
  "/api/razorpay/webhook",
  express.raw({ type: "application/json" }),
  razorpayWebhook
);

// Body parsers
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// --------------------------------------------------
// ✅ CLOUDINARY STARTUP CHECK (Non-blocking)
// --------------------------------------------------
(async () => {
  try {
    const r = await cloudinary.api.ping();
    console.log("✅ Cloudinary Ping OK:", r);
  } catch (e) {
    console.log("❌ Cloudinary Ping Failed:", e?.message || e);
  }
})();

// --------------------------------------------------
// ✅ DATABASE
// --------------------------------------------------
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// --------------------------------------------------
// ✅ API ROUTES
// --------------------------------------------------

app.use("/api/ping", pingRoutes);
app.use("/api/size-charts", sizeChartRoutes);
app.use("/api/addresses", addressRoutes);
app.use("/api/blogs", blogRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/collections", collectionRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/credits", creditRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/offers", offerRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/products", productRoutes);
app.use("/api/queries", queryRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/fabrics", fabricRoutes);
app.use("/api/attributes", attributeRoutes);
app.use("/api/admin-users", adminUserRoutes);
// Admin
app.use("/api/inventory", inventoryRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/homepage-settings", homepageSettingsRoutes);
app.use("/api/newsletters", newsletterRouter);

// Media
app.use("/api/media", mediaRoutes);

// Shipping (Shiprocket)
app.use("/api", shiprocketRoutes);

// --------------------------------------------------
// ✅ PRODUCT VIEW ANALYTICS
// POST /api/analytics/product-view
// --------------------------------------------------
app.use("/api/analytics", productViewAnalyticsRoutes);

// --------------------------------------------------
// ✅ REELS
// --------------------------------------------------
app.use("/api/reels", reelsRoutes);

// --------------------------------------------------
// ✅ CUSTOMER SUPPORT
// --------------------------------------------------
app.use("/api/support", customerTicketRoutes);

// --------------------------------------------------
// ✅ BARCODE
// --------------------------------------------------
app.use("/api", barcodeItemRoutes);

// --------------------------------------------------
// ✅ RAZORPAY
// --------------------------------------------------
app.use("/api/razorpay", razorpayRoutes);

// --------------------------------------------------
// ✅ ABANDONED CARTS
// --------------------------------------------------
app.use("/api/abandoned-carts", abandonedCartRoutes);

// --------------------------------------------------
// ✅ SUPERADMIN
// --------------------------------------------------
app.use("/superadmin", superadminRoutes);

// --------------------------------------------------
// ROOT
// --------------------------------------------------
app.get("/", (req, res) => {
  res.send("🛒 MIRAY FASHIONS API running...");
});

// --------------------------------------------------
// ✅ CLOUDINARY TEST
// --------------------------------------------------
app.get("/api/cloudinary/test", async (req, res) => {
  try {
    const r = await cloudinary.api.ping();
    res.json({ ok: true, result: r });
  } catch (e) {
    res.status(500).json({
      ok: false,
      message: e?.message || "Cloudinary ping failed",
    });
  }
});

// --------------------------------------------------
// ✅ 404 HANDLER (Always last route)
// --------------------------------------------------
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// --------------------------------------------------
// ✅ GLOBAL ERROR HANDLER
// --------------------------------------------------
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Server Error",
  });
});

// --------------------------------------------------
// ✅ START SERVER
// --------------------------------------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
