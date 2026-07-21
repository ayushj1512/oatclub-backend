// --------------------------------------------------
// server.js (OATCLUB Backend)
// --------------------------------------------------

// ✅ MUST BE FIRST LINE
import "dotenv/config";

import dns from "dns";
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import morgan from "morgan";

// --------------------------------------------------
// ✅ DNS CONFIG
// --------------------------------------------------
// ✅ Cloudflare DNS
// ✅ Replaced old Google DNS 8.8.8.8 with 1.1.1.1
dns.setServers(["1.1.1.1", "1.0.0.1"]);

// --------------------------------------------------
// ROUTES
// --------------------------------------------------
import pingRoutes from "./routes/pingRouter.js";
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
import emailRoutes from "./Email/email.routes.js";
import collaborationRoutes from "./Collaboration/CollaborationRoutes.js";
import affiliateRoutes from "./Affiliate/AffiliateRouter.js";
import attributeRoutes from "./Attribute/attributeRoutes.js";
import shiprocketRoutes from "./shiprocket/shipping.routes.js";
import bestsellerRoutes from "./BestSeller/bestseller.routes.js";
import adminFootwearRoutes from "./Footwear/adminFootwearRoutes.js";
import footwearRoutes from "./Footwear/footwearRoutes.js";
import inventoryReservationRoutes from "./InventoryReservation/InventoryReservationRoutes.js";
import homeCollectionsRoutes from "./HomeCollection/HomeCollectionsRoutes.js";
import metaFeedRouter from "./routes/metaFeed.js";
import metaAdsRoutes from "./MetaAds/MetaAdsRoutes.js";
import remittanceRoutes from "./Remittance/RemiitanceRouter.js";
import commerceManagerRoutes from "./CommerceManager/CommerceManagerRoutes.js";
import commerceFeed from "./routes/commerceManagerFeed.js";
import influencerProgramRoutes from "./InfluencerProgram/InfluencerProgramRoutes.js";
import whatsappConfirmationMessageRoutes from "./whatsappConfirmationMessage/whatsappConfirmationMessageRoutes.js";
import tailorroutes from "./tailor/tailor.routes.js";

import inventoryRoutes from "./routes/admin/inventoryRouter.js";
import ticketRoutes from "./routes/admin/tickets.js";
import superadminRoutes from "./routes/superadmin.js";
import marketingSpendRoutes from "./MarketingSpend/marketingSpendRoutes.js";
import marqueeRoutes from "./MarqueeItem/marquee.routes.js";

import productViewAnalyticsRoutes from "./productviews/analytics.routes.js";
import reelsRoutes from "./reels/reels.router.js";

import razorpayRoutes from "./Razorpay/razorpay.router.js";
import { webhook as razorpayWebhook } from "./Razorpay/razorpay.controller.js";

import { cloudinary } from "./config/cloudinary.js";
import mediaRoutes from "./cloudinary/mediaRoutes.js";

import customerTicketRoutes from "./CustomerTicket/customerTicket.routes.js";
import barcodeItemRoutes from "./BarcodeItem/barcodeItem.routes.js";
import abandonedCartRoutes from "./AbandonedCart/AbandonedCartRoutes.js";
import homepageSettingsRoutes from "./HomepageSettings/homepageSettingsRoutes.js";
import adminUserRoutes from "./AdminUsers/adminUserRoutes.js";
import mediaAuthRoutes from "./MediaUser/mediaAuthRoutes.js";
import commingSoonRoutes from "./ComingSoonModel/comingSoon.routes.js";
import fabriclogRoutes from "./FabricLog/FabricLogRouter.js";

import orderRefundRoutes from "./Orders/order.refunds/orderRefundRoutes.js";
import marketingcampaignroutes from "./MarketingCampaign/marketingCampaignRoutes.js";
import vendorUserRoutes from "./VendorUser/vendorUserRoutes.js";
import cuttingBatchRoutes from "./cuttingbatch/cuttingbatchroute.js";

// --------------------------------------------------
// APP CONFIG
// --------------------------------------------------
const app = express();

app.set("trust proxy", 1);

// --------------------------------------------------
// ENV DEBUG
// --------------------------------------------------
console.log("✅ ENV LOADED @ server.js:", {
  MAIL_ENABLED: process.env.MAIL_ENABLED,
  MAIL_USER: process.env.MAIL_USER,
  MAIL_PASS: process.env.MAIL_PASS ? "✅ present" : "❌ missing",
  MAIL_HOST: process.env.MAIL_HOST,
  MAIL_PORT: process.env.MAIL_PORT,
});

// --------------------------------------------------
// CORS CONFIG
// --------------------------------------------------
const ALLOWED_ORIGINS = [
  // Local Development
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:4000",
  "http://192.168.29.74:3000",
  // OATCLUB Store
  "https://oatclub.in",
  "https://www.oatclub.in",
  "https://oatclub-storefront.vercel.app",

  // OATCLUB Admin
  "https://admin.oatclub.in",
  "https://oatclub-admin.vercel.app",

  // Backend Domain
  "https://studio.oatclub.in",

  "https://oatclub-vendor-vdsc.vercel.app",
  "http://vendor.oatclub.in",
];

