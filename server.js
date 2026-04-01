// --------------------------------------------------
// server.js (MIRAY FASHIONS Backend)
// --------------------------------------------------

// ✅ MUST BE FIRST LINE (ESM SAFE)
import "dotenv/config";

import express from "express";
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
import offerRoutes from "./Offer/offerRouter.js";
import orderRoutes from "./Orders/orderRouter.js";
import productRoutes from "./Products/productRouter.js";
import queryRoutes from "./Query/queryRouter.js";
import reviewRoutes from "./Review/reviewRouter.js";
import wishlistRoutes from "./Wishlist/wishlistRouter.js";
import fabricRoutes from "./Fabric/fabric.routes.js";
import sizeChartRoutes from "./SizeChart/sizeChartRoutes.js";
import proxyImageRoute from "./routes/imageProxy.route.js";
import emailRoutes from "./Email/email.routes.js"; // ✅ your merged email/actions routes
import collaborationRoutes from "./Collaboration/CollaborationRoutes.js"; // <-- router file
import attributeRoutes from "./Attribute/attributeRoutes.js";
import shiprocketRoutes from "./shiprocket/shipping.routes.js";
import bestsellerRoutes from "./BestSeller/bestseller.routes.js";
import xpressbeesRoutes from "./Xpressbees/xpressbees.routes.js";
import adminFootwearRoutes from "./Footwear/adminFootwearRoutes.js";
import footwearRoutes from "./Footwear/footwearRoutes.js";
import inventoryReservationRoutes from "./InventoryReservation/InventoryReservationRoutes.js";
import { startCrons } from "./cronjob/index.js";
import homeCollectionsRoutes from "./HomeCollection/HomeCollectionsRoutes.js";
import metaFeedRouter from "./routes/metaFeed.js";
import metaAdsRoutes from "./MetaAds/MetaAdsRoutes.js";
import remittanceRoutes from "./Remittance/RemiitanceRouter.js";
import commerceManagerRoutes from "./CommerceManager/CommerceManagerRoutes.js";
import commerceFeed from "./routes/commerceManagerFeed.js";
import influencerProgramRoutes from "./InfluencerProgram/InfluencerProgramRoutes.js";


// --------------------------------------------------
// ROUTES (ADMIN / SUPERADMIN)
// --------------------------------------------------
import inventoryRoutes from "./routes/admin/inventoryRouter.js";
import ticketRoutes from "./routes/admin/tickets.js";
import superadminRoutes from "./routes/superadmin.js";
import marketingSpendRoutes from "./MarketingSpend/marketingSpendRoutes.js";
import marqueeRoutes from "./MarqueeItem/marquee.routes.js";
import bluedartRoutes from "./BlueDart/bluedart.routes.js";

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
import adminUserRoutes from "./AdminUsers/adminUserRoutes.js";
import mediaAuthRoutes from "./MediaUser/mediaAuthRoutes.js";
import commingSoonRoutes from "./ComingSoonModel/comingSoon.routes.js"
import fabriclogRoutes from "./FabricLog/FabricLogRouter.js";
// --------------------------------------------------
// ✅ ENV DEBUG (VERY IMPORTANT)
// --------------------------------------------------
console.log("✅ ENV LOADED @ server.js:", {
  MAIL_ENABLED: process.env.MAIL_ENABLED,
  MAIL_USER: process.env.MAIL_USER,
  MAIL_PASS: process.env.MAIL_PASS ? "✅ present" : "❌ missing",
  MAIL_HOST: process.env.MAIL_HOST,
  MAIL_PORT: process.env.MAIL_PORT,
});

