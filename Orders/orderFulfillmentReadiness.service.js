import Product from "../Products/Products.js";

const num = (value) => Math.max(0, Number(value || 0));

const normalize = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const getVariant = (product, item) => {
  const variants = Array.isArray(product?.variants)
    ? product.variants
    : [];

  if (!variants.length) return null;

  const variantId = item?.variant?.variantId;

  if (variantId) {
    const byId = variants.find(
      (variant) =>
        String(variant?._id) === String(variantId)
    );

    if (byId) return byId;
  }

  const sku = normalize(item?.variant?.sku);

  if (sku) {
    const bySku = variants.find(
      (variant) => normalize(variant?.sku) === sku
    );

    if (bySku) return bySku;
  }

  const selectedSize = normalize(item?.selectedSize);

  if (selectedSize) {
    const bySize = variants.find((variant) =>
      (variant?.attributes || []).some((attr) => {
        const key = normalize(attr?.key);
        const value = normalize(attr?.value);

        return (
          ["size", "sizes"].includes(key) &&
          value === selectedSize
        );
      })
    );

    if (bySize) return bySize;
  }

  return null;
};

const getAvailableQty = (product, item) => {
  if (!product) return 0;

  const variants = Array.isArray(product?.variants)
    ? product.variants
    : [];

  // Simple product
  if (!variants.length) {
    return Math.max(
      0,
      num(product.stock) - num(product.reservedStock)
    );
  }

  // Variable product
  const variant = getVariant(product, item);

  if (!variant) return 0;

  return Math.max(
    0,
    num(variant.stock) - num(variant.reservedStock)
  );
};

export const buildProductInventoryMap = async (orders = []) => {
  const productIds = [
    ...new Set(
      orders
        .flatMap((order) => order?.items || [])
        .filter(
          (item) =>
            item?.productModel === "Product" &&
            item?.productId
        )
        .map((item) => String(item.productId))
    ),
  ];

  if (!productIds.length) {
    return new Map();
  }

  const products = await Product.find({
    _id: { $in: productIds },
  })
    .select(
      "_id productCode title stock reservedStock variants"
    )
    .lean();

  return new Map(
    products.map((product) => [
      String(product._id),
      product,
    ])
  );
};

export const getOrderFulfillmentReadiness = (
  order,
  productMap
) => {
  const items = Array.isArray(order?.items)
    ? order.items
    : [];

  if (!items.length) {
    return {
      status: "none",
      isFullyFulfillable: false,
      percentage: 0,
      requiredQty: 0,
      fulfillableQty: 0,
      missingItems: [],
      items: [],
    };
  }

  let requiredQty = 0;
  let fulfillableQty = 0;

  const checkedItems = items.map((item) => {
    const required = Math.max(
      1,
      num(item?.quantity || 1)
    );

    requiredQty += required;

    const product =
      productMap.get(String(item?.productId)) || null;

    const availableQty =
      item?.productModel === "Product"
        ? getAvailableQty(product, item)
        : 0;

    const fulfillable = Math.min(
      required,
      availableQty
    );

    fulfillableQty += fulfillable;

    return {
      lineId: item?.lineId || "",
      productId: item?.productId || null,
      productCode:
        item?.productSnapshot?.productCode || "",
      title:
        item?.productSnapshot?.title || "",
      selectedSize: item?.selectedSize || "",
      requiredQty: required,
      availableQty,
      ready: availableQty >= required,
    };
  });

  const readyItems = checkedItems.filter(
    (item) => item.ready
  ).length;

  let status = "none";

  if (readyItems === checkedItems.length) {
    status = "full";
  } else if (fulfillableQty > 0) {
    status = "partial";
  }

  return {
    status,

    isFullyFulfillable: status === "full",

    percentage: requiredQty
      ? Math.round(
        (fulfillableQty / requiredQty) * 100
      )
      : 0,

    requiredQty,
    fulfillableQty,

    missingItems: checkedItems.filter(
      (item) => !item.ready
    ),

    items: checkedItems,
  };
};

export const enrichOrdersWithFulfillmentReadiness =
  async (orders = []) => {
    const productMap =
      await buildProductInventoryMap(orders);

    return orders.map((order) => ({
      ...order,
      fulfillmentReadiness:
        getOrderFulfillmentReadiness(
          order,
          productMap
        ),
    }));
  };

export const getFullyFulfillableOrders = async (
  orders = []
) => {
  const enriched =
    await enrichOrdersWithFulfillmentReadiness(
      orders
    );

  return enriched.filter(
    (order) =>
      order?.fulfillmentReadiness
        ?.isFullyFulfillable
  );
};
