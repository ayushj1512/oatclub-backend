import mongoose from "mongoose";
import Order from "./Orders.js";
import InventoryReservation from "../InventoryReservation/InventoryReservation.js";
import { syncOrderAllocatedQtyFromReservations } from "../inventoryUtility/syncOrderAllocatedQtyFromReservations.js";
import Product from "../Products/Products.js";
import { buildAddressSnapshot } from "./order.address.mapper.js";
import { cancelShiprocketShipment } from "../shiprocket/shiprocket.cancel.js";
import Address from "../Address/Address.js"; // <-- correct path
import {
  checkServiceability,
  createShipment,
  assignAwb,
} from "../shiprocket/index.js";
import { buildShiprocketPayload } from "../shiprocket/shiprocket.payload.js";
import { Mailer } from "../nodemailer/mailer.js"; // ✅ adjust relative path if needed
// ✅ Centralized email triggers
import {
  triggerOrderEmails,
  triggerOrderCancellationEmails,
  triggerRmaEmails,
  triggerPaymentRecoveryEmail,
  sendCustomerPaymentRecoveryMail,
} from "./order.emails.js";
import Coupon from "../Coupon/Coupon.js";
import {
  consumeReservationsInternalByOrder,
  cancelReservationsInternalByOrder,
  restockFromRTOInternal,
} from "../InventoryReservation/InventoryReservationController.js";

import { reserveInventoryForOrderNumberInternal } from "../InventoryReservation/inventoryWebhook.js";

import {
  detectDuplicateOrders,
  markDuplicateOrderAlerts,
} from "./order.duplicate.utils.js";

import { updateOrderFulfillmentStatus } from "./order.utils.js";
import { recalculateCustomerAnalytics } from "../Customer/customerAnalytics.service.js";
import Customer from "../Customer/Customer.js";
import { debitWalletForOrderInternal } from "../Customer/customerCredit.service.js"; // ⚠️ path tumhare project ke hisaab se adjust kar lena
import { creditOrderWalletRewardInternal } from "../Customer/orderWalletReward.service.js";
import { checkIsBlacklistedCustomer } from "../Customer/customerBlacklist.service.js";
import { createShipment as createDelhiveryShipment } from "../delhivery/shipment.js";
import { checkServiceability as checkDelhiveryServiceability } from "../delhivery/serviceability.js";
import { calculateDelhiveryRate } from "../delhivery/rate.js";
import {
  sendCodOrderConfirmationWhatsapp,
  sendPaymentPendingWhatsapp,
  sendPrepaidOrderConfirmationWhatsapp,
} from "../fast2sms/index.js";

import {
  enrichOrdersWithFulfillmentReadiness,
} from "./orderFulfillmentReadiness.service.js";

import { createReturnOrder } from "../shiprocket/shiprocket.return.js";
import { buildReverseShiprocketPayload } from "../shiprocket/shiprocket.reverse.payload.js";

const isParentOrder = (order) =>
  String(order?.orderType || "").toLowerCase() === "parent";
const isShipmentOrder = (order) =>
  ["shipment", "child"].includes(String(order?.orderType || "").toLowerCase()); // pick one naming

const ADMIN_ORDER_ALERT_EMAILS = ["oatclub.in@gmail.com"].filter(Boolean);

const RAZORPAY_DISCOUNT_PERCENT = 10;

const triggerFast2SmsSafe = ({
  type,
  order,
  paymentStatus = "",
}) => {
  if (!order?._id) return;

  const run = async () => {
    try {
      let result = null;

      if (type === "cod_confirmation") {
        result =
          await sendCodOrderConfirmationWhatsapp({
            order,
          });
      }

      if (type === "payment_pending") {
        result =
          await sendPaymentPendingWhatsapp({
            order,
            paymentStatus,
          });
      }

      if (type === "payment_confirmed") {
        result =
          await sendPrepaidOrderConfirmationWhatsapp({
            order,
          });
      }

      if (!result?.success) {
        console.error(
          `⚠️ Fast2SMS ${type} failed:`,
          result?.error ||
          result?.data ||
          result,
        );

        return;
      }

      console.log(
        `✅ Fast2SMS ${type} sent:`,
        order?.orderNumber || order?._id,
      );
    } catch (error) {
      console.error(
        `⚠️ Fast2SMS ${type} error:`,
        error?.message || error,
      );
    }
  };

  if (typeof setImmediate === "function") {
    setImmediate(run);
  } else {
    setTimeout(run, 0);
  }
};

const sendAdminOrderReceivedMail = async (order) => {
  try {
    if (process.env.MAIL_ENABLED !== "true") {
      console.log("📭 Admin order mail skipped: MAIL_ENABLED not true");
      return;
    }

    // ✅ Remove duplicates + join safely for nodemailer
    const recipients = [...new Set(ADMIN_ORDER_ALERT_EMAILS)]
      .map((e) => String(e).trim().toLowerCase())
      .filter(Boolean);

    if (!recipients.length) {
      console.log("📭 Admin order mail skipped: no admin recipients");
      return;
    }

    // ✅ CTA: Prefer Admin panel if available else fallback
    const baseAdminUrl =
      process.env.ADMIN_PANEL_URL ||
      process.env.CLIENT_URL ||
      "http://localhost:3000";

    const orderId = order?.orderId || order?.orderNumber || order?._id;
    const ctaUrl = orderId
      ? `${baseAdminUrl}/admin/orders/${orderId}`
      : baseAdminUrl;

    await Mailer.sendAdminOrderReceived({
      to: recipients.join(","),
      order,
      ctaUrl,
    });

    console.log("✅ Admin Order Received mail sent to:", recipients.join(", "));
  } catch (err) {
    console.error("❌ Admin Order Received mail error FULL:", err);
  }
};

const scrubXpressbees = (order) => {
  if (!order || !order.shipment) return;

  // If xpressbees exists but is undefined / not an object, remove it
  if (order.shipment.xpressbees === undefined) {
    order.shipment.xpressbees = undefined; // keep for clarity
    delete order.shipment.xpressbees;
  } else if (
    order.shipment.xpressbees != null &&
    typeof order.shipment.xpressbees !== "object"
  ) {
    delete order.shipment.xpressbees;
  }
};

/* ============================================================
   ORDER ITEM EDITING GUARD
============================================================ */

const canEditOrderItems = (order) => {
  const status = String(order?.fulfillmentStatus || "processing").toLowerCase();

  return (
    ["processing", "packed"].includes(status) &&
    order?.cancellation?.isCancelled !== true
  );
};

/* ============================================================
   RMA POLICY (hardcoded backend)
   - Return/Exchange allowed within 7 days from deliveredAt
   - 1st exchange free, 2nd+ exchange fee = 199
============================================================ */
const RMA_POLICY = {
  windowDays: 7,
  exchange: {
    firstFree: true,
    secondFee: 199,
  },
  countExchangeStatuses: [
    "requested",
    "approved",
    "pickup_scheduled",
    "picked",
    "in_transit",
    "received",
    "qc_pass",
    "qc_fail",
    "replacement_shipped",
    "closed",
  ],
};

/* ============================================================
   HELPERS
============================================================ */
const normalizeVariantAttributes = (variant) => {
  const attrs = Array.isArray(variant?.attributes) ? variant.attributes : [];
  return attrs
    .filter((a) => a && a.key != null && a.value != null)
    .map((a) => ({ key: String(a.key), value: String(a.value) }));
};

const findVariantById = (product, variantId) => {
  if (!variantId) return null;
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  return variants.find((v) => String(v._id) === String(variantId)) || null;
};

const uniqStrings = (arr) =>
  Array.from(
    new Set((arr || []).map((x) => String(x || "").trim()).filter(Boolean)),
  );

const computeCategoryBreakdown = (normalizedItems) => {
  const map = new Map();
  for (const it of normalizedItems || []) {
    const catId = it?.productSnapshot?.category
      ? String(it.productSnapshot.category)
      : null;
    if (!catId) continue;

    const prev = map.get(catId) || {
      categoryId: it.productSnapshot.category,
      totalSpend: 0,
      quantity: 0,
    };
    prev.totalSpend += Number(it.subtotal || 0);
    prev.quantity += Number(it.quantity || 0);
    map.set(catId, prev);
  }
  return Array.from(map.values());
};

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));

const daysDiff = (fromDate, toDate) => {
  const a = new Date(fromDate).getTime();
  const b = new Date(toDate).getTime();
  return Math.floor((a - b) / (1000 * 60 * 60 * 24));
};

const pickAttr = (attrs = [], keys = []) => {
  const kset = keys.map((k) => String(k).trim().toLowerCase());
  const found = (attrs || []).find((a) =>
    kset.includes(
      String(a?.key || "")
        .trim()
        .toLowerCase(),
    ),
  );
  return found?.value ? String(found.value) : "";
};

const isWithinRmaWindow = (deliveredAt) => {
  if (!deliveredAt) return false;
  const diffDays = daysDiff(Date.now(), deliveredAt); // today - deliveredAt
  return diffDays >= 0 && diffDays <= RMA_POLICY.windowDays;
};

const countPreviousExchanges = (order) => {
  const rmas = order?.rmas || [];
  return rmas.filter((r) => {
    if (!r) return false;
    if (r.type !== "exchange") return false;
    if (r.status === "rejected") return false;
    return RMA_POLICY.countExchangeStatuses.includes(r.status);
  }).length;
};

const computeExchangeFee = (exchangeCountSoFar) => {
  if (RMA_POLICY.exchange.firstFree && exchangeCountSoFar === 0) return 0;
  return Number(RMA_POLICY.exchange.secondFee || 0);
};

/**
 * RMA snapshot builder (for embedding in Order.rmas[])
 * item: { orderItemIndex, quantity }
 */
const buildRmaItemsSnapshots = (order, rmaItems) => {
  const out = [];
  for (const ri of rmaItems || []) {
    const idx = Number(ri?.orderItemIndex);
    const qty = Number(ri?.quantity);

    if (!Number.isInteger(idx) || idx < 0)
      throw new Error("Invalid orderItemIndex in RMA items");
    if (!Number.isFinite(qty) || qty < 1)
      throw new Error("Invalid quantity in RMA items");

    const orderItem = Array.isArray(order?.items) ? order.items[idx] : null;
    if (!orderItem) throw new Error(`Order item not found at index: ${idx}`);

    out.push({
      orderItemIndex: idx,
      quantity: qty,
      productId: orderItem.productId || null,
      productCode: orderItem?.productSnapshot?.productCode || "",
      title: orderItem?.productSnapshot?.title || "",
      variantSku: orderItem?.variant?.sku || "",
    });
  }
  return out;
};

const syncCustomerAnalyticsSafe = (customerId, context = "order") => {
  const id = customerId?._id || customerId;
  if (!id) return;

  const run = async () => {
    try {
      await recalculateCustomerAnalytics(id);
      console.log(`✅ Customer analytics synced | ${context} | customer=${id}`);
    } catch (err) {
      console.error(
        `⚠️ Customer analytics sync failed | ${context} | customer=${id}:`,
        err?.message || err,
      );
    }
  };

  if (typeof setImmediate === "function") {
    setImmediate(run);
  } else {
    setTimeout(run, 0);
  }
};

const str = (v) => (v == null ? "" : String(v));
const normEmail = (v) => str(v).trim().toLowerCase();
const normPhone = (v) =>
  str(v)
    .replace(/[^\d+]/g, "")
    .trim()
    .replace(/^\+/, "");

const buildCouponIdentity = ({ email, phone }) => {
  const e = normEmail(email);
  if (e && e.includes("@")) return `email:${e}`;
  const p = normPhone(phone);
  if (p) return `phone:${p}`;
  return "";
};

/**
 * Compute remaining returnable qty for each order item index
 * - Excludes rejected RMAs
 * - Counts all other statuses as "consumed"
 */
const computeRemainingQtyByIndex = (order) => {
  const purchased = new Map();
  (order.items || []).forEach((it, idx) => {
    purchased.set(String(idx), Number(it.quantity || 0));
  });

  const returned = new Map();
  (order.rmas || []).forEach((r) => {
    if (!r || r.status === "rejected") return;
    (r.items || []).forEach((ri) => {
      const key = String(ri.orderItemIndex);
      returned.set(key, (returned.get(key) || 0) + Number(ri.quantity || 0));
    });
  });

  const remaining = new Map();
  for (const [k, bought] of purchased.entries()) {
    const used = returned.get(k) || 0;
    remaining.set(k, Math.max(0, bought - used));
  }
  return remaining;
};

// ========================================================================================
// ✅ EASY CONFIRM: Mark order confirmed (manual / cod / admin action)
// ========================================================================================
const confirmOrderById = async ({
  orderId,
  adminId = null,
  session = null,
}) => {
  const update = {
    isConfirmed: true,
    confirmedAt: new Date(),
  };

  if (adminId) update.confirmedBy = adminId;

  const query = Order.findByIdAndUpdate(orderId, update, {
    new: true,
    runValidators: true,
  });

  if (session) query.session(session);

  return query;
};

/* ============================================================
   CREATE ORDER
  Expect each item: { productId, quantity, variantId? }
============================================================ */

export const createOrder = async (req, res) => {
  const session = await mongoose.startSession();

  const str = (v) => (v == null ? "" : String(v));
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
  const oid = (v) => new mongoose.Types.ObjectId(String(v));

  const normEmail = (v) => str(v).trim().toLowerCase();
  const normPhone = (v) =>
    str(v)
      .replace(/[^\d+]/g, "")
      .trim()
      .replace(/^\+/, "");

  const isNumericLike = (v) => /^[0-9]+$/.test(str(v).trim());

  const sanitizeSelectedColor = (color, productCode = "") => {
    const c = str(color).trim();
    const pc = str(productCode).trim();
    if (!c) return "";
    if (isNumericLike(c)) return "";
    if (pc && c.toUpperCase() === pc.toUpperCase()) return "";
    return c;
  };

  const buildCouponIdentity = ({ email, phone }) => {
    const e = normEmail(email);
    if (e && e.includes("@")) return `email:${e}`;
    const p = normPhone(phone);
    if (p) return `phone:${p}`;
    return "";
  };

  const pickAttr = (attrs = [], keys = []) => {
    const wanted = keys.map((k) => str(k).trim().toLowerCase());
    const found = (Array.isArray(attrs) ? attrs : []).find((a) =>
      wanted.includes(str(a?.key).trim().toLowerCase()),
    );
    return found?.value ? str(found.value) : "";
  };

  const normalizeVariantAttributes = (variant) => {
    const raw = variant?.attributes;

    if (Array.isArray(raw)) {
      return raw
        .filter((a) => a?.key != null && a?.value != null)
        .map((a) => ({ key: str(a.key), value: str(a.value) }));
    }

    if (raw && typeof raw === "object") {
      return Object.entries(raw).map(([key, value]) => ({
        key: str(key),
        value: str(value),
      }));
    }

    return [];
  };

  const getSizeFromSku = (sku) => {
    const parts = str(sku).toUpperCase().split("-");
    const sizes = [
      "XXS",
      "XS",
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "3XL",
      "4XL",
      "5XL",
    ];

    for (let i = parts.length - 1; i >= 0; i--) {
      if (sizes.includes(parts[i])) return parts[i];
    }

    return "";
  };

  const getColorFromSku = (sku, productCode = "") => {
    const parts = str(sku).toUpperCase().split("-");
    if (parts.length < 2) return "";

    const sizes = [
      "XXS",
      "XS",
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "3XL",
      "4XL",
      "5XL",
    ];
    const maybeColor = parts[parts.length - 2];

    if (sizes.includes(maybeColor)) return "";
    if (/^[0-9]+$/.test(maybeColor)) return "";
    if (productCode && maybeColor === str(productCode).toUpperCase()) return "";

    return maybeColor.toLowerCase();
  };

  const normalizePriority = (v) => {
    const p = str(v).trim().toLowerCase();
    return ["normal", "medium", "high"].includes(p) ? p : "normal";
  };

  const isPrimaryItem = (item = {}) =>
    item?.isPrimaryProduct === true ||
    item?.productSnapshot?.isPrimaryProduct === true;

  const isSecondaryItem = (item = {}) => !isPrimaryItem(item);

  const getCouponDiscountBase = ({
    couponDoc,
    subtotal,
    eligibleCouponBase,
  }) => {
    if (!couponDoc) return null;

    const target = str(
      couponDoc?.discountTarget ||
      couponDoc?.cartRule?.discountTarget ||
      "cart",
    );

    const hasRules =
      Array.isArray(couponDoc?.cartRules) &&
      couponDoc.cartRules.some((rule) => rule?.isActive !== false);

    if (!hasRules || target === "cart") return subtotal;

    if (
      [
        "collection_products",
        "category_products",
        "matched_products",
        "secondary_products",
        "primary_products",
      ].includes(target)
    ) {
      return eligibleCouponBase;
    }

    return subtotal;
  };

  const normalizeOrderAttribution = (raw = {}) => {
    const now = new Date();

    const q = req.query || {};
    const bodyAttr = raw && typeof raw === "object" ? raw : {};

    const firstTouch = bodyAttr.firstTouch || {};
    const lastTouch = bodyAttr.lastTouch || {};
    const sessionAttr = bodyAttr.session || {};

    const pick = (...values) => {
      for (const v of values) {
        const cleaned = str(v).trim();
        if (cleaned) return cleaned;
      }
      return "";
    };

    const lowerPick = (...values) => pick(...values).toLowerCase();

    const utmSource = lowerPick(
      bodyAttr.source,
      bodyAttr.utm_source,
      q.utm_source,
      lastTouch.source,
      sessionAttr.source,
      firstTouch.source,
    );

    const utmMedium = lowerPick(
      bodyAttr.medium,
      bodyAttr.utm_medium,
      q.utm_medium,
      lastTouch.medium,
      sessionAttr.medium,
      firstTouch.medium,
    );

    const utmCampaign = pick(
      bodyAttr.campaign,
      bodyAttr.utm_campaign,
      q.utm_campaign,
      lastTouch.campaign,
      sessionAttr.campaign,
      firstTouch.campaign,
    );

    const finalSource = utmSource || "direct";
    const finalMedium = utmMedium || "direct";

    const referrer = pick(
      bodyAttr.referrer,
      req.headers?.referer,
      req.headers?.referrer,
      lastTouch.referrer,
      firstTouch.referrer,
    );

    const landingUrl = pick(
      bodyAttr.landingUrl,
      bodyAttr.firstTouchUrl,
      firstTouch.landingUrl,
      firstTouch.pageUrl,
    );

    const lastTouchUrl = pick(
      bodyAttr.lastTouchUrl,
      lastTouch.pageUrl,
      sessionAttr.pageUrl,
      bodyAttr.pageUrl,
    );

    return {
      source: finalSource,
      medium: finalMedium,
      campaign: utmCampaign,

      firstTouch: {
        source: lowerPick(firstTouch.source, finalSource),
        medium: lowerPick(firstTouch.medium, finalMedium),
        campaign: pick(firstTouch.campaign, utmCampaign),
        campaignSlug: pick(firstTouch.campaignSlug, bodyAttr.campaignSlug),
        content: pick(firstTouch.content, bodyAttr.utm_content, q.utm_content),
        term: pick(firstTouch.term, bodyAttr.utm_term, q.utm_term),
        pageUrl: pick(firstTouch.pageUrl, landingUrl),
        landingUrl,
        referrer,
        capturedAt: firstTouch.capturedAt || bodyAttr.capturedAt || now,
      },

      lastTouch: {
        source: lowerPick(lastTouch.source, finalSource),
        medium: lowerPick(lastTouch.medium, finalMedium),
        campaign: pick(lastTouch.campaign, utmCampaign),
        campaignSlug: pick(lastTouch.campaignSlug, bodyAttr.campaignSlug),
        content: pick(lastTouch.content, bodyAttr.utm_content, q.utm_content),
        term: pick(lastTouch.term, bodyAttr.utm_term, q.utm_term),
        pageUrl: lastTouchUrl,
        landingUrl: pick(lastTouch.landingUrl, landingUrl),
        referrer,
        capturedAt: lastTouch.capturedAt || now,
      },

      session: {
        source: lowerPick(sessionAttr.source, finalSource),
        medium: lowerPick(sessionAttr.medium, finalMedium),
        campaign: pick(sessionAttr.campaign, utmCampaign),
        campaignSlug: pick(sessionAttr.campaignSlug, bodyAttr.campaignSlug),
        content: pick(sessionAttr.content, bodyAttr.utm_content, q.utm_content),
        term: pick(sessionAttr.term, bodyAttr.utm_term, q.utm_term),
        pageUrl: pick(sessionAttr.pageUrl, lastTouchUrl),
        landingUrl: pick(sessionAttr.landingUrl, landingUrl),
        referrer,
        capturedAt: sessionAttr.capturedAt || now,
      },

      campaignId: isObjectId(bodyAttr.campaignId || q.campaignId)
        ? oid(bodyAttr.campaignId || q.campaignId)
        : null,

      campaignSlug: pick(
        bodyAttr.campaignSlug,
        bodyAttr.utm_campaign,
        q.utm_campaign,
      ),

      marketingLinkId: pick(bodyAttr.marketingLinkId, bodyAttr.mlid, q.mlid),
      shortCode: pick(bodyAttr.shortCode, bodyAttr.mcode, q.mcode),

      clickIds: {
        fbclid: pick(bodyAttr.fbclid, q.fbclid),
        gclid: pick(bodyAttr.gclid, q.gclid),
        msclkid: pick(bodyAttr.msclkid, q.msclkid),
        ttclid: pick(bodyAttr.ttclid, q.ttclid),
        scClickId: pick(
          bodyAttr.scClickId,
          bodyAttr.sc_click_id,
          q.scClickId,
          q.sc_click_id,
        ),
      },

      visitorId: pick(bodyAttr.visitorId, bodyAttr.vid),
      sessionId: pick(bodyAttr.sessionId, bodyAttr.sid),

      referrer,
      landingUrl,
      firstTouchUrl: pick(bodyAttr.firstTouchUrl, landingUrl),
      lastTouchUrl,

      device: {
        type: pick(bodyAttr.device?.type, bodyAttr.deviceType),
        browser: pick(bodyAttr.device?.browser, bodyAttr.browser),
        os: pick(bodyAttr.device?.os, bodyAttr.os),
        userAgent: pick(
          bodyAttr.device?.userAgent,
          req.headers?.["user-agent"],
        ),
        ip: pick(
          bodyAttr.device?.ip,
          req.headers?.["x-forwarded-for"]?.split(",")?.[0],
          req.ip,
          req.socket?.remoteAddress,
        ),
      },

      raw: bodyAttr,
      capturedAt: bodyAttr.capturedAt || now,
      lastUpdatedAt: now,
    };
  };

  const validateAndComputeCoupon = async ({
    code,
    cartTotal,
    discountBase = null,
    identity,
    couponDocFromBase = null,
  }) => {
    if (!code) {
      return { couponSnapshot: null, couponDiscount: 0, couponDoc: null };
    }

    const couponCode = str(code).trim().toUpperCase();
    const couponDoc =
      couponDocFromBase ||
      (await Coupon.findOne({ code: couponCode }).session(session));

    if (!couponDoc) throw new Error("Invalid coupon code.");
    if (!couponDoc.isActive) throw new Error("Coupon is not active.");

    if (couponDoc.validFrom && new Date() < new Date(couponDoc.validFrom)) {
      throw new Error("Coupon is not active yet.");
    }

    if (couponDoc.validTill && new Date() > new Date(couponDoc.validTill)) {
      throw new Error("Coupon has expired.");
    }

    if (num(cartTotal) < num(couponDoc.minPurchase || 0)) {
      throw new Error(
        `Minimum purchase required is ₹${num(couponDoc.minPurchase || 0)}`,
      );
    }

    if (
      num(couponDoc.usageLimit) > 0 &&
      num(couponDoc.usedCount) >= num(couponDoc.usageLimit)
    ) {
      throw new Error("Coupon usage limit has been reached.");
    }

    const perUserLimit = num(couponDoc.usageLimitPerCustomer || 1);
    const usedBy = Array.isArray(couponDoc.usedBy) ? couponDoc.usedBy : [];
    const usedTimes = identity
      ? usedBy.filter((x) => str(x) === identity).length
      : 0;

    if (identity && usedTimes >= perUserLimit) {
      throw new Error("You have already used this coupon.");
    }

    const baseAmount =
      discountBase !== null && discountBase !== undefined
        ? num(discountBase)
        : num(cartTotal);

    if (baseAmount <= 0) {
      throw new Error("Coupon is not applicable on this cart.");
    }

    let discountAmount = 0;

    if (couponDoc.discountType === "percentage") {
      discountAmount = (baseAmount * num(couponDoc.discountValue)) / 100;

      if (num(couponDoc.maxDiscount) > 0) {
        discountAmount = Math.min(discountAmount, num(couponDoc.maxDiscount));
      }
    } else {
      discountAmount = Math.min(num(couponDoc.discountValue), baseAmount);
    }

    discountAmount = Math.max(0, Math.round(discountAmount));

    if (!discountAmount) {
      throw new Error("Invalid discount calculation.");
    }

    return {
      couponSnapshot: {
        code: couponCode,
        discount: discountAmount,
        discountBase: baseAmount,
      },
      couponDiscount: discountAmount,
      couponDoc,
    };
  };

  const normalizeCheckoutAddress = (address = {}) => {
    const snapshot = {
      fullName: str(address.fullName || address.name).trim(),

      line1: str(address.line1 || address.addressLine1).trim(),

      line2: str(address.line2 || address.addressLine2).trim(),

      city: str(address.city).trim(),

      state: str(address.state).trim(),

      pincode: str(address.pincode || address.postalCode)
        .replace(/\D/g, "")
        .slice(0, 6),

      phone: normPhone(address.phone).slice(-10),

      email: normEmail(address.email),

      country: str(address.country || "IN").trim(),
    };

    if (!snapshot.fullName) throw new Error("Full name required");

    if (!snapshot.line1) throw new Error("Address required");

    if (!snapshot.city) throw new Error("City required");

    if (!snapshot.state) throw new Error("State required");

    if (!/^\d{6}$/.test(snapshot.pincode)) {
      throw new Error("Invalid pincode");
    }

    if (!/^\d{10}$/.test(snapshot.phone)) {
      throw new Error("Invalid phone");
    }

    return snapshot;
  };

  try {
    const {
      customerId,

      // Optional saved address IDs
      shippingAddressId,
      billingAddressId,

      // NEW: direct checkout snapshots
      shippingAddressSnapshot: incomingShippingAddress = null,
      billingAddressSnapshot: incomingBillingAddress = null,

      items,
      coupon,
      attribution = {},
      shippingFee = 0,
      tax = 0,
      paymentMethod = "cod",

      // ✅ wallet / customer credit
      useWallet = false,
      walletAmount = 0,

      source = "website",
      isGiftOrder = false,
      currency = "INR",
      customerSupportRemark = "",
      priority = "normal",
    } = req.body;

    const pm = str(paymentMethod).trim().toLowerCase();
    const finalPriority = normalizePriority(priority);
    const finalAttribution = normalizeOrderAttribution(attribution);

    if (!isObjectId(customerId)) {
      return res.status(400).json({ message: "Invalid customerId" });
    }

    const hasShippingAddressId =
      shippingAddressId && isObjectId(shippingAddressId);

    const hasBillingAddressId =
      billingAddressId && isObjectId(billingAddressId);

    if (shippingAddressId && !hasShippingAddressId) {
      return res.status(400).json({
        message: "Invalid shippingAddressId",
      });
    }

    if (billingAddressId && !hasBillingAddressId) {
      return res.status(400).json({
        message: "Invalid billingAddressId",
      });
    }

    if (!hasShippingAddressId && !incomingShippingAddress) {
      return res.status(400).json({
        message: "Shipping address is required.",
      });
    }

    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ message: "Order items missing" });
    }

    if (!["cod", "razorpay", "wallet"].includes(pm)) {
      return res.status(400).json({
        message: "Invalid paymentMethod. Allowed: cod | razorpay | wallet",
      });
    }

    let createdOrderId = null;

    await session.withTransaction(async () => {
      let shippingAddressSnapshot;
      let billingAddressSnapshot;

      if (hasShippingAddressId) {
        const shippingAddress =
          await Address.findById(shippingAddressId).session(session);

        if (!shippingAddress) {
          throw new Error("Shipping address not found");
        }

        shippingAddressSnapshot = buildAddressSnapshot(shippingAddress);
      } else {
        shippingAddressSnapshot = normalizeCheckoutAddress(
          incomingShippingAddress,
        );
      }

      if (hasBillingAddressId) {
        const billingAddress =
          await Address.findById(billingAddressId).session(session);

        if (!billingAddress) {
          throw new Error("Billing address not found");
        }

        billingAddressSnapshot = buildAddressSnapshot(billingAddress);
      } else if (incomingBillingAddress) {
        billingAddressSnapshot = normalizeCheckoutAddress(
          incomingBillingAddress,
        );
      } else {
        billingAddressSnapshot = {
          ...shippingAddressSnapshot,
        };
      }

      const blacklistedCustomer = await checkIsBlacklistedCustomer({
        customerId,
        email: shippingAddressSnapshot?.email,
        phone: shippingAddressSnapshot?.phone,
        session,
      });

      if (blacklistedCustomer) {
        const error = new Error(
          "We couldn't process your order at this time. If you believe this is an error, please contact our support team.",
        );

        error.code = "ORDER_NOT_AVAILABLE";
        error.statusCode = 403;

        throw error;
      }

      const identity = buildCouponIdentity({
        email: shippingAddressSnapshot?.email,
        phone: shippingAddressSnapshot?.phone,
      });

      const productIds = [
        ...new Set(items.map((i) => str(i?.productId)).filter(Boolean)),
      ];

      const bad = productIds.find((id) => !isObjectId(id));
      if (bad) throw new Error(`Invalid productId: ${bad}`);

      const products = await Product.find({ _id: { $in: productIds } })
        .session(session)
        .lean();

      const productMap = new Map(products.map((p) => [str(p._id), p]));

      const normalizedItems = [];
      let subtotal = 0;
      let totalQty = 0;

      for (const item of items) {
        const pid = str(item?.productId);
        if (!pid) throw new Error("productId missing");

        const qty = num(item?.quantity);
        if (!Number.isFinite(qty) || qty < 1) {
          throw new Error("Invalid quantity");
        }

        const product = productMap.get(pid);
        if (!product) throw new Error("Product not found");

        const isVariable =
          product.productType === "variable" ||
          (Array.isArray(product.variants) && product.variants.length > 0);

        let variant = null;

        if (isVariable) {
          if (!item.variantId) {
            throw new Error(`${product.title} - variantId missing`);
          }

          variant = findVariantById(product, item.variantId);

          if (!variant) {
            throw new Error(`${product.title} - variant not found`);
          }
        }

        const frontendPrice = num(
          item?.price ??
          item?.itemPrice ??
          item?.item_price ??
          item?.salePrice ??
          item?.productSnapshot?.price,
        );

        const dbPrice = num(product.price);
        const unitPrice = frontendPrice > 0 ? frontendPrice : dbPrice;
        const lineSubtotal = unitPrice * qty;

        subtotal += lineSubtotal;
        totalQty += qty;

        const attrs = normalizeVariantAttributes(variant);

        const selectedSize =
          str(item?.selectedSize || item?.size).trim() ||
          pickAttr(attrs, ["size", "sizes", "shirt_size"]) ||
          getSizeFromSku(variant?.sku);

        const selectedColorRaw =
          str(item?.selectedColor || item?.color).trim() ||
          pickAttr(attrs, ["color", "colour", "color_name"]) ||
          getColorFromSku(variant?.sku, product.productCode);

        const selectedColor = sanitizeSelectedColor(
          selectedColorRaw,
          product.productCode,
        );

        normalizedItems.push({
          lineId: crypto.randomUUID(),
          productModel: "Product",
          productId: oid(product._id),
          fulfillment: {
            allocatedQty: 0,
            shippedQty: 0,
            toProduceQty: qty,
          },
          productSnapshot: {
            productCode:
              item?.productSnapshot?.productCode || product.productCode || "",
            title: item?.productSnapshot?.title || item?.name || product.title,
            slug: item?.productSnapshot?.slug || product.slug || "",
            thumbnail:
              item?.productSnapshot?.thumbnail ||
              item?.productSnapshot?.image ||
              item?.image ||
              product.thumbnail ||
              "",
            images: Array.isArray(item?.productSnapshot?.images)
              ? item.productSnapshot.images
              : Array.isArray(product.images)
                ? product.images
                : [],
            productType:
              product.productType ||
              (product?.variants?.length ? "variable" : "simple"),
            sku: item?.productSnapshot?.sku || product.sku || "",
            tags: Array.isArray(product.tags) ? product.tags : [],
            hsnCode: str(product.hsnCode),
            weight: num(product.weight),
            currency: product.currency || currency,
            isPrimaryProduct: isPrimaryItem(item),
          },
          variant: {
            variantId: variant?._id || item?.variantId || null,
            sku: variant?.sku || item?.variant?.sku || "",
            attributes: attrs,
            weight: num(variant?.weight),
          },
          selectedSize,
          selectedColor,
          quantity: qty,
          price: unitPrice,
          compareAtPrice: product?.compareAtPrice ?? null,
          subtotal: lineSubtotal,
        });
      }

      const couponCode =
        coupon && typeof coupon === "object"
          ? str(coupon.code).trim().toUpperCase()
          : "";

      const hasPrimaryProduct = items.some(isPrimaryItem);

      const eligibleCouponBase = normalizedItems.reduce(
        (sum, orderItem, index) => {
          const rawItem = items[index];

          return hasPrimaryProduct && isSecondaryItem(rawItem)
            ? sum + num(orderItem.subtotal)
            : sum;
        },
        0,
      );

      const couponDocForBase = couponCode
        ? await Coupon.findOne({ code: couponCode }).session(session)
        : null;

      const discountBase = couponDocForBase
        ? getCouponDiscountBase({
          couponDoc: couponDocForBase,
          subtotal,
          eligibleCouponBase,
        })
        : null;

      console.log("🎟️ CREATE ORDER COUPON DEBUG:", {
        couponCode,
        subtotal,
        eligibleCouponBase,
        discountTarget:
          couponDocForBase?.discountTarget ||
          couponDocForBase?.cartRule?.discountTarget ||
          "cart",
        discountBaseUsed: discountBase,
        attribution: {
          source: finalAttribution.source,
          medium: finalAttribution.medium,
          campaign: finalAttribution.campaign,
        },
      });

      const totalAmount = subtotal + num(shippingFee) + num(tax);

      const { couponSnapshot, couponDiscount, couponDoc } =
        await validateAndComputeCoupon({
          code: couponCode,
          cartTotal: subtotal,
          discountBase,
          identity,
          couponDocFromBase: couponDocForBase,
        });

      const afterCouponPayable = Math.max(
        0,
        totalAmount - Math.min(num(couponDiscount), totalAmount),
      );

      const requestedWalletAmount =
        useWallet === true || num(walletAmount) > 0 || pm === "wallet"
          ? Math.max(0, num(walletAmount))
          : 0;

      const actualWalletAmount =
        requestedWalletAmount > 0 || pm === "wallet"
          ? Math.min(
            requestedWalletAmount || afterCouponPayable,
            afterCouponPayable,
          )
          : 0;

      const amountAfterWallet = Math.max(
        0,
        afterCouponPayable - actualWalletAmount,
      );

      const razorpayExtraDiscount =
        pm === "razorpay"
          ? Math.min(
            amountAfterWallet,
            Math.round((amountAfterWallet * RAZORPAY_DISCOUNT_PERCENT) / 100),
          )
          : 0;

      let finalDiscount = num(couponDiscount) + num(razorpayExtraDiscount);
      if (finalDiscount > totalAmount) finalDiscount = totalAmount;

      const finalPayable = Math.max(
        0,
        amountAfterWallet - razorpayExtraDiscount,
      );

      const effectivePaymentMethod =
        actualWalletAmount > 0 && finalPayable === 0 ? "wallet" : pm;

      const effectivePaymentStatus =
        effectivePaymentMethod === "wallet" ? "paid" : "pending";

      const analytics = {
        totalItems: totalQty,
        averageItemPrice: totalQty ? subtotal / totalQty : 0,
        couponApplied: Boolean(couponSnapshot?.code),
        creditsUsed: actualWalletAmount > 0,
        categoryBreakdown: computeCategoryBreakdown(normalizedItems),
        tagsUsed: uniqStrings(
          normalizedItems.flatMap((it) => it.productSnapshot?.tags || []),
        ),
        onlinePaymentDiscountApplied: pm === "razorpay",
        onlinePaymentDiscountPct:
          pm === "razorpay" ? RAZORPAY_DISCOUNT_PERCENT : 0,
        onlinePaymentDiscountAmount: razorpayExtraDiscount,
        couponIdentity: identity || "",
      };

      const [order] = await Order.create(
        [
          {
            customerId: oid(customerId),
            shippingAddressSnapshot,
            billingAddressSnapshot,
            items: normalizedItems,
            priority: finalPriority,
            customerSupportRemark: str(customerSupportRemark).trim(),
            subtotal,
            discount: finalDiscount,
            coupon: couponSnapshot ? { ...couponSnapshot, identity } : null,
            shippingFee,
            tax,
            totalAmount,
            finalPayable,
            currency,

            walletCredit: {
              used: actualWalletAmount > 0,
              amount: actualWalletAmount,
              transactionId: "",
              debitedAt:
                actualWalletAmount > 0 && effectivePaymentMethod !== "razorpay"
                  ? new Date()
                  : null,
              balanceAfterDebit: 0,
            },

            paymentBreakdown: {
              walletAmount: actualWalletAmount,
              razorpayAmount:
                effectivePaymentMethod === "razorpay" ? finalPayable : 0,
              codAmount: effectivePaymentMethod === "cod" ? finalPayable : 0,
            },

            paymentMethod: effectivePaymentMethod,
            paymentStatus: effectivePaymentStatus,

            isConfirmed: effectivePaymentMethod === "wallet",
            confirmedAt:
              effectivePaymentMethod === "wallet" ? new Date() : null,
            confirmedBy: effectivePaymentMethod === "wallet" ? "auto" : null,

            fulfillmentStatus: "processing",
            source,
            attribution: finalAttribution,
            isGiftOrder,
            analytics,
            rmas: [],
          },
        ],
        { session },
      );

      if (actualWalletAmount > 0 && effectivePaymentMethod !== "razorpay") {
        const debitResult = await debitWalletForOrderInternal({
          customerId,
          amount: actualWalletAmount,
          orderId: order._id,
          orderNumber: order.orderNumber,
          session,
        });

        order.walletCredit.transactionId = debitResult?.log?.creditId || "";
        order.walletCredit.balanceAfterDebit = debitResult?.balance || 0;
        order.walletCredit.debitedAt = new Date();

        await order.save({ session });
      }

      if (
        couponDoc &&
        couponSnapshot?.code &&
        identity &&
        effectivePaymentMethod === "cod"
      ) {
        couponDoc.usedBy = Array.isArray(couponDoc.usedBy)
          ? couponDoc.usedBy
          : [];

        if (!couponDoc.usedBy.includes(identity)) {
          couponDoc.usedBy.push(identity);
          couponDoc.usedCount = num(couponDoc.usedCount) + 1;
          await couponDoc.save({ session });
        }
      }

      createdOrderId = order._id;
    });

    await creditOrderWalletRewardInternal({ orderId: createdOrderId }).catch(
      (e) => {
        console.error("⚠️ Wallet reward credit failed:", e?.message || e);
      },
    );

    const finalOrder = await Order.findById(createdOrderId)
      .populate("customerId", "name email phone")
      .lean();

    syncCustomerAnalyticsSafe(
      finalOrder?.customerId?._id || finalOrder?.customerId,
      "createOrder",
    );

    if (
      String(
        finalOrder?.paymentMethod || "",
      ).toLowerCase() === "cod" &&
      finalOrder?.isConfirmed !== true
    ) {
      triggerFast2SmsSafe({
        type: "cod_confirmation",
        order: finalOrder,
      });
    }

    try {
      triggerOrderEmails(finalOrder);
    } catch (e) {
      console.error("⚠️ triggerOrderEmails failed:", e?.message || e);
    }

    return res.status(201).json({
      message: "Order created successfully",
      order: finalOrder,
    });
  } catch (error) {
    console.error("❌ Create Order Error:", error);

    return res.status(error.statusCode || 400).json({
      success: false,
      code: error.code || "ORDER_CREATION_FAILED",
      message: error.message || "Order creation failed",
    });
  } finally {
    session.endSession();
  }
};

