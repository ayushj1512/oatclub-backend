import Coupon from "./Coupon.js";
import mongoose from "mongoose";

/* ------------------------------------------------------------------
HELPERS
------------------------------------------------------------------- */

const normCode = (v) => String(v || "").trim().toUpperCase();
const normEmail = (v) => String(v || "").trim().toLowerCase();

const normPhone = (v) => {
  const digits = String(v || "").replace(/\D/g, "");
  return digits.length ? digits : "";
};

const toId = (v) => String(v?._id || v || "");

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail(v));

const isPhone = (v) => {
  const digits = normPhone(v);
  return digits.length >= 10 && digits.length <= 15;
};

const fakeRes = {
  status: () => ({
    json: () => null,
  }),
};

const buildCustomerKey = ({ email, phone, customerId }) => {
  if (email && isEmail(email)) return `email:${normEmail(email)}`;
  if (phone && isPhone(phone)) return `phone:${normPhone(phone)}`;

  if (customerId) {
    const cid = String(customerId).trim();
    if (!cid || cid.toLowerCase() === "guest") return null;
    return `id:${cid}`;
  }

  return null;
};

const isWithinDates = (coupon) => {
  const now = new Date();
  const validFrom = coupon.validFrom ? new Date(coupon.validFrom) : null;
  const validTill = coupon.validTill ? new Date(coupon.validTill) : null;

  if (validFrom && now < validFrom) return false;
  if (validTill && now > validTill) return false;

  return true;
};

const enforceTargets = ({ coupon, email, phone, res }) => {
  if (coupon.targetEmail && normEmail(email) !== coupon.targetEmail) {
    res.status(403).json({
      message: "This coupon is not applicable for this email.",
    });
    return false;
  }

  if (coupon.targetPhone && normPhone(phone) !== coupon.targetPhone) {
    res.status(403).json({
      message: "This coupon is not applicable for this phone number.",
    });
    return false;
  }

  return true;
};

const validateCouponBasics = ({ coupon, cartTotal, customerKey, res }) => {
  if (!coupon) {
    res.status(404).json({ message: "Invalid coupon code." });
    return false;
  }

  if (!coupon.isActive) {
    res.status(400).json({ message: "Coupon is not active." });
    return false;
  }

  if (!isWithinDates(coupon)) {
    res.status(400).json({ message: "Coupon is expired or not yet active." });
    return false;
  }

  if (Number(cartTotal) < Number(coupon.minPurchase || 0)) {
    res.status(400).json({
      message: `Minimum purchase required is ₹${coupon.minPurchase}`,
    });
    return false;
  }

  if (
    Number(coupon.usageLimit) > 0 &&
    Number(coupon.usedCount) >= Number(coupon.usageLimit)
  ) {
    res.status(400).json({ message: "Coupon usage limit has been reached." });
    return false;
  }

  const perLimit = Number(coupon.usageLimitPerCustomer ?? 1);

  if (perLimit > 0 && customerKey) {
    const usedTimes = (coupon.usedBy || []).filter(
      (x) => String(x) === customerKey
    ).length;

    if (usedTimes >= perLimit) {
      res.status(400).json({ message: "You have already used this coupon." });
      return false;
    }
  }

  return true;
};

/* ------------------------------------------------------------------
CART ITEM HELPERS
------------------------------------------------------------------- */

const getItemProduct = (item) => item?.product || item || {};

const getItemQty = (item) => {
  const qty = Number(item?.quantity ?? item?.qty ?? 1);
  return qty > 0 ? qty : 1;
};

const getItemPrice = (item) => {
  const product = getItemProduct(item);
  return Number(
    item?.price ??
      item?.salePrice ??
      item?.finalPrice ??
      product?.price ??
      product?.salePrice ??
      0
  );
};

const getItemTotal = (item) => getItemPrice(item) * getItemQty(item);

const getCartTotalFromItems = (cartItems = []) =>
  cartItems.reduce((sum, item) => sum + getItemTotal(item), 0);

