// scripts/exportCustomerMarketingExcel.js

import "dotenv/config";
import mongoose from "mongoose";
import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";

const OUT_DIR = path.join(process.cwd(), "exports");
const OUT_FILE = path.join(
  OUT_DIR,
  `customer-marketing-data-${new Date().toISOString().slice(0, 10)}.xlsx`
);

const safe = (v, fallback = "") => v ?? fallback;

const toDate = (v) => {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d;
};

const daysAgo = (date) => {
  if (!date) return "";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
};

const pct = (num, den) => {
  if (!den) return 0;
  return Number(((num / den) * 100).toFixed(2));
};

const getId = (v) => {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (v._id) return String(v._id);
  return String(v);
};

const normalizePhone = (phone = "") =>
  String(phone).replace(/\D/g, "").slice(-10);

const addDescription = (ws, text) => {
  ws.insertRow(1, [text]);
  ws.mergeCells(1, 1, 1, Math.max(ws.columnCount, 8));
  ws.getCell("A1").font = { bold: true, size: 12 };
  ws.getCell("A1").alignment = { wrapText: true, vertical: "middle" };
  ws.getRow(1).height = 34;
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
    col.width = Math.min(Math.max(col.header?.length || 14, 14), 32);
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

const getCollection = async (name) => {
  const collections = await mongoose.connection.db
    .listCollections()
    .toArray();

  const exists = collections.some((c) => c.name === name);
  if (!exists) {
    console.log(`⚠️ Collection skipped: ${name}`);
    return [];
  }

  return mongoose.connection.collection(name).find({}).toArray();
};

const getOrderAmount = (order) =>
  Number(
    order.finalPayable ||
      order.totalAmount ||
      order.total ||
      order.grandTotal ||
      order.amount ||
      0
  );

const getPaymentMethod = (order) =>
  String(order.paymentMethod || order.payment?.method || "").toLowerCase();

const getPaymentStatus = (order) =>
  String(order.paymentStatus || order.payment?.status || "").toLowerCase();

const getFulfillmentStatus = (order) =>
  String(order.fulfillmentStatus || order.status || "").toLowerCase();

const getOrderItems = (order) =>
  Array.isArray(order.items)
    ? order.items
    : Array.isArray(order.products)
    ? order.products
    : [];

const getCustomerKeyFromOrder = (order) => ({
  customerObjectId: getId(order.customer || order.customerId),
  email: String(
    order.email ||
      order.customerEmail ||
      order.customer?.email ||
      order.shippingAddress?.email ||
      ""
  ).toLowerCase(),
  phone: normalizePhone(
    order.phone ||
      order.customerPhone ||
      order.customer?.phone ||
      order.shippingAddress?.phone ||
      ""
  ),
});

const makePersona = ({ totalOrders, totalSpend, avgOrderValue, rtoRate, discountScore }) => {
  if (rtoRate >= 40) return "High Risk COD";
  if (totalSpend >= 25000 || totalOrders >= 8) return "VIP Buyer";
  if (avgOrderValue >= 3000) return "Premium Shopper";
  if (discountScore >= 60) return "Bargain Hunter";
  if (totalOrders >= 3) return "Loyal Buyer";
  if (totalOrders === 0) return "Window Shopper";
  return "New Buyer";
};

const main = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("❌ MONGO_URI missing in .env");
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ MongoDB connected");

  const customers = await getCollection("customers");
  const orders = await getCollection("orders");

  console.log(`👥 Customers: ${customers.length}`);
  console.log(`📦 Orders: ${orders.length}`);

  const ordersByCustomer = new Map();

  for (const order of orders) {
    const key = getCustomerKeyFromOrder(order);

    const possibleKeys = [
      key.customerObjectId,
      key.email,
      key.phone,
    ].filter(Boolean);

    for (const k of possibleKeys) {
      if (!ordersByCustomer.has(k)) ordersByCustomer.set(k, []);
      ordersByCustomer.get(k).push(order);
    }
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Miray Fashions";
  workbook.created = new Date();

  const customerRows = [];
  const segmentRows = [];
  const locationRows = [];
  const preferenceRows = [];
  const cartRows = [];
  const riskRows = [];
  const campaignRows = [];

  const locationMap = new Map();

  for (const customer of customers) {
    const cId = String(customer._id);
    const email = String(customer.email || "").toLowerCase();
    const phone = normalizePhone(customer.phone);

    const matchedOrders =
      ordersByCustomer.get(cId) ||
      ordersByCustomer.get(email) ||
      ordersByCustomer.get(phone) ||
      [];

    const uniqueOrders = [
      ...new Map(matchedOrders.map((o) => [String(o._id), o])).values(),
    ];

    const totalOrders = uniqueOrders.length || Number(customer.analytics?.totalOrders || 0);
    const totalSpend =
      uniqueOrders.reduce((sum, o) => sum + getOrderAmount(o), 0) ||
      Number(customer.analytics?.totalSpend || 0);

    const avgOrderValue = totalOrders ? Number((totalSpend / totalOrders).toFixed(2)) : 0;

    const codOrders = uniqueOrders.filter((o) => getPaymentMethod(o) === "cod").length;
    const prepaidOrders = uniqueOrders.filter((o) =>
      ["razorpay", "prepaid", "online"].includes(getPaymentMethod(o))
    ).length;

    const deliveredOrders = uniqueOrders.filter((o) =>
      ["delivered", "completed"].includes(getFulfillmentStatus(o))
    ).length;

    const cancelledOrders = uniqueOrders.filter((o) =>
      ["cancelled", "canceled"].includes(getFulfillmentStatus(o))
    ).length;

    const rtoOrders = uniqueOrders.filter((o) =>
      ["rto", "return_to_origin"].includes(getFulfillmentStatus(o))
    ).length;

    const returnedOrders = uniqueOrders.filter((o) =>
      ["returned", "return_requested"].includes(getFulfillmentStatus(o))
    ).length;

    const paidOrders = uniqueOrders.filter((o) =>
      ["paid", "captured"].includes(getPaymentStatus(o))
    ).length;

    const firstOrderAt = uniqueOrders
      .map((o) => new Date(o.createdAt || o.orderDate))
      .filter((d) => !Number.isNaN(d.getTime()))
      .sort((a, b) => a - b)[0];

    const lastOrderAt = uniqueOrders
      .map((o) => new Date(o.createdAt || o.orderDate))
      .filter((d) => !Number.isNaN(d.getTime()))
      .sort((a, b) => b - a)[0];

    const allItems = uniqueOrders.flatMap(getOrderItems);

    const sizes = {};
    const colors = {};
    const productCodes = {};
    const categories = {};

    for (const item of allItems) {
      const size = item.selectedSize || item.size || item.variant?.size || "";
      const color = item.selectedColor || item.color || item.variant?.color || "";
      const productCode =
        item.productCode ||
        item.sku ||
        item.productSnapshot?.productCode ||
        item.product?.productCode ||
        "";
      const category =
        item.category ||
        item.productSnapshot?.category ||
        item.product?.category?.name ||
        "";

      if (size) sizes[size] = (sizes[size] || 0) + Number(item.quantity || 1);
      if (color) colors[color] = (colors[color] || 0) + Number(item.quantity || 1);
      if (productCode) productCodes[productCode] = (productCodes[productCode] || 0) + Number(item.quantity || 1);
      if (category) categories[category] = (categories[category] || 0) + Number(item.quantity || 1);
    }

    const top = (obj) =>
      Object.entries(obj).sort((a, b) => b[1] - a[1])[0]?.[0] || "";

    const couponUses = Number(customer.analytics?.couponUses || 0);
    const discountScore = totalOrders ? Math.min(100, Math.round((couponUses / totalOrders) * 100)) : 0;

    const deliveryRate = pct(deliveredOrders, totalOrders);
    const cancellationRate = pct(cancelledOrders, totalOrders);
    const returnRate = pct(returnedOrders, totalOrders);
    const rtoRate = pct(rtoOrders, totalOrders);
    const paymentSuccessRate = pct(paidOrders, totalOrders);

    const lastOrderDays = daysAgo(lastOrderAt);
    const lastCartDays = daysAgo(customer.cart?.lastCartActivityAt);

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
          Number(customer.analytics?.wishlistCount || 0) * 3 +
          Number(customer.cart?.cartCount || 0) * 4 +
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

    const common = {
      customerId: customer.customerId || "",
      name: customer.name || "",
      email,
      phone: customer.phone || "",
      gender: customer.gender || "unknown",
      ageGroup: customer.ageGroup || "Unknown",
      city: customer.city || "",
      state: customer.state || "",
      joinedAt: toDate(customer.joinedAt || customer.createdAt),
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
      customerType,
      codRiskLevel,
      engagementScore,
      persona,
    };

    customerRows.push({
      ...common,
      favoriteSize: top(sizes),
      favoriteColor: top(colors),
      favoriteCategory: top(categories),
      topProductCode: top(productCodes),
      discountDependencyScore: discountScore,
      cartCount: customer.cart?.cartCount || 0,
      abandonedCartCount: customer.cart?.abandonedCartCount || 0,
      lastCartActivityAt: toDate(customer.cart?.lastCartActivityAt),
      wishlistCount: customer.analytics?.wishlistCount || 0,
    });

    segmentRows.push({
      customerId: common.customerId,
      name: common.name,
      phone: common.phone,
      email: common.email,
      customerType,
      persona,
      engagementScore,
      totalSpend,
      totalOrders,
      lastOrderDays,
      suggestedCampaign:
        customerType === "vip"
          ? "VIP early access / premium drop"
          : customerType === "inactive"
          ? "Winback offer"
          : codRiskLevel === "high"
          ? "Prepaid-only / verification"
          : discountScore >= 60
          ? "Coupon-led offer"
          : "New arrivals / recommendation",
    });

    preferenceRows.push({
      customerId: common.customerId,
      name: common.name,
      favoriteCategory: top(categories),
      favoriteSize: top(sizes),
      favoriteColor: top(colors),
      topProductCode: top(productCodes),
      budgetMin: customer.preferences?.budgetRange?.min || "",
      budgetMax: customer.preferences?.budgetRange?.max || "",
      cartProducts: (customer.cartAdds || [])
        .map((x) => `${x.productCode}${x.size ? `-${x.size}` : ""}`)
        .join(", "),
    });

    cartRows.push({
      customerId: common.customerId,
      name: common.name,
      phone: common.phone,
      email: common.email,
      cartCount: customer.cart?.cartCount || 0,
      abandonedCartCount: customer.cart?.abandonedCartCount || 0,
      activeCartType: customer.cart?.activeCartType || "",
      lastCartActivityAt: toDate(customer.cart?.lastCartActivityAt),
      lastCartDays,
      cartAdds: (customer.cartAdds || [])
        .map((x) => `${x.productCode}${x.size ? ` (${x.size})` : ""}`)
        .join(", "),
    });

    riskRows.push({
      customerId: common.customerId,
      name: common.name,
      phone: common.phone,
      totalOrders,
      codOrders,
      cancelledOrders,
      returnedOrders,
      rtoOrders,
      cancellationRate,
      returnRate,
      rtoRate,
      codRiskLevel,
      riskScore: Math.min(100, Math.round(rtoRate * 1.2 + cancellationRate * 0.8 + returnRate * 0.5)),
    });

    campaignRows.push({
      campaign: "VIP Customers",
      customerId: common.customerId,
      name: common.name,
      phone: common.phone,
      email: common.email,
      included: customerType === "vip" ? "Yes" : "No",
      reason: "High spend / repeat buying",
    });

    campaignRows.push({
      campaign: "Abandoned Cart",
      customerId: common.customerId,
      name: common.name,
      phone: common.phone,
      email: common.email,
      included: Number(customer.cart?.abandonedCartCount || 0) > 0 ? "Yes" : "No",
      reason: "Has abandoned cart activity",
    });

    campaignRows.push({
      campaign: "Winback",
      customerId: common.customerId,
      name: common.name,
      phone: common.phone,
      email: common.email,
      included: lastOrderDays !== "" && lastOrderDays > 60 ? "Yes" : "No",
      reason: "No recent order",
    });

    const locKey = `${common.state || "Unknown"}|${common.city || "Unknown"}`;
    const existing = locationMap.get(locKey) || {
      state: common.state || "Unknown",
      city: common.city || "Unknown",
      customers: 0,
      orders: 0,
      revenue: 0,
      rtoOrders: 0,
      cancelledOrders: 0,
    };

    existing.customers += 1;
    existing.orders += totalOrders;
    existing.revenue += totalSpend;
    existing.rtoOrders += rtoOrders;
    existing.cancelledOrders += cancelledOrders;
    locationMap.set(locKey, existing);
  }

  for (const loc of locationMap.values()) {
    locationRows.push({
      ...loc,
      avgRevenuePerCustomer: loc.customers
        ? Number((loc.revenue / loc.customers).toFixed(2))
        : 0,
      rtoRate: pct(loc.rtoOrders, loc.orders),
      cancellationRate: pct(loc.cancelledOrders, loc.orders),
    });
  }

  const addSheet = (name, description, columns, rows) => {
    const ws = workbook.addWorksheet(name);

    ws.columns = columns.map((key) => ({
      header: key,
      key,
      width: 18,
    }));

    ws.addRows(rows);
    addDescription(ws, description);
    styleSheet(ws);

    return ws;
  };

  addSheet(
    "01 Customer Master",
    "Complete customer-level marketing export: identity, profile, order behavior, preferences, risk, engagement and persona.",
    Object.keys(customerRows[0] || { customerId: "" }),
    customerRows
  );

  addSheet(
    "02 Segments",
    "Ready-to-use customer segments for CRM, WhatsApp, Meta custom audiences and retention campaigns.",
    Object.keys(segmentRows[0] || { customerId: "" }),
    segmentRows
  );

  addSheet(
    "03 Location Insights",
    "City/state-wise customer, order, revenue, RTO and cancellation summary for regional marketing decisions.",
    Object.keys(locationRows[0] || { city: "" }),
    locationRows
  );

  addSheet(
    "04 Preferences",
    "Fashion preference signals: favorite category, size, color, top product codes and cart interests.",
    Object.keys(preferenceRows[0] || { customerId: "" }),
    preferenceRows
  );

  addSheet(
    "05 Cart Intent",
    "Cart and abandoned-cart signals useful for recovery campaigns and high-intent customer targeting.",
    Object.keys(cartRows[0] || { customerId: "" }),
    cartRows
  );

  addSheet(
    "06 COD Risk",
    "Risk sheet for COD control, RTO reduction, prepaid nudges and manual verification.",
    Object.keys(riskRows[0] || { customerId: "" }),
    riskRows
  );

  addSheet(
    "07 Campaign Lists",
    "Campaign-wise inclusion list. Filter Included = Yes and export phone/email for campaign execution.",
    Object.keys(campaignRows[0] || { campaign: "" }),
    campaignRows
  );

  const readme = workbook.addWorksheet("README");
  readme.columns = [
    { header: "Sheet", key: "sheet", width: 24 },
    { header: "Purpose", key: "purpose", width: 80 },
  ];

  readme.addRows([
    {
      sheet: "01 Customer Master",
      purpose: "Main customer marketing database with persona, spend, order behavior, preferences and risk.",
    },
    {
      sheet: "02 Segments",
      purpose: "CRM segments like VIP, inactive, risky, bargain hunter and suggested campaign.",
    },
    {
      sheet: "03 Location Insights",
      purpose: "State/city level revenue, RTO and cancellation insights.",
    },
    {
      sheet: "04 Preferences",
      purpose: "Favorite category, size, color and cart product interest.",
    },
    {
      sheet: "05 Cart Intent",
      purpose: "Abandoned cart and active cart recovery targeting.",
    },
    {
      sheet: "06 COD Risk",
      purpose: "COD risk, RTO and cancellation control list.",
    },
    {
      sheet: "07 Campaign Lists",
      purpose: "Filter-ready campaign customer lists.",
    },
  ]);

  addDescription(
    readme,
    "Customer Marketing Excel Export — generated from MongoDB using MONGO_URI from .env"
  );
  styleSheet(readme);

  await workbook.xlsx.writeFile(OUT_FILE);

  console.log("✅ Excel exported successfully:");
  console.log(OUT_FILE);

  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error("❌ Export failed:", err);
  await mongoose.disconnect();
  process.exit(1);
});