/* -------------------------------------------
   ✅ Date helpers (IST-safe)
   - If startAt/endAt provided (ISO with offset), use directly.
   - Else use startDate/endDate (YYYY-MM-DD) and convert to IST day boundaries.
------------------------------------------- */
const IST_OFFSET_MIN = 330; // +05:30

const parseYMD = (ymd) => {
  const s = String(ymd || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, mo, d };
};

// Convert "YYYY-MM-DD" IST midnight to a UTC Date object
const istStartUtcFromYMD = (ymd) => {
  const p = parseYMD(ymd);
  if (!p) return null;
  const utcMidnightMs = Date.UTC(p.y, p.mo - 1, p.d, 0, 0, 0, 0);
  return new Date(utcMidnightMs - IST_OFFSET_MIN * 60 * 1000);
};

// End exclusive: next day IST midnight (converted to UTC)
const istEndExclusiveUtcFromYMD = (ymd) => {
  const start = istStartUtcFromYMD(ymd);
  if (!start) return null;
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
};

// ✅ Updated: getAllOrders
// - supports array query params (fulfillmentStatus, paymentStatus, paymentMethod, priority)
// - safer parsing + sanitization
// - optional higher limit for admin (still capped, configurable)
// - keeps your IST date helpers as-is

export const getAllOrders = async (req, res) => {
  try {
    const {
      customerId,
      paymentStatus,
      fulfillmentStatus,
      isConfirmed,
      isInfluencerOrder,
      confirmFilter,
      priority,

      startDate,
      endDate,
      startAt,
      endAt,

      minAmount,
      maxAmount,
      paymentMethod,
      customerName,

      // ✅ Universal attribution filters
      attributionSource,
      attributionMedium,
      attributionCampaign,
      campaignId,
      campaignSlug,
      marketingLinkId,
      shortCode,
      visitorId,
      sessionId,

      page = "1",
      limit = "100",

      // ✅ only compute sum when asked
      includeSum = "false",
    } = req.query;

    const filters = {};

    /* ----------------------------
       ✅ helpers
    ---------------------------- */
    const toStr = (v) => String(v ?? "").trim();
    const toLower = (v) => toStr(v).toLowerCase();

    const normalizeArrayParam = (v) => {
      if (v == null) return [];
      const arr = Array.isArray(v) ? v : [v];
      return arr.map((x) => toStr(x)).filter(Boolean);
    };

    const setInOrEq = (field, raw, mapFn = (x) => x) => {
      const arr = normalizeArrayParam(raw).map(mapFn).filter(Boolean);
      if (!arr.length) return;
      filters[field] = arr.length === 1 ? arr[0] : { $in: arr };
    };

    const setRegex = (field, raw) => {
      const value = toStr(raw);
      if (!value) return;

      filters[field] = new RegExp(
        value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
    };

    /* ----------------------------
       ✅ Basic filters
    ---------------------------- */
    if (customerId && mongoose.Types.ObjectId.isValid(String(customerId))) {
      filters.customerId = new mongoose.Types.ObjectId(String(customerId));
    }

    setInOrEq("paymentStatus", paymentStatus, (x) => toStr(x));
    setInOrEq("fulfillmentStatus", fulfillmentStatus, (x) => toStr(x));

    if (confirmFilter === "confirmed") filters.isConfirmed = true;
    else if (confirmFilter === "not_confirmed")
      filters.isConfirmed = { $ne: true };
    else if (isConfirmed != null)
      filters.isConfirmed = toLower(isConfirmed) === "true";

    const allowedPriority = new Set(["normal", "medium", "high"]);
    const prClean = normalizeArrayParam(priority)
      .map((x) => toLower(x))
      .filter((p) => allowedPriority.has(p));

    if (prClean.length === 1) filters.priority = prClean[0];
    else if (prClean.length > 1) filters.priority = { $in: prClean };

    setInOrEq("paymentMethod", paymentMethod, (x) => toLower(x));

    if (isInfluencerOrder != null) {
      const value = toLower(isInfluencerOrder);

      if (value === "true") {
        filters.isInfluencerOrder = true;
      } else if (value === "false") {
        filters.isInfluencerOrder = { $ne: true };
      }
    }

    /* ----------------------------
       ✅ Universal attribution filters
    ---------------------------- */
    setInOrEq("attribution.source", attributionSource, (x) => toLower(x));
    setInOrEq("attribution.medium", attributionMedium, (x) => toLower(x));

    // campaign can be partial search because names/slugs can vary
    setRegex("attribution.campaign", attributionCampaign);

    if (campaignId && mongoose.Types.ObjectId.isValid(String(campaignId))) {
      filters["attribution.campaignId"] = new mongoose.Types.ObjectId(
        String(campaignId),
      );
    }

    setInOrEq("attribution.campaignSlug", campaignSlug, (x) => toLower(x));
    setInOrEq("attribution.marketingLinkId", marketingLinkId, (x) => toStr(x));
    setInOrEq("attribution.shortCode", shortCode, (x) => toStr(x));
    setInOrEq("attribution.visitorId", visitorId, (x) => toStr(x));
    setInOrEq("attribution.sessionId", sessionId, (x) => toStr(x));

    /* ----------------------------
       ✅ Date range — IST correct
    ---------------------------- */
    const hasStartAt = !!toStr(startAt);
    const hasEndAt = !!toStr(endAt);
    const hasStartDate = !!toStr(startDate);
    const hasEndDate = !!toStr(endDate);

    if (hasStartAt || hasEndAt || hasStartDate || hasEndDate) {
      filters.createdAt = {};

      if (hasStartAt) {
        const d = new Date(toStr(startAt));
        if (!Number.isNaN(d.getTime())) filters.createdAt.$gte = d;
      } else if (hasStartDate) {
        const d = istStartUtcFromYMD(startDate);
        if (d) filters.createdAt.$gte = d;
      }

      if (hasEndAt) {
        const d = new Date(toStr(endAt));
        if (!Number.isNaN(d.getTime())) filters.createdAt.$lte = d;
      } else if (hasEndDate) {
        const d = istEndExclusiveUtcFromYMD(endDate);
        if (d) filters.createdAt.$lt = d;
      }

      if (
        !filters.createdAt.$gte &&
        !filters.createdAt.$lt &&
        !filters.createdAt.$lte
      ) {
        delete filters.createdAt;
      }
    }

    /* ----------------------------
       ✅ Amount range
    ---------------------------- */
    const minA = Number(minAmount);
    const maxA = Number(maxAmount);

    if (Number.isFinite(minA) || Number.isFinite(maxA)) {
      filters.finalPayable = {};
      if (Number.isFinite(minA)) filters.finalPayable.$gte = minA;
      if (Number.isFinite(maxA)) filters.finalPayable.$lte = maxA;
    }

    /* ----------------------------
       ✅ Search
    ---------------------------- */
    const q = toStr(customerName);

    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

      filters.$or = [
        { orderNumber: rx },
        { "shippingAddressSnapshot.fullName": rx },
        { "shippingAddressSnapshot.email": rx },
        { "shippingAddressSnapshot.phone": rx },

        // ✅ attribution searchable too
        { "attribution.source": rx },
        { "attribution.medium": rx },
        { "attribution.campaign": rx },
        { "attribution.campaignSlug": rx },
        { "attribution.shortCode": rx },
      ];
    }

    /* ----------------------------
       ✅ Pagination
    ---------------------------- */
    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);

    const limitNumRaw = parseInt(String(limit), 10) || 100;
    const MAX_LIMIT = 200;
    const limitNum = Math.min(Math.max(1, limitNumRaw), MAX_LIMIT);

    const skip = (pageNum - 1) * limitNum;

    /* ----------------------------
       ✅ FAST projection for list
    ---------------------------- */
    const LIST_FIELDS = {
      orderNumber: 1,
      createdAt: 1,
      orderDate: 1,
      "fulfillmentDates.packedAt": 1,

      priority: 1,
      priorityRank: 1,

      paymentMethod: 1,
      paymentStatus: 1,
      fulfillmentStatus: 1,
      isConfirmed: 1,
      isInfluencerOrder: 1,
      isTestingOrder: 1,
      subtotal: 1,
      discount: 1,
      shippingFee: 1,
      tax: 1,
      totalAmount: 1,
      finalPayable: 1,
      currency: 1,

      "shippingAddressSnapshot.fullName": 1,
      "shippingAddressSnapshot.phone": 1,
      "shippingAddressSnapshot.email": 1,
      "shippingAddressSnapshot.pincode": 1,

      // ✅ Universal attribution
      "attribution.source": 1,
      "attribution.medium": 1,
      "attribution.campaign": 1,
      "attribution.campaignId": 1,
      "attribution.campaignSlug": 1,
      "attribution.marketingLinkId": 1,
      "attribution.shortCode": 1,
      "attribution.visitorId": 1,
      "attribution.sessionId": 1,
      "attribution.landingUrl": 1,
      "attribution.lastTouchUrl": 1,
      "attribution.referrer": 1,
      "attribution.clickIds.fbclid": 1,
      "attribution.clickIds.gclid": 1,
      "attribution.clickIds.msclkid": 1,
      "attribution.clickIds.ttclid": 1,
      "attribution.clickIds.scClickId": 1,

      // ✅ Shipment + Shiprocket details
      "shipment.provider": 1,
      "shipment.status": 1,



      // Universal shipment fields
      "shipment.orderId": 1,
      "shipment.shipmentId": 1,
      "shipment.awb": 1,
      "shipment.courierName": 1,
      "shipment.trackingUrl": 1,
      "shipment.labelUrl": 1,

      // Shiprocket-specific fields
      "shipment.shiprocket.orderId": 1,
      "shipment.shiprocket.shipmentId": 1,
      "shipment.shiprocket.awb": 1,
      "shipment.shiprocket.courierName": 1,
      "shipment.shiprocket.trackingUrl": 1,
      "shipment.shiprocket.labelUrl": 1,

      // items but light + snapshot
      "items.lineId": 1,
      "items.quantity": 1,
      "items.price": 1,
      "items.subtotal": 1,
      "items.selectedSize": 1,
      "items.selectedColor": 1,
      "items.productSnapshot.productCode": 1,
      "items.productSnapshot.title": 1,
      "items.productSnapshot.thumbnail": 1,
      "items.variant.sku": 1,

      "items.productId": 1,
      "items.productModel": 1,
      "items.variant.variantId": 1,
      "items.variant.sku": 1,
    };

    const sort = { priorityRank: -1, createdAt: -1 };
    const wantSum = toLower(includeSum) === "true";

    const promises = [
      Order.find(filters)
        .select(LIST_FIELDS)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean()
        .populate({ path: "customerId", select: "name email phone" }),

      Order.countDocuments(filters),
    ];

    if (wantSum) {
      promises.push(
        Order.aggregate([
          { $match: filters },
          {
            $group: {
              _id: null,
              totalSum: { $sum: { $ifNull: ["$finalPayable", 0] } },
            },
          },
        ]),
      );
    }

    const [orders, totalCount, sumAgg] = await Promise.all(promises);

    const finalOrders =
      confirmFilter === "not_confirmed"
        ? await enrichOrdersWithFulfillmentReadiness(orders)
        : orders;

    const totalSum = wantSum ? Number(sumAgg?.[0]?.totalSum || 0) : null;
    const hasMore = skip + (orders?.length || 0) < totalCount;

    const totalPages = Math.max(
      1,
      Math.ceil(totalCount / limitNum)
    );

    return res.status(200).json({
      orders: finalOrders,

      meta: {
        page: pageNum,
        limit: limitNum,

        total: totalCount,
        totalCount,
        totalPages,

        totalSum,

        hasMore,
        hasNextPage: pageNum < totalPages,
        hasPreviousPage: pageNum > 1,
      },
    });
  } catch (error) {
    console.error("❌ Fetch Orders Error:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// ✅ GET CONFIRMED ORDERS
// GET /api/orders/confirmed
export const getConfirmedOrders = async (req, res) => {
  req.query.confirmFilter = "confirmed";
  return getAllOrders(req, res);
};

// ✅ GET NOT CONFIRMED ORDERS
// GET /api/orders/not-confirmed
export const getNotConfirmedOrders = async (req, res) => {
  req.query.confirmFilter = "not_confirmed";
  return getAllOrders(req, res);
};

/* ============================================================
   GET ORDER BY ID
============================================================ */
export const getOrderById = async (req, res) => {
  try {
    const idOrNumber = String(req.params.id || "").trim();
    const query = mongoose.Types.ObjectId.isValid(idOrNumber)
      ? { _id: idOrNumber }
      : { orderNumber: idOrNumber };

    const order = await Order.findOne(query)
      .populate("customerId", "name email phone")
      .populate("items.productId");

    if (!order) return res.status(404).json({ message: "Order not found" });
    return res.status(200).json(order);
  } catch (error) {
    console.error("❌ Fetch Order Error:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

/* ============================================================
   GET ORDERS OF SPECIFIC CUSTOMER
============================================================ */
export const getOrdersByCustomer = async (req, res) => {
  try {
    const orders = await Order.find({ customerId: req.params.customerId })
      .populate("items.productId")
      .sort({ priority: -1, createdAt: -1 });

    return res.status(200).json(orders);
  } catch (error) {
    console.error("❌ Customer Orders Error:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

/* ============================================================
   UPDATE FULL ORDER
============================================================ */
export const updateOrder = async (req, res) => {
  try {
    const body = { ...req.body };

    // ✅ keep status separate so date hook runs via .save()
    const nextFulfillmentStatus = body.fulfillmentStatus
      ? String(body.fulfillmentStatus).trim().toLowerCase()
      : "";

    delete body.fulfillmentStatus;

    // ✅ trim remark
    if (body.customerSupportRemark != null) {
      body.customerSupportRemark = String(body.customerSupportRemark).trim();
    }

    // ✅ sanitize priority
    if (body.priority != null) {
      const p = String(body.priority).trim().toLowerCase();
      body.priority = ["normal", "medium", "high"].includes(p) ? p : "normal";
    }

    // ✅ If coupon object updated manually, sync discount too
    if (body.coupon && typeof body.coupon === "object" && body.coupon.code) {
      body.discount = Number(body.coupon.discount || 0);

      if (body.coupon.identity != null) {
        body.coupon.identity = String(body.coupon.identity).trim();
      }

      if (body.coupon.code != null) {
        body.coupon.code = String(body.coupon.code).trim().toUpperCase();
      }
    }

    let order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    // ✅ normal fields update
    Object.assign(order, body);

    // ✅ status update through document save => pre-validate runs
    if (nextFulfillmentStatus) {
      order.fulfillmentStatus = nextFulfillmentStatus;
    }

    const updatedOrder = await order.save();
    syncCustomerAnalyticsSafe(updatedOrder.customerId, "updateOrder");

    return res.status(200).json({
      message: "Order updated",
      order: updatedOrder,
    });
  } catch (error) {
    console.error("❌ Update Order Error:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// ========================================================================================
// ✅ MARK COD ORDER AS PAID
// ========================================================================================
export const markCodOrderAsPaid = async (req, res) => {
  try {
    const { id } = req.params;

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (order.paymentMethod !== "cod") {
      return res.status(400).json({
        success: false,
        message: "Only COD orders are allowed.",
      });
    }

    // ✅ Convert COD order to manually paid (Prepaid)
    order.paymentMethod = "manual_prepaid";
    order.paymentStatus = "paid";

    order.paymentBreakdown = order.paymentBreakdown || {};
    order.paymentBreakdown.codAmount = 0;
    order.paymentBreakdown.razorpayAmount = Number(order.finalPayable || 0);

    order.isConfirmed = true;
    order.confirmedAt = order.confirmedAt || new Date();
    order.confirmedBy = "admin";

    // Optional
    if (req.body?.isInfluencerOrder !== undefined) {
      order.isInfluencerOrder = !!req.body.isInfluencerOrder;
    }

    await order.save();

    return res.json({
      success: true,
      message: "COD order marked as paid.",
      order,
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

/* ============================================================
   UPDATE ORDER STATUS
   - supports cancel / paid / confirm / packed / shipped / delivered
   - shipped + delivered customer emails
   - packed => consume reservations + auto shiprocket booking
============================================================ */
export const updateOrderStatus = async (req, res) => {
  const session = await mongoose.startSession();

  const str = (v) => (v == null ? "" : String(v));
  const lower = (v) => str(v).trim().toLowerCase();
  const normEmail = (v) => str(v).trim().toLowerCase();
  const normPhone = (v) =>
    str(v)
      .replace(/[^\d+]/g, "")
      .trim()
      .replace(/^\+/, "");

  const defer = (fn) =>
    typeof setImmediate === "function" ? setImmediate(fn) : setTimeout(fn, 0);

  const stripUndefinedDeep = (obj) => {
    if (Array.isArray(obj)) return obj.map(stripUndefinedDeep);
    if (!obj || typeof obj !== "object") return obj;

    const out = {};

    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        out[key] = stripUndefinedDeep(value);
      }
    }

    return out;
  };

  const buildCouponIdentity = ({ email, phone }) => {
    const normalizedEmail = normEmail(email);

    if (normalizedEmail && normalizedEmail.includes("@")) {
      return `email:${normalizedEmail}`;
    }

    const normalizedPhone = normPhone(phone);

    if (normalizedPhone) {
      return `phone:${normalizedPhone}`;
    }

    return "";
  };

  const pickCancelActor = () => {
    const actor = lower(req.body?.cancelledBy);

    if (["admin", "customer", "system"].includes(actor)) {
      return actor;
    }

    const reason = lower(req.body?.reason);

    if (["cancelled_by_admin", "admin"].includes(reason)) {
      return "admin";
    }

    if (["cancelled_by_customer", "customer"].includes(reason)) {
      return "customer";
    }

    return req.user?.role === "admin" ? "admin" : "customer";
  };

  const getCustomerMailData = (order) => {
    const to =
      str(order?.shippingAddressSnapshot?.email).trim() ||
      str(order?.billingAddressSnapshot?.email).trim();

    const name =
      str(order?.shippingAddressSnapshot?.fullName).trim() ||
      str(order?.billingAddressSnapshot?.fullName).trim() ||
      "Customer";

    const baseUrl =
      process.env.CLIENT_URL ||
      process.env.STORE_URL ||
      "http://localhost:3000";

    const ctaUrl = order?.orderNumber
      ? `${baseUrl}/orders/${order.orderNumber}`
      : baseUrl;

    return {
      to,
      name,
      ctaUrl,
    };
  };

  const triggerReserveNonBlocking = (orderNumber) => {
    const cleanOrderNumber = str(orderNumber).trim();

    if (!cleanOrderNumber) return;

    defer(async () => {
      try {
        await reserveInventoryForOrderNumberInternal({
          orderNumber: cleanOrderNumber,
          allowedFulfillment: ["processing", "packed"],
          confirmedOnly: true,
          debug: false,
        });
      } catch (error) {
        console.error(
          "⚠️ Reserve trigger failed:",
          error?.message || error,
        );
      }
    });
  };

  const sendOrderMailNonBlocking = ({ type, order }) => {
    defer(async () => {
      try {
        if (process.env.MAIL_ENABLED !== "true") {
          console.log(`📭 ${type} mail skipped: MAIL_ENABLED not true`);
          return;
        }

        const { to, name, ctaUrl } = getCustomerMailData(order);

        if (!to) {
          console.log(`📭 ${type} mail skipped: customer email missing`);
          return;
        }

        if (type === "shipped") {
          await Mailer.sendOrderShipped({
            to,
            name,
            order,
            ctaUrl,
          });
        }

        if (type === "delivered") {
          await Mailer.sendOrderDelivered({
            to,
            name,
            order,
            ctaUrl,
          });
        }

        console.log(
          `✅ ${type} email sent:`,
          order?.orderNumber,
          "->",
          to,
        );
      } catch (error) {
        console.error(
          `❌ ${type} email failed:`,
          error?.message || error,
        );
      }
    });
  };

  try {
    req.body = stripUndefinedDeep(req.body);

    if (req.body?.shipment) {
      if (req.body.shipment.xpressbees == null) {
        delete req.body.shipment.xpressbees;
      }

      if (req.body.shipment.shiprocket == null) {
        delete req.body.shipment.shiprocket;
      }
    }

    const orderId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({
        message: "Invalid order id",
      });
    }

    const fulfillmentStatus = lower(req.body?.fulfillmentStatus);
    const paymentStatus = lower(req.body?.paymentStatus);
    const isConfirmedReq = req.body?.isConfirmed === true;

    const cancelActor = pickCancelActor();
    const cancelReason = str(req.body?.reason).trim();

    let updatedOrder = null;
    let shouldTriggerReserve = false;
    let shouldBookShiprocket = false;
    let shouldCreateShiprocketReturn = false;
    let shouldSendShippedEmail = false;
    let shouldSendDeliveredEmail = false;

    await session.withTransaction(async () => {
      let order = await Order.findById(orderId).session(session);

      if (!order) {
        throw new Error("Order not found");
      }

      const isParent = lower(order?.orderType) === "parent";
      const prevPaid = lower(order?.paymentStatus) === "paid";
      const prevConfirmed = Boolean(order?.isConfirmed);
      const prevFulfillmentStatus = lower(order?.fulfillmentStatus);

      if (fulfillmentStatus === "cancelled") {
        const allowed = ["processing", "packed"];
        const currentStatus = lower(order.fulfillmentStatus);

        if (!allowed.includes(currentStatus)) {
          throw new Error(
            "Cancel allowed only in processing or packed stage",
          );
        }

        await cancelReservationsInternalByOrder({
          orderId: order._id,
          reason: `Order cancelled | orderNumber=${order.orderNumber || ""}`,
          session,
        });

        const now = new Date();

        const setPayload = {
          fulfillmentStatus: "cancelled",
          "fulfillmentDates.cancelledAt": now,

          "cancellation.isCancelled": true,
          "cancellation.cancelledAt":
            order.cancellation?.cancelledAt || now,
          "cancellation.cancelledBy": cancelActor,
          "cancellation.reason":
            cancelReason || order.cancellation?.reason || "",
        };

        const unsetPayload = {};

        if (cancelActor === "admin") {
          setPayload.adminRemarks =
            str(req.body?.adminRemarks).trim() ||
            "cancelled_by_admin";

          unsetPayload.customerMessage = "";
        } else {
          setPayload.customerMessage =
            str(req.body?.customerMessage).trim() ||
            "cancelled_by_customer";

          unsetPayload.adminRemarks = "";
        }

        const isPaidRazorpay =
          lower(order.paymentMethod) === "razorpay" &&
          lower(order.paymentStatus) === "paid" &&
          order.razorpay?.paymentId;

        if (isPaidRazorpay) {
          const amount = Number(order.finalPayable || 0);

          setPayload.eligibleForRefund = true;
          setPayload.paymentStatus = "refund_pending";

          setPayload["refundSummary.status"] = "refund_pending";
          setPayload["refundSummary.refundType"] = "full";
          setPayload["refundSummary.eligibleAmount"] = amount;
          setPayload["refundSummary.pendingAmount"] = amount;
          setPayload["refundSummary.reason"] =
            cancelReason || "Paid order cancelled before shipment";

          setPayload["refundSummary.markedEligibleAt"] =
            order.refundSummary?.markedEligibleAt || now;

          setPayload["refundSummary.refundRequestedAt"] =
            order.refundSummary?.refundRequestedAt || now;
        }

        updatedOrder = await Order.findOneAndUpdate(
          {
            _id: order._id,
            fulfillmentStatus: {
              $in: allowed,
            },
          },
          {
            $set: setPayload,
            ...(Object.keys(unsetPayload).length
              ? {
                $unset: unsetPayload,
              }
              : {}),
          },
          {
            new: true,
            session,
            runValidators: true,
          },
        );

        if (!updatedOrder) {
          throw new Error(
            "Order was already updated. Please refresh and try again.",
          );
        }

        return;
      }

      if (paymentStatus) {
        order.paymentStatus = paymentStatus;
      }

      if (isConfirmedReq && !order.isConfirmed) {
        if (
          lower(order.paymentMethod) === "razorpay" &&
          lower(order.paymentStatus) !== "paid"
        ) {
          throw new Error(
            "Cannot confirm Razorpay order before payment is paid",
          );
        }

        order.isConfirmed = true;
        order.confirmedAt = new Date();
      }

      if (
        paymentStatus === "paid" &&
        lower(order.paymentMethod) === "razorpay" &&
        !order.isConfirmed
      ) {
        order.isConfirmed = true;
        order.confirmedAt = new Date();
      }

      const nowPaid = lower(order?.paymentStatus) === "paid";
      const nowConfirmed = Boolean(order?.isConfirmed);

      if (
        (!prevPaid &&
          nowPaid &&
          lower(order.paymentMethod) === "razorpay") ||
        (!prevConfirmed && nowConfirmed)
      ) {
        shouldTriggerReserve = true;
      }

      if (
        paymentStatus === "paid" &&
        lower(order.paymentMethod) === "razorpay" &&
        order?.coupon?.code
      ) {
        const couponCode = str(order.coupon.code)
          .trim()
          .toUpperCase();

        const identity =
          str(order?.coupon?.identity).trim() ||
          buildCouponIdentity({
            email: order?.shippingAddressSnapshot?.email,
            phone: order?.shippingAddressSnapshot?.phone,
          });

        if (couponCode && identity) {
          const couponDoc = await Coupon.findOne({
            code: couponCode,
          }).session(session);

          if (couponDoc) {
            couponDoc.usedBy = Array.isArray(couponDoc.usedBy)
              ? couponDoc.usedBy
              : [];

            if (!couponDoc.usedBy.includes(identity)) {
              couponDoc.usedBy.push(identity);
              couponDoc.usedCount =
                Number(couponDoc.usedCount || 0) + 1;

              await couponDoc.save({
                session,
              });
            }
          }
        }
      }

      if (fulfillmentStatus) {
        const shippingStages = [
          "packed",
          "picked",
          "shipped",
          "out_for_delivery",
          "delivered",
        ];

        const currentStatus = lower(order.fulfillmentStatus);

        const becomingReturnRequested =
          fulfillmentStatus === "return_requested" &&
          currentStatus !== "return_requested";

        const becomingExchangeRequested =
          fulfillmentStatus === "exchange_requested" &&
          currentStatus !== "exchange_requested";

        if (
          becomingReturnRequested ||
          becomingExchangeRequested
        ) {
          shouldCreateShiprocketReturn = true;
        }

        const isReversePickup =
          fulfillmentStatus === "pickup_initiated";

        const becomingPacked =
          fulfillmentStatus === "packed" &&
          currentStatus !== "packed";

        const becomingShipped =
          fulfillmentStatus === "shipped" &&
          prevFulfillmentStatus !== "shipped";

        const becomingDelivered =
          fulfillmentStatus === "delivered" &&
          prevFulfillmentStatus !== "delivered";

        if (!isReversePickup) {
          if (
            isParent &&
            shippingStages.includes(fulfillmentStatus)
          ) {
            throw new Error(
              "Parent order cannot move to shipping stages. Update shipment orders (-A/-B) instead.",
            );
          }

          if (
            !nowConfirmed &&
            shippingStages.includes(fulfillmentStatus)
          ) {
            throw new Error(
              "Order must be confirmed before shipping stages",
            );
          }
        }

        if (fulfillmentStatus === "refunded") {
          const allowedPrev = [
            "returned",
            "cancelled",
            "rto",
          ];

          if (!allowedPrev.includes(currentStatus)) {
            throw new Error(
              "Refunded can be marked only after returned/cancelled/rto",
            );
          }

          order.paymentStatus = "refunded";
        }

        if (becomingPacked && !isParent) {
          if (
            lower(order.paymentMethod) === "razorpay" &&
            lower(order.paymentStatus) !== "paid"
          ) {
            throw new Error(
              "Cannot pack Razorpay order before payment is paid",
            );
          }

          await consumeReservationsInternalByOrder({
            orderId: order._id,
            reason: `Consumed on PACKED | orderNumber=${order.orderNumber || ""}`,
            session,
          });

          order = await Order.findById(orderId).session(session);

          if (!order) {
            throw new Error(
              "Order not found after reservation consume",
            );
          }
        }

        order.fulfillmentStatus = fulfillmentStatus;

        if (fulfillmentStatus === "shipped") {
          order.trackingDetails =
            order.trackingDetails || {};

          order.shipment = order.shipment || {};

          if (!order.trackingDetails.shippedAt) {
            order.trackingDetails.shippedAt = new Date();
          }

          if (!order.shipment.shippedAt) {
            order.shipment.shippedAt = new Date();
          }
        }

        if (fulfillmentStatus === "delivered") {
          order.trackingDetails =
            order.trackingDetails || {};

          order.shipment = order.shipment || {};

          if (!order.trackingDetails.deliveredAt) {
            order.trackingDetails.deliveredAt = new Date();
          }

          if (!order.shipment.deliveredAt) {
            order.shipment.deliveredAt = new Date();
          }
        }

        // Auto-book only on the first transition to PACKED.
        // Existing AWB or shipment ID prevents duplicate booking.
        if (becomingPacked && !isParent) {
          const alreadyBooked =
            order?.shipment?.shiprocket?.awb ||
            order?.shipment?.shiprocket?.shipmentId;

          if (!alreadyBooked) {
            shouldBookShiprocket = true;
          }
        }

        if (becomingShipped) {
          shouldSendShippedEmail = true;
        }

        if (becomingDelivered) {
          shouldSendDeliveredEmail = true;
        }
      }

      await order.save({
        session,
      });

      updatedOrder = order;
    });

    const finalOrder = updatedOrder?._id
      ? await Order.findById(updatedOrder._id).lean()
      : null;

    syncCustomerAnalyticsSafe(
      finalOrder?.customerId,
      "updateOrderStatus",
    );

    if (finalOrder && shouldTriggerReserve) {
      triggerReserveNonBlocking(finalOrder.orderNumber);
    }

    /* ============================================================
   SHIPROCKET AUTO RETURN
   return_requested / exchange_requested
============================================================ */

    if (finalOrder && shouldCreateShiprocketReturn) {
      try {
        const freshOrderDoc = await Order.findById(finalOrder._id);

        if (!freshOrderDoc) {
          throw new Error(
            "Order not found before Shiprocket return creation",
          );
        }

        const wantedType =
          fulfillmentStatus === "exchange_requested"
            ? "exchange"
            : "return";

        /*
          Find latest relevant RMA.
          Prefer requested/approved RMA.
        */
        const matchingRmas = (freshOrderDoc.rmas || [])
          .filter(
            (rma) =>
              lower(rma?.type) === wantedType &&
              ["requested", "approved"].includes(
                lower(rma?.status),
              ),
          )
          .sort(
            (a, b) =>
              new Date(b?.createdAt || 0).getTime() -
              new Date(a?.createdAt || 0).getTime(),
          );

        const rma = matchingRmas[0];

        if (!rma) {
          throw new Error(
            `No ${wantedType} RMA found for Shiprocket return`,
          );
        }

        /*
          Duplicate protection
        */
        const alreadyCreated =
          rma?.reverseShipment?.orderId ||
          rma?.reverseShipment?.shipmentId ||
          rma?.reverseShipment?.awb;

        if (alreadyCreated) {
          console.log(
            "↩️ Shiprocket return already exists:",
            {
              orderNumber: freshOrderDoc.orderNumber,
              rmaNumber: rma.rmaNumber,
            },
          );
        } else {
          const payload =
            buildReverseShiprocketPayload({
              order: freshOrderDoc,
              rma,
            });

          /*
            QC OFF completely
          */
          payload.order_items = (
            payload.order_items || []
          ).map((item) => {
            const {
              qc_enable,
              qc_product_name,
              qc_brand,
              qc_product_image,
              ...cleanItem
            } = item;

            return cleanItem;
          });

          console.log(
            "↩️ Creating Shiprocket return:",
            {
              orderNumber: freshOrderDoc.orderNumber,
              rmaNumber: rma.rmaNumber,
              type: wantedType,
              items: payload.order_items.length,
            },
          );

          const shipment =
            await createReturnOrder(payload);

          const reverseAwb = str(
            shipment?.awb_code ||
            shipment?.awb ||
            shipment?.shipment?.awb_code,
          ).trim();

          const shiprocketOrderId = str(
            shipment?.order_id ||
            shipment?.id,
          ).trim();

          const shiprocketShipmentId = str(
            shipment?.shipment_id ||
            shipment?.shipment?.id,
          ).trim();

          if (
            !shiprocketOrderId &&
            !shiprocketShipmentId
          ) {
            throw new Error(
              shipment?.message ||
              shipment?.error ||
              "Shiprocket return order creation failed",
            );
          }

          const now = new Date();

          rma.reverseShipment = {
            provider: "shiprocket",

            orderId: shiprocketOrderId,
            shipmentId: shiprocketShipmentId,

            awb: reverseAwb,

            courierName: str(
              shipment?.courier_name ||
              shipment?.courier,
            ).trim(),

            trackingUrl: str(
              shipment?.tracking_url,
            ).trim(),

            pickupScheduledAt: reverseAwb
              ? now
              : null,

            status: reverseAwb
              ? "pickup_scheduled"
              : "return_created",

            lastUpdatedAt: now,
          };

          /*
            RMA lifecycle
          */
          rma.status = reverseAwb
            ? "pickup_scheduled"
            : "approved";

          await freshOrderDoc.save();

          console.log(
            "✅ Shiprocket return created:",
            {
              orderNumber:
                freshOrderDoc.orderNumber,
              rmaNumber: rma.rmaNumber,
              shiprocketOrderId,
              shipmentId:
                shiprocketShipmentId,
              awb: reverseAwb || "pending",
            },
          );
        }
      } catch (error) {
        /*
          VERY IMPORTANT:
          status remains return_requested /
          exchange_requested even if Shiprocket fails.
        */
        console.error(
          "⚠️ Auto Shiprocket return failed:",
          error?.response?.data ||
          error?.message ||
          error,
        );
      }
    }

    // Book only after MongoDB transaction commits.
    // Shiprocket failure will not rollback packed status or inventory consume.
    if (finalOrder && shouldBookShiprocket) {
      try {
        const freshOrderDoc = await Order.findById(
          finalOrder._id,
        );

        if (!freshOrderDoc) {
          throw new Error(
            "Order not found before Shiprocket auto booking",
          );
        }

        const alreadyBooked =
          freshOrderDoc?.shipment?.shiprocket?.awb ||
          freshOrderDoc?.shipment?.shiprocket?.shipmentId;

        if (!alreadyBooked) {
          await autoBookShiprocketForOrder(freshOrderDoc);
        }
      } catch (error) {
        console.error(
          "⚠️ Auto Shiprocket booking failed:",
          error?.response?.data ||
          error?.message ||
          error,
        );
      }
    }

    if (finalOrder && shouldSendShippedEmail) {
      sendOrderMailNonBlocking({
        type: "shipped",
        order: finalOrder,
      });
    }

    if (finalOrder && shouldSendDeliveredEmail) {
      sendOrderMailNonBlocking({
        type: "delivered",
        order: finalOrder,
      });
    }

    if (fulfillmentStatus === "cancelled") {
      try {
        triggerOrderCancellationEmails(
          finalOrder,
          cancelReason,
        );
      } catch (error) {
        console.error(
          "⚠️ Cancellation email trigger failed:",
          error?.message || error,
        );
      }
    }

    return res.status(200).json({
      message:
        fulfillmentStatus === "cancelled"
          ? "Order cancelled successfully"
          : "Order status updated",
      order: finalOrder,
    });
  } catch (error) {
    console.error("❌ Update Status Error:", error);

    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

/* ============================================================
   ✅ DUPLICATE / EXCHANGE ORDER
   - paymentMethod: exchange
   - paymentStatus: not_applicable
============================================================ */

export const duplicateExchangeOrder = async (req, res) => {
  const session = await mongoose.startSession();

  // ---------------- helpers (LOCAL, self-contained) ----------------
  const str = (v) => (v == null ? "" : String(v));

  const num = (v, d = 0) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : d;
  };

  const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));

  const oid = (v) => new mongoose.Types.ObjectId(String(v));

  const escapeRegExp = (s) =>
    String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const normalizeVariantAttributes = (variant) => {
    const raw = variant?.attributes;

    // supports: [{key,value}] or {key:value}
    if (Array.isArray(raw)) {
      return raw
        .filter((a) => a?.key != null && a?.value != null)
        .map((a) => ({ key: str(a.key), value: str(a.value) }));
    }

    if (raw && typeof raw === "object") {
      return Object.entries(raw).map(([k, v]) => ({
        key: str(k),
        value: str(v),
      }));
    }

    return [];
  };

  const findVariantById = (product, variantId) => {
    if (!variantId) return null;
    const vars = Array.isArray(product?.variants) ? product.variants : [];
    return vars.find((v) => String(v._id) === String(variantId)) || null;
  };

  const pickAttr = (attrs = [], keys = []) => {
    const wanted = keys.map((k) => str(k).trim().toLowerCase());
    const found = (Array.isArray(attrs) ? attrs : []).find((a) =>
      wanted.includes(str(a?.key).trim().toLowerCase()),
    );
    return found?.value ? str(found.value) : "";
  };

  const isNumericLike = (v) => /^[0-9]+$/.test(str(v).trim());

  const sanitizeSelectedColor = (color, productCode = "") => {
    const c = str(color).trim();
    const pc = str(productCode).trim();
    if (!c) return "";
    if (isNumericLike(c)) return "";
    if (pc && c.toUpperCase() === pc.toUpperCase()) return "";
    return c;
  };

  const getSizeFromSku = (sku) => {
    const parts = str(sku).toUpperCase().split("-");
    const sizes = [
      "XXS",
      "XS",
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "3XL",
      "4XL",
      "5XL",
    ];
    for (let i = parts.length - 1; i >= 0; i--) {
      if (sizes.includes(parts[i])) return parts[i];
    }
    return "";
  };

  const getColorFromSku = (sku, productCode = "") => {
    const parts = str(sku).toUpperCase().split("-");
    if (parts.length < 2) return "";

    const sizes = [
      "XXS",
      "XS",
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "3XL",
      "4XL",
      "5XL",
    ];
    const maybeColor = parts[parts.length - 2];

    if (sizes.includes(maybeColor)) return "";
    if (/^[0-9]+$/.test(maybeColor)) return "";
    if (productCode && maybeColor === str(productCode).toUpperCase()) return "";

    return maybeColor.toLowerCase();
  };

  // ✅ allocate from sellable stock (stock - reservedStock) else toProduce
  const computeAllocation = ({ stock = 0, reservedStock = 0, qty = 1 }) => {
    const q = Math.max(1, num(qty, 1));
    const sellable = Math.max(0, num(stock) - num(reservedStock));
    const allocatedQty = Math.min(q, sellable);
    const toProduceQty = Math.max(0, q - allocatedQty);
    return { allocatedQty, toProduceQty };
  };

  // ---------------- controller ----------------
  try {
    const orderId = req.params.orderId;

    const {
      // optional override items (exchange items)
      // [{ productId, quantity, variantId? }]
      items,

      // optional: link to existing rmaNumber
      rmaNumber,

      // optional notes
      customerNote = "",
      adminNote = "",
      reason = "other",
      resolution = "exchange",
    } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "Invalid orderId" });
    }

    let newOrderDoc = null;

    await session.withTransaction(async () => {
      const original = await Order.findById(orderId).session(session);
      if (!original) throw new Error("Original order not found");

      const base = str(original.orderNumber).trim(); // OATCLUB-000217
      if (!base) throw new Error("Original orderNumber missing");

      const regex = new RegExp(`^${escapeRegExp(base)}-R(\\d+)$`, "i");
      const existing = await Order.find(
        { orderNumber: { $regex: regex } },
        { orderNumber: 1 },
      )
        .session(session)
        .lean();

      let maxN = 0;
      for (const x of existing) {
        const m = String(x.orderNumber || "").match(/-R(\d+)$/i);
        if (!m) continue;
        const n = Number(m[1]);
        if (Number.isFinite(n)) maxN = Math.max(maxN, n);
      }

      const nextN = maxN + 1;
      const newOrderNumber = `${base}-R${nextN}`;

      const incomingItems = Array.isArray(items) && items.length ? items : null;

      let normalizedItems = [];
      let subtotal = 0;

      if (!incomingItems) {
        // ✅ copy original items (snapshot based)
        normalizedItems = (original.items || []).map((it) => {
          const qty = Math.max(1, Number(it.quantity || 1));
          subtotal += Number(it.subtotal ?? Number(it.price || 0) * qty);

          return {
            ...(it?.toObject?.() ? it.toObject() : it),
            lineId: crypto.randomUUID(),
            fulfillment: { allocatedQty: 0, shippedQty: 0, toProduceQty: qty },
          };
        });
      } else {
        // ✅ build fresh snapshots from Product
        const productIds = [
          ...new Set(
            incomingItems.map((i) => str(i?.productId)).filter(Boolean),
          ),
        ];
        const bad = productIds.find((id) => !isObjectId(id));
        if (bad) throw new Error(`Invalid productId: ${bad}`);

        const products = await Product.find({ _id: { $in: productIds } })
          .session(session)
          .lean();

        const productMap = new Map(products.map((p) => [str(p._id), p]));

        for (const item of incomingItems) {
          const pid = str(item?.productId);
          if (!pid) throw new Error("productId missing");

          const qty = num(item?.quantity, 0);
          if (!Number.isFinite(qty) || qty < 1)
            throw new Error("Invalid quantity");

          const product = productMap.get(pid);
          if (!product) throw new Error("Product not found");

          const isVariable =
            product.productType === "variable" ||
            (Array.isArray(product.variants) && product.variants.length > 0);

          let variant = null;
          if (isVariable) {
            if (!item.variantId)
              throw new Error(`${product.title} - variantId missing`);
            variant = findVariantById(product, item.variantId);
            if (!variant)
              throw new Error(`${product.title} - variant not found`);
          }

          const { allocatedQty, toProduceQty } = computeAllocation({
            stock: variant ? variant.stock : product.stock,
            reservedStock: variant
              ? variant.reservedStock
              : product.reservedStock,
            qty,
          });

          const unitPrice = num(product.price, 0);
          const lineSubtotal = unitPrice * qty;

          subtotal += lineSubtotal;

          const attrs = normalizeVariantAttributes(variant);

          const selectedSize =
            pickAttr(attrs, ["size", "sizes", "shirt_size"]) ||
            getSizeFromSku(variant?.sku);

          const selectedColorRaw =
            pickAttr(attrs, ["color", "colour", "color_name"]) ||
            getColorFromSku(variant?.sku, product.productCode);

          const selectedColor = sanitizeSelectedColor(
            selectedColorRaw,
            product.productCode,
          );

          normalizedItems.push({
            lineId: crypto.randomUUID(),
            productModel: "Product",
            productId: oid(product._id),

            fulfillment: { allocatedQty, shippedQty: 0, toProduceQty },

            productSnapshot: {
              productCode: product.productCode || "",
              title: product.title,
              slug: product.slug || "",
              thumbnail: product.thumbnail || "",
              images: Array.isArray(product.images) ? product.images : [],
              productType:
                product.productType ||
                (product?.variants?.length ? "variable" : "simple"),
              sku: product.sku || "",
              tags: Array.isArray(product.tags) ? product.tags : [],
              hsnCode: str(product.hsnCode),
              weight: num(product.weight, 0),
              currency: product.currency || "INR",
            },

            variant: {
              variantId: variant?._id || null,
              sku: variant?.sku || "",
              attributes: attrs,
              weight: num(variant?.weight, 0),
            },

            selectedSize,
            selectedColor,
            quantity: qty,
            price: unitPrice,
            compareAtPrice: product?.compareAtPrice ?? null,
            subtotal: lineSubtotal,
          });
        }
      }

      // ✅ exchange order amounts
      const exchangeSubtotal = subtotal;
      const exchangeDiscount = 0;
      const exchangeShipping = 0;
      const exchangeTax = 0;
      const exchangeTotalAmount = exchangeSubtotal;
      const exchangeFinalPayable = 0;

      const [created] = await Order.create(
        [
          {
            customerId: original.customerId,
            shippingAddressSnapshot: original.shippingAddressSnapshot,
            billingAddressSnapshot: original.billingAddressSnapshot,

            items: normalizedItems,

            rmas: [
              {
                rmaNumber: rmaNumber || undefined,
                type: "exchange",
                status: "approved",
                items: normalizedItems.map((it, idx) => ({
                  orderLineId: it.lineId,
                  orderItemIndex: idx,
                  quantity: Number(it.quantity || 1),
                  productId: it.productId || null,
                  productCode: it?.productSnapshot?.productCode || "",
                  title: it?.productSnapshot?.title || "",
                  variantSku: it?.variant?.sku || "",
                })),
                reason,
                customerNote: str(customerNote),
                adminNote: str(adminNote),
                resolution,
                exchangeRequest: { note: "Replacement order created" },
                fee: { amount: 0, currency: "INR", status: "waived" },
              },
            ],

            subtotal: exchangeSubtotal,
            discount: exchangeDiscount,
            shippingFee: exchangeShipping,
            tax: exchangeTax,
            totalAmount: exchangeTotalAmount,
            finalPayable: exchangeFinalPayable,
            currency: original.currency || "INR",

            paymentMethod: "exchange",
            paymentStatus: "not_applicable",
            fulfillmentStatus: "processing",

            source: "manual",
            isGiftOrder: original.isGiftOrder || false,

            orderType: "shipment",
            parentOrderId: original._id,
            splitSuffix: `R${nextN}`,

            isConfirmed: true,
            confirmedAt: new Date(),
            confirmedBy: req.user?._id || null,

            adminRemarks: `exchange_replacement_of:${base}`,
            customerSupportRemark: original.customerSupportRemark || "",

            analytics: {
              ...(original.analytics || {}),
              couponApplied: false,
              creditsUsed: false,
              onlinePaymentDiscountApplied: false,
              onlinePaymentDiscountPct: 0,
              onlinePaymentDiscountAmount: 0,
            },

            orderNumber: newOrderNumber,
          },
        ],
        { session },
      );

      newOrderDoc = created;
    });

    const fresh = await Order.findById(newOrderDoc._id).lean();
    return res
      .status(201)
      .json({ message: "Exchange duplicate order created", order: fresh });
  } catch (e) {
    console.error("❌ duplicateExchangeOrder error:", e);
    return res
      .status(400)
      .json({ message: e.message || "Duplicate create failed" });
  } finally {
    session.endSession();
  }
};

/* ============================================================
   ✅ CONFIRM ORDER (ADMIN / COD)
   - sets isConfirmed + confirmedAt + confirmedBy
   - triggers Shiprocket booking
============================================================ */
export const confirmOrder = async (req, res) => {
  const session = await mongoose.startSession();

  const defer = (fn) => {
    if (typeof setImmediate === "function") return setImmediate(fn);
    return setTimeout(fn, 0);
  };

  const normalizeConfirmedBy = () => {
    const incoming = String(req.body?.confirmedBy || "")
      .trim()
      .toLowerCase();

    if (["admin", "customer"].includes(incoming)) return incoming;

    if (req.user?.role === "admin") return "admin";

    return "customer";
  };

  try {
    const orderId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    const confirmedBy = normalizeConfirmedBy();
    let updatedOrder = null;
    let shouldTriggerReserve = false;

    await session.withTransaction(async () => {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw new Error("Order not found");

      if (
        String(order.paymentMethod || "").toLowerCase() === "razorpay" &&
        String(order.paymentStatus || "").toLowerCase() !== "paid"
      ) {
        throw new Error("Cannot confirm Razorpay order before payment is paid");
      }

      if (order.isConfirmed) {
        updatedOrder = order;
        return;
      }

      order.isConfirmed = true;
      order.confirmedAt = new Date();
      order.confirmedBy = confirmedBy;

      await order.save({ session });

      updatedOrder = order;
      shouldTriggerReserve = true;
    });

    const finalOrder = await Order.findById(updatedOrder._id).lean();
    syncCustomerAnalyticsSafe(finalOrder?.customerId, "confirmOrder");

    if (finalOrder && shouldTriggerReserve) {
      const orderNumber = String(finalOrder?.orderNumber || "").trim();

      if (orderNumber) {
        defer(async () => {
          try {
            await reserveInventoryForOrderNumberInternal({
              orderNumber,
              allowedFulfillment: ["processing", "packed"],
              confirmedOnly: true,
              debug: true,
            });
          } catch (err) {
            console.error(
              "❌ [INVENTORY] Reserve failed:",
              err?.message || err,
            );
          }
        });
      }
    }

    return res.status(200).json({
      message: finalOrder?.isConfirmed
        ? "Order confirmed successfully"
        : "Order already confirmed",
      order: finalOrder,
    });
  } catch (error) {
    console.error("❌ Confirm Order Error:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

/* ============================================================
   UPDATE TRACKING
============================================================ */
export const updateTracking = async (req, res) => {
  try {
    const {
      trackingId,
      awb,
      courierName,
      trackingUrl,
      shippedAt,
      deliveredAt,
      expectedDelivery,
    } = req.body || {};

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (String(order?.orderType || "").toLowerCase() === "parent") {
      return res.status(400).json({
        message:
          "Tracking cannot be updated on parent order. Update shipment order (-A/-B) instead.",
        reason: "parent_order_blocked",
      });
    }

    const finalAwb = String(
      awb ??
      trackingId ??
      order?.shipment?.shiprocket?.awb ??
      order?.trackingDetails?.trackingId ??
      "",
    ).trim();
    const finalCourier = String(
      courierName ??
      order?.shipment?.shiprocket?.courierName ??
      order?.trackingDetails?.courierName ??
      "",
    ).trim();
    const finalUrl = String(
      trackingUrl ??
      order?.shipment?.shiprocket?.trackingUrl ??
      order?.trackingDetails?.trackingUrl ??
      "",
    ).trim();

    order.shipment =
      order.shipment && typeof order.shipment === "object"
        ? order.shipment
        : {};
    order.shipment.provider = order.shipment.provider || "shiprocket";
    order.shipment.shiprocket =
      order.shipment.shiprocket && typeof order.shipment.shiprocket === "object"
        ? order.shipment.shiprocket
        : {};

    if (finalAwb) order.shipment.shiprocket.awb = finalAwb;
    if (finalCourier) order.shipment.shiprocket.courierName = finalCourier;
    if (finalUrl) order.shipment.shiprocket.trackingUrl = finalUrl;

    order.trackingDetails = {
      ...(order.trackingDetails || {}),
      trackingId: finalAwb || order.trackingDetails?.trackingId,
      courierName: finalCourier || order.trackingDetails?.courierName,
      trackingUrl: finalUrl || order.trackingDetails?.trackingUrl,
      shippedAt: shippedAt ?? order.trackingDetails?.shippedAt,
      deliveredAt: deliveredAt ?? order.trackingDetails?.deliveredAt,
      expectedDelivery:
        expectedDelivery ?? order.trackingDetails?.expectedDelivery,
    };

    const curr = String(order.fulfillmentStatus || "").toLowerCase();
    const terminal = ["cancelled", "returned", "refunded"];

    const hasShippedSignal = Boolean(finalAwb) || shippedAt != null;
    if (hasShippedSignal) {
      if (
        !terminal.includes(curr) &&
        ["processing", "packed", "picked"].includes(curr)
      )
        order.fulfillmentStatus = "shipped";
      if (!order.shipment.status || order.shipment.status === "pending")
        order.shipment.status = "shipped";
      if (shippedAt && !order.shipment.shippedAt)
        order.shipment.shippedAt = new Date(shippedAt);
    }

    if (deliveredAt) {
      if (!terminal.includes(curr)) order.fulfillmentStatus = "delivered";
      order.shipment.status = "delivered";
      if (!order.shipment.deliveredAt)
        order.shipment.deliveredAt = new Date(deliveredAt);
      if (!order.trackingDetails.deliveredAt)
        order.trackingDetails.deliveredAt = new Date(deliveredAt);
    }

    await order.save();

    try {
      const customerEmail =
        order?.shippingAddressSnapshot?.email ||
        order?.billingAddressSnapshot?.email ||
        order?.customerId?.email ||
        order?.email;
      const customerName =
        order?.shippingAddressSnapshot?.fullName ||
        order?.shippingAddressSnapshot?.name ||
        order?.customerId?.name ||
        "Customer";
      if (customerEmail && (finalAwb || finalUrl)) {
        await Mailer.sendOrderTracking({
          to: customerEmail,
          name: customerName,
          awb: finalAwb,
          courierName: finalCourier || "—",
          trackingLink: finalUrl || "#",
          order,
        });
      }
    } catch (mailErr) {
      console.error("❌ Tracking mail error:", mailErr?.message || mailErr);
    }

    return res.status(200).json({ message: "Tracking updated", order });
  } catch (error) {
    console.error("❌ Tracking Update Error:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

/* ============================================================
   DELETE ORDER
============================================================ */
export const deleteOrder = async (req, res) => {
  try {
    const deletedOrder = await Order.findByIdAndDelete(req.params.id);
    if (!deletedOrder)
      return res.status(404).json({ message: "Order not found" });

    return res.status(200).json({ message: "Order deleted" });
  } catch (error) {
    console.error("❌ Delete Order Error:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

/* ============================================================
   ORDER ANALYTICS (ADMIN)
============================================================ */
export const getOrderAnalytics = async (req, res) => {
  try {
    const totalOrders = await Order.countDocuments();
    const totalRevenue = await Order.aggregate([
      { $group: { _id: null, sum: { $sum: "$finalPayable" } } },
    ]);

    const codOrders = await Order.countDocuments({ paymentMethod: "cod" });
    const prepaidOrders = await Order.countDocuments({
      paymentMethod: { $ne: "cod" },
    });

    return res.status(200).json({
      totalOrders,
      totalRevenue: totalRevenue[0]?.sum || 0,
      codOrders,
      prepaidOrders,
    });
  } catch (error) {
    console.error("❌ Analytics Error:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

export const getOrderByOrderNumber = async (req, res) => {
  try {
    const orderNumber = String(req.params.orderNumber || "").trim();
    if (!orderNumber)
      return res.status(400).json({ message: "orderNumber missing" });

    const order = await Order.findOne({ orderNumber })
      .populate("customerId", "name email phone")
      .populate("items.productId");

    if (!order) return res.status(404).json({ message: "Order not found" });
    return res.status(200).json(order);
  } catch (error) {
    console.error("❌ Fetch Order By Number Error:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// CANCEL ORDER
// ✅ IMPORTANT: Add these imports at top (adjust paths if needed)
// import InventoryReservation from "../InventoryReservation/InventoryReservation.js";
// import { releaseReservationInternalByOrder } from "../InventoryReservation/reservation.internal.js"; // optional helper (shown below)

export const cancelOrder = async (req, res) => {
  const session = await mongoose.startSession();
  const TAG = "❌[CANCEL_ORDER]";

  const str = (v) => (v == null ? "" : String(v));
  const norm = (v) => str(v).trim().toLowerCase();

  const stripUndefinedDeep = (obj) => {
    if (Array.isArray(obj)) return obj.map(stripUndefinedDeep);
    if (obj && typeof obj === "object") {
      const out = {};
      for (const [k, v] of Object.entries(obj)) {
        if (v === undefined) continue;
        out[k] = stripUndefinedDeep(v);
      }
      return out;
    }
    return obj;
  };

  const isAdminCancel = (reason) => norm(reason) === "cancelled_by_admin";

  const pickCancelReason = (req) => {
    const incoming = norm(req.body?.reason);

    if (incoming === "cancelled_by_admin" || incoming === "admin") {
      return "cancelled_by_admin";
    }

    if (incoming === "cancelled_by_customer" || incoming === "customer") {
      return "cancelled_by_customer";
    }

    const actor = norm(req.body?.cancelledBy);
    if (actor === "admin") return "cancelled_by_admin";
    if (actor === "customer") return "cancelled_by_customer";

    return req.user?.role === "admin"
      ? "cancelled_by_admin"
      : "cancelled_by_customer";
  };

  try {
    req.body = stripUndefinedDeep(req.body);

    const orderId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      console.log(`${TAG} Invalid orderId`);
      return res
        .status(400)
        .json({ success: false, message: "Invalid order id" });
    }

    const reason = pickCancelReason(req);
    console.log(`${TAG} Request received`, { orderId, reason });

    let cancelledOrderId = null;
    let releasedCount = 0;

    await session.withTransaction(async () => {
      let order = await Order.findById(orderId).session(session);
      if (!order) throw new Error("Order not found");

      const isParent = norm(order?.orderType) === "parent";

      const nonCancellableStatuses = [
        "picked",
        "shipped",
        "out_for_delivery",
        "delivered",
      ];

      if (nonCancellableStatuses.includes(norm(order.fulfillmentStatus))) {
        throw new Error("Order cannot be cancelled after pickup / shipment");
      }

      if (norm(order.fulfillmentStatus) === "cancelled") {
        cancelledOrderId = order._id;
        return;
      }

      if (!isParent) {
        const shipmentId = order?.shipment?.shiprocket?.shipmentId;

        if (shipmentId) {
          try {
            await cancelShiprocketShipment(shipmentId);
            console.log(`${TAG} ✅ Shiprocket cancellation successful`, {
              shipmentId,
            });
          } catch (err) {
            console.error(
              `${TAG} ⚠️ Shiprocket cancel failed`,
              err?.response?.data || err,
            );
          }
        }
      }

      const cancelResult = await cancelReservationsInternalByOrder({
        orderId: order._id,
        reason,
        nextStatus: "released",
        session,
      });

      releasedCount = Number(cancelResult?.count || 0);

      // ✅ refetch fresh order because reservation cancellation may update same order internally
      order = await Order.findById(orderId).session(session);
      if (!order)
        throw new Error("Order not found after reservation cancellation");

      if (
        norm(order.paymentMethod) === "razorpay" &&
        norm(order.paymentStatus) === "paid"
      ) {
        order.paymentStatus = "refund_pending";
      }

      order.fulfillmentStatus = "cancelled";

      if (!order.shipment || typeof order.shipment !== "object") {
        order.shipment = {};
      }
      order.shipment.status = "cancelled";

      if (isAdminCancel(reason)) {
        order.adminRemarks = "cancelled_by_admin";
        order.customerMessage = undefined;
      } else {
        order.customerMessage = "cancelled_by_customer";
        order.adminRemarks = undefined;
      }

      await order.save({ session });

      cancelledOrderId = order._id;

      console.log(`${TAG} ✅ Cancelled saved`, {
        orderId: cancelledOrderId,
        releasedCount,
      });
    });

    const finalOrder = cancelledOrderId
      ? await Order.findById(cancelledOrderId).lean()
      : null;

    return res.status(200).json({
      success: true,
      message:
        finalOrder?.fulfillmentStatus === "cancelled"
          ? "Order cancelled successfully"
          : "Order already cancelled",
      releasedReservations: releasedCount,
      order: finalOrder || null,
    });
  } catch (error) {
    console.error(`${TAG} ❌ Cancel Order Error`, error);
    return res.status(400).json({ success: false, message: error.message });
  } finally {
    console.log(`${TAG} Session ended`);
    session.endSession();
  }
};

async function performOrderCancellation({ orderId, reason = "", session }) {
  const order = await Order.findById(orderId).session(session);
  if (!order) throw new Error("Order not found");

  const currentStatus = String(order.fulfillmentStatus || "")
    .trim()
    .toLowerCase();

  // once packed / picked / shipped, reservation may already be consumed
  const nonCancellableStatuses = [
    "packed",
    "picked",
    "shipped",
    "out_for_delivery",
    "delivered",
  ];

  if (nonCancellableStatuses.includes(currentStatus)) {
    throw new Error(
      "Order cannot be cancelled after packing / pickup / shipment",
    );
  }

  // already cancelled -> no duplicate work
  if (currentStatus === "cancelled") {
    return order;
  }

  const isParent =
    String(order?.orderType || "")
      .trim()
      .toLowerCase() === "parent";
  const cancelReason = String(reason || "Order cancelled").trim();

  // cancel shipment if created
  if (!isParent) {
    const shipmentId = order?.shipment?.shiprocket?.shipmentId;
    if (shipmentId) {
      try {
        await cancelShiprocketShipment(shipmentId);
      } catch (err) {
        console.error(
          "⚠️ Shiprocket cancel failed:",
          err?.response?.data || err,
        );
      }
    }
  }

  // release pending / reserved reservations and reconcile to next needy order
  await cancelReservationsInternalByOrder({
    orderId: order._id,
    reason: `${cancelReason} | orderNumber=${order.orderNumber || ""}`,
    nextStatus: "released",
    session,
  });

  // prepaid cancelled -> mark refund pending
  if (
    String(order.paymentMethod || "").toLowerCase() === "razorpay" &&
    String(order.paymentStatus || "").toLowerCase() === "paid"
  ) {
    order.paymentStatus = "refund_pending";
  }

  order.fulfillmentStatus = "cancelled";

  if (!order.shipment || typeof order.shipment !== "object") {
    order.shipment = {};
  }
  order.shipment.status = "cancelled";

  order.adminRemarks = cancelReason;

  await order.save({ session });
  return order;
}

/**
 * Auto book Shiprocket once order is PACKED.
 * ✅ Fix included: prevents "shipment.xpressbees cast" from blocking shiprocket save
 * (even if you don't use xpressbees, old/undefined values can still fail validation)
 */
async function autoBookShiprocketForOrder(order) {
  const TAG = "🚀[AUTO-SHIPROCKET]";

  const clean = (value) => String(value ?? "").trim();
  const lower = (value) => clean(value).toLowerCase();
  const log = (message, data = "") => console.log(`${TAG} ${message}`, data);

  const scrubXpressbees = () => {
    if (!order?.shipment || typeof order.shipment !== "object") return;

    if (
      order.shipment.xpressbees === undefined ||
      (order.shipment.xpressbees !== null &&
        typeof order.shipment.xpressbees !== "object")
    ) {
      delete order.shipment.xpressbees;
    }
  };

  const ensureShipment = () => {
    if (!order.shipment || typeof order.shipment !== "object") {
      order.shipment = {};
    }

    if (
      !order.shipment.shiprocket ||
      typeof order.shipment.shiprocket !== "object"
    ) {
      order.shipment.shiprocket = {};
    }

    scrubXpressbees();
  };

  const saveOrder = async () => {
    scrubXpressbees();
    await order.save();
  };

  const saveShipmentDetails = async ({
    shipmentId = "",
    shiprocketOrderId = "",
    awb = "",
    courierName = "",
    trackingUrl = "",
  }) => {
    ensureShipment();

    const finalShipmentId =
      clean(shipmentId) ||
      clean(order.shipment.shipmentId) ||
      clean(order.shipment.shiprocket.shipmentId);

    const finalOrderId =
      clean(shiprocketOrderId) ||
      clean(order.shipment.orderId) ||
      clean(order.shipment.shiprocket.orderId);

    const finalAwb =
      clean(awb) ||
      clean(order.shipment.awb) ||
      clean(order.shipment.shiprocket.awb);

    const finalCourierName =
      clean(courierName) ||
      clean(order.shipment.courierName) ||
      clean(order.shipment.shiprocket.courierName);

    const finalTrackingUrl =
      clean(trackingUrl) ||
      clean(order.shipment.trackingUrl) ||
      clean(order.shipment.shiprocket.trackingUrl) ||
      (finalAwb
        ? `https://shiprocket.co/tracking/${encodeURIComponent(finalAwb)}`
        : "");

    const status = finalAwb ? "booked" : "processing";
    const now = new Date();

    order.shipment.provider = "shiprocket";
    order.shipment.status = status;
    order.shipment.shipmentId = finalShipmentId;
    order.shipment.orderId = finalOrderId;
    order.shipment.awb = finalAwb;
    order.shipment.courierName = finalCourierName;
    order.shipment.trackingUrl = finalTrackingUrl;

    order.shipment.shiprocket.shipmentId = finalShipmentId;
    order.shipment.shiprocket.orderId = finalOrderId;
    order.shipment.shiprocket.awb = finalAwb;
    order.shipment.shiprocket.courierName = finalCourierName;
    order.shipment.shiprocket.trackingUrl = finalTrackingUrl;
    order.shipment.shiprocket.status = status;
    order.shipment.shiprocket.lastUpdatedAt = now;

    order.trackingDetails = {
      ...(order.trackingDetails?.toObject?.() || order.trackingDetails || {}),
      provider: "shiprocket",
      trackingId: finalAwb,
      awb: finalAwb,
      courierName: finalCourierName,
      trackingUrl: finalTrackingUrl,
      lastUpdatedAt: now,
    };

    await saveOrder();
  };

  if (isParentOrder(order)) {
    return log("🚫 SKIP: parent order cannot be shipped", {
      orderNumber: order?.orderNumber,
    });
  }

  if (!order?.isConfirmed) {
    return log("🚫 SKIP: order not confirmed");
  }

  if (lower(order?.fulfillmentStatus) !== "packed") {
    return log("🚫 SKIP: order not packed", {
      orderNumber: order?.orderNumber,
      fulfillmentStatus: order?.fulfillmentStatus,
    });
  }

  try {
    log("START", {
      orderNumber: order?.orderNumber,
      orderId: order?._id?.toString(),
      paymentMethod: order?.paymentMethod,
      paymentStatus: order?.paymentStatus,
    });

    if (!clean(order?.shippingAddressSnapshot?.pincode)) {
      return log("❌ SKIP: shipping pincode missing");
    }

    if (!clean(process.env.SHIPROCKET_PICKUP_PINCODE)) {
      return log("❌ SKIP: SHIPROCKET_PICKUP_PINCODE missing");
    }

    if (!clean(process.env.SHIPROCKET_PICKUP_LOCATION)) {
      return log("❌ SKIP: SHIPROCKET_PICKUP_LOCATION missing");
    }

    if (
      lower(order?.paymentMethod) === "razorpay" &&
      lower(order?.paymentStatus) !== "paid"
    ) {
      return log("⏳ SKIP: Razorpay payment not paid");
    }

    ensureShipment();

    const existingAwb =
      clean(order.shipment.awb) || clean(order.shipment.shiprocket.awb);

    if (existingAwb) {
      await saveShipmentDetails({ awb: existingAwb });

      return log("✅ SKIP: AWB already exists", {
        awb: existingAwb,
      });
    }

    const existingShipmentId =
      clean(order.shipment.shipmentId) ||
      clean(order.shipment.shiprocket.shipmentId);

    if (existingShipmentId) {
      log("Shipment exists. Assigning AWB...", {
        shipmentId: existingShipmentId,
      });

      try {
        const assigned = await assignAwb(existingShipmentId);

        const awb = clean(
          assigned?.awb_code ||
          assigned?.awb ||
          assigned?.response?.data?.awb_code,
        );

        if (!awb) {
          return log("⚠️ Assign AWB response missing awb_code", {
            shipmentId: existingShipmentId,
            response: assigned,
          });
        }

        await saveShipmentDetails({
          shipmentId: existingShipmentId,
          awb,
          courierName:
            assigned?.courier_name ||
            assigned?.courierName ||
            assigned?.response?.data?.courier_name,
          trackingUrl:
            assigned?.tracking_url ||
            assigned?.trackingUrl ||
            assigned?.response?.data?.tracking_url,
        });

        return log("✅ AWB assigned and saved", {
          shipmentId: existingShipmentId,
          awb,
        });
      } catch (error) {
        return log("⚠️ Assign AWB failed", {
          shipmentId: existingShipmentId,
          message: error?.message,
          status: error?.response?.status,
          data: error?.response?.data,
        });
      }
    }

    const totalWeight =
      order.items?.reduce((total, item) => {
        const weight =
          Number(item?.variant?.weight) ||
          Number(item?.productSnapshot?.weight) ||
          0.5;

        return total + weight * Number(item?.quantity || 1);
      }, 0) || 0.5;

    const isCOD = lower(order?.paymentMethod) === "cod";

    const couriers = await checkServiceability({
      pickupPincode: clean(process.env.SHIPROCKET_PICKUP_PINCODE),
      deliveryPincode: clean(order.shippingAddressSnapshot.pincode),
      weight: totalWeight,
      cod: isCOD ? 1 : 0,
    });

    if (!Array.isArray(couriers) || !couriers.length) {
      return log("⚠️ SKIP: no courier available");
    }

    const payload = buildShiprocketPayload(order);

    payload.payment_method = isCOD ? "COD" : "Prepaid";
    payload.shipping_charges = Number(order.shippingFee || 0);
    payload.collectable_amount = isCOD ? Number(order.finalPayable || 0) : 0;

    if (payload.transaction_charges == null) {
      payload.transaction_charges = 0;
    }

    if (isCOD) {
      const expectedSubTotal = Math.max(
        0,
        Number(order.finalPayable || 0) -
        Number(order.shippingFee || 0) -
        Number(order.tax || 0),
      );

      if (
        Number.isFinite(expectedSubTotal) &&
        Math.abs(Number(payload.sub_total || 0) - expectedSubTotal) >= 1
      ) {
        payload.sub_total = expectedSubTotal;

        if (Array.isArray(payload.order_items) && payload.order_items.length) {
          const totalUnits =
            payload.order_items.reduce(
              (total, item) => total + Number(item.units || 0),
              0,
            ) || 1;

          const perUnit = Math.round(expectedSubTotal / totalUnits);

          payload.order_items = payload.order_items.map((item) => ({
            ...item,
            selling_price: String(perUnit),
            discount: "0",
          }));

          const calculatedTotal = payload.order_items.reduce(
            (total, item) =>
              total + Number(item.selling_price || 0) * Number(item.units || 0),
            0,
          );

          const difference = expectedSubTotal - calculatedTotal;
          const lastIndex = payload.order_items.length - 1;
          const lastItem = payload.order_items[lastIndex];
          const lastUnits = Number(lastItem.units || 1);

          payload.order_items[lastIndex] = {
            ...lastItem,
            selling_price: String(
              Math.max(
                0,
                Number(lastItem.selling_price || 0) +
                Math.round(difference / lastUnits),
              ),
            ),
          };
        }
      }
    }

    log("📦 Creating shipment...", {
      orderId: payload?.order_id,
      paymentMethod: payload?.payment_method,
      weight: payload?.weight || totalWeight,
      items: payload?.order_items?.length || 0,
    });

    const shipment = await createShipment(payload);

    const shipmentId = clean(
      shipment?.shipment_id ||
      shipment?.shipmentId ||
      shipment?.response?.data?.shipment_id,
    );

    const shiprocketOrderId = clean(
      shipment?.order_id ||
      shipment?.orderId ||
      shipment?.response?.data?.order_id,
    );

    let awb = clean(
      shipment?.awb_code || shipment?.awb || shipment?.response?.data?.awb_code,
    );

    if (!shipmentId) {
      return log("❌ FAIL: shipment_id missing", {
        response: shipment,
      });
    }

    await saveShipmentDetails({
      shipmentId,
      shiprocketOrderId,
      awb,
      courierName:
        shipment?.courier_name ||
        shipment?.courierName ||
        shipment?.response?.data?.courier_name,
      trackingUrl:
        shipment?.tracking_url ||
        shipment?.trackingUrl ||
        shipment?.response?.data?.tracking_url,
    });

    if (!awb) {
      try {
        const assigned = await assignAwb(shipmentId);

        awb = clean(
          assigned?.awb_code ||
          assigned?.awb ||
          assigned?.response?.data?.awb_code,
        );

        if (!awb) {
          log("⚠️ Assign AWB response missing awb_code", {
            shipmentId,
            response: assigned,
          });
        } else {
          await saveShipmentDetails({
            shipmentId,
            shiprocketOrderId,
            awb,
            courierName:
              assigned?.courier_name ||
              assigned?.courierName ||
              assigned?.response?.data?.courier_name,
            trackingUrl:
              assigned?.tracking_url ||
              assigned?.trackingUrl ||
              assigned?.response?.data?.tracking_url,
          });

          log("✅ AWB assigned and saved", {
            shipmentId,
            awb,
          });
        }
      } catch (error) {
        log("⚠️ Assign AWB failed", {
          shipmentId,
          message: error?.message,
          status: error?.response?.status,
          data: error?.response?.data,
        });
      }
    }

    log("END ✅", {
      orderNumber: order?.orderNumber,
      shipmentId:
        order.shipment?.shipmentId || order.shipment?.shiprocket?.shipmentId,
      awb: order.shipment?.awb || order.shipment?.shiprocket?.awb,
      status: order.shipment?.status,
    });
  } catch (error) {
    console.error(`${TAG} ❌ ERROR`, {
      message: error?.message,
      status: error?.response?.status,
      data: error?.response?.data,
      url: error?.config?.url,
    });
  }
}

// Admin trigger: Book Shiprocket only if details missing
// Route example: POST /admin/orders/:id/shiprocket/book
// Admin trigger: Book Shiprocket ONLY if missing
// Route: POST /admin/orders/:id/shiprocket/book
export const adminBookShiprocketIfMissing = async (req, res) => {
  const TAG = "🛠️[ADMIN-BOOK-SHIPROCKET]";

  // tiny helpers
  const str = (v) => (v == null ? "" : String(v));
  const low = (v) => str(v).trim().toLowerCase();
  const trim = (v) => str(v).trim();

  // ✅ Fix: if xpressbees (unused) is present as undefined/bad type, it can block order.save()
  const scrubXpressbees = (order) => {
    if (!order?.shipment || typeof order.shipment !== "object") return;
    if (order.shipment.xpressbees === undefined)
      delete order.shipment.xpressbees;
    else if (
      order.shipment.xpressbees != null &&
      typeof order.shipment.xpressbees !== "object"
    )
      delete order.shipment.xpressbees;
  };

  try {
    const orderId = req.params.id;

    /* ---------------- validate id ---------------- */
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid order id" });
    }

    /* ---------------- load order (Mongoose doc, not lean) ---------------- */
    const order = await Order.findById(orderId);
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    /* ---------------- guards ---------------- */
    if (isParentOrder(order)) {
      return res.status(400).json({
        success: false,
        message:
          "Parent order cannot be shipped. Create -A/-B shipment order first.",
        reason: "parent_order_blocked",
      });
    }

    if (!order.isConfirmed) {
      return res.status(400).json({
        success: false,
        message: "Order not confirmed. Confirm order first.",
        reason: "not_confirmed",
      });
    }

    if (low(order.fulfillmentStatus) !== "packed") {
      return res.status(400).json({
        success: false,
        message: "Shiprocket booking allowed only when order is packed.",
        reason: "not_packed",
        fulfillmentStatus: order.fulfillmentStatus,
      });
    }

    if (
      low(order.paymentMethod) === "razorpay" &&
      low(order.paymentStatus) !== "paid"
    ) {
      return res.status(400).json({
        success: false,
        message: "Razorpay order is not paid yet.",
        reason: "prepaid_not_paid",
      });
    }

    if (!trim(order?.shippingAddressSnapshot?.pincode)) {
      return res.status(400).json({
        success: false,
        message: "Shipping pincode missing in order.",
        reason: "missing_delivery_pincode",
      });
    }

    if (!trim(process.env.SHIPROCKET_PICKUP_PINCODE)) {
      return res.status(500).json({
        success: false,
        message: "SHIPROCKET_PICKUP_PINCODE missing in env.",
        reason: "missing_pickup_pincode_env",
      });
    }

    /* ---------------- already booked? ---------------- */
    const sr = order?.shipment?.shiprocket || {};
    const hasAwb = Boolean(trim(sr.awb));
    const hasShipmentId = Boolean(trim(sr.shipmentId));

    if (hasAwb || hasShipmentId) {
      return res.status(200).json({
        success: true,
        skipped: true,
        message: "Shiprocket already exists for this order. Skipping booking.",
        reason: hasAwb ? "awb_exists" : "shipmentId_exists",
        shiprocket: {
          shipmentId: trim(sr.shipmentId),
          awb: trim(sr.awb),
          courierName: trim(sr.courierName),
          trackingUrl: trim(sr.trackingUrl),
        },
        trackingDetails: {
          trackingId: trim(order?.trackingDetails?.trackingId),
          courierName: trim(order?.trackingDetails?.courierName),
          trackingUrl: trim(order?.trackingDetails?.trackingUrl),
        },
      });
    }

    /* ---------------- book now ---------------- */
    console.log(`${TAG} Booking Shiprocket...`, {
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      fulfillmentStatus: order.fulfillmentStatus,
    });

    // ✅ important: remove bad xpressbees before booking (prevents cast error on save)
    scrubXpressbees(order);

    // This function will set shipment.shiprocket fields & save
    await autoBookShiprocketForOrder(order);

    /* ---------------- fetch fresh view ---------------- */
    const fresh = await Order.findById(orderId).lean();
    const freshSr = fresh?.shipment?.shiprocket || {};

    return res.status(200).json({
      success: true,
      message:
        "Shiprocket booking triggered (only when packed and details were missing).",
      orderId: fresh?._id,
      orderNumber: fresh?.orderNumber,
      shiprocket: {
        shipmentId: trim(freshSr.shipmentId),
        awb: trim(freshSr.awb),
        courierName: trim(freshSr.courierName),
        trackingUrl: trim(freshSr.trackingUrl),
      },
      trackingDetails: {
        trackingId: trim(fresh?.trackingDetails?.trackingId),
        courierName: trim(fresh?.trackingDetails?.courierName),
        trackingUrl: trim(fresh?.trackingDetails?.trackingUrl),
      },
    });
  } catch (err) {
    console.error(`${TAG} ❌ error:`, err?.message || err);

    // ✅ helpful: show validation paths if any
    if (err?.name === "ValidationError") {
      console.error(`${TAG} Validation paths:`, Object.keys(err.errors || {}));
    }

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message || "unknown_error",
    });
  }
};


// ============================================================
// ADMIN: BOOK ORDER WITH DELHIVERY
// POST /api/orders/:id/delhivery/book
// ============================================================

export const adminBookDelhiveryIfMissing = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order id",
      });
    }

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (isParentOrder(order)) {
      return res.status(400).json({
        success: false,
        message: "Parent order cannot be shipped.",
      });
    }

    if (!order.isConfirmed) {
      return res.status(400).json({
        success: false,
        message: "Confirm order before booking.",
      });
    }

    if (
      String(order.fulfillmentStatus || "")
        .trim()
        .toLowerCase() !== "packed"
    ) {
      return res.status(400).json({
        success: false,
        message: "Only packed orders can be booked.",
      });
    }

    if (
      String(order.paymentMethod || "")
        .trim()
        .toLowerCase() === "razorpay" &&
      String(order.paymentStatus || "")
        .trim()
        .toLowerCase() !== "paid"
    ) {
      return res.status(400).json({
        success: false,
        message: "Prepaid order is not paid.",
      });
    }

    const currentProvider = String(
      order?.shipment?.provider || "",
    )
      .trim()
      .toLowerCase();

    const currentAwb = String(
      order?.shipment?.awb || "",
    ).trim();

    const currentCourierName = String(
      order?.shipment?.courierName || "",
    ).trim();

    const existingWaybill = String(
      order?.shipment?.delhivery?.waybill || "",
    ).trim();

    // Only prevent duplicate active Delhivery booking.
    // Existing Shiprocket booking can be replaced as active provider.
    if (currentProvider === "delhivery" && existingWaybill) {
      return res.status(200).json({
        success: true,
        skipped: true,
        message: "Delhivery shipment already booked.",
        waybill: existingWaybill,
      });
    }

    const previousShipment =
      currentProvider && currentProvider !== "delhivery"
        ? {
          provider: currentProvider,
          awb: currentAwb,
          courierName: currentCourierName,
          orderId: String(order?.shipment?.orderId || ""),
          shipmentId: String(order?.shipment?.shipmentId || ""),
          trackingUrl: String(
            order?.shipment?.trackingUrl || "",
          ),
          status: String(
            order?.shipment?.status || "",
          ),
          changedAt: new Date(),
        }
        : null;

    const address = order.shippingAddressSnapshot || {};

    const quantity = (order.items || []).reduce(
      (sum, item) =>
        sum + Math.max(1, Number(item?.quantity || 1)),
      0,
    );

    const productDescription = (order.items || [])
      .map((item) => item?.productSnapshot?.title)
      .filter(Boolean)
      .join(", ");

    const pincode = String(address?.pincode || "")
      .replace(/\D/g, "")
      .slice(0, 6);

    if (!/^\d{6}$/.test(pincode)) {
      return res.status(400).json({
        success: false,
        message: "Valid shipping pincode is required.",
      });
    }

    const serviceability =
      await checkDelhiveryServiceability(pincode);

    const isCod =
      String(order.paymentMethod || "")
        .trim()
        .toLowerCase() === "cod";

    const canBook = isCod
      ? serviceability?.codAvailable === true
      : serviceability?.prepaidAvailable === true;

    if (
      serviceability?.serviceable !== true ||
      !canBook
    ) {
      return res.status(400).json({
        success: false,
        message: isCod
          ? "Delhivery COD is unavailable for this pincode."
          : "Delhivery prepaid delivery is unavailable for this pincode.",
      });
    }

    const result = await createDelhiveryShipment({
      customerName: address.fullName,
      address: [address.line1, address.line2]
        .filter(Boolean)
        .join(", "),
      city: address.city,
      state: address.state,
      pincode,
      phone: address.phone,

      orderNumber: order.orderNumber,
      paymentMode: isCod ? "COD" : "Prepaid",
      totalAmount: Number(order.finalPayable || 0),
      quantity: quantity || 1,
      productDescription:
        productDescription || "OATCLUB Clothing",

      weight: Number(req.body?.weight || 500),
      length: Number(req.body?.length || 25),
      width: Number(req.body?.width || 20),
      height: Number(req.body?.height || 5),
    });

    const packageData =
      result?.packages?.[0] ||
      result?.data?.packages?.[0] ||
      result?.shipment?.[0] ||
      {};

    const waybill = String(
      packageData?.waybill ||
      packageData?.wbn ||
      result?.waybill ||
      result?.upload_wbn ||
      "",
    ).trim();

    if (!waybill) {
      return res.status(502).json({
        success: false,
        message: "Delhivery did not return a waybill.",
        data: result,
      });
    }

    const trackingUrl = String(
      packageData?.tracking_url ||
      result?.tracking_url ||
      "",
    ).trim();

    const now = new Date();

    const existingShipment =
      order.shipment?.toObject?.() ||
      order.shipment ||
      {};

    const existingDelhivery =
      order.shipment?.delhivery?.toObject?.() ||
      order.shipment?.delhivery ||
      {};

    const existingHistory = Array.isArray(
      existingShipment?.history,
    )
      ? existingShipment.history
      : [];

    order.shipment = {
      ...existingShipment,

      provider: "delhivery",
      orderId: String(order.orderNumber),
      shipmentId: waybill,
      awb: waybill,
      courierName: "Delhivery",
      trackingUrl,
      labelUrl: "",
      status: "booked",
      rawStatus: packageData?.status || "booked",
      bookedAt: now,
      lastSyncedAt: now,

      history: previousShipment
        ? [...existingHistory, previousShipment]
        : existingHistory,

      delhivery: {
        ...existingDelhivery,

        orderId: String(order.orderNumber),
        shipmentId: waybill,
        waybill,
        awb: waybill,
        courierName: "Delhivery",
        trackingUrl,
        labelUrl: "",
        status: "booked",
        rawStatus: packageData?.status || "booked",
        bookedAt: now,
        lastSyncedAt: now,
        rawBookingResponse: result,
      },
    };

    order.trackingDetails = {
      ...(order.trackingDetails?.toObject?.() ||
        order.trackingDetails ||
        {}),

      trackingId: waybill,
      awb: waybill,
      provider: "delhivery",
      courierName: "Delhivery",
      trackingUrl,
      shippedAt: null,
      lastUpdatedAt: now,
    };

    order.markModified("shipment");
    order.markModified("trackingDetails");

    await order.save();

    const providerChanged =
      Boolean(previousShipment) &&
      previousShipment.provider !== "delhivery";

    return res.status(201).json({
      success: true,

      message: providerChanged
        ? `Courier provider changed from ${previousShipment.provider} to Delhivery.`
        : "Delhivery shipment booked successfully.",

      providerChanged,

      previousShipment: previousShipment
        ? {
          provider: previousShipment.provider,
          awb: previousShipment.awb,
          courierName: previousShipment.courierName,
        }
        : null,

      data: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        provider: "delhivery",
        waybill,
        awb: waybill,
        courierName: "Delhivery",
        trackingUrl,
        status: "booked",
      },
    });
  } catch (error) {
    console.error("❌ Delhivery booking error:", {
      message: error?.message,
      response: error?.response?.data,
      stack: error?.stack,
    });

    return res
      .status(error?.response?.status || 500)
      .json({
        success: false,
        message:
          error?.response?.data?.message ||
          error?.message ||
          "Delhivery booking failed",
        error: error?.response?.data || null,
      });
  }
};
/* ============================================================
   UPDATE ADDRESS SNAPSHOT (ADMIN)
   PATCH /api/orders/:id/address
   body: { type: "shipping"|"billing", address: {...} }
============================================================ */
export const updateOrderAddress = async (req, res) => {
  try {
    const orderId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    const { type, address } = req.body || {};
    const targetType = String(type || "")
      .trim()
      .toLowerCase();

    if (!["shipping", "billing"].includes(targetType)) {
      return res
        .status(400)
        .json({ message: "Invalid type. Allowed: shipping | billing" });
    }

    if (!address || typeof address !== "object") {
      return res.status(400).json({ message: "address object missing" });
    }

    // ✅ Basic sanitizers
    const str = (v) => (v == null ? "" : String(v)).trim();
    const cleanPhone = (v) =>
      str(v)
        .replace(/[^\d+]/g, "")
        .replace(/^\+/, "");
    const cleanPincode = (v) => str(v).replace(/[^\d]/g, "");

    const nextSnapshot = {
      fullName: str(address.fullName),
      line1: str(address.line1),
      line2: str(address.line2),
      city: str(address.city),
      state: str(address.state),
      pincode: cleanPincode(address.pincode),
      phone: cleanPhone(address.phone),
      // keep optional fields if you store them in snapshot:
      email: str(address.email),
      country: str(address.country),
    };

    // ✅ Minimal validations
    if (
      !nextSnapshot.fullName ||
      !nextSnapshot.line1 ||
      !nextSnapshot.city ||
      !nextSnapshot.state ||
      !nextSnapshot.pincode
    ) {
      return res.status(400).json({
        message:
          "Required fields missing (fullName, line1, city, state, pincode)",
      });
    }

    // ✅ pincode sanity (India)
    if (nextSnapshot.pincode && nextSnapshot.pincode.length !== 6) {
      return res.status(400).json({ message: "Invalid pincode" });
    }

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });

    // 🚫 Guard: once shipped/picked/out_for_delivery/delivered -> don't allow address change
    const blockedStatuses = [
      "picked",
      "shipped",
      "out_for_delivery",
      "delivered",
      "returned",
    ];
    if (blockedStatuses.includes(order.fulfillmentStatus)) {
      return res.status(400).json({
        message: `Address cannot be updated after order is ${order.fulfillmentStatus}`,
      });
    }

    // 🚫 Guard: if Shiprocket shipment already created, usually address should NOT change
    const srShipmentId = order?.shipment?.shiprocket?.shipmentId;
    const srAwb = order?.shipment?.shiprocket?.awb;
    if (srShipmentId || srAwb) {
      return res.status(400).json({
        message:
          "Shiprocket shipment already created. Address update is locked.",
        reason: "shiprocket_locked",
      });
    }

    // ✅ Optional: keep history
    order.addressEditLogs = Array.isArray(order.addressEditLogs)
      ? order.addressEditLogs
      : [];
    order.addressEditLogs.push({
      type: targetType,
      updatedAt: new Date(),
      // adminId: req.user?._id || null, // if auth middleware exists
      previous:
        targetType === "shipping"
          ? order.shippingAddressSnapshot
          : order.billingAddressSnapshot,
      next: nextSnapshot,
    });

    if (targetType === "shipping") order.shippingAddressSnapshot = nextSnapshot;
    if (targetType === "billing") order.billingAddressSnapshot = nextSnapshot;

    await order.save();

    return res.status(200).json({ message: "Address updated", order });
  } catch (error) {
    console.error("❌ Update Address Error:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

/* ============================================================
   ✅ LOOKUP ORDERS BY EMAIL / PHONE  (for Customer Support)
   Route: GET /api/orders/lookup?email=&phone=
   - searches in shipping/billing snapshots + coupon/analytics identity
   - returns latest first (and priority rank if you want)
   - includes enough fields for support panel
============================================================ */

export const lookupOrdersByIdentity = async (req, res) => {
  try {
    const str = (v) => (v == null ? "" : String(v));
    const normEmail = (v) => str(v).trim().toLowerCase();
    const normPhone = (v) =>
      str(v)
        .replace(/[^\d+]/g, "")
        .trim()
        .replace(/^\+/, "");

    const email = normEmail(req.query.email);
    const phone = normPhone(req.query.phone);

    if (!email && !phone) {
      return res.status(400).json({ message: "email or phone required" });
    }

    // build identities (matches your createOrder analytics.couponIdentity style)
    const identities = [];
    if (email && email.includes("@")) identities.push(`email:${email}`);
    if (phone) identities.push(`phone:${phone}`);

    // escape for regex contains search (fallback)
    const escapeRegExp = (s) =>
      String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rxEmail = email ? new RegExp(`^${escapeRegExp(email)}$`, "i") : null;
    const rxPhone = phone ? new RegExp(`^${escapeRegExp(phone)}$`, "i") : null;

    const or = [];

    // ✅ primary: snapshot exact matches (case-insensitive for email)
    if (email) {
      or.push(
        { "shippingAddressSnapshot.email": rxEmail },
        { "billingAddressSnapshot.email": rxEmail },
      );
    }
    if (phone) {
      or.push(
        { "shippingAddressSnapshot.phone": phone },
        { "billingAddressSnapshot.phone": phone },
      );
    }

    // ✅ coupon / analytics identity matches
    if (identities.length) {
      or.push(
        { "coupon.identity": { $in: identities } },
        { "analytics.couponIdentity": { $in: identities } },
      );
    }

    // ✅ optional fallback: if your phone snapshots sometimes store +91 etc
    // do a "contains digits" regex (kept small to avoid slow scans)
    if (phone && phone.length >= 8) {
      const rxDigits = new RegExp(escapeRegExp(phone.slice(-10))); // last 10
      or.push(
        { "shippingAddressSnapshot.phone": rxDigits },
        { "billingAddressSnapshot.phone": rxDigits },
      );
    }

    // If somehow no OR built (shouldn’t happen), guard
    if (!or.length) {
      return res.status(400).json({ message: "Invalid lookup query" });
    }

    // ✅ Query with priority rank sort like your getAllOrders
    const orders = await Order.aggregate([
      { $match: { $or: or } },
      {
        $addFields: {
          _priorityRank: {
            $switch: {
              branches: [
                { case: { $eq: ["$priority", "high"] }, then: 3 },
                { case: { $eq: ["$priority", "medium"] }, then: 2 },
                { case: { $eq: ["$priority", "normal"] }, then: 1 },
              ],
              default: 1,
            },
          },
        },
      },
      { $sort: { createdAt: -1, _priorityRank: -1 } }, // latest first (support wants latest)
      { $limit: 50 },
      {
        $project: {
          // keep payload light but useful for support panel
          orderNumber: 1,
          createdAt: 1,
          orderDate: 1,
          priority: 1,

          paymentMethod: 1,
          paymentStatus: 1,
          fulfillmentStatus: 1,
          isConfirmed: 1,

          subtotal: 1,
          discount: 1,
          shippingFee: 1,
          tax: 1,
          totalAmount: 1,
          finalPayable: 1,
          currency: 1,

          shippingAddressSnapshot: 1,
          billingAddressSnapshot: 1,

          trackingDetails: 1,
          shipment: 1,

          items: 1,
          rmas: 1,
        },
      },
    ]);

    // if you want customer details too (optional):
    // const populated = await Order.populate(orders, [
    //   { path: "customerId", select: "name email phone" },
    //   { path: "items.productId" },
    // ]);

    return res.status(200).json({ orders });
  } catch (error) {
    console.error("❌ lookupOrdersByIdentity Error:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

export const getProductOrderCount = async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();

    if (!q) {
      return res.status(400).json({
        success: false,
        message: "q is required",
      });
    }

    const escapeRegex = (s = "") =>
      String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const rx = new RegExp(escapeRegex(q), "i");

    const match = {
      isConfirmed: true, // recommended
      $or: [
        { "items.productSnapshot.title": rx },
        { "items.productSnapshot.productCode": rx },
      ],
    };

    const totalOrders = await Order.countDocuments(match);

    return res.status(200).json({
      success: true,
      query: q,
      totalOrders,
    });
  } catch (error) {
    console.error("❌ getProductOrderCount Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

export const searchProductOrderNumbers = async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();

    if (!q) {
      return res.status(400).json({
        success: false,
        message: "q is required",
      });
    }

    const escapeRegex = (value = "") =>
      String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const rx = new RegExp(escapeRegex(q), "i");

    const orders = await Order.find({
      isConfirmed: true,
      $or: [
        { "items.productSnapshot.title": rx },
        { "items.productSnapshot.productCode": rx },
      ],
    })
      .select({
        orderNumber: 1,
        orderDate: 1,

        fulfillmentStatus: 1,
        paymentMethod: 1,
        paymentStatus: 1,

        shippingAddressSnapshot: 1,
        items: 1,

        finalPayable: 1,
        currency: 1,
      })
      .sort({ orderDate: -1 })
      .lean();

    const groupedOrders = {};
    const flatOrders = [];

    for (const order of orders) {
      const matchingItems = (order.items || []).filter((item) => {
        const productName = String(
          item?.productSnapshot?.title || "",
        );

        const productCode = String(
          item?.productSnapshot?.productCode || "",
        );

        return rx.test(productName) || rx.test(productCode);
      });

      if (!matchingItems.length) continue;

      const matchedProducts = matchingItems.map((item) => ({
        productId: item?.productId || null,

        productCode:
          item?.productSnapshot?.productCode || "",

        productName:
          item?.productSnapshot?.title || "",

        sku:
          item?.variant?.sku ||
          item?.productSnapshot?.sku ||
          "",

        size:
          item?.selectedSize ||
          (item?.variant?.attributes || []).find((attribute) =>
            ["size", "sizes"].includes(
              String(attribute?.key || "")
                .trim()
                .toLowerCase(),
            ),
          )?.value ||
          "",

        color:
          item?.selectedColor ||
          (item?.variant?.attributes || []).find((attribute) =>
            ["color", "colour"].includes(
              String(attribute?.key || "")
                .trim()
                .toLowerCase(),
            ),
          )?.value ||
          "",

        quantity: Number(item?.quantity || 0),
        price: Number(item?.price || 0),
        subtotal: Number(item?.subtotal || 0),
      }));

      const productNames = [
        ...new Set(
          matchedProducts
            .map((product) => product.productName)
            .filter(Boolean),
        ),
      ];

      const productCodes = [
        ...new Set(
          matchedProducts
            .map((product) => product.productCode)
            .filter(Boolean),
        ),
      ];

      const sizes = [
        ...new Set(
          matchedProducts
            .map((product) => product.size)
            .filter(Boolean),
        ),
      ];

      const status = String(
        order.fulfillmentStatus || "unknown",
      )
        .trim()
        .toLowerCase();

      const formattedOrder = {
        orderId: order._id,
        orderNumber: order.orderNumber || "",
        orderDate: order.orderDate || null,

        name:
          order.shippingAddressSnapshot?.fullName || "",

        city:
          order.shippingAddressSnapshot?.city || "",

        state:
          order.shippingAddressSnapshot?.state || "",

        paymentMethod:
          order.paymentMethod || "",

        paymentStatus:
          order.paymentStatus || "",

        fulfillmentStatus: status,

        finalPayable:
          Number(order.finalPayable || 0),

        currency:
          order.currency || "INR",

        // Convenient flat values for table/CSV
        productName: productNames.join(", "),
        productCode: productCodes.join(", "),
        size: sizes.join(", "),

        // Complete matched item details
        matchedProducts,
      };

      if (!groupedOrders[status]) {
        groupedOrders[status] = [];
      }

      groupedOrders[status].push(formattedOrder);
      flatOrders.push(formattedOrder);
    }

    const orderNumbers = [
      ...new Set(
        flatOrders
          .map((order) => order.orderNumber)
          .filter(Boolean),
      ),
    ];

    const summary = Object.entries(groupedOrders).map(
      ([fulfillmentStatus, statusOrders]) => ({
        fulfillmentStatus,
        totalOrders: statusOrders.length,

        totalQuantity: statusOrders.reduce(
          (total, order) =>
            total +
            order.matchedProducts.reduce(
              (quantity, product) =>
                quantity + Number(product.quantity || 0),
              0,
            ),
          0,
        ),
      }),
    );

    return res.status(200).json({
      success: true,
      query: q,

      totalOrders: flatOrders.length,
      orderNumbers,

      summary,
      groupedOrders,

      // Also returned for simple table rendering
      orders: flatOrders,
    });
  } catch (error) {
    console.error(
      "❌ searchProductOrderNumbers error:",
      error,
    );

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/* ------------------------------------------------------------------
   GET /api/orders/location/search?state=Delhi&pincode=110019&page=1&limit=50
   - state only
   - pincode only
   - dono saath
   - shipping + billing dono me match karega
------------------------------------------------------------------- */

const safe = (v) => String(v ?? "").trim();

const parseIntSafe = (v, d) => {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};

const escapeRegex = (s = "") =>
  String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const rx = (v) => new RegExp(`^${escapeRegex(safe(v))}$`, "i");

export const findOrdersByStateAndPincode = async (req, res) => {
  try {
    const {
      state = "",
      pincode = "",
      page = 1,
      limit = 50,
      fulfillmentStatus = "",
      paymentMethod = "",
      isConfirmed,
      search = "",
    } = req.query;

    const pageNum = parseIntSafe(page, 1);
    const limitNum = Math.min(parseIntSafe(limit, 50), 500);
    const skip = (pageNum - 1) * limitNum;

    const filters = {};

    /* ---------------- state / pincode filters ---------------- */
    const locationAnd = [];

    if (safe(state)) {
      locationAnd.push({
        $or: [
          { "shippingAddressSnapshot.state": rx(state) },
          { "billingAddressSnapshot.state": rx(state) },
        ],
      });
    }

    if (safe(pincode)) {
      locationAnd.push({
        $or: [
          { "shippingAddressSnapshot.pincode": safe(pincode) },
          { "billingAddressSnapshot.pincode": safe(pincode) },
        ],
      });
    }

    if (locationAnd.length) {
      filters.$and = locationAnd;
    }

    /* ---------------- optional extra filters ---------------- */
    if (safe(fulfillmentStatus)) {
      filters.fulfillmentStatus = safe(fulfillmentStatus).toLowerCase();
    }

    if (safe(paymentMethod)) {
      filters.paymentMethod = safe(paymentMethod).toLowerCase();
    }

    if (isConfirmed !== undefined && String(isConfirmed).trim() !== "") {
      const val = String(isConfirmed).trim().toLowerCase();
      filters.isConfirmed = ["true", "1", "yes"].includes(val);
    }

    /* ---------------- optional text search ---------------- */
    if (safe(search)) {
      const searchRegex = new RegExp(escapeRegex(search), "i");

      filters.$and = [
        ...(filters.$and || []),
        {
          $or: [
            { orderNumber: searchRegex },
            { "shippingAddressSnapshot.fullName": searchRegex },
            { "shippingAddressSnapshot.phone": searchRegex },
            { "shippingAddressSnapshot.email": searchRegex },
            { "shippingAddressSnapshot.city": searchRegex },
            { "shippingAddressSnapshot.state": searchRegex },
            { "shippingAddressSnapshot.pincode": searchRegex },
            { "billingAddressSnapshot.fullName": searchRegex },
            { "billingAddressSnapshot.phone": searchRegex },
            { "billingAddressSnapshot.email": searchRegex },
            { "billingAddressSnapshot.city": searchRegex },
            { "billingAddressSnapshot.state": searchRegex },
            { "billingAddressSnapshot.pincode": searchRegex },
          ],
        },
      ];
    }

    const [orders, total] = await Promise.all([
      Order.find(filters)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .select({
          orderNumber: 1,
          createdAt: 1,
          customerId: 1,
          shippingAddressSnapshot: 1,
          billingAddressSnapshot: 1,
          paymentMethod: 1,
          paymentStatus: 1,
          fulfillmentStatus: 1,
          isConfirmed: 1,
          finalPayable: 1,
          totalAmount: 1,
          items: 1,
        })
        .populate("customerId", "name email phone")
        .lean(),

      Order.countDocuments(filters),
    ]);

    return res.status(200).json({
      success: true,
      message: "Orders fetched successfully",
      filters: {
        state: safe(state),
        pincode: safe(pincode),
        fulfillmentStatus: safe(fulfillmentStatus),
        paymentMethod: safe(paymentMethod),
        isConfirmed:
          isConfirmed !== undefined && String(isConfirmed).trim() !== ""
            ? filters.isConfirmed
            : undefined,
        search: safe(search),
      },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.max(1, Math.ceil(total / limitNum)),
        hasNextPage: skip + orders.length < total,
        hasPrevPage: pageNum > 1,
      },
      orders,
    });
  } catch (error) {
    console.error("findOrdersByStateAndPincode error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch orders by state/pincode",
      error: error.message,
    });
  }
};

export const getDuplicateOrderAlerts = async (req, res) => {
  try {
    const result = await detectDuplicateOrders();

    return res.status(200).json({
      ok: true,
      message: "Duplicate order scan completed",
      ...result,
    });
  } catch (error) {
    console.error("getDuplicateOrderAlerts error:", error);
    return res.status(500).json({
      ok: false,
      message: "Failed to detect duplicate orders",
      error: error.message,
    });
  }
};

export const markDuplicateOrderAlertsController = async (req, res) => {
  try {
    const result = await markDuplicateOrderAlerts();

    return res.status(200).json({
      ok: true,
      message: "Duplicate alerts marked successfully",
      ...result,
    });
  } catch (error) {
    console.error("markDuplicateOrderAlertsController error:", error);
    return res.status(500).json({
      ok: false,
      message: "Failed to mark duplicate order alerts",
      error: error.message,
    });
  }
};

/* ============================================================
   UPDATE ORDER PAYMENT STATUS ONLY
============================================================ */
/* ============================================================
   UPDATE ORDER PAYMENT STATUS ONLY
============================================================ */

export const updateOrderPaymentStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const paymentStatus = String(
      req.body?.paymentStatus || "",
    )
      .trim()
      .toLowerCase();

    const allowedStatuses = [
      "pending",
      "paid",
      "failed",
      "refunded",
      "refund_pending",
      "not_applicable",
    ];

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order id",
      });
    }

    if (!allowedStatuses.includes(paymentStatus)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment status",
        allowedStatuses,
      });
    }

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const previousPaymentStatus = String(
      order.paymentStatus || "",
    )
      .trim()
      .toLowerCase();

    const paymentMethod = String(
      order.paymentMethod || "",
    )
      .trim()
      .toLowerCase();

    const statusActuallyChanged =
      previousPaymentStatus !== paymentStatus;

    order.paymentStatus = paymentStatus;

    // Razorpay paid → auto confirm
    if (
      paymentStatus === "paid" &&
      paymentMethod === "razorpay"
    ) {
      order.isConfirmed = true;
      order.confirmedAt =
        order.confirmedAt || new Date();
      order.confirmedBy =
        order.confirmedBy || "auto";

      order.razorpay = order.razorpay || {};

      if (!order.razorpay.paidAt) {
        order.razorpay.paidAt = new Date();
      }
    }

    // Refunded status sync
    if (paymentStatus === "refunded") {
      order.fulfillmentStatus = "refunded";
    }

    const updatedOrder = await order.save();

    await creditOrderWalletRewardInternal({
      orderId: updatedOrder._id,
    }).catch((error) => {
      console.error(
        "⚠️ Wallet reward credit failed:",
        error?.message || error,
      );
    });

    syncCustomerAnalyticsSafe(
      updatedOrder.customerId,
      "updateOrderPaymentStatus",
    );

    const isCancelled =
      updatedOrder?.cancellation?.isCancelled === true ||
      String(
        updatedOrder?.fulfillmentStatus || "",
      ).toLowerCase() === "cancelled";

    const shouldSendPaymentRecoveryEmail =
      statusActuallyChanged &&
      paymentStatus === "failed" &&
      ["razorpay", "manual_prepaid"].includes(
        paymentMethod,
      ) &&
      !isCancelled;

    const shouldSendPaymentPendingWhatsapp =
      statusActuallyChanged &&
      ["pending", "failed"].includes(
        paymentStatus,
      ) &&
      ["razorpay", "manual_prepaid"].includes(
        paymentMethod,
      ) &&
      !isCancelled;

    const shouldSendPaymentConfirmedWhatsapp =
      statusActuallyChanged &&
      paymentStatus === "paid" &&
      paymentMethod !== "cod" &&
      !isCancelled;

    const orderPayload =
      updatedOrder.toObject?.() || updatedOrder;

    if (shouldSendPaymentRecoveryEmail) {
      triggerPaymentRecoveryEmail(updatedOrder);

      console.log(
        "📩 Payment recovery email triggered:",
        {
          orderNumber: updatedOrder.orderNumber,
          previousPaymentStatus,
          paymentStatus,
          paymentMethod,
        },
      );
    }

    if (shouldSendPaymentPendingWhatsapp) {
      triggerFast2SmsSafe({
        type: "payment_pending",
        order: orderPayload,
        paymentStatus,
      });
    }

    if (shouldSendPaymentConfirmedWhatsapp) {
      triggerFast2SmsSafe({
        type: "payment_confirmed",
        order: orderPayload,
      });
    }

    return res.status(200).json({
      success: true,
      message:
        "Payment status updated successfully",
      order: updatedOrder,

      paymentRecoveryEmailTriggered:
        shouldSendPaymentRecoveryEmail,

      paymentPendingWhatsappTriggered:
        shouldSendPaymentPendingWhatsapp,

      paymentConfirmedWhatsappTriggered:
        shouldSendPaymentConfirmedWhatsapp,
    });
  } catch (error) {
    console.error(
      "❌ Update Payment Status Error:",
      error,
    );

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/* ============================================================
   GET ORDER CONFIRMATION DETAILS
   - supports order _id OR orderNumber
============================================================ */
export const getOrderConfirmationDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const query = mongoose.Types.ObjectId.isValid(String(id))
      ? { _id: id }
      : { orderNumber: String(id).trim() };

    const order = await Order.findOne(query)
      .select(
        "orderNumber isConfirmed confirmedBy confirmedAt paymentMethod fulfillmentStatus cancellation",
      )
      .lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const confirmedAtIST = order.confirmedAt
      ? new Date(order.confirmedAt).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })
      : null;

    return res.status(200).json({
      success: true,
      message: "Confirmation details fetched successfully",
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber,

        isConfirmed: order.isConfirmed === true,
        confirmedBy: order.confirmedBy || null,
        confirmedAt: order.confirmedAt || null,
        confirmedAtIST,

        paymentMethod: order.paymentMethod || null,
        fulfillmentStatus: order.fulfillmentStatus || null,

        isCancelled: order?.cancellation?.isCancelled === true,
        cancelledAt: order?.cancellation?.cancelledAt || null,
        cancelledBy: order?.cancellation?.cancelledBy || null,
      },
    });
  } catch (error) {
    console.error("❌ Get Confirmation Details Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// ========================================================================================
// ✅ GET ORDERS DASHBOARD SUMMARY - FAST AGGREGATED
// Route: GET /api/orders/dashboard
// ========================================================================================
export const getOrdersDashboard = async (req, res) => {
  try {
    const now = new Date();

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

    const last7Start = new Date(startOfToday);
    last7Start.setDate(last7Start.getDate() - 6);

    const last14Start = new Date(startOfToday);
    last14Start.setDate(last14Start.getDate() - 13);

    const thisWeekStart = new Date(startOfToday);
    thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay());

    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const COUNTABLE_MATCH = {
      $or: [
        {
          paymentMethod: "razorpay",
          paymentStatus: "paid",
        },
        {
          paymentMethod: "cod",
          isConfirmed: true,
        },
        {
          paymentMethod: "exchange",
        },
        {
          paymentStatus: "not_applicable",
        },
      ],
    };

    const activityDateExpr = {
      $ifNull: [
        "$razorpay.paidAt",
        {
          $ifNull: [
            "$confirmedAt",
            {
              $ifNull: ["$orderDate", "$createdAt"],
            },
          ],
        },
      ],
    };

    const [summaryAgg, pendingConfirmation, refundPending] = await Promise.all([
      Order.aggregate([
        { $match: COUNTABLE_MATCH },
        {
          $addFields: {
            dashboardActivityAt: activityDateExpr,
            dashboardSource: {
              $ifNull: ["$attribution.source", "$source"],
            },
          },
        },
        {
          $facet: {
            total: [
              {
                $group: {
                  _id: null,
                  count: { $sum: 1 },
                  revenue: { $sum: { $ifNull: ["$finalPayable", 0] } },
                },
              },
            ],

            today: [
              {
                $match: {
                  dashboardActivityAt: {
                    $gte: startOfToday,
                    $lt: startOfTomorrow,
                  },
                },
              },
              {
                $group: {
                  _id: null,
                  count: { $sum: 1 },
                  revenue: { $sum: { $ifNull: ["$finalPayable", 0] } },
                },
              },
            ],

            thisWeek: [
              {
                $match: {
                  dashboardActivityAt: {
                    $gte: thisWeekStart,
                    $lte: now,
                  },
                },
              },
              {
                $group: {
                  _id: null,
                  count: { $sum: 1 },
                  revenue: { $sum: { $ifNull: ["$finalPayable", 0] } },
                },
              },
            ],

            thisMonth: [
              {
                $match: {
                  dashboardActivityAt: {
                    $gte: thisMonthStart,
                    $lte: now,
                  },
                },
              },
              {
                $group: {
                  _id: null,
                  count: { $sum: 1 },
                  revenue: { $sum: { $ifNull: ["$finalPayable", 0] } },
                },
              },
            ],

            last7: [
              {
                $match: {
                  dashboardActivityAt: {
                    $gte: last7Start,
                    $lte: now,
                  },
                },
              },
              {
                $group: {
                  _id: null,
                  count: { $sum: 1 },
                  revenue: { $sum: { $ifNull: ["$finalPayable", 0] } },
                },
              },
            ],

            dailyTrend: [
              {
                $match: {
                  dashboardActivityAt: {
                    $gte: last14Start,
                    $lte: now,
                  },
                },
              },
              {
                $group: {
                  _id: {
                    $dateToString: {
                      format: "%Y-%m-%d",
                      date: "$dashboardActivityAt",
                      timezone: "Asia/Kolkata",
                    },
                  },
                  orders: { $sum: 1 },
                  revenue: { $sum: { $ifNull: ["$finalPayable", 0] } },
                  codOrders: {
                    $sum: {
                      $cond: [{ $eq: ["$paymentMethod", "cod"] }, 1, 0],
                    },
                  },
                  prepaidOrders: {
                    $sum: {
                      $cond: [{ $eq: ["$paymentMethod", "razorpay"] }, 1, 0],
                    },
                  },
                  exchangeOrders: {
                    $sum: {
                      $cond: [{ $eq: ["$paymentMethod", "exchange"] }, 1, 0],
                    },
                  },
                  delivered: {
                    $sum: {
                      $cond: [
                        { $eq: ["$fulfillmentStatus", "delivered"] },
                        1,
                        0,
                      ],
                    },
                  },
                  cancelled: {
                    $sum: {
                      $cond: [
                        { $eq: ["$fulfillmentStatus", "cancelled"] },
                        1,
                        0,
                      ],
                    },
                  },
                  rto: {
                    $sum: {
                      $cond: [{ $eq: ["$fulfillmentStatus", "rto"] }, 1, 0],
                    },
                  },
                  returned: {
                    $sum: {
                      $cond: [
                        { $eq: ["$fulfillmentStatus", "returned"] },
                        1,
                        0,
                      ],
                    },
                  },
                  refunded: {
                    $sum: {
                      $cond: [
                        { $eq: ["$fulfillmentStatus", "refunded"] },
                        1,
                        0,
                      ],
                    },
                  },
                },
              },
              {
                $project: {
                  _id: 0,
                  date: "$_id",
                  orders: 1,
                  revenue: 1,
                  codOrders: 1,
                  prepaidOrders: 1,
                  exchangeOrders: 1,
                  delivered: 1,
                  cancelled: 1,
                  rto: 1,
                  returned: 1,
                  refunded: 1,
                },
              },
              { $sort: { date: 1 } },
            ],

            hourlyTrend: [
              {
                $match: {
                  dashboardActivityAt: {
                    $gte: thisMonthStart,
                    $lte: now,
                  },
                },
              },
              {
                $group: {
                  _id: {
                    $hour: {
                      date: "$dashboardActivityAt",
                      timezone: "Asia/Kolkata",
                    },
                  },
                  orders: { $sum: 1 },
                  revenue: { $sum: { $ifNull: ["$finalPayable", 0] } },
                },
              },
              {
                $project: {
                  _id: 0,
                  hour: "$_id",
                  orders: 1,
                  revenue: 1,
                },
              },
              { $sort: { hour: 1 } },
            ],

            sourcePerformance: [
              {
                $group: {
                  _id: {
                    $toLower: {
                      $ifNull: ["$dashboardSource", "direct"],
                    },
                  },
                  orders: { $sum: 1 },
                  revenue: { $sum: { $ifNull: ["$finalPayable", 0] } },
                },
              },
              {
                $project: {
                  _id: 0,
                  source: "$_id",
                  orders: 1,
                  revenue: 1,
                },
              },
              { $sort: { orders: -1, revenue: -1 } },
              { $limit: 10 },
            ],

            fulfillment: [
              {
                $group: {
                  _id: "$fulfillmentStatus",
                  count: { $sum: 1 },
                  revenue: { $sum: { $ifNull: ["$finalPayable", 0] } },
                },
              },
            ],

            paymentMethods: [
              {
                $group: {
                  _id: "$paymentMethod",
                  count: { $sum: 1 },
                  revenue: { $sum: { $ifNull: ["$finalPayable", 0] } },
                },
              },
            ],

            actionStats: [
              {
                $group: {
                  _id: null,
                  packableOrders: {
                    $sum: {
                      $cond: [{ $eq: ["$isPackable", true] }, 1, 0],
                    },
                  },
                  highPriority: {
                    $sum: {
                      $cond: [{ $eq: ["$priority", "high"] }, 1, 0],
                    },
                  },
                },
              },
            ],
          },
        },
      ]),

      Order.countDocuments({
        isConfirmed: { $ne: true },
        fulfillmentStatus: {
          $nin: ["cancelled", "delivered", "rto", "returned", "refunded"],
        },
      }),

      Order.countDocuments({
        $or: [
          { paymentStatus: "refund_pending" },
          { "refundSummary.status": "refund_pending" },
          { eligibleForRefund: true },
        ],
      }),
    ]);

    const data = summaryAgg?.[0] || {};

    const total = data.total?.[0] || {};
    const today = data.today?.[0] || {};
    const thisWeek = data.thisWeek?.[0] || {};
    const thisMonth = data.thisMonth?.[0] || {};
    const last7 = data.last7?.[0] || {};
    const actionStats = data.actionStats?.[0] || {};

    const fulfillmentMap = {};
    for (const row of data.fulfillment || []) {
      fulfillmentMap[row._id || "unknown"] = {
        count: row.count || 0,
        revenue: row.revenue || 0,
      };
    }

    const paymentMap = {};
    for (const row of data.paymentMethods || []) {
      paymentMap[row._id || "unknown"] = {
        count: row.count || 0,
        revenue: row.revenue || 0,
      };
    }

    const processing = fulfillmentMap.processing?.count || 0;
    const packed = fulfillmentMap.packed?.count || 0;
    const picked = fulfillmentMap.picked?.count || 0;
    const shipped = fulfillmentMap.shipped?.count || 0;
    const outForDelivery = fulfillmentMap.out_for_delivery?.count || 0;
    const delivered = fulfillmentMap.delivered?.count || 0;

    const cancelled = fulfillmentMap.cancelled?.count || 0;
    const returned = fulfillmentMap.returned?.count || 0;
    const rto = fulfillmentMap.rto?.count || 0;
    const refunded = fulfillmentMap.refunded?.count || 0;

    const issues = cancelled + returned + rto + refunded;
    const totalCount = total.count || 0;

    return res.status(200).json({
      success: true,

      summary: {
        totalOrders: totalCount,
        totalRevenue: total.revenue || 0,

        todayOrders: today.count || 0,
        todayRevenue: today.revenue || 0,

        thisWeekOrders: thisWeek.count || 0,
        thisWeekRevenue: thisWeek.revenue || 0,

        thisMonthOrders: thisMonth.count || 0,
        thisMonthRevenue: thisMonth.revenue || 0,

        last7Orders: last7.count || 0,
        last7Revenue: last7.revenue || 0,
        aov7: last7.count ? Math.round((last7.revenue || 0) / last7.count) : 0,

        deliveryRate: totalCount
          ? Number(((delivered / totalCount) * 100).toFixed(1))
          : 0,
        issueRate: totalCount
          ? Number(((issues / totalCount) * 100).toFixed(1))
          : 0,
      },

      pipeline: {
        processing,
        packed,
        picked,
        shipped,
        outForDelivery,
        delivered,
        pendingToShip: processing + packed,
        inTransit: picked + shipped + outForDelivery,
      },

      issues: {
        cancelled,
        returned,
        rto,
        refunded,
        total: issues,
      },

      payment: {
        codOrders: paymentMap.cod?.count || 0,
        codRevenue: paymentMap.cod?.revenue || 0,

        prepaidOrders: paymentMap.razorpay?.count || 0,
        prepaidRevenue: paymentMap.razorpay?.revenue || 0,

        exchangeOrders: paymentMap.exchange?.count || 0,
        exchangeRevenue: paymentMap.exchange?.revenue || 0,
      },

      actions: {
        pendingConfirmation,
        refundPending,
        packableOrders: actionStats.packableOrders || 0,
        highPriority: actionStats.highPriority || 0,
      },

      dailyTrend: data.dailyTrend || [],
      hourlyTrend: data.hourlyTrend || [],
      sourcePerformance: data.sourcePerformance || [],
    });
  } catch (error) {
    console.error("❌ Orders Dashboard Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load orders dashboard",
      error: error.message,
    });
  }
};
/* ============================================================
   APPLY COUPON AFTER ORDER PLACED

   POST /api/orders/:id/apply-coupon-after-order

   Body:
   {
     "code": "WELCOME10"
   }
============================================================ */

export const applyCouponAfterOrderPlaced = async (req, res) => {
  const session = await mongoose.startSession();

  const str = (value) =>
    value === null || value === undefined ? "" : String(value);

  const num = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const normalizeCode = (value) => str(value).trim().toUpperCase();

  const normalizeEmail = (value) => str(value).trim().toLowerCase();

  const normalizePhone = (value) => str(value).replace(/\D/g, "");

  try {
    const code = normalizeCode(req.body?.code);
    const idOrNumber = str(req.params.id).trim();

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "Coupon code is required.",
      });
    }

    let finalOrder = null;

    await session.withTransaction(async () => {
      const orderQuery = mongoose.Types.ObjectId.isValid(idOrNumber)
        ? {
          $or: [
            { _id: idOrNumber },
            { orderNumber: idOrNumber },
            { orderId: idOrNumber },
          ],
        }
        : {
          $or: [{ orderNumber: idOrNumber }, { orderId: idOrNumber }],
        };

      const order = await Order.findOne(orderQuery).session(session);

      if (!order) {
        throw new Error("Order not found.");
      }

      const fulfillmentStatus = str(order.fulfillmentStatus).toLowerCase();

      if (
        ["shipped", "delivered", "cancelled", "rto", "returned"].includes(
          fulfillmentStatus,
        )
      ) {
        throw new Error(
          `Coupon cannot be applied because order is ${fulfillmentStatus}.`,
        );
      }

      if (
        str(order.paymentMethod).toLowerCase() === "razorpay" &&
        str(order.paymentStatus).toLowerCase() === "paid"
      ) {
        throw new Error(
          "Paid Razorpay order cannot be adjusted directly. Create a partial refund instead.",
        );
      }

      if (str(order.paymentMethod).toLowerCase() === "exchange") {
        throw new Error("Coupon cannot be applied to an exchange order.");
      }

      const coupon = await Coupon.findOne({ code }).session(session);

      if (!coupon) {
        throw new Error("Invalid coupon code.");
      }

      const now = new Date();

      if (!coupon.isActive) {
        throw new Error("Coupon is not active.");
      }

      if (coupon.validFrom && now < new Date(coupon.validFrom)) {
        throw new Error("Coupon is not active yet.");
      }

      if (coupon.validTill && now > new Date(coupon.validTill)) {
        throw new Error("Coupon has expired.");
      }

      const subtotal = num(order.subtotal);

      if (subtotal < num(coupon.minPurchase)) {
        throw new Error(
          `Minimum purchase required is ₹${num(coupon.minPurchase)}.`,
        );
      }

      if (
        num(coupon.usageLimit) > 0 &&
        num(coupon.usedCount) >= num(coupon.usageLimit)
      ) {
        throw new Error("Coupon usage limit has been reached.");
      }

      const email = normalizeEmail(
        order.shippingAddressSnapshot?.email ||
        order.billingAddressSnapshot?.email,
      );

      const phone = normalizePhone(
        order.shippingAddressSnapshot?.phone ||
        order.billingAddressSnapshot?.phone,
      );

      const customerIdentity = email
        ? `email:${email}`
        : phone
          ? `phone:${phone}`
          : order.customerId
            ? `id:${order.customerId}`
            : "";

      if (coupon.targetEmail && normalizeEmail(coupon.targetEmail) !== email) {
        throw new Error("Coupon is not applicable for this email.");
      }

      if (coupon.targetPhone && normalizePhone(coupon.targetPhone) !== phone) {
        throw new Error("Coupon is not applicable for this phone number.");
      }

      const usageLimitPerCustomer = num(coupon.usageLimitPerCustomer || 1);

      const usedTimes = customerIdentity
        ? (coupon.usedBy || []).filter(
          (value) => str(value).trim() === customerIdentity,
        ).length
        : 0;

      if (
        customerIdentity &&
        usageLimitPerCustomer > 0 &&
        usedTimes >= usageLimitPerCustomer
      ) {
        throw new Error("Customer has already used this coupon.");
      }

      let couponDiscount = 0;

      if (coupon.discountType === "percentage") {
        couponDiscount = (subtotal * num(coupon.discountValue)) / 100;
      } else {
        couponDiscount = num(coupon.discountValue);
      }

      if (num(coupon.maxDiscount) > 0) {
        couponDiscount = Math.min(couponDiscount, num(coupon.maxDiscount));
      }

      couponDiscount = Math.max(
        0,
        Math.round(Math.min(couponDiscount, subtotal, num(order.totalAmount))),
      );

      if (couponDiscount <= 0) {
        throw new Error("Coupon is not applicable on this order.");
      }

      const previousCouponDiscount = num(order.coupon?.discount);

      const existingDiscount = num(order.discount);

      const discountWithoutOldCoupon = Math.max(
        0,
        existingDiscount - previousCouponDiscount,
      );

      order.discount = Math.min(
        num(order.totalAmount),
        discountWithoutOldCoupon + couponDiscount,
      );

      order.coupon = {
        code: coupon.code,
        discount: couponDiscount,
        finalTotal: Math.max(0, num(order.totalAmount) - num(order.discount)),
        identity: customerIdentity,
      };

      order.analytics = order.analytics || {};
      order.analytics.couponApplied = true;
      order.analytics.couponIdentity = customerIdentity;

      /*
       * Order model pre-validate hook automatically
       * recalculates finalPayable.
       */
      await order.save({ session });

      order.paymentBreakdown = order.paymentBreakdown || {};

      if (order.paymentMethod === "cod") {
        order.paymentBreakdown.codAmount = num(order.finalPayable);
        order.paymentBreakdown.razorpayAmount = 0;
      }

      if (order.paymentMethod === "razorpay") {
        order.paymentBreakdown.razorpayAmount = num(order.finalPayable);
        order.paymentBreakdown.codAmount = 0;
      }

      await order.save({ session });

      if (customerIdentity) {
        coupon.usedBy = Array.isArray(coupon.usedBy) ? coupon.usedBy : [];

        coupon.usedBy.push(customerIdentity);
      }

      coupon.usedCount = num(coupon.usedCount) + 1;

      await coupon.save({ session });

      finalOrder = order;
    });

    syncCustomerAnalyticsSafe(
      finalOrder?.customerId,
      "applyCouponAfterOrderPlaced",
    );

    return res.status(200).json({
      success: true,
      message: "Coupon applied successfully.",
      order: finalOrder,
      pricing: {
        subtotal: finalOrder.subtotal,
        shippingFee: finalOrder.shippingFee,
        tax: finalOrder.tax,
        totalAmount: finalOrder.totalAmount,
        discount: finalOrder.discount,
        couponDiscount: finalOrder.coupon?.discount || 0,
        finalPayable: finalOrder.finalPayable,
      },
    });
  } catch (error) {
    console.error("❌ Apply Coupon After Order Error:", error);

    return res.status(400).json({
      success: false,
      message: error.message || "Unable to apply coupon to order.",
    });
  } finally {
    await session.endSession();
  }
};
/* ============================================================
   ADMIN ADJUST FINAL PAYABLE

   PATCH /api/orders/:id/adjust-final-payable

   Body options:

   {
     "discountAmount": 300
   }

   OR

   {
     "additionalDiscount": 200
   }

   OR

   {
     "finalPayable": 1499
   }
============================================================ */

export const adjustOrderFinalPayable = async (req, res) => {
  const num = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const str = (value) =>
    value === null || value === undefined ? "" : String(value);

  try {
    const idOrNumber = str(req.params.id).trim();

    const {
      discountAmount,
      additionalDiscount,
      finalPayable,
      removeCoupon = false,
    } = req.body;

    const hasDiscountAmount =
      discountAmount !== undefined && discountAmount !== null;

    const hasAdditionalDiscount =
      additionalDiscount !== undefined && additionalDiscount !== null;

    const hasFinalPayable = finalPayable !== undefined && finalPayable !== null;

    if (!hasDiscountAmount && !hasAdditionalDiscount && !hasFinalPayable) {
      return res.status(400).json({
        success: false,
        message:
          "discountAmount, additionalDiscount or finalPayable is required.",
      });
    }

    const orderQuery = mongoose.Types.ObjectId.isValid(idOrNumber)
      ? {
        $or: [
          { _id: idOrNumber },
          { orderNumber: idOrNumber },
          { orderId: idOrNumber },
        ],
      }
      : {
        $or: [{ orderNumber: idOrNumber }, { orderId: idOrNumber }],
      };

    const order = await Order.findOne(orderQuery);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    const fulfillmentStatus = str(order.fulfillmentStatus).toLowerCase();

    if (
      ["shipped", "delivered", "cancelled", "rto", "returned"].includes(
        fulfillmentStatus,
      )
    ) {
      return res.status(400).json({
        success: false,
        message: `Order cannot be adjusted because it is ${fulfillmentStatus}.`,
      });
    }

    if (
      str(order.paymentMethod).toLowerCase() === "razorpay" &&
      str(order.paymentStatus).toLowerCase() === "paid"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Paid Razorpay order cannot be adjusted directly. Create a partial refund instead.",
      });
    }

    const totalAmount = num(order.totalAmount);

    const walletAmount = num(
      order.walletCredit?.amount || order.paymentBreakdown?.walletAmount,
    );

    let nextDiscount = num(order.discount);

    if (hasDiscountAmount) {
      nextDiscount = num(discountAmount);
    }

    if (hasAdditionalDiscount) {
      nextDiscount = num(order.discount) + num(additionalDiscount);
    }

    if (hasFinalPayable) {
      const requestedFinalPayable = num(finalPayable);

      if (requestedFinalPayable < 0) {
        return res.status(400).json({
          success: false,
          message: "Final payable cannot be negative.",
        });
      }

      if (requestedFinalPayable > Math.max(0, totalAmount - walletAmount)) {
        return res.status(400).json({
          success: false,
          message:
            "Final payable cannot be greater than the current payable before discount.",
        });
      }

      nextDiscount = totalAmount - walletAmount - requestedFinalPayable;
    }

    nextDiscount = Math.max(0, Math.min(nextDiscount, totalAmount));

    order.discount = Math.round(nextDiscount);

    if (removeCoupon === true) {
      order.coupon = undefined;

      order.analytics = order.analytics || {};
      order.analytics.couponApplied = false;
      order.analytics.couponIdentity = "";
    }

    /*
     * Model hook recalculates:
     * finalPayable = totalAmount - discount - walletAmount
     */
    await order.save();

    order.paymentBreakdown = order.paymentBreakdown || {};

    if (order.paymentMethod === "cod") {
      order.paymentBreakdown.codAmount = num(order.finalPayable);
      order.paymentBreakdown.razorpayAmount = 0;
    }

    if (order.paymentMethod === "razorpay") {
      order.paymentBreakdown.razorpayAmount = num(order.finalPayable);
      order.paymentBreakdown.codAmount = 0;
    }

    await order.save();

    syncCustomerAnalyticsSafe(order.customerId, "adjustOrderFinalPayable");

    return res.status(200).json({
      success: true,
      message: "Order payable adjusted successfully.",
      order,
      pricing: {
        subtotal: order.subtotal,
        shippingFee: order.shippingFee,
        tax: order.tax,
        totalAmount: order.totalAmount,
        discount: order.discount,
        walletAmount: order.walletCredit?.amount || 0,
        finalPayable: order.finalPayable,
      },
    });
  } catch (error) {
    console.error("❌ Adjust Order Final Payable Error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Unable to adjust order payable.",
    });
  }
};

export const markOrderAsInfluencer = async (req, res) => {
  try {
    const idOrNumber = String(req.params.id || "").trim();
    const { isInfluencerOrder } = req.body;

    if (typeof isInfluencerOrder !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isInfluencerOrder must be a boolean",
      });
    }

    const query = mongoose.Types.ObjectId.isValid(idOrNumber)
      ? { _id: idOrNumber }
      : { orderNumber: idOrNumber };

    const order = await Order.findOneAndUpdate(
      query,
      { $set: { isInfluencerOrder } },
      {
        new: true,
        runValidators: true,
      },
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: isInfluencerOrder
        ? "Order marked as influencer order"
        : "Order removed from influencer orders",
      order,
    });
  } catch (error) {
    console.error("❌ Influencer Order Update Error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Unable to update influencer order",
    });
  }
};

