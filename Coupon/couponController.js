import Coupon from "./Coupon.js";
import mongoose from "mongoose";

/* ------------------------------------------------------------------
BASIC HELPERS
------------------------------------------------------------------- */

const normCode = (v) =>
  String(v || "")
    .trim()
    .toUpperCase();
const normEmail = (v) =>
  String(v || "")
    .trim()
    .toLowerCase();
const normPhone = (v) => String(v || "").replace(/\D/g, "");
const toId = (v) => String(v?._id || v || "");

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail(v));
const isPhone = (v) => normPhone(v).length >= 10 && normPhone(v).length <= 15;

const fakeRes = { status: () => ({ json: () => null }) };

const cleanUndefined = (obj = {}) => {
  Object.keys(obj).forEach((key) => obj[key] === undefined && delete obj[key]);
  return obj;
};

const buildCustomerKey = ({ email, phone, customerId }) => {
  if (email && isEmail(email)) return `email:${normEmail(email)}`;
  if (phone && isPhone(phone)) return `phone:${normPhone(phone)}`;

  const cid = String(customerId || "").trim();
  if (cid && cid.toLowerCase() !== "guest") return `id:${cid}`;

  return null;
};

/* ------------------------------------------------------------------
CART HELPERS
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
      0,
  );
};

const getItemTotal = (item) => getItemPrice(item) * getItemQty(item);

const getCartTotalFromItems = (cartItems = []) =>
  cartItems.reduce((sum, item) => sum + getItemTotal(item), 0);

const getCartQty = (cartItems = [], countMode = "total_quantity") => {
  if (!Array.isArray(cartItems) || !cartItems.length) return 0;
  if (countMode === "unique_items") return cartItems.length;

  return cartItems.reduce((sum, item) => sum + getItemQty(item), 0);
};

const isPrimaryItem = (item) => {
  const product = getItemProduct(item);
  return Boolean(
    item?.isPrimaryProduct ??
    item?.isPrimary ??
    product?.isPrimaryProduct ??
    product?.isPrimary,
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

/* ------------------------------------------------------------------
RULE HELPERS
------------------------------------------------------------------- */

const arrayMatch = ({ itemIds = [], ruleIds = [], matchMode = "any" }) => {
  const ids = ruleIds.map(toId).filter(Boolean);
  if (!ids.length) return false;

  if (matchMode === "all") return ids.every((id) => itemIds.includes(id));
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
    return [
      oldRule.requiresPrimaryProduct && {
        ruleType: "primary_required",
        isActive: true,
      },
      oldRule.requiresSecondaryProduct && {
        ruleType: "secondary_required",
        isActive: true,
      },
    ].filter(Boolean);
  }

  if (oldRule.ruleType === "category_collection") {
    return [
      coupon.categories?.length && {
        ruleType: "category_required",
        categories: coupon.categories,
        matchMode: oldRule.matchMode || "any",
        isActive: true,
      },
      coupon.collections?.length && {
        ruleType: "collection_required",
        collections: coupon.collections,
        matchMode: oldRule.matchMode || "any",
        isActive: true,
      },
    ].filter(Boolean);
  }

  return [];
};

const cartPassesRules = ({ coupon, cartItems = [] }) => {
  const rules = normalizeRuntimeRules(coupon);
  if (!rules.length) return true;

  return rules.every((rule) =>
    cartItems.some((item) => itemMatchesRule(item, rule)),
  );
};

const cartPassesQuantityRule = ({ coupon, cartItems = [] }) => {
  const rule = coupon?.quantityRule;
  if (!rule?.enabled) return true;

  const minItems = Number(rule.minItems || 0);
  if (minItems <= 0) return true;

  const countMode = rule.countMode || "total_quantity";
  return getCartQty(cartItems, countMode) >= minItems;
};

const itemMatchesAnyCategoryRule = (item, rules = []) =>
  rules.some(
    (rule) =>
      rule.ruleType === "category_required" && itemMatchesRule(item, rule),
  );

const itemMatchesAnyCollectionRule = (item, rules = []) =>
  rules.some(
    (rule) =>
      rule.ruleType === "collection_required" && itemMatchesRule(item, rule),
  );

const itemMatchesAnyRule = (item, rules = []) =>
  rules.some((rule) => itemMatchesRule(item, rule));

const getDiscountTarget = (coupon) =>
  coupon.discountTarget || coupon.cartRule?.discountTarget || "cart";