const isPrimaryItem = (item) => {
  const product = getItemProduct(item);
  return Boolean(
    item?.isPrimaryProduct ??
      item?.isPrimary ??
      product?.isPrimaryProduct ??
      product?.isPrimary
  );
};

const isSecondaryItem = (item) => !isPrimaryItem(item);

const getItemCategoryIds = (item) => {
  const product = getItemProduct(item);

  return [
    ...(Array.isArray(item?.categories) ? item.categories : []),
    ...(Array.isArray(product?.categories) ? product.categories : []),
    item?.category,
    product?.category,
    item?.categoryId,
    product?.categoryId,
  ]
    .filter(Boolean)
    .map(toId);
};

const getItemCollectionIds = (item) => {
  const product = getItemProduct(item);

  return [
    ...(Array.isArray(item?.collections) ? item.collections : []),
    ...(Array.isArray(product?.collections) ? product.collections : []),
    item?.collection,
    product?.collection,
    item?.collectionId,
    product?.collectionId,
  ]
    .filter(Boolean)
    .map(toId);
};

const arrayMatch = ({ itemIds = [], ruleIds = [], matchMode = "any" }) => {
  const ids = ruleIds.map(toId).filter(Boolean);
  if (!ids.length) return false;

  if (matchMode === "all") {
    return ids.every((id) => itemIds.includes(id));
  }

  return ids.some((id) => itemIds.includes(id));
};

const itemMatchesRule = (item, rule) => {
  if (!rule?.isActive) return false;

  if (rule.ruleType === "primary_required") return isPrimaryItem(item);
  if (rule.ruleType === "secondary_required") return isSecondaryItem(item);

  if (rule.ruleType === "category_required") {
    return arrayMatch({
      itemIds: getItemCategoryIds(item),
      ruleIds: rule.categories || [],
      matchMode: rule.matchMode || "any",
    });
  }

  if (rule.ruleType === "collection_required") {
    return arrayMatch({
      itemIds: getItemCollectionIds(item),
      ruleIds: rule.collections || [],
      matchMode: rule.matchMode || "any",
    });
  }

  return false;
};

const normalizeRuntimeRules = (coupon) => {
  const rules = Array.isArray(coupon.cartRules) ? coupon.cartRules : [];

  if (rules.length) return rules.filter((rule) => rule?.isActive !== false);

  const oldRule = coupon.cartRule || {};

  if (!oldRule.enabled || oldRule.ruleType === "none") return [];

  if (oldRule.ruleType === "primary_secondary") {
    const next = [];

    if (oldRule.requiresPrimaryProduct) {
      next.push({ ruleType: "primary_required", isActive: true });
    }

    if (oldRule.requiresSecondaryProduct) {
      next.push({ ruleType: "secondary_required", isActive: true });
    }

    return next;
  }

  if (oldRule.ruleType === "category_collection") {
    const next = [];

    if (coupon.categories?.length) {
      next.push({
        ruleType: "category_required",
        categories: coupon.categories,
        matchMode: oldRule.matchMode || "any",
        isActive: true,
      });
    }

    if (coupon.collections?.length) {
      next.push({
        ruleType: "collection_required",
        collections: coupon.collections,
        matchMode: oldRule.matchMode || "any",
        isActive: true,
      });
    }

    return next;
  }

  return [];
};

const cartPassesRules = ({ coupon, cartItems = [] }) => {
  const rules = normalizeRuntimeRules(coupon);
  if (!rules.length) return true;

  return rules.every((rule) => cartItems.some((item) => itemMatchesRule(item, rule)));
};

const itemMatchesAnyCategoryRule = (item, rules = []) =>
  rules.some(
    (rule) => rule.ruleType === "category_required" && itemMatchesRule(item, rule)
  );

const itemMatchesAnyCollectionRule = (item, rules = []) =>
  rules.some(
    (rule) => rule.ruleType === "collection_required" && itemMatchesRule(item, rule)
  );