/* ============================================================
   ADD PRODUCT TO ORDER
   POST /api/orders/:id/items
============================================================ */

export const addProductToOrder = async (req, res) => {
  try {
    const { id } = req.params;

    const { productId, variantId = null, quantity = 1 } = req.body || {};

    const qty = Number(quantity);

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({
        success: false,
        message: "Valid productId is required",
      });
    }

    if (!Number.isInteger(qty) || qty < 1) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be at least 1",
      });
    }

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (!canEditOrderItems(order)) {
      return res.status(400).json({
        success: false,
        message: `Products cannot be edited when order is ${order.fulfillmentStatus}`,
      });
    }

    const product = await Product.findById(productId).lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const variants = Array.isArray(product.variants) ? product.variants : [];

    const isVariable =
      product.productType === "variable" || variants.length > 0;

    let variant = null;

    if (isVariable) {
      if (!variantId || !mongoose.Types.ObjectId.isValid(variantId)) {
        return res.status(400).json({
          success: false,
          message: "Valid variantId is required",
        });
      }

      variant = variants.find((item) => String(item._id) === String(variantId));

      if (!variant) {
        return res.status(404).json({
          success: false,
          message: "Product variant not found",
        });
      }
    }

    const variantAttributes = Array.isArray(variant?.attributes)
      ? variant.attributes
        .filter(
          (attribute) => attribute?.key != null && attribute?.value != null,
        )
        .map((attribute) => ({
          key: String(attribute.key),
          value: String(attribute.value),
        }))
      : [];

    const selectedSize =
      variantAttributes.find(
        (attribute) => String(attribute.key).toLowerCase() === "size",
      )?.value || "";

    const selectedColor =
      variantAttributes.find((attribute) =>
        ["color", "colour"].includes(String(attribute.key).toLowerCase()),
      )?.value || "";

    const existingItem = order.items.find((item) => {
      const sameProduct = String(item.productId) === String(product._id);

      const sameVariant =
        String(item.variant?.variantId || "") === String(variant?._id || "");

      return sameProduct && sameVariant;
    });

    const unitPrice = Number(product.price || 0);

    if (unitPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: "Product price is invalid",
      });
    }

    if (existingItem) {
      existingItem.quantity = Number(existingItem.quantity || 0) + qty;

      existingItem.subtotal =
        Number(existingItem.price || unitPrice) * existingItem.quantity;

      existingItem.fulfillment = existingItem.fulfillment || {};

      existingItem.fulfillment.toProduceQty =
        Number(existingItem.fulfillment.toProduceQty || 0) + qty;
    } else {
      order.items.push({
        lineId: new mongoose.Types.ObjectId().toString(),

        productModel: "Product",
        productId: product._id,

        fulfillment: {
          allocatedQty: 0,
          shippedQty: 0,
          toProduceQty: qty,
        },

        productSnapshot: {
          productCode: product.productCode || "",
          title: product.title,
          slug: product.slug || "",
          thumbnail: product.thumbnail || product.images?.[0] || "",
          images: Array.isArray(product.images) ? product.images : [],
          productType:
            product.productType || (variants.length ? "variable" : "simple"),
          sku: product.sku || "",
          tags: Array.isArray(product.tags) ? product.tags : [],
          hsnCode: product.hsnCode || "",
          weight: Number(product.weight || 0),
          currency: product.currency || order.currency || "INR",
          isPrimaryProduct: product.isPrimaryProduct !== false,
        },

        variant: {
          variantId: variant?._id || null,
          sku: variant?.sku || "",
          attributes: variantAttributes,
          weight: Number(variant?.weight || 0),
        },

        selectedSize,
        selectedColor,

        quantity: qty,
        price: unitPrice,
        compareAtPrice: product.compareAtPrice ?? null,
        subtotal: unitPrice * qty,
      });
    }

    order.markModified("items");

    // First save recalculates subtotal and finalPayable
    await order.save();

    syncOrderPaymentBreakdown(order);
    await order.save();

    syncCustomerAnalyticsSafe(order.customerId, "addProductToOrder");

    return res.status(200).json({
      success: true,
      message: existingItem
        ? "Product quantity increased"
        : "Product added to order",
      order,
      totals: {
        subtotal: order.subtotal,
        discount: order.discount,
        shippingFee: order.shippingFee,
        tax: order.tax,
        totalAmount: order.totalAmount,
        finalPayable: order.finalPayable,
      },
    });
  } catch (error) {
    console.error("❌ Add Product To Order Error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to add product to order",
    });
  }
};