// --------------------------------------------------
// CONFIG
// --------------------------------------------------
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
  "http://localhost:3002",

  // ✅ Frontend (.in)
  "https://www.mirayfashions.in",
  "https://mirayfashions.in",

  // ✅ Frontend (.com)
  "https://www.mirayfashions.com",
  "https://mirayfashions.com",

  // ✅ Product frontend
  "https://product.mirayfashions.com",

  // ✅ Media Panel / Media site
  "https://media.mirayfashions.com",
  "https://www.media.mirayfashions.com",
  "https://miray-media-project.vercel.app",
  "https://www.miray-media-project.vercel.app",

  // ✅ Vercel deployments / previews
  "https://miray-nine.vercel.app",

  // ✅ Admin Panel
  "https://admin.mirayfashions.com",

  // ✅ Backend itself
  "https://miray-backend.onrender.com",
];


// ✅ Allow Shiprocket webhook without CORS restrictions
app.use("/api/shiprocket/webhook", (req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-api-key, x-shiprocket-token, x-webhook-token"
  );
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});


app.use(
  cors({
    origin: function (origin, callback) {
      // ✅ Allow server-to-server / Postman / curl (no origin)
      if (!origin) return callback(null, true);

      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);

      // ❌ Block everything else
      return callback(new Error("Not allowed by CORS"), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
  "Content-Type",
  "Authorization",
  "x-api-key",
  "x-shiprocket-token",
  "x-webhook-token",
],

  })
);

app.use((req, res, next) => {
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

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
app.use("/api/fabric-logs", fabriclogRoutes);
app.use("/api/attributes", attributeRoutes);
app.use("/api/admin-users", adminUserRoutes);
app.use("/api/proxy-image", proxyImageRoute);
app.use("/api", emailRoutes);
app.use("/api/collaborations", collaborationRoutes);
app.use("/api", bestsellerRoutes);
app.use("/api/shipping/xpressbees", xpressbeesRoutes);
app.use("/api/footwear", footwearRoutes);
app.use("/api/admin/footwear", adminFootwearRoutes);
app.use("/api/inventory-reservations", inventoryReservationRoutes);
app.use("/api/coming-soon", commingSoonRoutes);
app.use("/api/marketing", marketingSpendRoutes);
app.use("/api/commerce-manager", commerceManagerRoutes);
app.use("/api/commerce-feed", commerceFeed);

// Admin
app.use("/api/inventory", inventoryRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/homepage-settings", homepageSettingsRoutes);
app.use("/api/newsletters", newsletterRouter);
app.use("/api/bluedart", bluedartRoutes);
app.use("/api/remittance", remittanceRoutes);
// Media
app.use("/api/media", mediaRoutes);
app.use("/media-user", mediaAuthRoutes);

// Shipping
app.use("/api", shiprocketRoutes);

// Analytics
app.use("/api/analytics", productViewAnalyticsRoutes);

// Reels
app.use("/api/reels", reelsRoutes);

// Support
app.use("/api/support", customerTicketRoutes);

// Barcode
app.use("/api", barcodeItemRoutes);

// Razorpay
app.use("/api/razorpay", razorpayRoutes);

// Abandoned carts
app.use("/api/abandoned-carts", abandonedCartRoutes);

// Meta Ads
app.use("/api/meta-ads", metaAdsRoutes);

// influencer program
app.use("/api/influencer-program", influencerProgramRoutes);

// Superadmin
app.use("/superadmin", superadminRoutes);
app.use("/api/home-collections", homeCollectionsRoutes);
app.use("/api", marqueeRoutes);
// Root
app.get("/", (req, res) => {
  res.send("🛒 MIRAY FASHIONS API running...");
});
//xml 


app.use("/", metaFeedRouter);// startCrons();
// Cloudinary test
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

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});



// Global error handler
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

  console.log("📨 MAIL_ENABLED:", process.env.MAIL_ENABLED);
  console.log("SMTP HOST:", process.env.MAIL_HOST);
  console.log("SMTP PORT:", process.env.MAIL_PORT);
  console.log("SMTP USER:", process.env.MAIL_USER);
  console.log("SMTP PASS:", process.env.MAIL_PASS ? "✅ present" : "❌ missing");
});