const itemMatchesAnyRule = (item, rules = []) =>
  rules.some((rule) => itemMatchesRule(item, rule));

const getDiscountTarget = (coupon) =>
  coupon.discountTarget || coupon.cartRule?.discountTarget || "cart";

const getEligibleItems = ({ coupon, cartItems = [] }) => {
  if (!Array.isArray(cartItems) || !cartItems.length) return [];

  const rules = normalizeRuntimeRules(coupon);
  const target = getDiscountTarget(coupon);

  if (!cartPassesRules({ coupon, cartItems })) return [];

  if (target === "cart") return cartItems;
  if (target === "primary_products") return cartItems.filter(isPrimaryItem);
  if (target === "secondary_products") return cartItems.filter(isSecondaryItem);

  if (target === "category_products") {
    return cartItems.filter((item) => itemMatchesAnyCategoryRule(item, rules));
  }

  if (target === "collection_products") {
    return cartItems.filter((item) => itemMatchesAnyCollectionRule(item, rules));
  }

  if (target === "matched_products") {
    return cartItems.filter((item) => itemMatchesAnyRule(item, rules));
  }

  return cartItems;
};

const calcDiscountAmount = ({ coupon, eligibleTotal, cartTotal }) => {
  let discount = 0;

  if (coupon.discountType === "percentage") {
    discount = (Number(eligibleTotal) * Number(coupon.discountValue || 0)) / 100;
  } else {
    discount = Number(coupon.discountValue || 0);
  }

  if (Number(coupon.maxDiscount) > 0) {
    discount = Math.min(discount, Number(coupon.maxDiscount));
  }

  return Math.max(
    0,
    Math.min(discount, Number(eligibleTotal), Number(cartTotal))
  );
};

const buildDiscountBreakdown = ({ coupon, cartItems = [], discount }) => {
  const eligibleItems = getEligibleItems({ coupon, cartItems });
  const eligibleTotal = eligibleItems.reduce(
    (sum, item) => sum + getItemTotal(item),
    0
  );

  if (!cartItems.length || !eligibleItems.length || discount <= 0 || eligibleTotal <= 0) {
    return [];
  }

  let assigned = 0;

  return eligibleItems.map((item, index) => {
    const itemTotal = getItemTotal(item);

    const itemDiscount =
      index === eligibleItems.length - 1
        ? Math.max(0, Math.round(discount - assigned))
        : Math.round((itemTotal / eligibleTotal) * discount);

    assigned += itemDiscount;

    return {
      productId: toId(item?.product?._id || item?.productId || item?._id),
      productCode: item?.productCode || item?.product?.productCode || "",
      title: item?.title || item?.product?.title || item?.name || "",
      quantity: getItemQty(item),
      itemTotal,
      discount: itemDiscount,
      finalItemTotal: Math.max(0, itemTotal - itemDiscount),
    };
  });
};

const calculateCouponDiscount = ({ coupon, cartTotal, cartItems = [] }) => {
  const hasCartItems = Array.isArray(cartItems) && cartItems.length > 0;

  const actualCartTotal = hasCartItems
    ? getCartTotalFromItems(cartItems)
    : Number(cartTotal || 0);

  const eligibleItems = hasCartItems
    ? getEligibleItems({ coupon, cartItems })
    : [];

  const eligibleTotal = hasCartItems
    ? eligibleItems.reduce((sum, item) => sum + getItemTotal(item), 0)
    : actualCartTotal;

  if (eligibleTotal <= 0) {
    return {
      discount: 0,
      finalTotal: actualCartTotal,
      eligibleTotal: 0,
      discountBreakdown: [],
    };
  }

  const discount = calcDiscountAmount({
    coupon,
    eligibleTotal,
    cartTotal: actualCartTotal,
  });

  return {
    discount,
    finalTotal: Math.max(0, actualCartTotal - discount),
    eligibleTotal,
    discountBreakdown: buildDiscountBreakdown({
      coupon,
      cartItems,
      discount,
    }),
  };
};