/* ============================================================
   REMOVE PRODUCT FROM ORDER
   DELETE /api/orders/:id/items/:lineId

   Optional body:
   {
     quantity: 1
   }

   quantity missing => complete line remove
============================================================ */

export const removeProductFromOrder = async (req, res) => {
  try {
    const { id, lineId } = req.params;
    const requestedQuantity = Number(req.body?.quantity || 0);

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (!canEditOrderItems(order)) {
      return res.status(400).json({
        success: false,
        message: `Products cannot be edited when order is ${order.fulfillmentStatus}`,
      });
    }

    const itemIndex = order.items.findIndex(
      (item) => String(item.lineId) === String(lineId),
    );

    if (itemIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Order item not found",
      });
    }

    const item = order.items[itemIndex];
    const currentQuantity = Number(item.quantity || 0);

    const removeCompleteLine =
      requestedQuantity <= 0 || requestedQuantity >= currentQuantity;

    if (removeCompleteLine) {
      if (order.items.length === 1) {
        return res.status(400).json({
          success: false,
          message: "Cannot remove the last product. Cancel the order instead.",
        });
      }

      order.items.splice(itemIndex, 1);
    } else {
      item.quantity = currentQuantity - requestedQuantity;

      item.subtotal = Number(item.price || 0) * item.quantity;

      item.fulfillment = item.fulfillment || {};

      item.fulfillment.toProduceQty = Math.max(
        0,
        Number(item.fulfillment.toProduceQty || 0) - requestedQuantity,
      );

      item.fulfillment.allocatedQty = Math.min(
        Number(item.fulfillment.allocatedQty || 0),
        item.quantity,
      );
    }

    order.markModified("items");

    // Existing order model hook recalculates totals
    await order.save();

    syncOrderPaymentBreakdown(order);
    await order.save();

    syncCustomerAnalyticsSafe(order.customerId, "removeProductFromOrder");

    return res.status(200).json({
      success: true,
      message: removeCompleteLine
        ? "Product removed from order"
        : "Product quantity reduced",
      order,
      totals: {
        subtotal: order.subtotal,
        discount: order.discount,
        shippingFee: order.shippingFee,
        tax: order.tax,
        totalAmount: order.totalAmount,
        finalPayable: order.finalPayable,
      },
    });
  } catch (error) {
    console.error("❌ Remove Product From Order Error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to remove product from order",
    });
  }
};