// ✅ Shiprocket webhook CORS bypass
app.use("/api/shiprocket/webhook", (req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-api-key, x-shiprocket-token, x-webhook-token",
  );

  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);

      if (ALLOWED_ORIGINS.includes(origin)) {
        return callback(null, true);
      }

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
  }),
);

app.use((req, res, next) => {
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// --------------------------------------------------
// MIDDLEWARE
// --------------------------------------------------
app.use(morgan("dev"));

// ✅ Razorpay webhook must come before JSON parser
app.post(
  "/api/razorpay/webhook",
  express.raw({ type: "application/json" }),
  razorpayWebhook,
);

app.use(
  "/api/whatsapp-confirmation-message",
  whatsappConfirmationMessageRoutes,
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// --------------------------------------------------
// CLOUDINARY CHECK
// --------------------------------------------------
(async () => {
  try {
    const result = await cloudinary.api.ping();
    console.log("✅ Cloudinary Ping OK:", result);
  } catch (error) {
    console.log("❌ Cloudinary Ping Failed:", error?.message || error);
  }
})();

// --------------------------------------------------
// DATABASE
// --------------------------------------------------
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((error) => console.error("❌ MongoDB connection error:", error));

// --------------------------------------------------
// API ROUTES
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
app.use("/api/cutting-batches", cuttingBatchRoutes);
app.use("/api/order-refunds", orderRefundRoutes);
app.use("/api/products", productRoutes);
app.use("/api/queries", queryRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/fabrics", fabricRoutes);
app.use("/api/fabric-logs", fabriclogRoutes);
app.use("/api/attributes", attributeRoutes);
app.use("/api/admin-users", adminUserRoutes);
app.use("/api/vendor-users", vendorUserRoutes);
app.use("/api", emailRoutes);
app.use("/api/collaborations", collaborationRoutes);
app.use("/api/affiliates", affiliateRoutes);
app.use("/api", bestsellerRoutes);
app.use("/api/footwear", footwearRoutes);
app.use("/api/admin/footwear", adminFootwearRoutes);
app.use("/api/inventory-reservations", inventoryReservationRoutes);
app.use("/api/coming-soon", commingSoonRoutes);
app.use("/api/marketing", marketingSpendRoutes);
app.use("/api/commerce-manager", commerceManagerRoutes);
app.use("/api/commerce-feed", commerceFeed);

app.use("/api/inventory", inventoryRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/homepage-settings", homepageSettingsRoutes);
app.use("/api/remittance", remittanceRoutes);

app.use("/api/media", mediaRoutes);
app.use("/media-user", mediaAuthRoutes);

app.use("/api/tailors", tailorroutes);

app.use("/api", shiprocketRoutes);

app.use("/api/analytics", productViewAnalyticsRoutes);
app.use("/api/reels", reelsRoutes);
app.use("/api/support", customerTicketRoutes);
app.use("/api", barcodeItemRoutes);

app.use("/api/razorpay", razorpayRoutes);
app.use("/api/abandoned-carts", abandonedCartRoutes);
app.use("/api/meta-ads", metaAdsRoutes);
app.use("/api/influencer-program", influencerProgramRoutes);

app.use("/superadmin", superadminRoutes);
app.use("/api/home-collections", homeCollectionsRoutes);
app.use("/api", marqueeRoutes);
app.use("/api/marketing-campaigns", marketingcampaignroutes);

// --------------------------------------------------
// ROOT + FEEDS
// --------------------------------------------------
app.get("/", (req, res) => {
  res.send(`
    🚀 OATCLUB API
    Own All Trends.

    Build Fast.
    Move Faster.
    Stay Unstoppable.

    Status: Online ✅
  `);
});

app.use("/", metaFeedRouter);

// --------------------------------------------------
// CLOUDINARY TEST
// --------------------------------------------------
app.get("/api/cloudinary/test", async (req, res) => {
  try {
    const result = await cloudinary.api.ping();

    res.json({
      ok: true,
      result,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error?.message || "Cloudinary ping failed",
    });
  }
});

// --------------------------------------------------
// 404 HANDLER
// --------------------------------------------------
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// --------------------------------------------------
// GLOBAL ERROR HANDLER
// --------------------------------------------------
app.use((err, req, res, next) => {
  console.error(err?.stack || err);

  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Server Error",
  });
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);

  console.log("📨 MAIL_ENABLED:", process.env.MAIL_ENABLED);
  console.log("SMTP HOST:", process.env.MAIL_HOST);
  console.log("SMTP PORT:", process.env.MAIL_PORT);
  console.log("SMTP USER:", process.env.MAIL_USER);
  console.log(
    "SMTP PASS:",
    process.env.MAIL_PASS ? "✅ present" : "❌ missing",
  );
});