const normalizeCouponPayload = (body = {}) => ({
  code: body.code ? normCode(body.code) : body.code,
  type: body.type,
  visibility: body.visibility,
  description: body.description,
  autoApply: body.autoApply,
  discountType: body.discountType,
  discountValue: body.discountValue,
  minPurchase: body.minPurchase,
  maxDiscount: body.maxDiscount,

  cartRules: Array.isArray(body.cartRules) ? body.cartRules : undefined,
  discountTarget: body.discountTarget,
  applyToAllEligibleItems: body.applyToAllEligibleItems,

  categories: body.categories || undefined,
  collections: body.collections || undefined,

  // old support
  cartRule: body.cartRule,

  influencerId: body.influencerId || null,
  issuedBy: body.issuedBy || null,
  validFrom: body.validFrom,
  validTill: body.validTill,
  usageLimit: body.usageLimit,
  usageLimitPerCustomer: body.usageLimitPerCustomer,
  isActive: body.isActive,
  targetEmail: body.targetEmail ? normEmail(body.targetEmail) : null,
  targetPhone: body.targetPhone ? normPhone(body.targetPhone) : null,
});

const cleanUndefined = (obj = {}) => {
  Object.keys(obj).forEach((key) => {
    if (obj[key] === undefined) delete obj[key];
  });

  return obj;
};

const couponResponse = (coupon) => ({
  _id: coupon._id,
  couponNumber: coupon.couponNumber,
  code: coupon.code,
  autoApply: coupon.autoApply,
  discountType: coupon.discountType,
  discountValue: coupon.discountValue,
  cartRules: coupon.cartRules || [],
  discountTarget: getDiscountTarget(coupon),
  applyToAllEligibleItems: coupon.applyToAllEligibleItems,
  cartRule: coupon.cartRule,
});

/* ------------------------------------------------------------------
CREATE COUPON
------------------------------------------------------------------- */