/* ============================================================
   CHANGE ORDER ITEM SIZE
   PATCH /api/orders/:id/items/:lineId/size

   Body:
   {
     "variantId": "TARGET_VARIANT_ID"
   }
============================================================ */

export const changeOrderItemSize = async (req, res) => {
  try {
    const { id, lineId } = req.params;
    const { variantId } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Valid order id is required",
      });
    }

    if (!lineId) {
      return res.status(400).json({
        success: false,
        message: "lineId is required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(variantId)) {
      return res.status(400).json({
        success: false,
        message: "Valid variantId is required",
      });
    }

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (!canEditOrderItems(order)) {
      return res.status(400).json({
        success: false,
        message: `Size cannot be changed when order is ${order.fulfillmentStatus}`,
      });
    }

    const item = order.items.find(
      (orderItem) => String(orderItem.lineId) === String(lineId),
    );

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Order item not found",
      });
    }

    if (String(item.productModel || "Product") !== "Product") {
      return res.status(400).json({
        success: false,
        message: "Size change currently supports Product items only",
      });
    }

    const shippedQty = Number(item.fulfillment?.shippedQty || 0);

    if (shippedQty > 0) {
      return res.status(400).json({
        success: false,
        message: "Size cannot be changed after this item has been shipped",
      });
    }

    const product = await Product.findById(item.productId).lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product linked to this order item was not found",
      });
    }

    const variants = Array.isArray(product.variants) ? product.variants : [];

    const targetVariant = variants.find(
      (variant) => String(variant._id) === String(variantId),
    );

    if (!targetVariant) {
      return res.status(404).json({
        success: false,
        message: "Selected size variant was not found for this product",
      });
    }

    if (String(item.variant?.variantId || "") === String(targetVariant._id)) {
      return res.status(400).json({
        success: false,
        message: "This size is already selected",
      });
    }

    const attributes = Array.isArray(targetVariant.attributes)
      ? targetVariant.attributes
        .filter(
          (attribute) => attribute?.key != null && attribute?.value != null,
        )
        .map((attribute) => ({
          key: String(attribute.key),
          value: String(attribute.value),
        }))
      : [];

    const sizeAttribute = attributes.find(
      (attribute) => String(attribute.key).trim().toLowerCase() === "size",
    );

    if (!sizeAttribute?.value) {
      return res.status(400).json({
        success: false,
        message: "Selected variant does not contain a size attribute",
      });
    }

    const duplicateTargetLine = order.items.find(
      (orderItem) =>
        String(orderItem.lineId) !== String(lineId) &&
        String(orderItem.productId) === String(item.productId) &&
        String(orderItem.variant?.variantId || "") ===
        String(targetVariant._id),
    );

    if (duplicateTargetLine) {
      return res.status(409).json({
        success: false,
        message:
          "The selected size already exists as another line in this order",
      });
    }

    const oldVariant = {
      variantId: item.variant?.variantId || null,
      sku: item.variant?.sku || "",
      selectedSize: item.selectedSize || "",
    };

    const selectedColor =
      attributes.find((attribute) =>
        ["color", "colour"].includes(
          String(attribute.key).trim().toLowerCase(),
        ),
      )?.value ||
      item.selectedColor ||
      "";

    item.variant = {
      variantId: targetVariant._id,
      sku: targetVariant.sku || "",
      attributes,
      weight: Number(targetVariant.weight || 0),
    };

    item.selectedSize = String(sizeAttribute.value);
    item.selectedColor = String(selectedColor);

    order.markModified("items");

    await order.save();

    syncCustomerAnalyticsSafe(order.customerId, "changeOrderItemSize");

    return res.status(200).json({
      success: true,
      message: `Size changed from ${oldVariant.selectedSize || "previous size"
        } to ${item.selectedSize}`,
      item: {
        lineId: item.lineId,
        productId: item.productId,
        productCode: item.productSnapshot?.productCode || "",
        title: item.productSnapshot?.title || "",
        quantity: item.quantity,
        oldVariant,
        variant: item.variant,
        selectedSize: item.selectedSize,
        selectedColor: item.selectedColor,
      },
      order,
    });
  } catch (error) {
    console.error("❌ Change Order Item Size Error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to change order item size",
    });
  }
};


