import "dotenv/config";
import dns from "dns";
import mongoose from "mongoose";
import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";

/**
 * ✅ Process Name:
 * DNS SRV Lookup Resolution
 *
 * MongoDB Atlas mongodb+srv:// URLs need SRV DNS lookup.
 * This fixes: querySrv ECONNREFUSED _mongodb._tcp...
 */
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const OUT_DIR = path.join(process.cwd(), "exports");
const OUT_FILE = path.join(
  OUT_DIR,
  `customer-marketing-data-${new Date().toISOString().slice(0, 10)}.xlsx`
);

const safe = (v, fallback = "") => v ?? fallback;

const cleanPhone = (phone = "") =>
  String(phone).replace(/\D/g, "").slice(-10);

const toDate = (v) => {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d;
};

const daysAgo = (v) => {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return Math.floor((Date.now() - d.getTime()) / 86400000);
};

const pct = (a, b) => (!b ? 0 : Number(((a / b) * 100).toFixed(2)));

const getId = (v) => {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (v._id) return String(v._id);
  return String(v);
};

const getAmount = (o) =>
  Number(o.finalPayable || o.totalAmount || o.grandTotal || o.total || 0);

const getPaymentMethod = (o) =>
  String(o.paymentMethod || o.payment?.method || "").toLowerCase();

const getPaymentStatus = (o) =>
  String(o.paymentStatus || o.payment?.status || "").toLowerCase();

const getStatus = (o) =>
  String(o.fulfillmentStatus || o.status || "").toLowerCase();

const getItems = (o) => (Array.isArray(o.items) ? o.items : []);

const topKey = (obj) =>
  Object.entries(obj).sort((a, b) => b[1] - a[1])[0]?.[0] || "";

const inc = (obj, key, qty = 1) => {
  if (!key) return;
  obj[key] = (obj[key] || 0) + Number(qty || 1);
};

const connectDB = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI missing in .env");
  }

  console.log("🔎 Process: DNS SRV Lookup Resolution");
  console.log("🌐 DNS Servers:", dns.getServers());
  console.log("🔌 Connecting MongoDB...");

  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 30000,
    connectTimeoutMS: 30000,
    socketTimeoutMS: 45000,
  });

  console.log("✅ MongoDB connected");
};

const getCollection = async (name) => {
  const exists = await mongoose.connection.db
    .listCollections({ name })
    .hasNext();

  if (!exists) {
    console.log(`⚠️ Collection not found: ${name}`);
    return [];
  }

  return mongoose.connection.collection(name).find({}).toArray();
};

const addDescription = (ws, text) => {
  ws.insertRow(1, [text]);
  ws.mergeCells(1, 1, 1, Math.max(ws.columnCount, 8));
  ws.getCell("A1").font = { bold: true, size: 12 };
  ws.getCell("A1").alignment = { wrapText: true, vertical: "middle" };
  ws.getRow(1).height = 38;
};

const styleSheet = (ws) => {
  ws.views = [{ state: "frozen", ySplit: 2 }];

  const header = ws.getRow(2);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF111827" },
  };

  ws.columns.forEach((col) => {
    col.width = Math.min(Math.max(String(col.header || "").length + 4, 14), 34);
  });

  ws.eachRow((row) => {
    row.eachCell((cell) => {
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.border = {
        top: { style: "thin", color: { argb: "FFE5E7EB" } },
        left: { style: "thin", color: { argb: "FFE5E7EB" } },
        bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
        right: { style: "thin", color: { argb: "FFE5E7EB" } },
      };
    });
  });
};

const addSheet = (wb, name, description, rows) => {
  const ws = wb.addWorksheet(name);

  const keys = Object.keys(rows[0] || { note: "" });

  ws.columns = keys.map((key) => ({
    header: key,
    key,
  }));

  ws.addRows(rows.length ? rows : [{ note: "No data found" }]);

  addDescription(ws, description);
  styleSheet(ws);

  return ws;
};

const makePersona = ({
  totalOrders,
  totalSpend,
  avgOrderValue,
  rtoRate,
  discountScore,
}) => {
  if (rtoRate >= 40) return "High Risk COD";
  if (totalSpend >= 25000 || totalOrders >= 8) return "VIP Buyer";
  if (avgOrderValue >= 3000) return "Premium Shopper";
  if (discountScore >= 60) return "Bargain Hunter";
  if (totalOrders >= 3) return "Loyal Buyer";
  if (totalOrders === 0) return "Window Shopper";
  return "New Buyer";
};