export const createCoupon = async (req, res) => {
  try {
    const payload = cleanUndefined(normalizeCouponPayload(req.body));

    if (
      !payload.code ||
      !payload.validTill ||
      !payload.discountType ||
      payload.discountValue == null
    ) {
      return res.status(400).json({
        message: "Missing required coupon fields.",
      });
    }

    const existingCoupon = await Coupon.findOne({ code: payload.code });
    if (existingCoupon) {
      return res.status(400).json({
        message: "Coupon code already exists.",
      });
    }

    const coupon = await Coupon.create({
      ...payload,
      usedBy: [],
    });

    return res.status(201).json({
      message: "Coupon created successfully",
      data: coupon,
    });
  } catch (error) {
    console.error("Error creating coupon:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

/* ------------------------------------------------------------------
GET ALL COUPONS
------------------------------------------------------------------- */

export const getAllCoupons = async (req, res) => {
  try {
    const {
      type,
      isActive,
      influencerId,
      visibility,
      autoApply,
      ruleType,
      category,
      collection,
      discountTarget,
      search,
    } = req.query;

    const filter = {};

    if (type) filter.type = type;
    if (visibility) filter.visibility = visibility;
    if (influencerId) filter.influencerId = influencerId;
    if (isActive !== undefined) filter.isActive = isActive === "true";
    if (autoApply !== undefined) filter.autoApply = autoApply === "true";
    if (ruleType) filter["cartRules.ruleType"] = ruleType;
    if (category) filter.categories = category;
    if (collection) filter.collections = collection;
    if (discountTarget) filter.discountTarget = discountTarget;

    if (search) {
      const q = String(search).trim();
      filter.$or = [
        { code: { $regex: q, $options: "i" } },
        { couponNumber: { $regex: q, $options: "i" } },
        { description: { $regex: q, $options: "i" } },
      ];
    }

    const coupons = await Coupon.find(filter)
      .sort({ createdAt: -1 })
      .populate("categories", "name slug")
      .populate("collections", "name slug")
      .populate("influencerId", "name email")
      .populate("issuedBy", "username email");

    return res.status(200).json({
      count: coupons.length,
      data: coupons,
    });
  } catch (error) {
    console.error("Error fetching coupons:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

/* ------------------------------------------------------------------
GET COUPON BY ID / CODE / COUPON NUMBER
------------------------------------------------------------------- */

export const getCouponByIdOrCode = async (req, res) => {
  try {
    const { idOrCode } = req.params;

    let coupon;

    if (mongoose.Types.ObjectId.isValid(idOrCode)) {
      coupon = await Coupon.findById(idOrCode)
        .populate("categories", "name slug")
        .populate("collections", "name slug");
    } else {
      const value = String(idOrCode || "").trim();

      coupon = await Coupon.findOne({
        $or: [{ code: normCode(value) }, { couponNumber: value }],
      })
        .populate("categories", "name slug")
        .populate("collections", "name slug");
    }

    if (!coupon || coupon.visibility === "private") {
      return res.status(404).json({ message: "Coupon not found" });
    }

    return res.status(200).json(coupon);
  } catch (error) {
    console.error("Error fetching coupon:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

/* ------------------------------------------------------------------
UPDATE COUPON
------------------------------------------------------------------- */

export const updateCoupon = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = cleanUndefined(normalizeCouponPayload(req.body));

    const coupon = await Coupon.findByIdAndUpdate(id, { $set: updates }, {
      new: true,
      runValidators: true,
    })
      .populate("categories", "name slug")
      .populate("collections", "name slug");

    if (!coupon) {
      return res.status(404).json({ message: "Coupon not found" });
    }

    return res.status(200).json({
      message: "Coupon updated successfully",
      data: coupon,
    });
  } catch (error) {
    console.error("Error updating coupon:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

/* ------------------------------------------------------------------
DELETE COUPON
------------------------------------------------------------------- */

export const deleteCoupon = async (req, res) => {
  try {
    const { id } = req.params;

    const coupon = await Coupon.findByIdAndDelete(id);
    if (!coupon) {
      return res.status(404).json({ message: "Coupon not found" });
    }

    return res.status(200).json({
      message: "Coupon deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting coupon:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

/* ------------------------------------------------------------------
APPLY COUPON
------------------------------------------------------------------- */

export const applyCoupon = async (req, res) => {
  try {
    const { code, cartTotal, cartItems = [], email, phone, customerId } = req.body;

    if (!code || (cartTotal == null && !cartItems.length)) {
      return res.status(400).json({
        message: "code and cartTotal/cartItems are required.",
      });
    }

    const couponCode = normCode(code);
    const customerKey = buildCustomerKey({ email, phone, customerId });

    if (!customerKey) {
      return res.status(400).json({
        message: "Please enter email or phone number to apply coupon.",
      });
    }

    const coupon = await Coupon.findOne({ code: couponCode });

    const actualCartTotal = cartItems.length
      ? getCartTotalFromItems(cartItems)
      : Number(cartTotal || 0);

    if (!validateCouponBasics({ coupon, cartTotal: actualCartTotal, customerKey, res })) return;
    if (!enforceTargets({ coupon, email, phone, res })) return;

    const result = calculateCouponDiscount({
      coupon,
      cartTotal: actualCartTotal,
      cartItems,
    });

    if (result.discount <= 0) {
      return res.status(400).json({
        message: "Coupon is not applicable on this cart.",
      });
    }

    return res.status(200).json({
      message: "Coupon applied successfully",
      coupon: couponResponse(coupon),
      cartTotal: actualCartTotal,
      discount: result.discount,
      finalTotal: result.finalTotal,
      eligibleTotal: result.eligibleTotal,
      discountBreakdown: result.discountBreakdown,
      customerKey,
    });
  } catch (error) {
    console.error("Error applying coupon:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

/* ------------------------------------------------------------------
AUTO APPLY BEST COUPON
------------------------------------------------------------------- */

export const autoApplyCoupon = async (req, res) => {
  try {
    const { cartTotal, cartItems = [], email, phone, customerId } = req.body;

    if (cartTotal == null && !cartItems.length) {
      return res.status(400).json({
        message: "cartTotal or cartItems are required.",
      });
    }

    const customerKey = buildCustomerKey({ email, phone, customerId });

    if (!customerKey) {
      return res.status(400).json({
        message: "Please enter email or phone number to auto apply coupon.",
      });
    }

    const actualCartTotal = cartItems.length
      ? getCartTotalFromItems(cartItems)
      : Number(cartTotal || 0);

    const coupons = await Coupon.find({
      autoApply: true,
      visibility: "public",
      isActive: true,
      validFrom: { $lte: new Date() },
      validTill: { $gte: new Date() },
    }).sort({ createdAt: -1 });

    let best = null;

    for (const coupon of coupons) {
      const valid = validateCouponBasics({
        coupon,
        cartTotal: actualCartTotal,
        customerKey,
        res: fakeRes,
      });

      if (!valid) continue;
      if (coupon.targetEmail && normEmail(email) !== coupon.targetEmail) continue;
      if (coupon.targetPhone && normPhone(phone) !== coupon.targetPhone) continue;

      const result = calculateCouponDiscount({
        coupon,
        cartTotal: actualCartTotal,
        cartItems,
      });

      if (result.discount <= 0) continue;

      if (!best || result.discount > best.discount) {
        best = { coupon, ...result };
      }
    }

    if (!best) {
      return res.status(200).json({
        message: "No auto apply coupon available.",
        applied: false,
        cartTotal: actualCartTotal,
        discount: 0,
        finalTotal: actualCartTotal,
      });
    }

    return res.status(200).json({
      message: "Best coupon auto applied.",
      applied: true,
      coupon: couponResponse(best.coupon),
      cartTotal: actualCartTotal,
      discount: best.discount,
      finalTotal: best.finalTotal,
      eligibleTotal: best.eligibleTotal,
      discountBreakdown: best.discountBreakdown,
      customerKey,
    });
  } catch (error) {
    console.error("Error auto applying coupon:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

/* ------------------------------------------------------------------
REDEEM COUPON
------------------------------------------------------------------- */

export const redeemCoupon = async (req, res) => {
  try {
    const { code, cartTotal, cartItems = [], email, phone, customerId } = req.body;

    if (!code || (cartTotal == null && !cartItems.length)) {
      return res.status(400).json({
        message: "code and cartTotal/cartItems are required.",
      });
    }

    const couponCode = normCode(code);
    const customerKey = buildCustomerKey({ email, phone, customerId });

    if (!customerKey) {
      return res.status(400).json({
        message: "Please provide email or phone number to redeem coupon.",
      });
    }

    const coupon = await Coupon.findOne({ code: couponCode });

    const actualCartTotal = cartItems.length
      ? getCartTotalFromItems(cartItems)
      : Number(cartTotal || 0);

    if (!validateCouponBasics({ coupon, cartTotal: actualCartTotal, customerKey, res })) return;
    if (!enforceTargets({ coupon, email, phone, res })) return;

    const result = calculateCouponDiscount({
      coupon,
      cartTotal: actualCartTotal,
      cartItems,
    });

    if (result.discount <= 0) {
      return res.status(400).json({
        message: "Coupon is not applicable on this cart.",
      });
    }

    const updated = await Coupon.findOneAndUpdate(
      { code: couponCode },
      {
        $push: { usedBy: customerKey },
        $inc: { usedCount: 1 },
      },
      { new: true }
    );

    return res.status(200).json({
      message: "Coupon redeemed successfully",
      coupon: couponResponse(updated),
      cartTotal: actualCartTotal,
      discount: result.discount,
      finalTotal: result.finalTotal,
      eligibleTotal: result.eligibleTotal,
      discountBreakdown: result.discountBreakdown,
      data: updated,
    });
  } catch (error) {
    console.error("Error redeeming coupon:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};