/* ============================================================
   ADVANCED ORDER FILTERS
   Additive controller — getAllOrders remains untouched
============================================================ */

const ADVANCED_FILTER_IST_OFFSET_MINUTES = 330;
const ADVANCED_FILTER_MAX_LIMIT = 500;

const advancedFilterString = (value) =>
  String(value ?? "").trim();

const advancedFilterLower = (value) =>
  advancedFilterString(value).toLowerCase();

const advancedFilterEscapeRegex = (value) =>
  advancedFilterString(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );

const advancedFilterList = (
  value,
  { lowercase = false } = {},
) => {
  const rawValues = Array.isArray(value)
    ? value
    : value == null
      ? []
      : [value];

  return [
    ...new Set(
      rawValues
        .flatMap((entry) =>
          advancedFilterString(entry).split(","),
        )
        .map((entry) =>
          lowercase
            ? advancedFilterLower(entry)
            : advancedFilterString(entry),
        )
        .filter(Boolean),
    ),
  ];
};

const advancedFilterObjectIds = (value) =>
  advancedFilterList(value)
    .filter((id) =>
      mongoose.Types.ObjectId.isValid(id),
    )
    .map(
      (id) =>
        new mongoose.Types.ObjectId(id),
    );

const advancedFilterBoolean = (value) => {
  const normalized = advancedFilterLower(value);

  if (["true", "1", "yes"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no"].includes(normalized)) {
    return false;
  }

  return null;
};

const advancedFilterParseYMD = (value) => {
  const match = advancedFilterString(value).match(
    /^(\d{4})-(\d{2})-(\d{2})$/,
  );

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (
    !year ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  return {
    year,
    month,
    day,
  };
};

const advancedFilterISTStartUTC = (ymd) => {
  const parsed = advancedFilterParseYMD(ymd);

  if (!parsed) return null;

  const utcMidnight = Date.UTC(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    0,
    0,
    0,
    0,
  );

  return new Date(
    utcMidnight -
    ADVANCED_FILTER_IST_OFFSET_MINUTES *
    60 *
    1000,
  );
};

const advancedFilterISTEndExclusiveUTC = (ymd) => {
  const start =
    advancedFilterISTStartUTC(ymd);

  if (!start) return null;

  return new Date(
    start.getTime() +
    24 * 60 * 60 * 1000,
  );
};

const advancedFilterAddInNin = ({
  clauses,
  field,
  include,
  exclude,
  lowercase = false,
  allowed = null,
}) => {
  let includeValues = advancedFilterList(
    include,
    { lowercase },
  );

  let excludeValues = advancedFilterList(
    exclude,
    { lowercase },
  );

  if (allowed) {
    includeValues = includeValues.filter(
      (value) => allowed.has(value),
    );

    excludeValues = excludeValues.filter(
      (value) => allowed.has(value),
    );
  }

  const condition = {};

  if (includeValues.length) {
    condition.$in = includeValues;
  }

  if (excludeValues.length) {
    condition.$nin = excludeValues;
  }

  if (Object.keys(condition).length) {
    clauses.push({
      [field]: condition,
    });
  }
};

const advancedFilterAddRegexList = ({
  clauses,
  field,
  include,
  exclude,
}) => {
  const includeValues =
    advancedFilterList(include);

  const excludeValues =
    advancedFilterList(exclude);

  if (includeValues.length) {
    clauses.push({
      $or: includeValues.map((value) => ({
        [field]: new RegExp(
          advancedFilterEscapeRegex(value),
          "i",
        ),
      })),
    });
  }

  if (excludeValues.length) {
    clauses.push({
      $nor: excludeValues.map((value) => ({
        [field]: new RegExp(
          advancedFilterEscapeRegex(value),
          "i",
        ),
      })),
    });
  }
};

const advancedFilterAddTextExists = ({
  clauses,
  fields,
  value,
}) => {
  const parsed =
    advancedFilterBoolean(value);

  if (parsed === null) return;

  if (parsed === true) {
    clauses.push({
      $or: fields.map((field) => ({
        [field]: {
          $exists: true,
          $nin: ["", null],
        },
      })),
    });

    return;
  }

  clauses.push({
    $and: fields.map((field) => ({
      $or: [
        {
          [field]: {
            $exists: false,
          },
        },
        {
          [field]: "",
        },
        {
          [field]: null,
        },
      ],
    })),
  });
};

const ADVANCED_PAYMENT_STATUSES = new Set([
  "pending",
  "paid",
  "failed",
  "refunded",
  "partially_refunded",
  "refund_pending",
  "not_applicable",
]);

const ADVANCED_PAYMENT_METHODS = new Set([
  "cod",
  "razorpay",
  "exchange",
  "wallet",
  "manual_prepaid",
]);

const ADVANCED_FULFILLMENT_STATUSES = new Set([
  "processing",
  "packed",
  "picked",
  "shipped",
  "out_for_delivery",
  "delivered",
  "pickup_initiated",
  "return_requested",
  "exchange_requested",
  "returned",
  "refunded",
  "exchanged",
  "cancelled",
  "rto",
  "failed",
]);

const ADVANCED_PRIORITIES = new Set([
  "normal",
  "medium",
  "high",
]);

const ADVANCED_ORDER_TYPES = new Set([
  "parent",
  "shipment",
]);

const ADVANCED_ORDER_LIST_FIELDS = {
  orderNumber: 1,
  createdAt: 1,
  orderDate: 1,

  orderType: 1,
  priority: 1,
  priorityRank: 1,

  paymentMethod: 1,
  paymentStatus: 1,
  fulfillmentStatus: 1,

  isConfirmed: 1,
  isInfluencerOrder: 1,
  isTestingOrder: 1,
  subtotal: 1,
  discount: 1,
  shippingFee: 1,
  tax: 1,
  totalAmount: 1,
  finalPayable: 1,
  currency: 1,

  coupon: 1,

  "shippingAddressSnapshot.fullName": 1,
  "shippingAddressSnapshot.phone": 1,
  "shippingAddressSnapshot.email": 1,
  "shippingAddressSnapshot.city": 1,
  "shippingAddressSnapshot.state": 1,
  "shippingAddressSnapshot.country": 1,
  "shippingAddressSnapshot.pincode": 1,

  "attribution.source": 1,
  "attribution.medium": 1,
  "attribution.campaign": 1,
  "attribution.campaignSlug": 1,

  "shipment.provider": 1,
  "shipment.status": 1,
  "shipment.orderId": 1,
  "shipment.shipmentId": 1,
  "shipment.awb": 1,
  "shipment.courierName": 1,
  "shipment.trackingUrl": 1,
  "shipment.labelUrl": 1,

  "shipment.shiprocket.orderId": 1,
  "shipment.shiprocket.shipmentId": 1,
  "shipment.shiprocket.awb": 1,
  "shipment.shiprocket.courierName": 1,
  "shipment.shiprocket.trackingUrl": 1,
  "shipment.shiprocket.labelUrl": 1,

  "items.lineId": 1,
  "items.productId": 1,
  "items.productModel": 1,

  "items.quantity": 1,
  "items.price": 1,
  "items.subtotal": 1,
  "items.selectedSize": 1,
  "items.selectedColor": 1,

  "items.productSnapshot.productCode": 1,
  "items.productSnapshot.title": 1,
  "items.productSnapshot.thumbnail": 1,
  "items.productSnapshot.sku": 1,

  "items.variant.variantId": 1,
  "items.variant.sku": 1,
  "items.price": 1,
  "items.subtotal": 1,
  "items.selectedSize": 1,
  "items.selectedColor": 1,

  "items.productSnapshot.productCode": 1,
  "items.productSnapshot.title": 1,
  "items.productSnapshot.thumbnail": 1,
  "items.productSnapshot.sku": 1,

  "items.variant.sku": 1,


};

/**
 * GET /api/orders/advanced-filter
 *
 * This controller is additive.
 * Existing getAllOrders remains unchanged.
 */
export const getAdvancedFilteredOrders = async (
  req,
  res,
) => {
  try {
    const query = req.query || {};
    const clauses = [];

    /* ---------------- Payment filters ---------------- */

    advancedFilterAddInNin({
      clauses,
      field: "paymentStatus",
      include: query.paymentStatus,
      exclude: query.excludePaymentStatus,
      lowercase: true,
      allowed: ADVANCED_PAYMENT_STATUSES,
    });

    advancedFilterAddInNin({
      clauses,
      field: "paymentMethod",
      include: query.paymentMethod,
      exclude: query.excludePaymentMethod,
      lowercase: true,
      allowed: ADVANCED_PAYMENT_METHODS,
    });

    /* ---------------- Status filters ---------------- */

    advancedFilterAddInNin({
      clauses,
      field: "fulfillmentStatus",
      include: query.fulfillmentStatus,
      exclude:
        query.excludeFulfillmentStatus,
      lowercase: true,
      allowed:
        ADVANCED_FULFILLMENT_STATUSES,
    });

    advancedFilterAddInNin({
      clauses,
      field: "priority",
      include: query.priority,
      exclude: query.excludePriority,
      lowercase: true,
      allowed: ADVANCED_PRIORITIES,
    });

    advancedFilterAddInNin({
      clauses,
      field: "orderType",
      include: query.orderType,
      exclude: query.excludeOrderType,
      lowercase: true,
      allowed: ADVANCED_ORDER_TYPES,
    });

    /* ---------------- Attribution ---------------- */

    advancedFilterAddInNin({
      clauses,
      field: "attribution.source",
      include: query.attributionSource,
      exclude:
        query.excludeAttributionSource,
      lowercase: true,
    });

    advancedFilterAddInNin({
      clauses,
      field: "attribution.medium",
      include: query.attributionMedium,
      exclude:
        query.excludeAttributionMedium,
      lowercase: true,
    });

    advancedFilterAddRegexList({
      clauses,
      field: "attribution.campaign",
      include:
        query.attributionCampaign,
      exclude:
        query.excludeAttributionCampaign,
    });

    /* ---------------- Product filters ---------------- */

    advancedFilterAddInNin({
      clauses,
      field:
        "items.productSnapshot.productCode",
      include: query.productCode,
      exclude: query.excludeProductCode,
    });

    advancedFilterAddInNin({
      clauses,
      field: "items.variant.sku",
      include: query.sku,
      exclude: query.excludeSku,
    });

    advancedFilterAddInNin({
      clauses,
      field: "items.selectedSize",
      include: query.size,
      exclude: query.excludeSize,
    });

    advancedFilterAddInNin({
      clauses,
      field: "items.selectedColor",
      include: query.color,
      exclude: query.excludeColor,
      lowercase: true,
    });

    const productIds =
      advancedFilterObjectIds(
        query.productId,
      );

    const excludeProductIds =
      advancedFilterObjectIds(
        query.excludeProductId,
      );

    if (
      productIds.length ||
      excludeProductIds.length
    ) {
      const productCondition = {};

      if (productIds.length) {
        productCondition.$in = productIds;
      }

      if (excludeProductIds.length) {
        productCondition.$nin =
          excludeProductIds;
      }

      clauses.push({
        "items.productId": productCondition,
      });
    }

    /* ---------------- Order filters ---------------- */

    advancedFilterAddRegexList({
      clauses,
      field: "orderNumber",
      include: query.orderNumber,
      exclude: query.excludeOrderNumber,
    });

    const customerIds =
      advancedFilterObjectIds(
        query.customerId,
      );

    const excludeCustomerIds =
      advancedFilterObjectIds(
        query.excludeCustomerId,
      );

    if (
      customerIds.length ||
      excludeCustomerIds.length
    ) {
      const customerCondition = {};

      if (customerIds.length) {
        customerCondition.$in = customerIds;
      }

      if (excludeCustomerIds.length) {
        customerCondition.$nin =
          excludeCustomerIds;
      }

      clauses.push({
        customerId: customerCondition,
      });
    }

    /* ---------------- Location filters ---------------- */

    advancedFilterAddRegexList({
      clauses,
      field:
        "shippingAddressSnapshot.city",
      include: query.city,
      exclude: query.excludeCity,
    });

    advancedFilterAddRegexList({
      clauses,
      field:
        "shippingAddressSnapshot.state",
      include: query.state,
      exclude: query.excludeState,
    });

    advancedFilterAddRegexList({
      clauses,
      field:
        "shippingAddressSnapshot.country",
      include: query.country,
      exclude: query.excludeCountry,
    });

    advancedFilterAddRegexList({
      clauses,
      field:
        "shippingAddressSnapshot.pincode",
      include: query.pincode,
      exclude: query.excludePincode,
    });

    /* ---------------- Confirmation ---------------- */

    const confirmationValue =
      query.confirmFilter ??
      query.isConfirmed;

    const confirmationBoolean =
      advancedFilterBoolean(
        confirmationValue,
      );

    if (
      advancedFilterLower(
        confirmationValue,
      ) === "confirmed" ||
      confirmationBoolean === true
    ) {
      clauses.push({
        isConfirmed: true,
      });
    } else if (
      advancedFilterLower(
        confirmationValue,
      ) === "not_confirmed" ||
      confirmationBoolean === false
    ) {
      clauses.push({
        isConfirmed: {
          $ne: true,
        },
      });
    }

    /* ---------------- Influencer ---------------- */

    const influencerValue =
      advancedFilterBoolean(
        query.isInfluencerOrder,
      );

    if (influencerValue === true) {
      clauses.push({
        isInfluencerOrder: true,
      });
    }

    if (influencerValue === false) {
      clauses.push({
        isInfluencerOrder: {
          $ne: true,
        },
      });
    }

    /* ---------------- Date range ---------------- */

    const startAt =
      advancedFilterString(query.startAt)
        ? new Date(
          advancedFilterString(
            query.startAt,
          ),
        )
        : advancedFilterISTStartUTC(
          query.startDate,
        );

    const endAt =
      advancedFilterString(query.endAt)
        ? new Date(
          advancedFilterString(
            query.endAt,
          ),
        )
        : advancedFilterISTEndExclusiveUTC(
          query.endDate,
        );

    const createdAtCondition = {};

    if (
      startAt &&
      !Number.isNaN(startAt.getTime())
    ) {
      createdAtCondition.$gte = startAt;
    }

    if (
      endAt &&
      !Number.isNaN(endAt.getTime())
    ) {
      if (
        advancedFilterString(
          query.endAt,
        )
      ) {
        createdAtCondition.$lte = endAt;
      } else {
        createdAtCondition.$lt = endAt;
      }
    }

    if (
      Object.keys(
        createdAtCondition,
      ).length
    ) {
      clauses.push({
        createdAt: createdAtCondition,
      });
    }

    /* ---------------- Amount range ---------------- */

    const minAmount = Number(
      query.minAmount,
    );

    const maxAmount = Number(
      query.maxAmount,
    );

    if (
      Number.isFinite(minAmount) ||
      Number.isFinite(maxAmount)
    ) {
      const amountCondition = {};

      if (Number.isFinite(minAmount)) {
        amountCondition.$gte = minAmount;
      }

      if (Number.isFinite(maxAmount)) {
        amountCondition.$lte = maxAmount;
      }

      clauses.push({
        finalPayable: amountCondition,
      });
    }

    /* ---------------- Discount range ---------------- */

    const minDiscount = Number(
      query.minDiscount,
    );

    const maxDiscount = Number(
      query.maxDiscount,
    );

    if (
      Number.isFinite(minDiscount) ||
      Number.isFinite(maxDiscount)
    ) {
      const discountCondition = {};

      if (Number.isFinite(minDiscount)) {
        discountCondition.$gte =
          minDiscount;
      }

      if (Number.isFinite(maxDiscount)) {
        discountCondition.$lte =
          maxDiscount;
      }

      clauses.push({
        discount: discountCondition,
      });
    }

    /* ---------------- Coupon filters ---------------- */

    const couponCodes =
      advancedFilterList(
        query.couponCode,
      );

    const excludedCouponCodes =
      advancedFilterList(
        query.excludeCouponCode,
      );

    if (
      couponCodes.length ||
      excludedCouponCodes.length
    ) {
      const couponCondition = {};

      if (couponCodes.length) {
        couponCondition.$in =
          couponCodes;
      }

      if (
        excludedCouponCodes.length
      ) {
        couponCondition.$nin =
          excludedCouponCodes;
      }

      clauses.push({
        "coupon.code": couponCondition,
      });
    }

    const hasCoupon =
      advancedFilterBoolean(
        query.hasCoupon,
      );

    if (hasCoupon === true) {
      clauses.push({
        "coupon.code": {
          $exists: true,
          $nin: ["", null],
        },
      });
    } else if (hasCoupon === false) {
      clauses.push({
        $or: [
          {
            coupon: {
              $exists: false,
            },
          },
          {
            "coupon.code": {
              $exists: false,
            },
          },
          {
            "coupon.code": "",
          },
          {
            "coupon.code": null,
          },
        ],
      });
    }

    /* ---------------- Courier filters ---------------- */

    const includedCouriers =
      advancedFilterList(
        query.courier,
      );

    const excludedCouriers =
      advancedFilterList(
        query.excludeCourier,
      );

    if (includedCouriers.length) {
      clauses.push({
        $or: includedCouriers.flatMap(
          (courier) => {
            const regex = new RegExp(
              advancedFilterEscapeRegex(
                courier,
              ),
              "i",
            );

            return [
              {
                "shipment.courierName":
                  regex,
              },
              {
                "shipment.shiprocket.courierName":
                  regex,
              },
            ];
          },
        ),
      });
    }

    if (excludedCouriers.length) {
      clauses.push({
        $nor: excludedCouriers.flatMap(
          (courier) => {
            const regex = new RegExp(
              advancedFilterEscapeRegex(
                courier,
              ),
              "i",
            );

            return [
              {
                "shipment.courierName":
                  regex,
              },
              {
                "shipment.shiprocket.courierName":
                  regex,
              },
            ];
          },
        ),
      });
    }

    /* ---------------- Shipment existence filters ---------------- */

    advancedFilterAddTextExists({
      clauses,
      fields: [
        "shipment.awb",
        "shipment.shiprocket.awb",
      ],
      value: query.hasAwb,
    });

    advancedFilterAddTextExists({
      clauses,
      fields: [
        "shipment.trackingUrl",
        "shipment.shiprocket.trackingUrl",
      ],
      value: query.hasTracking,
    });

    advancedFilterAddTextExists({
      clauses,
      fields: [
        "shipment.labelUrl",
        "shipment.shiprocket.labelUrl",
      ],
      value: query.hasLabel,
    });

    /* ---------------- Global search ---------------- */

    const search =
      advancedFilterString(
        query.search ??
        query.customerName,
      );

    if (search) {
      const searchRegex = new RegExp(
        advancedFilterEscapeRegex(
          search,
        ),
        "i",
      );

      clauses.push({
        $or: [
          {
            orderNumber: searchRegex,
          },
          {
            "shippingAddressSnapshot.fullName":
              searchRegex,
          },
          {
            "shippingAddressSnapshot.email":
              searchRegex,
          },
          {
            "shippingAddressSnapshot.phone":
              searchRegex,
          },
          {
            "items.productSnapshot.productCode":
              searchRegex,
          },
          {
            "items.productSnapshot.title":
              searchRegex,
          },
          {
            "items.variant.sku":
              searchRegex,
          },
          {
            "attribution.source":
              searchRegex,
          },
          {
            "attribution.medium":
              searchRegex,
          },
          {
            "attribution.campaign":
              searchRegex,
          },
        ],
      });
    }

    /* ---------------- Final Mongo filter ---------------- */

    const mongoFilter =
      clauses.length === 0
        ? {}
        : clauses.length === 1
          ? clauses[0]
          : {
            $and: clauses,
          };

    /* ---------------- Pagination ---------------- */

    const page = Math.max(
      1,
      parseInt(
        advancedFilterString(
          query.page,
        ),
        10,
      ) || 1,
    );

    const requestedLimit =
      parseInt(
        advancedFilterString(
          query.limit,
        ),
        10,
      ) || 100;

    const limit = Math.min(
      Math.max(requestedLimit, 1),
      ADVANCED_FILTER_MAX_LIMIT,
    );

    const skip =
      (page - 1) * limit;

    const includeSum =
      advancedFilterBoolean(
        query.includeSum,
      ) === true;

    /* ---------------- Database query ---------------- */

    const databaseQueries = [
      Order.find(mongoFilter)
        .select(
          ADVANCED_ORDER_LIST_FIELDS,
        )
        .sort({
          priorityRank: -1,
          createdAt: -1,
        })
        .skip(skip)
        .limit(limit)
        .lean()
        .populate({
          path: "customerId",
          select:
            "name email phone",
        }),

      Order.countDocuments(
        mongoFilter,
      ),
    ];

    if (includeSum) {
      databaseQueries.push(
        Order.aggregate([
          {
            $match: mongoFilter,
          },
          {
            $group: {
              _id: null,
              totalSum: {
                $sum: {
                  $ifNull: [
                    "$finalPayable",
                    0,
                  ],
                },
              },
            },
          },
        ]),
      );
    }

    const [
      orders,
      totalCount,
      sumResult,
    ] = await Promise.all(
      databaseQueries,
    );
    const needsReadiness = orders.some(
      (order) =>
        order?.isConfirmed !== true &&
        String(order?.paymentMethod || "").toLowerCase() === "cod" &&
        String(order?.fulfillmentStatus || "").toLowerCase() === "processing"
    );

    const finalOrders = needsReadiness
      ? await enrichOrdersWithFulfillmentReadiness(orders)
      : orders;

    return res.status(200).json({
      orders: finalOrders,

      meta: {
        page,
        limit,
        totalCount,

        totalPages: Math.max(
          1,
          Math.ceil(
            totalCount / limit,
          ),
        ),

        totalSum: includeSum
          ? Number(
            sumResult?.[0]
              ?.totalSum || 0,
          )
          : null,

        hasMore:
          skip + orders.length <
          totalCount,
      },

      appliedFilters:
        query.debug === "true"
          ? mongoFilter
          : undefined,
    });
  } catch (error) {
    console.error(
      "Advanced order filter error:",
      error,
    );

    return res.status(500).json({
      message:
        "Unable to filter orders",
      error: error.message,
    });
  }
};

// ============================================================================
// SPLIT ORDER
// POST /api/orders/:orderId/split
//
// Body:
// {
//   "shipments": [
//     {
//       "items": [
//         { "lineId": "item-line-id-1", "quantity": 1 }
//       ]
//     },
//     {
//       "items": [
//         { "lineId": "item-line-id-2", "quantity": 1 }
//       ]
//     }
//   ]
// }
// ============================================================================

export const splitOrder = async (req, res) => {
  const session = await mongoose.startSession();

  const safeString = (value) =>
    String(value ?? "").trim();

  const safeNumber = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number)
      ? number
      : fallback;
  };

  const getVariantId = (item = {}) =>
    item?.variant?.variantId ||
    item?.variantId ||
    item?.variant?._id ||
    null;

  const makeInventoryKey = (
    productId,
    variantId = null,
  ) =>
    `${safeString(productId)}::${variantId
      ? safeString(variantId)
      : "root"
    }`;

  const buildReservationKey = ({
    refId,
    productId,
    variantId = null,
  }) =>
    `order:${safeString(refId)}:${safeString(
      productId,
    )}:${variantId
      ? safeString(variantId)
      : "root"
    }`;

  const appendNote = (
    oldText = "",
    nextText = "",
  ) => {
    const oldValue = safeString(oldText);
    const nextValue = safeString(nextText);

    if (!oldValue) return nextValue;
    if (!nextValue) return oldValue;

    return `${oldValue}\n${nextValue}`;
  };

  try {
    const { orderId } = req.params;
    const { shipments = [] } = req.body;

    /* =========================================================
       BASIC VALIDATION
    ========================================================= */

    if (
      !mongoose.Types.ObjectId.isValid(
        String(orderId || ""),
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid orderId",
      });
    }

    if (
      !Array.isArray(shipments) ||
      shipments.length < 2
    ) {
      return res.status(400).json({
        success: false,
        message:
          "At least two shipments are required.",
      });
    }

    if (shipments.length > 26) {
      return res.status(400).json({
        success: false,
        message:
          "Maximum 26 split shipments are allowed.",
      });
    }

    let parentOrderId = null;
    const createdChildIds = [];

    await session.withTransaction(async () => {
      /* =======================================================
         LOAD ORDER
      ======================================================= */

      const order = await Order.findById(
        orderId,
      ).session(session);

      if (!order) {
        throw new Error("Order not found");
      }

      const orderType = safeString(
        order.orderType || "shipment",
      ).toLowerCase();

      if (orderType === "parent") {
        throw new Error(
          "This order has already been split.",
        );
      }

      if (order.parentOrderId) {
        throw new Error(
          "A child shipment order cannot be split.",
        );
      }

      if (
        order.cancellation?.isCancelled ===
        true ||
        order.fulfillmentStatus ===
        "cancelled"
      ) {
        throw new Error(
          "Cancelled order cannot be split.",
        );
      }

      const blockedStatuses = [
        "picked",
        "shipped",
        "out_for_delivery",
        "delivered",
        "rto",
        "returned",
        "refunded",
      ];

      if (
        blockedStatuses.includes(
          safeString(
            order.fulfillmentStatus,
          ).toLowerCase(),
        )
      ) {
        throw new Error(
          `Order cannot be split in ${order.fulfillmentStatus} status.`,
        );
      }

      const existingChildren =
        await Order.exists({
          parentOrderId: order._id,
        }).session(session);

      if (existingChildren) {
        throw new Error(
          "Split shipment orders already exist.",
        );
      }

      /* =======================================================
         ITEMS + SPLIT VALIDATION
      ======================================================= */

      const originalItems =
        Array.isArray(order.items)
          ? order.items
          : [];

      if (!originalItems.length) {
        throw new Error(
          "Order has no items to split.",
        );
      }

      const itemMap = new Map(
        originalItems.map((item) => [
          safeString(item.lineId),
          item,
        ]),
      );

      const assignedQuantityMap =
        new Map();

      for (
        let shipmentIndex = 0;
        shipmentIndex < shipments.length;
        shipmentIndex += 1
      ) {
        const shipment =
          shipments[shipmentIndex];

        if (
          !Array.isArray(
            shipment?.items,
          ) ||
          !shipment.items.length
        ) {
          throw new Error(
            `Shipment ${shipmentIndex + 1
            } must contain at least one item.`,
          );
        }

        for (const requestedItem of shipment.items) {
          const lineId = safeString(
            requestedItem?.lineId,
          );

          const quantity = Number(
            requestedItem?.quantity,
          );

          if (!lineId) {
            throw new Error(
              `lineId missing in shipment ${shipmentIndex + 1
              }.`,
            );
          }

          if (
            !Number.isInteger(quantity) ||
            quantity < 1
          ) {
            throw new Error(
              `Invalid quantity for lineId ${lineId}.`,
            );
          }

          const originalItem =
            itemMap.get(lineId);

          if (!originalItem) {
            throw new Error(
              `Order item not found for lineId ${lineId}.`,
            );
          }

          const orderedQuantity =
            Math.max(
              0,
              safeNumber(
                originalItem.quantity,
              ),
            );

          const previous =
            assignedQuantityMap.get(
              lineId,
            ) || 0;

          const next =
            previous + quantity;

          if (next > orderedQuantity) {
            throw new Error(
              `Split quantity exceeds ordered quantity for ${originalItem
                ?.productSnapshot
                ?.title || lineId
              }.`,
            );
          }

          assignedQuantityMap.set(
            lineId,
            next,
          );
        }
      }

      for (const item of originalItems) {
        const lineId = safeString(
          item.lineId,
        );

        const orderedQuantity =
          Math.max(
            0,
            safeNumber(item.quantity),
          );

        const assignedQuantity =
          assignedQuantityMap.get(
            lineId,
          ) || 0;

        if (
          assignedQuantity !==
          orderedQuantity
        ) {
          throw new Error(
            `Complete quantity must be assigned for ${item?.productSnapshot
              ?.title || lineId
            }. Ordered: ${orderedQuantity}, assigned: ${assignedQuantity}.`,
          );
        }
      }

      /* =======================================================
         LOAD PARENT ACTIVE RESERVATIONS BEFORE MODIFYING ORDER
      ======================================================= */

      const parentReservations =
        await InventoryReservation.find({
          refType: "order",
          refId: order._id,
          status: {
            $in: [
              "pending",
              "reserved",
            ],
          },
        })
          .sort({
            createdAt: 1,
            _id: 1,
          })
          .session(session);

      /*
       * IMPORTANT:
       * We do NOT release these reservations.
       * We do NOT reserve stock again.
       *
       * Ownership will simply move:
       *
       * parent -> child A / child B
       *
       * Therefore physical stock and reservedStock stay unchanged.
       */

      /* =======================================================
         SAVE ORIGINAL FINANCIAL VALUES BEFORE PARENT CONVERSION
      ======================================================= */

      const originalParent =
        order.toObject();

      const totalSubtotal =
        safeNumber(order.subtotal);

      const totalDiscount =
        safeNumber(order.discount);

      const totalShippingFee =
        safeNumber(order.shippingFee);

      const totalTax =
        safeNumber(order.tax);

      const totalWalletAmount =
        Math.max(
          0,
          safeNumber(
            order?.walletCredit
              ?.amount ??
            order?.paymentBreakdown
              ?.walletAmount,
          ),
        );

      /* =======================================================
         CONVERT ORIGINAL ORDER INTO LOGICAL PARENT
      ======================================================= */

      parentOrderId = order._id;

      order.orderType = "parent";
      order.parentOrderId = null;
      order.splitSuffix = "";

      /*
       * Parent remains financial/source record.
       * It must not behave like warehouse shipment.
       */

      order.isPackable = false;

      order.shipment = {
        provider:
          order.shipment?.provider ||
          "shiprocket",

        status: "pending",

        orderId: "",
        shipmentId: "",
        awb: "",
        courierName: "",
        trackingUrl: "",
        labelUrl: "",
      };

      order.trackingDetails = {
        trackingId: "",
        awb: "",
        provider: "",
        courierName: "",
        trackingUrl: "",
        lastUpdatedAt: null,
      };

      await order.save({
        session,
      });

      /* =======================================================
         CHILD ORDERS
      ======================================================= */

      const alphabet =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

      let distributedDiscount = 0;
      let distributedShippingFee = 0;
      let distributedTax = 0;
      let distributedWalletAmount = 0;

      /*
       * Used afterwards to distribute existing reservations.
       */
      const childAllocationPlans = [];

      for (
        let index = 0;
        index < shipments.length;
        index += 1
      ) {
        const shipmentRequest =
          shipments[index];

        const splitSuffix =
          alphabet[index];

        /* ---------------------------------------------------
           ITEMS
        --------------------------------------------------- */

        const childItems =
          shipmentRequest.items.map(
            (requestedItem) => {
              const originalItem =
                itemMap.get(
                  safeString(
                    requestedItem.lineId,
                  ),
                );

              const quantity =
                Number(
                  requestedItem.quantity,
                );

              const price =
                safeNumber(
                  originalItem.price,
                );

              const subtotal =
                price * quantity;

              const itemObject =
                typeof originalItem.toObject ===
                  "function"
                  ? originalItem.toObject()
                  : {
                    ...originalItem,
                  };

              return {
                ...itemObject,

                quantity,
                subtotal,

                /*
                 * Reservation sync after migration
                 * becomes source of truth for
                 * allocatedQty.
                 */
                fulfillment: {
                  ...(itemObject.fulfillment ||
                    {}),

                  allocatedQty: 0,
                  shippedQty: 0,

                  toProduceQty:
                    quantity,
                },
              };
            },
          );

        const childSubtotal =
          childItems.reduce(
            (sum, item) =>
              sum +
              safeNumber(
                item.subtotal,
              ),
            0,
          );

        const ratio =
          totalSubtotal > 0
            ? childSubtotal /
            totalSubtotal
            : 1 /
            shipments.length;

        const isLastChild =
          index ===
          shipments.length - 1;

        /* ---------------------------------------------------
           MONEY DISTRIBUTION
        --------------------------------------------------- */

        const childDiscount =
          isLastChild
            ? totalDiscount -
            distributedDiscount
            : Math.round(
              totalDiscount *
              ratio,
            );

        const childShippingFee =
          isLastChild
            ? totalShippingFee -
            distributedShippingFee
            : Math.round(
              totalShippingFee *
              ratio,
            );

        const childTax =
          isLastChild
            ? totalTax -
            distributedTax
            : Math.round(
              totalTax * ratio,
            );

        const childWalletAmount =
          isLastChild
            ? totalWalletAmount -
            distributedWalletAmount
            : Math.round(
              totalWalletAmount *
              ratio,
            );

        distributedDiscount +=
          childDiscount;

        distributedShippingFee +=
          childShippingFee;

        distributedTax +=
          childTax;

        distributedWalletAmount +=
          childWalletAmount;

        const childTotalAmount =
          childSubtotal +
          childShippingFee +
          childTax;

        /*
         * Order model itself calculates:
         *
         * finalPayable =
         * totalAmount
         * - discount
         * - wallet
         *
         * So child values must match that formula.
         */

        const childBeforeWallet =
          Math.max(
            0,
            childTotalAmount -
            childDiscount,
          );

        const safeChildWalletAmount =
          Math.min(
            childWalletAmount,
            childBeforeWallet,
          );

        const childFinalPayable =
          Math.max(
            0,
            childBeforeWallet -
            safeChildWalletAmount,
          );

        /* ---------------------------------------------------
           PAYMENT BREAKDOWN
        --------------------------------------------------- */

        const childPaymentBreakdown = {
          walletAmount:
            safeChildWalletAmount,

          razorpayAmount:
            order.paymentMethod ===
              "razorpay"
              ? childFinalPayable
              : 0,

          codAmount:
            order.paymentMethod === "cod"
              ? childFinalPayable
              : 0,
        };

        /* ---------------------------------------------------
           COUPON SNAPSHOT
        --------------------------------------------------- */

        const childCoupon =
          originalParent?.coupon
            ? {
              ...originalParent.coupon,

              discount:
                Math.max(
                  0,
                  childDiscount,
                ),

              finalTotal:
                childFinalPayable,
            }
            : null;

        /* ---------------------------------------------------
           PAYLOAD
        --------------------------------------------------- */

        const parentObject = {
          ...originalParent,
        };

        delete parentObject._id;
        delete parentObject.__v;
        delete parentObject.createdAt;
        delete parentObject.updatedAt;

        const childOrderPayload = {
          ...parentObject,

          orderNumber: `${order.orderNumber}-${splitSuffix}`,

          orderType: "shipment",

          parentOrderId:
            order._id,

          splitSuffix,

          items: childItems,

          subtotal:
            childSubtotal,

          discount:
            Math.max(
              0,
              childDiscount,
            ),

          shippingFee:
            Math.max(
              0,
              childShippingFee,
            ),

          tax:
            Math.max(
              0,
              childTax,
            ),

          totalAmount:
            Math.max(
              0,
              childTotalAmount,
            ),

          finalPayable:
            childFinalPayable,

          coupon:
            childCoupon,

          /*
           * Split wallet financially,
           * but DO NOT debit wallet again.
           */
          walletCredit: {
            used:
              safeChildWalletAmount >
              0,

            amount:
              safeChildWalletAmount,

            /*
             * Reference original debit only.
             * No new debit occurs here.
             */
            transactionId:
              originalParent
                ?.walletCredit
                ?.transactionId ||
              "",

            debitedAt:
              originalParent
                ?.walletCredit
                ?.debitedAt ||
              null,

            balanceAfterDebit:
              originalParent
                ?.walletCredit
                ?.balanceAfterDebit ||
              0,
          },

          paymentBreakdown:
            childPaymentBreakdown,

          /*
           * Financial payment transaction
           * belongs to parent.
           *
           * Do not duplicate Razorpay IDs
           * across child shipment orders.
           */
          razorpay: {
            orderId: "",
            paymentId: "",
            signature: "",
            amount: 0,
            currency:
              originalParent
                ?.razorpay
                ?.currency ||
              originalParent
                ?.currency ||
              "INR",
            paidAt: null,
          },

          /*
           * Payment state itself remains
           * inherited because customer has
           * already paid / selected COD
           * on original order.
           */
          paymentMethod:
            originalParent.paymentMethod,

          paymentStatus:
            originalParent.paymentStatus,

          isConfirmed:
            originalParent.isConfirmed ===
            true,

          confirmedAt:
            originalParent.confirmedAt ||
            null,

          confirmedBy:
            originalParent.confirmedBy ||
            null,

          fulfillmentStatus:
            "processing",

          fulfillmentDates: {
            processingAt:
              new Date(),

            packedAt: null,
            pickedAt: null,
            shippedAt: null,
            outForDeliveryAt: null,
            deliveredAt: null,
            pickupInitiatedAt: null,
            returnRequestedAt: null,
            exchangeRequestedAt: null,
            returnedAt: null,
            refundedAt: null,
            exchangedAt: null,
            cancelledAt: null,
            rtoAt: null,
            failedAt: null,
          },

          cancellation: {
            isCancelled: false,
            cancelledAt: null,
            reason: "",
          },

          shipment: {
            provider:
              originalParent
                ?.shipment
                ?.provider ||
              "shiprocket",

            status: "pending",

            orderId: "",
            shipmentId: "",
            awb: "",
            courierName: "",
            trackingUrl: "",
            labelUrl: "",
          },

          trackingDetails: {
            trackingId: "",
            awb: "",
            provider: "",
            courierName: "",
            trackingUrl: "",
            lastUpdatedAt: null,
          },

          isPackable: false,

          rmas: [],

          eligibleForRefund: false,
          eligibleForRma: false,

          reviewRequest: {
            sent: false,
            sentAt: null,
            channel: "fast2sms",
            token: "",
            link: "",
            error: "",
          },

          analytics: {
            ...(originalParent.analytics ||
              {}),

            totalItems:
              childItems.reduce(
                (sum, item) =>
                  sum +
                  safeNumber(
                    item.quantity,
                  ),
                0,
              ),

            averageItemPrice:
              childItems.reduce(
                (sum, item) =>
                  sum +
                  safeNumber(
                    item.quantity,
                  ),
                0,
              ) > 0
                ? childSubtotal /
                childItems.reduce(
                  (sum, item) =>
                    sum +
                    safeNumber(
                      item.quantity,
                    ),
                  0,
                )
                : 0,

            creditsUsed:
              safeChildWalletAmount >
              0,
          },
        };

        const [childOrder] =
          await Order.create(
            [childOrderPayload],
            {
              session,
            },
          );

        createdChildIds.push(
          childOrder._id,
        );

        /* ---------------------------------------------------
           BUILD RESERVATION NEED MAP FOR CHILD
        --------------------------------------------------- */

        const needMap = new Map();

        for (const item of childItems) {
          const productId =
            item?.productId?._id ||
            item?.productId;

          if (!productId) {
            continue;
          }

          const variantId =
            getVariantId(item);

          const key =
            makeInventoryKey(
              productId,
              variantId,
            );

          const quantity =
            Math.max(
              0,
              safeNumber(
                item.quantity,
              ),
            );

          if (quantity <= 0) {
            continue;
          }

          if (!needMap.has(key)) {
            needMap.set(key, {
              productId,
              variantId,
              quantity: 0,
            });
          }

          needMap.get(key).quantity +=
            quantity;
        }

        childAllocationPlans.push({
          childOrderId:
            childOrder._id,

          orderNumber:
            childOrder.orderNumber,

          needMap,
        });
      }

      /* =======================================================
         RESERVATION MIGRATION
         Parent -> Children

         IMPORTANT:
         - No releaseReservedStock()
         - No reserveAvailableStockNow()
         - No stock increment/decrement
         - Same total active reservation qty
      ======================================================= */

      for (
        const parentReservation of parentReservations
      ) {
        const reservationObject =
          parentReservation.toObject();

        const key =
          makeInventoryKey(
            parentReservation.productId,
            parentReservation.variantId ||
            null,
          );

        let remainingReservationQty =
          Math.max(
            0,
            safeNumber(
              parentReservation.qty,
            ),
          );

        const allocations = [];

        for (
          const plan of
          childAllocationPlans
        ) {
          if (
            remainingReservationQty <=
            0
          ) {
            break;
          }

          const need =
            plan.needMap.get(key);

          if (!need) {
            continue;
          }

          const remainingNeed =
            Math.max(
              0,
              safeNumber(
                need.quantity,
              ),
            );

          if (
            remainingNeed <= 0
          ) {
            continue;
          }

          const allocationQty =
            Math.min(
              remainingReservationQty,
              remainingNeed,
            );

          if (
            allocationQty <= 0
          ) {
            continue;
          }

          allocations.push({
            childOrderId:
              plan.childOrderId,

            orderNumber:
              plan.orderNumber,

            qty: allocationQty,
          });

          need.quantity -=
            allocationQty;

          remainingReservationQty -=
            allocationQty;
        }

        /*
         * Active reservation exists but none
         * of the child items match it.
         *
         * Better to stop whole split than
         * silently orphan reserved inventory.
         */
        if (
          !allocations.length &&
          safeNumber(
            parentReservation.qty,
          ) > 0
        ) {
          throw new Error(
            `Unable to migrate reservation ${parentReservation._id} while splitting order.`,
          );
        }

        /*
         * If full active reservation qty
         * cannot be assigned, stop transaction.
         */
        if (
          remainingReservationQty > 0
        ) {
          throw new Error(
            `Reservation quantity mismatch while splitting ${order.orderNumber}.`,
          );
        }

        /*
         * Delete original reservation document
         * ONLY as DB ownership record.
         *
         * We intentionally do NOT call stock
         * release because stock hold must remain.
         */
        await InventoryReservation.deleteOne(
          {
            _id:
              parentReservation._id,
          },
          {
            session,
          },
        );

        /*
         * Recreate reservation ownership rows
         * preserving SAME status + total qty.
         */
        for (const allocation of allocations) {
          const clonedReservation = {
            ...reservationObject,

            _id:
              new mongoose.Types.ObjectId(),

            refType: "order",

            refId:
              allocation.childOrderId,

            orderNumber:
              allocation.orderNumber,

            qty:
              allocation.qty,

            reservationKey:
              buildReservationKey({
                refId:
                  allocation.childOrderId,

                productId:
                  parentReservation.productId,

                variantId:
                  parentReservation.variantId ||
                  null,
              }),

            notes:
              appendNote(
                parentReservation.notes,

                `Reservation moved from split parent ${order.orderNumber} to ${allocation.orderNumber}`,
              ),

            updatedAt:
              new Date(),
          };

          /*
           * Preserve original creation time if
           * available for FIFO history.
           */
          if (
            reservationObject.createdAt
          ) {
            clonedReservation.createdAt =
              reservationObject.createdAt;
          }

          delete clonedReservation.__v;

          await InventoryReservation.create(
            [clonedReservation],
            {
              session,
            },
          );
        }
      }

      /* =======================================================
         SYNC ALLOCATED QTY FROM NEW RESERVATION OWNERSHIP
      ======================================================= */

      await syncOrderAllocatedQtyFromReservations(
        {
          orderId: order._id,
          debug: false,
          session,
        },
      );

      for (
        const childOrderId of
        createdChildIds
      ) {
        await syncOrderAllocatedQtyFromReservations(
          {
            orderId:
              childOrderId,

            debug: false,
            session,
          },
        );
      }

      /*
       * Parent should have zero allocated qty
       * after reservations moved away.
       *
       * Children get actual allocation from
       * their reservation records.
       */

      const syncedChildren =
        await Order.find({
          _id: {
            $in: createdChildIds,
          },
        }).session(session);

      for (const child of syncedChildren) {
        const childItems =
          Array.isArray(child.items)
            ? child.items
            : [];

        child.isPackable =
          childItems.length > 0 &&
          childItems.every((item) => {
            const orderedQty =
              Math.max(
                0,
                safeNumber(
                  item.quantity,
                ),
              );

            const allocatedQty =
              Math.max(
                0,
                safeNumber(
                  item
                    ?.fulfillment
                    ?.allocatedQty,
                ),
              );

            return (
              allocatedQty >=
              orderedQty
            );
          });

        await child.save({
          session,
        });
      }
    });

    /* =========================================================
       RESPONSE
    ========================================================= */

    const parent =
      await Order.findById(
        parentOrderId,
      )
        .populate(
          "customerId",
          "name email phone",
        )
        .lean();

    const children =
      await Order.find({
        _id: {
          $in: createdChildIds,
        },
      })
        .sort({
          splitSuffix: 1,
        })
        .populate(
          "customerId",
          "name email phone",
        )
        .lean();

    return res.status(201).json({
      success: true,

      message: `Order ${parent.orderNumber} split into ${children.length} shipments successfully.`,

      parent,
      children,
    });
  } catch (error) {
    console.error(
      "❌ Split Order Error:",
      error,
    );

    return res.status(400).json({
      success: false,

      message:
        error.message ||
        "Order split failed.",
    });
  } finally {
    await session.endSession();
  }
};