const getEligibleItems = ({ coupon, cartItems = [] }) => {
  if (!Array.isArray(cartItems) || !cartItems.length) return [];
  if (!cartPassesRules({ coupon, cartItems })) return [];
  if (!cartPassesQuantityRule({ coupon, cartItems })) return [];

  const rules = normalizeRuntimeRules(coupon);
  const target = getDiscountTarget(coupon);

  if (target === "cart") return cartItems;
  if (target === "primary_products") return cartItems.filter(isPrimaryItem);
  if (target === "secondary_products") return cartItems.filter(isSecondaryItem);

  if (target === "category_products") {
    return cartItems.filter((item) => itemMatchesAnyCategoryRule(item, rules));
  }

  if (target === "collection_products") {
    return cartItems.filter((item) =>
      itemMatchesAnyCollectionRule(item, rules),
    );
  }

  if (target === "matched_products") {
    return cartItems.filter((item) => itemMatchesAnyRule(item, rules));
  }

  return cartItems;
};

/* ------------------------------------------------------------------
VALIDATION HELPERS
------------------------------------------------------------------- */

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

const validateCouponBasics = ({
  coupon,
  cartTotal,
  cartItems,
  customerKey,
  res,
}) => {
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

  if (!cartPassesQuantityRule({ coupon, cartItems })) {
    const minItems = Number(coupon.quantityRule?.minItems || 0);
    res.status(400).json({
      message: `Add at least ${minItems} item${minItems > 1 ? "s" : ""} to use this coupon.`,
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
      (x) => String(x) === customerKey,
    ).length;

    if (usedTimes >= perLimit) {
      res.status(400).json({ message: "You have already used this coupon." });
      return false;
    }
  }

  return true;
};

/* ------------------------------------------------------------------
DISCOUNT HELPERS
------------------------------------------------------------------- */

const calcDiscountAmount = ({ coupon, eligibleTotal, cartTotal }) => {
  let discount =
    coupon.discountType === "percentage"
      ? (Number(eligibleTotal) * Number(coupon.discountValue || 0)) / 100
      : Number(coupon.discountValue || 0);

  if (Number(coupon.maxDiscount) > 0) {
    discount = Math.min(discount, Number(coupon.maxDiscount));
  }

  return Math.max(
    0,
    Math.min(discount, Number(eligibleTotal), Number(cartTotal)),
  );
};

const buildDiscountBreakdown = ({ coupon, cartItems = [], discount }) => {
  const eligibleItems = getEligibleItems({ coupon, cartItems });
  const eligibleTotal = eligibleItems.reduce(
    (sum, item) => sum + getItemTotal(item),
    0,
  );

  if (
    !cartItems.length ||
    !eligibleItems.length ||
    discount <= 0 ||
    eligibleTotal <= 0
  ) {
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
  const hasItems = Array.isArray(cartItems) && cartItems.length > 0;

  const actualCartTotal = hasItems
    ? getCartTotalFromItems(cartItems)
    : Number(cartTotal || 0);

  const eligibleItems = hasItems ? getEligibleItems({ coupon, cartItems }) : [];

  const eligibleTotal = hasItems
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
    discountBreakdown: buildDiscountBreakdown({ coupon, cartItems, discount }),
  };
};

/* ------------------------------------------------------------------
PAYLOAD / RESPONSE
------------------------------------------------------------------- */

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

  quantityRule: body.quantityRule,
  cartRules: Array.isArray(body.cartRules) ? body.cartRules : undefined,
  discountTarget: body.discountTarget,
  applyToAllEligibleItems: body.applyToAllEligibleItems,

  categories: body.categories || undefined,
  collections: body.collections || undefined,
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

const couponResponse = (coupon) => ({
  _id: coupon._id,
  couponNumber: coupon.couponNumber,
  code: coupon.code,
  autoApply: coupon.autoApply,
  discountType: coupon.discountType,
  discountValue: coupon.discountValue,
  minPurchase: coupon.minPurchase,
  maxDiscount: coupon.maxDiscount,
  quantityRule: coupon.quantityRule,
  cartRules: coupon.cartRules || [],
  discountTarget: getDiscountTarget(coupon),
  applyToAllEligibleItems: coupon.applyToAllEligibleItems,
  cartRule: coupon.cartRule,
});

/* ------------------------------------------------------------------
COMMON APPLY LOGIC
------------------------------------------------------------------- */

const getApplyContext = (body = {}) => {
  const { code, cartTotal, cartItems = [], email, phone, customerId } = body;

  const actualCartTotal = cartItems.length
    ? getCartTotalFromItems(cartItems)
    : Number(cartTotal || 0);

  return {
    code,
    couponCode: normCode(code),
    cartItems,
    cartTotal,
    actualCartTotal,
    email,
    phone,
    customerId,
    customerKey: buildCustomerKey({ email, phone, customerId }),
  };
};

const validateApplyInput = ({
  code,
  cartTotal,
  cartItems,
  customerKey,
  res,
}) => {
  if (!code || (cartTotal == null && !cartItems.length)) {
    res.status(400).json({
      message: "code and cartTotal/cartItems are required.",
    });
    return false;
  }

  if (!customerKey) {
    res.status(400).json({
      message: "Please enter email or phone number to apply coupon.",
    });
    return false;
  }

  return true;
};

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
      return res
        .status(400)
        .json({ message: "Missing required coupon fields." });
    }

    const existingCoupon = await Coupon.findOne({ code: payload.code });
    if (existingCoupon) {
      return res.status(400).json({ message: "Coupon code already exists." });
    }

    const coupon = await Coupon.create({ ...payload, usedBy: [] });

    return res.status(201).json({
      message: "Coupon created successfully",
      data: coupon,
    });
  } catch (error) {
    console.error("Error creating coupon:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
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
      quantityRule,
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
    if (quantityRule !== undefined) {
      filter["quantityRule.enabled"] = quantityRule === "true";
    }

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

    return res.status(200).json({ count: coupons.length, data: coupons });
  } catch (error) {
    console.error("Error fetching coupons:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

/* ------------------------------------------------------------------
GET COUPON BY ID / CODE / COUPON NUMBER
------------------------------------------------------------------- */

export const getCouponByIdOrCode = async (req, res) => {
  try {
    const { idOrCode } = req.params;
    const value = String(idOrCode || "").trim();

    const coupon = mongoose.Types.ObjectId.isValid(idOrCode)
      ? await Coupon.findById(idOrCode)
          .populate("categories", "name slug")
          .populate("collections", "name slug")
      : await Coupon.findOne({
          $or: [{ code: normCode(value) }, { couponNumber: value }],
        })
          .populate("categories", "name slug")
          .populate("collections", "name slug");

    if (!coupon || coupon.visibility === "private") {
      return res.status(404).json({ message: "Coupon not found" });
    }

    return res.status(200).json(coupon);
  } catch (error) {
    console.error("Error fetching coupon:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

/* ------------------------------------------------------------------
UPDATE COUPON
------------------------------------------------------------------- */

export const updateCoupon = async (req, res) => {
  try {
    const updates = cleanUndefined(normalizeCouponPayload(req.body));

    const coupon = await Coupon.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true },
    )
      .populate("categories", "name slug")
      .populate("collections", "name slug");

    if (!coupon) return res.status(404).json({ message: "Coupon not found" });

    return res.status(200).json({
      message: "Coupon updated successfully",
      data: coupon,
    });
  } catch (error) {
    console.error("Error updating coupon:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

/* ------------------------------------------------------------------
DELETE COUPON
------------------------------------------------------------------- */

export const deleteCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndDelete(req.params.id);
    if (!coupon) return res.status(404).json({ message: "Coupon not found" });

    return res.status(200).json({ message: "Coupon deleted successfully" });
  } catch (error) {
    console.error("Error deleting coupon:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

/* ------------------------------------------------------------------
APPLY COUPON
------------------------------------------------------------------- */

export const applyCoupon = async (req, res) => {
  try {
    const ctx = getApplyContext(req.body);

    if (!validateApplyInput({ ...ctx, res })) return;

    const coupon = await Coupon.findOne({ code: ctx.couponCode });

    if (
      !validateCouponBasics({
        coupon,
        cartTotal: ctx.actualCartTotal,
        cartItems: ctx.cartItems,
        customerKey: ctx.customerKey,
        res,
      })
    ) {
      return;
    }

    if (!enforceTargets({ coupon, email: ctx.email, phone: ctx.phone, res }))
      return;

    const result = calculateCouponDiscount({
      coupon,
      cartTotal: ctx.actualCartTotal,
      cartItems: ctx.cartItems,
    });

    if (result.discount <= 0) {
      return res.status(400).json({
        message: "Coupon is not applicable on this cart.",
      });
    }

    return res.status(200).json({
      message: "Coupon applied successfully",
      coupon: couponResponse(coupon),
      cartTotal: ctx.actualCartTotal,
      cartQuantity: getCartQty(ctx.cartItems, coupon.quantityRule?.countMode),
      discount: result.discount,
      finalTotal: result.finalTotal,
      eligibleTotal: result.eligibleTotal,
      discountBreakdown: result.discountBreakdown,
      customerKey: ctx.customerKey,
    });
  } catch (error) {
    console.error("Error applying coupon:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
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
        cartItems,
        customerKey,
        res: fakeRes,
      });

      if (!valid) continue;
      if (coupon.targetEmail && normEmail(email) !== coupon.targetEmail)
        continue;
      if (coupon.targetPhone && normPhone(phone) !== coupon.targetPhone)
        continue;

      const result = calculateCouponDiscount({
        coupon,
        cartTotal: actualCartTotal,
        cartItems,
      });

      if (result.discount <= 0) continue;
      if (!best || result.discount > best.discount)
        best = { coupon, ...result };
    }

    if (!best) {
      return res.status(200).json({
        message: "No auto apply coupon available.",
        applied: false,
        cartTotal: actualCartTotal,
        cartQuantity: getCartQty(cartItems),
        discount: 0,
        finalTotal: actualCartTotal,
      });
    }

    return res.status(200).json({
      message: "Best coupon auto applied.",
      applied: true,
      coupon: couponResponse(best.coupon),
      cartTotal: actualCartTotal,
      cartQuantity: getCartQty(cartItems, best.coupon.quantityRule?.countMode),
      discount: best.discount,
      finalTotal: best.finalTotal,
      eligibleTotal: best.eligibleTotal,
      discountBreakdown: best.discountBreakdown,
      customerKey,
    });
  } catch (error) {
    console.error("Error auto applying coupon:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

/* ------------------------------------------------------------------
REDEEM COUPON
------------------------------------------------------------------- */

export const redeemCoupon = async (req, res) => {
  try {
    const ctx = getApplyContext(req.body);

    if (!validateApplyInput({ ...ctx, res })) return;

    const coupon = await Coupon.findOne({ code: ctx.couponCode });

    if (
      !validateCouponBasics({
        coupon,
        cartTotal: ctx.actualCartTotal,
        cartItems: ctx.cartItems,
        customerKey: ctx.customerKey,
        res,
      })
    ) {
      return;
    }

    if (!enforceTargets({ coupon, email: ctx.email, phone: ctx.phone, res }))
      return;

    const result = calculateCouponDiscount({
      coupon,
      cartTotal: ctx.actualCartTotal,
      cartItems: ctx.cartItems,
    });

    if (result.discount <= 0) {
      return res.status(400).json({
        message: "Coupon is not applicable on this cart.",
      });
    }

    const updated = await Coupon.findOneAndUpdate(
      { code: ctx.couponCode },
      {
        $push: { usedBy: ctx.customerKey },
        $inc: { usedCount: 1 },
      },
      { new: true },
    );

    return res.status(200).json({
      message: "Coupon redeemed successfully",
      coupon: couponResponse(updated),
      cartTotal: ctx.actualCartTotal,
      cartQuantity: getCartQty(ctx.cartItems, updated.quantityRule?.countMode),
      discount: result.discount,
      finalTotal: result.finalTotal,
      eligibleTotal: result.eligibleTotal,
      discountBreakdown: result.discountBreakdown,
      data: updated,
    });
  } catch (error) {
    console.error("Error redeeming coupon:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

export const getAvailableCoupons = async (req, res) => {
  try {
    const { email, phone, customerId } = req.body;

    const customerKey = buildCustomerKey({
      email,
      phone,
      customerId,
    });

    const now = new Date();

    const coupons = await Coupon.find({
      visibility: "public",
      isActive: true,
      validFrom: { $lte: now },
      validTill: { $gte: now },
    })
      .sort({ createdAt: -1 })
      .populate("categories", "name slug")
      .populate("collections", "name slug")
      .lean();

    const availableCoupons = coupons.filter((coupon) => {
      // Global usage limit reached
      if (
        Number(coupon.usageLimit) > 0 &&
        Number(coupon.usedCount) >= Number(coupon.usageLimit)
      ) {
        return false;
      }

      // Customer-specific coupon checks
      if (
        coupon.targetEmail &&
        normEmail(email) !== normEmail(coupon.targetEmail)
      ) {
        return false;
      }

      if (
        coupon.targetPhone &&
        normPhone(phone) !== normPhone(coupon.targetPhone)
      ) {
        return false;
      }

      // Hide only if this customer already exhausted usage
      const perCustomerLimit = Number(
        coupon.usageLimitPerCustomer ?? 1
      );

      if (customerKey && perCustomerLimit > 0) {
        const usedTimes = (coupon.usedBy || []).filter(
          (key) => String(key) === customerKey
        ).length;

        if (usedTimes >= perCustomerLimit) {
          return false;
        }
      }

      return true;
    });

    return res.status(200).json({
      count: availableCoupons.length,
      data: availableCoupons,
    });
  } catch (error) {
    console.error("Error fetching available coupons:", error);

    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};