const main = async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  await connectDB();

  const customers = await getCollection("customers");
  const orders = await getCollection("orders");

  console.log(`👥 Customers found: ${customers.length}`);
  console.log(`📦 Orders found: ${orders.length}`);

  const ordersByKey = new Map();

  for (const order of orders) {
    const keys = [
      getId(order.customer || order.customerId),
      String(order.email || order.customerEmail || order.customer?.email || "").toLowerCase(),
      cleanPhone(order.phone || order.customerPhone || order.customer?.phone),
    ].filter(Boolean);

    for (const key of keys) {
      if (!ordersByKey.has(key)) ordersByKey.set(key, []);
      ordersByKey.get(key).push(order);
    }
  }

  const customerMaster = [];
  const segments = [];
  const preferences = [];
  const cartIntent = [];
  const codRisk = [];
  const campaignLists = [];
  const locationMap = new Map();

  for (const c of customers) {
    const customerObjectId = String(c._id);
    const email = String(c.email || "").toLowerCase();
    const phone = cleanPhone(c.phone);

    const matchedOrders = [
      ...(ordersByKey.get(customerObjectId) || []),
      ...(ordersByKey.get(email) || []),
      ...(ordersByKey.get(phone) || []),
    ];

    const uniqueOrders = [
      ...new Map(matchedOrders.map((o) => [String(o._id), o])).values(),
    ];

    const totalOrders =
      uniqueOrders.length || Number(c.analytics?.totalOrders || 0);

    const totalSpend =
      uniqueOrders.reduce((sum, o) => sum + getAmount(o), 0) ||
      Number(c.analytics?.totalSpend || 0);

    const avgOrderValue = totalOrders
      ? Number((totalSpend / totalOrders).toFixed(2))
      : 0;

    const codOrders = uniqueOrders.filter(
      (o) => getPaymentMethod(o) === "cod"
    ).length;

    const prepaidOrders = uniqueOrders.filter((o) =>
      ["razorpay", "prepaid", "online"].includes(getPaymentMethod(o))
    ).length;

    const deliveredOrders = uniqueOrders.filter((o) =>
      ["delivered", "completed"].includes(getStatus(o))
    ).length;

    const cancelledOrders = uniqueOrders.filter((o) =>
      ["cancelled", "canceled"].includes(getStatus(o))
    ).length;

    const returnedOrders = uniqueOrders.filter((o) =>
      ["returned", "return_requested"].includes(getStatus(o))
    ).length;

    const rtoOrders = uniqueOrders.filter((o) =>
      ["rto", "return_to_origin"].includes(getStatus(o))
    ).length;

    const paidOrders = uniqueOrders.filter((o) =>
      ["paid", "captured"].includes(getPaymentStatus(o))
    ).length;

    const orderDates = uniqueOrders
      .map((o) => new Date(o.createdAt || o.orderDate))
      .filter((d) => !Number.isNaN(d.getTime()))
      .sort((a, b) => a - b);

    const firstOrderAt = orderDates[0] || c.analytics?.firstOrderAt || "";
    const lastOrderAt =
      orderDates[orderDates.length - 1] || c.analytics?.lastOrderAt || "";

    const sizes = {};
    const colors = {};
    const categories = {};
    const productCodes = {};

    for (const order of uniqueOrders) {
      for (const item of getItems(order)) {
        const qty = item.quantity || 1;

        inc(sizes, item.selectedSize || item.size || item.variant?.size, qty);
        inc(colors, item.selectedColor || item.color || item.variant?.color, qty);

        inc(
          productCodes,
          item.productCode ||
            item.sku ||
            item.productSnapshot?.productCode ||
            item.product?.productCode,
          qty
        );

        inc(
          categories,
          item.category ||
            item.productSnapshot?.category ||
            item.product?.category?.name,
          qty
        );
      }
    }

    const couponUses = Number(c.analytics?.couponUses || 0);
    const discountScore = totalOrders
      ? Math.min(100, Math.round((couponUses / totalOrders) * 100))
      : 0;

    const deliveryRate = pct(deliveredOrders, totalOrders);
    const cancellationRate = pct(cancelledOrders, totalOrders);
    const returnRate = pct(returnedOrders, totalOrders);
    const rtoRate = pct(rtoOrders, totalOrders);
    const paymentSuccessRate = pct(paidOrders, totalOrders);

    const lastOrderDays = daysAgo(lastOrderAt);
    const lastCartDays = daysAgo(c.cart?.lastCartActivityAt);

    const customerType =
      totalOrders >= 8 || totalSpend >= 25000
        ? "vip"
        : rtoRate >= 35 || cancellationRate >= 40
        ? "risky"
        : lastOrderDays !== "" && lastOrderDays > 90
        ? "inactive"
        : totalOrders >= 2
        ? "repeat"
        : "new";

    const codRiskLevel =
      rtoRate >= 40 || cancellationRate >= 50
        ? "high"
        : rtoRate >= 20 || cancellationRate >= 25
        ? "medium"
        : "low";

    const engagementScore = Math.min(
      100,
      Math.round(
        totalOrders * 12 +
          deliveredOrders * 8 +
          Number(c.analytics?.wishlistCount || 0) * 3 +
          Number(c.cart?.cartCount || 0) * 4 +
          (lastCartDays !== "" && lastCartDays <= 7 ? 15 : 0) +
          (lastOrderDays !== "" && lastOrderDays <= 30 ? 20 : 0)
      )
    );

    const persona = makePersona({
      totalOrders,
      totalSpend,
      avgOrderValue,
      rtoRate,
      discountScore,
    });

    const row = {
      customerId: c.customerId || "",
      name: c.name || "",
      email,
      phone: c.phone || "",
      gender: c.gender || "unknown",
      ageGroup: c.ageGroup || "Unknown",
      city: c.city || "",
      state: c.state || "",
      country: c.country || "India",
      joinedAt: toDate(c.joinedAt || c.createdAt),

      totalOrders,
      totalSpend,
      avgOrderValue,
      deliveredOrders,
      cancelledOrders,
      returnedOrders,
      rtoOrders,
      codOrders,
      prepaidOrders,

      deliveryRate,
      cancellationRate,
      returnRate,
      rtoRate,
      paymentSuccessRate,

      firstOrderAt: toDate(firstOrderAt),
      lastOrderAt: toDate(lastOrderAt),
      lastOrderDays,

      favoriteCategory: topKey(categories),
      favoriteSize: topKey(sizes),
      favoriteColor: topKey(colors),
      topProductCode: topKey(productCodes),

      cartCount: c.cart?.cartCount || 0,
      abandonedCartCount: c.cart?.abandonedCartCount || 0,
      lastCartActivityAt: toDate(c.cart?.lastCartActivityAt),
      lastCartDays,

      wishlistCount: c.analytics?.wishlistCount || 0,
      couponUses,
      discountDependencyScore: discountScore,

      customerType,
      codRiskLevel,
      engagementScore,
      persona,
    };

    customerMaster.push(row);

    segments.push({
      customerId: row.customerId,
      name: row.name,
      phone: row.phone,
      email: row.email,
      customerType,
      persona,
      engagementScore,
      totalOrders,
      totalSpend,
      lastOrderDays,
      suggestedCampaign:
        customerType === "vip"
          ? "VIP early access / premium drop"
          : customerType === "inactive"
          ? "Winback offer"
          : codRiskLevel === "high"
          ? "COD verification / prepaid push"
          : discountScore >= 60
          ? "Coupon-led offer"
          : "New arrivals / recommendations",
    });

    preferences.push({
      customerId: row.customerId,
      name: row.name,
      phone: row.phone,
      favoriteCategory: row.favoriteCategory,
      favoriteSize: row.favoriteSize,
      favoriteColor: row.favoriteColor,
      topProductCode: row.topProductCode,
      budgetMin: c.preferences?.budgetRange?.min || "",
      budgetMax: c.preferences?.budgetRange?.max || "",
      cartProducts: (c.cartAdds || [])
        .map((x) => `${x.productCode}${x.size ? ` (${x.size})` : ""}`)
        .join(", "),
    });

    cartIntent.push({
      customerId: row.customerId,
      name: row.name,
      phone: row.phone,
      email: row.email,
      cartCount: row.cartCount,
      abandonedCartCount: row.abandonedCartCount,
      activeCartType: c.cart?.activeCartType || "",
      lastCartActivityAt: row.lastCartActivityAt,
      lastCartDays,
      cartAdds: (c.cartAdds || [])
        .map((x) => `${x.productCode}${x.size ? ` (${x.size})` : ""}`)
        .join(", "),
    });

    codRisk.push({
      customerId: row.customerId,
      name: row.name,
      phone: row.phone,
      totalOrders,
      codOrders,
      cancelledOrders,
      returnedOrders,
      rtoOrders,
      cancellationRate,
      returnRate,
      rtoRate,
      codRiskLevel,
      riskScore: Math.min(
        100,
        Math.round(rtoRate * 1.2 + cancellationRate * 0.8 + returnRate * 0.5)
      ),
    });

    campaignLists.push(
      {
        campaign: "VIP Customers",
        customerId: row.customerId,
        name: row.name,
        phone: row.phone,
        email: row.email,
        included: customerType === "vip" ? "Yes" : "No",
        reason: "High spend or repeat buying",
      },
      {
        campaign: "Abandoned Cart",
        customerId: row.customerId,
        name: row.name,
        phone: row.phone,
        email: row.email,
        included: row.abandonedCartCount > 0 ? "Yes" : "No",
        reason: "Has abandoned cart activity",
      },
      {
        campaign: "Winback",
        customerId: row.customerId,
        name: row.name,
        phone: row.phone,
        email: row.email,
        included: lastOrderDays !== "" && lastOrderDays > 60 ? "Yes" : "No",
        reason: "No recent order",
      }
    );

    const locKey = `${row.state || "Unknown"}|${row.city || "Unknown"}`;
    const loc = locationMap.get(locKey) || {
      state: row.state || "Unknown",
      city: row.city || "Unknown",
      customers: 0,
      orders: 0,
      revenue: 0,
      rtoOrders: 0,
      cancelledOrders: 0,
    };

    loc.customers += 1;
    loc.orders += totalOrders;
    loc.revenue += totalSpend;
    loc.rtoOrders += rtoOrders;
    loc.cancelledOrders += cancelledOrders;

    locationMap.set(locKey, loc);
  }

  const locationInsights = [...locationMap.values()].map((x) => ({
    ...x,
    avgRevenuePerCustomer: x.customers
      ? Number((x.revenue / x.customers).toFixed(2))
      : 0,
    rtoRate: pct(x.rtoOrders, x.orders),
    cancellationRate: pct(x.cancelledOrders, x.orders),
  }));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Miray Fashions";
  workbook.created = new Date();

  addSheet(
    workbook,
    "01 Customer Master",
    "Complete customer-level marketing export: identity, location, order behavior, cart intent, risk, engagement and persona.",
    customerMaster
  );

  addSheet(
    workbook,
    "02 Segments",
    "Ready-to-use customer segments for CRM, WhatsApp, Meta custom audiences and retention campaigns.",
    segments
  );

  addSheet(
    workbook,
    "03 Location Insights",
    "City/state-wise customers, orders, revenue, RTO and cancellation summary.",
    locationInsights
  );

  addSheet(
    workbook,
    "04 Preferences",
    "Fashion preference signals: favorite category, size, color, top product code and cart interests.",
    preferences
  );

  addSheet(
    workbook,
    "05 Cart Intent",
    "Cart and abandoned-cart signals useful for recovery campaigns and high-intent targeting.",
    cartIntent
  );

  addSheet(
    workbook,
    "06 COD Risk",
    "COD risk, RTO and cancellation control list for prepaid push and manual verification.",
    codRisk
  );

  addSheet(
    workbook,
    "07 Campaign Lists",
    "Filter Included = Yes and export phone/email for campaign execution.",
    campaignLists
  );

  addSheet(
    workbook,
    "README",
    "Customer Marketing Excel Export generated from MongoDB using MONGO_URI from .env.",
    [
      {
        Sheet: "01 Customer Master",
        Purpose: "Main customer database with persona, spend, orders, cart, preferences and risk.",
      },
      {
        Sheet: "02 Segments",
        Purpose: "CRM-ready segments and suggested campaigns.",
      },
      {
        Sheet: "03 Location Insights",
        Purpose: "City/state performance for regional marketing.",
      },
      {
        Sheet: "04 Preferences",
        Purpose: "Category, size, color and product preference signals.",
      },
      {
        Sheet: "05 Cart Intent",
        Purpose: "Abandoned cart and active cart targeting.",
      },
      {
        Sheet: "06 COD Risk",
        Purpose: "RTO/COD risk monitoring.",
      },
      {
        Sheet: "07 Campaign Lists",
        Purpose: "Campaign-wise filterable customer list.",
      },
    ]
  );

  await workbook.xlsx.writeFile(OUT_FILE);

  console.log("✅ Excel exported successfully:");
  console.log(OUT_FILE);

  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error("❌ Export failed:", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
}); 