export const toggleTestingOrder = async (req, res) => {
  try {
    const { id } = req.params;

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    order.isTestingOrder = !order.isTestingOrder;

    await order.save();

    return res.status(200).json({
      success: true,
      message: `Order marked as ${order.isTestingOrder ? "Testing" : "Normal"
        } successfully.`,
      order,
    });
  } catch (error) {
    console.error("Toggle Testing Order:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update testing order.",
    });
  }
};


/* ============================================================
   MANUALLY SEND PAYMENT RECOVERY EMAIL
   POST /api/orders/:id/send-payment-recovery-email
============================================================ */

export const sendOrderPaymentRecoveryEmail = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order id",
      });
    }

    const order = await Order.findById(id)
      .populate("customerId", "name email phone");

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const paymentMethod = String(
      order?.paymentMethod || "",
    )
      .trim()
      .toLowerCase();

    const paymentStatus = String(
      order?.paymentStatus || "",
    )
      .trim()
      .toLowerCase();

    const fulfillmentStatus = String(
      order?.fulfillmentStatus || "",
    )
      .trim()
      .toLowerCase();

    const isCancelled =
      order?.cancellation?.isCancelled === true ||
      fulfillmentStatus === "cancelled";

    if (isCancelled) {
      return res.status(400).json({
        success: false,
        message:
          "Payment recovery email cannot be sent for a cancelled order",
      });
    }

    if (
      !["razorpay", "manual_prepaid"].includes(
        paymentMethod,
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Payment recovery email is available only for online payment orders",
      });
    }

    if (
      !["pending", "failed"].includes(
        paymentStatus,
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          paymentStatus === "paid"
            ? "Order payment is already completed"
            : `Payment recovery email cannot be sent for status: ${paymentStatus}`,
      });
    }

    if (order?.razorpay?.paymentId) {
      return res.status(400).json({
        success: false,
        message:
          "Razorpay payment ID already exists. Recovery email was not sent",
      });
    }

    const clientUrl =
      process.env.CLIENT_URL ||
      "http://localhost:3000";

    const paymentLink =
      String(req.body?.paymentLink || "").trim() ||
      `${clientUrl}/payment/retry/${order._id}`;

    const requestedExpiry = req.body?.expiresAt
      ? new Date(req.body.expiresAt)
      : null;

    const expiresAt =
      requestedExpiry &&
        !Number.isNaN(requestedExpiry.getTime())
        ? requestedExpiry
        : new Date(
          Date.now() +
          24 * 60 * 60 * 1000,
        );

    const result =
      await sendCustomerPaymentRecoveryMail(
        order,
        {
          paymentLink,
          expiresAt,
        },
      );

    if (!result?.success) {
      return res.status(
        result?.skipped ? 400 : 500,
      ).json({
        success: false,
        skipped: Boolean(result?.skipped),
        message:
          result?.reason ||
          result?.error ||
          "Payment recovery email could not be sent",
      });
    }

    return res.status(200).json({
      success: true,
      message:
        "Payment recovery email sent successfully",
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        paymentMethod,
        paymentStatus,
        email: result.email,
        paymentLink,
        expiresAt,
      },
    });
  } catch (error) {
    console.error(
      "❌ Send Payment Recovery Email Error:",
      error,
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to send payment recovery email",
      error: error.message,
    });
  }
};


/* ============================================================
   BULK SEND PAYMENT RECOVERY EMAILS
   POST /api/orders/send-payment-recovery-emails
   body: { orderIds: [] }
============================================================ */

export const sendBulkOrderPaymentRecoveryEmails = async (
  req,
  res,
) => {
  try {
    const rawOrderIds = Array.isArray(
      req.body?.orderIds,
    )
      ? req.body.orderIds
      : [];

    const orderIds = [
      ...new Set(
        rawOrderIds
          .map((id) => String(id || "").trim())
          .filter((id) =>
            mongoose.Types.ObjectId.isValid(id),
          ),
      ),
    ];

    if (!orderIds.length) {
      return res.status(400).json({
        success: false,
        message:
          "At least one valid order id is required",
      });
    }

    const maxBulkSize = 100;

    if (orderIds.length > maxBulkSize) {
      return res.status(400).json({
        success: false,
        message: `Maximum ${maxBulkSize} orders can be processed at once`,
      });
    }

    const orders = await Order.find({
      _id: {
        $in: orderIds,
      },
    }).populate(
      "customerId",
      "name email phone",
    );

    const clientUrl =
      process.env.CLIENT_URL ||
      "http://localhost:3000";

    const expiresAt = new Date(
      Date.now() +
      24 * 60 * 60 * 1000,
    );

    const results = [];

    for (const order of orders) {
      const paymentMethod = String(
        order?.paymentMethod || "",
      )
        .trim()
        .toLowerCase();

      const paymentStatus = String(
        order?.paymentStatus || "",
      )
        .trim()
        .toLowerCase();

      const fulfillmentStatus = String(
        order?.fulfillmentStatus || "",
      )
        .trim()
        .toLowerCase();

      const isCancelled =
        order?.cancellation?.isCancelled ===
        true ||
        fulfillmentStatus === "cancelled";

      const orderResult = {
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        paymentMethod,
        paymentStatus,
        success: false,
        skipped: false,
        email: "",
        reason: "",
      };

      if (isCancelled) {
        orderResult.skipped = true;
        orderResult.reason =
          "Order is cancelled";
        results.push(orderResult);
        continue;
      }

      if (
        !["razorpay", "manual_prepaid"].includes(
          paymentMethod,
        )
      ) {
        orderResult.skipped = true;
        orderResult.reason =
          "Not an online payment order";
        results.push(orderResult);
        continue;
      }

      if (
        !["pending", "failed"].includes(
          paymentStatus,
        )
      ) {
        orderResult.skipped = true;
        orderResult.reason =
          paymentStatus === "paid"
            ? "Payment already completed"
            : "Payment status not eligible";
        results.push(orderResult);
        continue;
      }

      if (order?.razorpay?.paymentId) {
        orderResult.skipped = true;
        orderResult.reason =
          "Razorpay payment ID already exists";
        results.push(orderResult);
        continue;
      }

      const paymentLink =
        `${clientUrl}/payment/retry/${order._id}`;

      const sendResult =
        await sendCustomerPaymentRecoveryMail(
          order,
          {
            paymentLink,
            expiresAt,
          },
        );

      orderResult.success =
        Boolean(sendResult?.success);

      orderResult.skipped =
        Boolean(sendResult?.skipped);

      orderResult.email =
        sendResult?.email || "";

      orderResult.reason =
        sendResult?.reason ||
        sendResult?.error ||
        "";

      results.push(orderResult);
    }

    const foundOrderIds = new Set(
      orders.map((order) =>
        String(order._id),
      ),
    );

    for (const orderId of orderIds) {
      if (!foundOrderIds.has(orderId)) {
        results.push({
          orderId,
          orderNumber: "",
          success: false,
          skipped: true,
          email: "",
          reason: "Order not found",
        });
      }
    }

    const sentCount = results.filter(
      (item) => item.success,
    ).length;

    const skippedCount = results.filter(
      (item) => item.skipped,
    ).length;

    const failedCount =
      results.length -
      sentCount -
      skippedCount;

    return res.status(200).json({
      success: true,
      message: `${sentCount} payment recovery email(s) sent`,
      summary: {
        requested: orderIds.length,
        found: orders.length,
        sent: sentCount,
        skipped: skippedCount,
        failed: failedCount,
      },
      results,
    });
  } catch (error) {
    console.error(
      "❌ Bulk Payment Recovery Email Error:",
      error,
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to process bulk payment recovery emails",
      error: error.message,
    });
  }
};

// ============================================================
// ADMIN: GET ALL PACKED ORDERS FOR COURIER ASSIGNMENT / REBOOKING
// GET /api/orders/shipping/packed
// ============================================================

export const getPackedOrdersForShipping = async (req, res) => {
  try {
    const {
      provider = "",
      search = "",
      page = "1",
      limit = "100",
    } = req.query;

    const pageNumber = Math.max(1, Number(page) || 1);
    const limitNumber = Math.min(
      Math.max(1, Number(limit) || 100),
      200,
    );

    const skip = (pageNumber - 1) * limitNumber;

    const filters = {
      fulfillmentStatus: "packed",
      isConfirmed: true,
      "cancellation.isCancelled": { $ne: true },
    };

    const andConditions = [];

    // ============================================================
    // PROVIDER FILTER
    // ============================================================

    const normalizedProvider = String(provider || "")
      .trim()
      .toLowerCase();

    if (normalizedProvider === "unassigned") {
      andConditions.push({
        $or: [
          { "shipment.provider": { $exists: false } },
          { "shipment.provider": null },
          { "shipment.provider": "" },
          { "shipment.provider": "unassigned" },
        ],
      });
    }

    if (
      normalizedProvider === "shiprocket" ||
      normalizedProvider === "delhivery"
    ) {
      andConditions.push({
        "shipment.provider": normalizedProvider,
      });
    }

    // ============================================================
    // SEARCH FILTER
    // ============================================================

    const normalizedSearch = String(search || "").trim();

    if (normalizedSearch) {
      const escapedSearch = normalizedSearch.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      );

      const searchRegex = new RegExp(escapedSearch, "i");

      andConditions.push({
        $or: [
          { orderNumber: searchRegex },
          { "shippingAddressSnapshot.fullName": searchRegex },
          { "shippingAddressSnapshot.phone": searchRegex },
          { "shippingAddressSnapshot.email": searchRegex },
          { "shippingAddressSnapshot.city": searchRegex },
          { "shippingAddressSnapshot.state": searchRegex },
          { "shippingAddressSnapshot.pincode": searchRegex },

          { "shipment.awb": searchRegex },
          { "shipment.courierName": searchRegex },

          { "items.productSnapshot.title": searchRegex },
          { "items.productSnapshot.productCode": searchRegex },
          { "items.variant.sku": searchRegex },
        ],
      });
    }

    if (andConditions.length > 0) {
      filters.$and = andConditions;
    }

    // ============================================================
    // FETCH ORDERS
    // ============================================================

    const [orders, totalCount] = await Promise.all([
      Order.find(filters)
        .select({
          orderNumber: 1,
          createdAt: 1,
          orderDate: 1,

          fulfillmentStatus: 1,
          fulfillmentDates: 1,

          paymentMethod: 1,
          paymentStatus: 1,
          finalPayable: 1,
          currency: 1,

          priority: 1,
          isInfluencerOrder: 1,
          isConfirmed: 1,

          shippingAddressSnapshot: 1,

          shipment: 1,

          "items.quantity": 1,
          "items.price": 1,
          "items.subtotal": 1,
          "items.selectedSize": 1,
          "items.selectedColor": 1,

          "items.productSnapshot.title": 1,
          "items.productSnapshot.productCode": 1,
          "items.productSnapshot.thumbnail": 1,
          "items.productSnapshot.weight": 1,

          "items.variant.weight": 1,
          "items.variant.sku": 1,
        })
        .sort({
          "fulfillmentDates.packedAt": 1,
          createdAt: 1,
        })
        .skip(skip)
        .limit(limitNumber)
        .lean(),

      Order.countDocuments(filters),
    ]);

    // ============================================================
    // NORMALIZE RESPONSE
    // ============================================================

    const normalizedOrders = orders.map((order) => {
      const items = Array.isArray(order.items) ? order.items : [];

      const totalQuantity = items.reduce(
        (sum, item) => sum + Number(item?.quantity || 0),
        0,
      );

      const totalWeight = items.reduce((sum, item) => {
        const quantity = Number(item?.quantity || 0);

        const itemWeight =
          Number(item?.variant?.weight || 0) ||
          Number(item?.productSnapshot?.weight || 0);

        return sum + itemWeight * quantity;
      }, 0);

      const paymentMethod = String(
        order.paymentMethod || "",
      ).toLowerCase();

      const shipmentProvider = String(
        order?.shipment?.provider || "",
      ).toLowerCase();

      const shipmentStatus = String(
        order?.shipment?.status || "",
      ).toLowerCase();

      const awb = String(order?.shipment?.awb || "").trim();

      const hasActiveShipment =
        Boolean(awb) &&
        ![
          "cancelled",
          "canceled",
          "failed",
          "void",
        ].includes(shipmentStatus);

      const canBookShipment = !hasActiveShipment;

      const canChangeCourier =
        Boolean(awb) ||
        ["booked", "cancelled", "canceled", "failed"].includes(
          shipmentStatus,
        );

      return {
        ...order,

        shippingSummary: {
          totalQuantity,
          totalWeight,

          isCod: paymentMethod === "cod",

          codAmount:
            paymentMethod === "cod"
              ? Number(order.finalPayable || 0)
              : 0,
        },

        courierSummary: {
          provider: shipmentProvider || "unassigned",
          status: shipmentStatus || "pending",
          awb,

          hasShipment: Boolean(awb),
          hasActiveShipment,
          canBookShipment,
          canChangeCourier,
        },
      };
    });

    return res.status(200).json({
      success: true,
      orders: normalizedOrders,

      meta: {
        page: pageNumber,
        limit: limitNumber,
        totalCount,
        hasMore:
          skip + normalizedOrders.length < totalCount,
      },
    });
  } catch (error) {
    console.error(
      "❌ Get packed shipping orders error:",
      error,
    );

    return res.status(500).json({
      success: false,
      message: "Unable to fetch packed orders.",
      error: error.message,
    });
  }
};

// ============================================================
// ADMIN: ASSIGN COURIER TO PACKED ORDER
// PATCH /api/orders/:id/courier
//
// Body:
// {
//   "provider": "shiprocket"
// }
//
// or
//
// {
//   "provider": "delhivery"
// }
// ============================================================

export const assignCourierToPackedOrder = async (req, res) => {
  try {
    const { id } = req.params;

    const provider = String(req.body?.provider || "")
      .trim()
      .toLowerCase();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order id.",
      });
    }

    if (!["shiprocket", "delhivery", "unassigned"].includes(provider)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid provider. Allowed providers: shiprocket, delhivery, unassigned.",
      });
    }

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    if (isParentOrder(order)) {
      return res.status(400).json({
        success: false,
        message: "Courier cannot be assigned to a parent order.",
      });
    }

    if (!order.isConfirmed) {
      return res.status(400).json({
        success: false,
        message: "Confirm the order before assigning a courier.",
      });
    }

    if (
      String(order.fulfillmentStatus || "")
        .trim()
        .toLowerCase() !== "packed"
    ) {
      return res.status(400).json({
        success: false,
        message: "Only packed orders can be assigned to a courier.",
      });
    }

    if (order.cancellation?.isCancelled === true) {
      return res.status(400).json({
        success: false,
        message: "Cancelled order cannot be assigned to a courier.",
      });
    }

    const existingAwb =
      order.shipment?.awb ||
      order.shipment?.shiprocket?.awb ||
      order.shipment?.delhivery?.waybill;

    if (existingAwb) {
      return res.status(409).json({
        success: false,
        message: "Courier cannot be changed after shipment booking.",
        provider: order.shipment?.provider,
        awb: existingAwb,
      });
    }

    order.shipment = order.shipment || {};

    order.shipment.provider = provider;
    order.shipment.status = "pending";

    await order.save();

    return res.status(200).json({
      success: true,
      message:
        provider === "unassigned"
          ? "Courier assignment removed."
          : `Order assigned to ${provider}.`,
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,
        fulfillmentStatus: order.fulfillmentStatus,
        shipment: {
          provider: order.shipment.provider,
          status: order.shipment.status,
          awb: order.shipment.awb || "",
        },
      },
    });
  } catch (error) {
    console.error("❌ Assign courier error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to assign courier.",
      error: error.message,
    });
  }
};

// ============================================================
// ADMIN: GET SHIPROCKET COURIER RATES FOR PACKED ORDER
// GET /api/orders/:id/shiprocket/rates
// ============================================================

export const getShiprocketRatesForOrder = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order id.",
      });
    }

    const order = await Order.findById(id).lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    if (isParentOrder(order)) {
      return res.status(400).json({
        success: false,
        message: "Parent order cannot be shipped.",
      });
    }

    if (!order.isConfirmed) {
      return res.status(400).json({
        success: false,
        message: "Confirm order before checking rates.",
      });
    }

    if (
      String(order.fulfillmentStatus || "")
        .trim()
        .toLowerCase() !== "packed"
    ) {
      return res.status(400).json({
        success: false,
        message: "Only packed orders can check courier rates.",
      });
    }

    const address = order.shippingAddressSnapshot || {};

    if (!address.pincode) {
      return res.status(400).json({
        success: false,
        message: "Shipping pincode is missing.",
      });
    }

    const totalWeight = (order.items || []).reduce((sum, item) => {
      const quantity = Number(item.quantity || 0);

      const itemWeight =
        Number(item?.variant?.weight || 0) ||
        Number(item?.productSnapshot?.weight || 0);

      return sum + itemWeight * quantity;
    }, 0);

    // Shiprocket commonly expects weight in KG.
    // Keep a safe minimum to avoid invalid zero-weight requests.
    const weight = Math.max(totalWeight || 0.5, 0.5);

    const cod =
      String(order.paymentMethod || "").toLowerCase() === "cod" ? 1 : 0;

    const pickupPincode =
      process.env.SHIPROCKET_PICKUP_PINCODE ||
      process.env.PICKUP_PINCODE ||
      "";

    if (!pickupPincode) {
      return res.status(500).json({
        success: false,
        message: "Shiprocket pickup pincode is not configured.",
      });
    }

    const serviceabilityResult = await checkServiceability({
      pickup_postcode: pickupPincode,
      delivery_postcode: String(address.pincode),
      weight,
      cod,
      declared_value: Number(order.finalPayable || order.totalAmount || 0),
    });

    const couriers =
      serviceabilityResult?.data?.available_courier_companies ||
      serviceabilityResult?.available_courier_companies ||
      serviceabilityResult?.couriers ||
      [];

    return res.status(200).json({
      success: true,
      orderId: order._id,
      orderNumber: order.orderNumber,
      weight,
      cod: Boolean(cod),
      couriers,
      raw: serviceabilityResult,
    });
  } catch (error) {
    console.error("❌ Shiprocket rates error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch Shiprocket rates.",
      error: error?.message || "unknown_error",
    });
  }
};

// ============================================================
// ADMIN: GET DELHIVERY DIRECT RATE
// GET /api/orders/:id/delhivery/rate
// ============================================================

export const getDelhiveryRateForOrder = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order id.",
      });
    }

    const order = await Order.findById(id).lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    if (isParentOrder(order)) {
      return res.status(400).json({
        success: false,
        message: "Parent order cannot be shipped.",
      });
    }

    if (!order.isConfirmed) {
      return res.status(400).json({
        success: false,
        message: "Confirm order before checking courier rates.",
      });
    }

    if (
      String(order.fulfillmentStatus || "")
        .trim()
        .toLowerCase() !== "packed"
    ) {
      return res.status(400).json({
        success: false,
        message: "Only packed orders can check courier rates.",
      });
    }

    const pincode = String(
      order?.shippingAddressSnapshot?.pincode || "",
    )
      .replace(/\D/g, "")
      .slice(0, 6);

    if (!/^\d{6}$/.test(pincode)) {
      return res.status(400).json({
        success: false,
        message: "Valid shipping pincode is required.",
      });
    }

    const isCod =
      String(order.paymentMethod || "")
        .trim()
        .toLowerCase() === "cod";

    // Step 1: Check serviceability
    const serviceability =
      await checkDelhiveryServiceability(pincode);

    const paymentModeAvailable = isCod
      ? serviceability?.codAvailable === true
      : serviceability?.prepaidAvailable === true;

    const serviceable =
      serviceability?.serviceable === true &&
      paymentModeAvailable;

    // Stop here when unavailable
    if (!serviceable) {
      return res.status(200).json({
        success: true,
        orderId: order._id,
        orderNumber: order.orderNumber,

        option: {
          courierName: "Delhivery Direct",
          serviceable: false,

          codAvailable: Boolean(
            serviceability?.codAvailable,
          ),

          prepaidAvailable: Boolean(
            serviceability?.prepaidAvailable,
          ),

          pickupAvailable: Boolean(
            serviceability?.pickupAvailable,
          ),

          rate: null,
          codCharges: null,
          estimatedDays: "",
          pricingAvailable: false,

          unavailableReason: isCod
            ? "Delhivery COD is unavailable for this pincode."
            : "Delhivery prepaid delivery is unavailable for this pincode.",

          city: serviceability?.city || "",
          district: serviceability?.district || "",
          state: serviceability?.state || "",
        },

        raw: {
          serviceability:
            serviceability?.raw || serviceability,
          rate: null,
        },
      });
    }

    // Step 2: Calculate package weight
    const totalWeightKg = (order.items || []).reduce(
      (sum, item) => {
        const quantity = Number(item.quantity || 0);

        const itemWeight =
          Number(item?.variant?.weight || 0) ||
          Number(item?.productSnapshot?.weight || 0);

        return sum + itemWeight * quantity;
      },
      0,
    );

    const weightInGrams = Math.max(
      500,
      Math.ceil((totalWeightKg || 0.5) * 1000),
    );

    // Step 3: Fetch rate only when serviceable
    const rateResult = await calculateDelhiveryRate({
      destinationPincode: pincode,
      weightInGrams,
      paymentMode: isCod ? "cod" : "prepaid",
    });

    const rate = Number(rateResult?.rate || 0);

    return res.status(200).json({
      success: true,
      orderId: order._id,
      orderNumber: order.orderNumber,
      weightInGrams,

      option: {
        courierName: "Delhivery Direct",
        serviceable: true,

        codAvailable: Boolean(
          serviceability?.codAvailable,
        ),

        prepaidAvailable: Boolean(
          serviceability?.prepaidAvailable,
        ),

        pickupAvailable: Boolean(
          serviceability?.pickupAvailable,
        ),

        rate: rate > 0 ? rate : null,
        codCharges: null,
        estimatedDays: "",

        pricingAvailable: rate > 0,
        zone: rateResult?.zone || "",

        city: serviceability?.city || "",
        district: serviceability?.district || "",
        state: serviceability?.state || "",
      },

      raw: {
        serviceability:
          serviceability?.raw || serviceability,
        rate: rateResult?.raw || rateResult,
      },
    });
  } catch (error) {
    const isTimeout =
      error?.code === "ECONNABORTED" ||
      String(error?.message || "")
        .toLowerCase()
        .includes("timeout");

    console.error(
      "❌ Delhivery rate error:",
      error?.response?.data ||
      error?.message ||
      error,
    );

    return res.status(isTimeout ? 504 : 500).json({
      success: false,
      message: isTimeout
        ? "Delhivery rate request timed out. Please retry."
        : "Unable to fetch Delhivery shipping rate.",
      error:
        error?.response?.data ||
        error?.message ||
        "unknown_error",
    });
  }
};


export const repairSplitOrderToOriginal = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const {
      orderNumber,
      apply = false,
    } = req.body || {};

    const on = String(orderNumber || "").trim();

    if (!on) {
      return res.status(400).json({
        success: false,
        message: "orderNumber is required",
      });
    }

    let result = null;

    await session.withTransaction(async () => {
      /* =====================================================
         FIND ORIGINAL / PARENT
      ===================================================== */

      const parent = await Order.findOne({
        orderNumber: on,
      }).session(session);

      if (!parent) {
        throw new Error(`Order ${on} not found`);
      }

      /* =====================================================
         FIND CHILDREN
      ===================================================== */

      const children = await Order.find({
        parentOrderId: parent._id,
      })
        .sort({ splitSuffix: 1 })
        .session(session);

      const childIds = children.map((child) => child._id);

      /* =====================================================
         RESERVATIONS
      ===================================================== */

      const parentReservations =
        await InventoryReservation.find({
          refType: "order",
          refId: parent._id,
          status: {
            $in: ["pending", "reserved"],
          },
        }).session(session);

      const childReservations = childIds.length
        ? await InventoryReservation.find({
          refType: "order",
          refId: {
            $in: childIds,
          },
          status: {
            $in: ["pending", "reserved"],
          },
        }).session(session)
        : [];

      const childReservedRows =
        childReservations.filter(
          (row) => row.status === "reserved",
        );

      const childPendingRows =
        childReservations.filter(
          (row) => row.status === "pending",
        );

      const parentReservedQty =
        parentReservations
          .filter((row) => row.status === "reserved")
          .reduce(
            (sum, row) =>
              sum + Number(row.qty || 0),
            0,
          );

      const parentPendingQty =
        parentReservations
          .filter((row) => row.status === "pending")
          .reduce(
            (sum, row) =>
              sum + Number(row.qty || 0),
            0,
          );

      const childReservedQty =
        childReservedRows.reduce(
          (sum, row) =>
            sum + Number(row.qty || 0),
          0,
        );

      const childPendingQty =
        childPendingRows.reduce(
          (sum, row) =>
            sum + Number(row.qty || 0),
          0,
        );

      /* =====================================================
         ORDER EXPECTED QUANTITY
      ===================================================== */

      const expectedQty = (
        Array.isArray(parent.items)
          ? parent.items
          : []
      ).reduce(
        (sum, item) =>
          sum +
          Math.max(
            0,
            Number(item?.quantity || 0),
          ),
        0,
      );

      result = {
        orderNumber: parent.orderNumber,

        parent: {
          _id: String(parent._id),
          orderType: parent.orderType,
          expectedQty,
        },

        children: children.map((child) => ({
          _id: String(child._id),
          orderNumber: child.orderNumber,
          splitSuffix: child.splitSuffix,
        })),

        reservations: {
          parentReservedQty,
          parentPendingQty,

          childReservedQty,
          childPendingQty,

          parentActiveRows:
            parentReservations.length,

          childActiveRows:
            childReservations.length,
        },

        safeToAutoRepair:
          childReservedRows.length === 0,
      };

      /* =====================================================
         DRY RUN
      ===================================================== */

      if (apply !== true) {
        return;
      }

      /* =====================================================
         SAFETY

         Pending child rows can simply disappear because
         they hold no physical stock.

         Reserved child rows MUST NOT be blindly deleted,
         because reservedStock would remain inflated.
      ===================================================== */

      if (childReservedRows.length) {
        throw new Error(
          `Repair blocked: ${childReservedRows.length} child reserved reservation(s) exist with total qty ${childReservedQty}. Transfer/release them first.`,
        );
      }

      /* =====================================================
         REMOVE CHILD PENDING RESERVATIONS

         Pending rows do not affect physical reservedStock.
      ===================================================== */

      if (childPendingRows.length) {
        await InventoryReservation.deleteMany(
          {
            _id: {
              $in: childPendingRows.map(
                (row) => row._id,
              ),
            },
          },
          { session },
        );
      }

      /* =====================================================
         DELETE SPLIT CHILD ORDERS
      ===================================================== */

      if (childIds.length) {
        await Order.deleteMany(
          {
            _id: {
              $in: childIds,
            },
          },
          { session },
        );
      }

      /* =====================================================
         RESTORE ORIGINAL ORDER
      ===================================================== */

      parent.orderType = "shipment";
      parent.parentOrderId = null;
      parent.splitSuffix = "";

      /*
       * Let reservation sync calculate this properly.
       */
      parent.isPackable = false;

      await parent.save({
        session,
      });

      /* =====================================================
         RESTORE ITEM ALLOCATION FROM ORIGINAL RESERVATIONS
      ===================================================== */

      await syncOrderAllocatedQtyFromReservations({
        orderId: parent._id,
        debug: false,
        session,
      });

      result.repaired = true;
    });

    return res.json({
      success: true,

      mode:
        req.body?.apply === true
          ? "APPLIED"
          : "DRY_RUN",

      result,
    });
  } catch (error) {
    console.error(
      "❌ Repair split order error:",
      error,
    );

    return res.status(400).json({
      success: false,
      message:
        error.message ||
        "Failed to repair split order",
    });
  } finally {
    await session.endSession();
  }
};
