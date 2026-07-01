import CuttingBatch from "./cuttingbatch.js";
import InventoryReservation from "../InventoryReservation/InventoryReservation.js";
import Order from "../Orders/Orders.js";

const ALLOWED_SOURCES = ["shopify", "website"];

const getOrderSeq = (orderNumber = "") => {
  const match = String(orderNumber).match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
};

const sizeKey = (size = "") => {
  const s = String(size).trim().toLowerCase();

  if (s === "xs") return "xs";
  if (s === "s") return "s";
  if (s === "m") return "m";
  if (s === "l") return "l";
  if (s === "xl") return "xl";

  return null;
};

const makeBatchNumber = (source = "website") => {
  const d = new Date();
  const date = d.toISOString().slice(0, 10).replaceAll("-", "");
  const prefix = source === "shopify" ? "CUT-SHOP" : "CUT-WEB";
  return `${prefix}-${date}-${Date.now()}`;
};

const normalizeSource = (value) => {
  const source = String(value || "website").trim().toLowerCase();
  return ALLOWED_SOURCES.includes(source) ? source : "website";
};

export const generateCuttingBatch = async (req, res) => {
  try {
    const source = normalizeSource(req.body.source || req.query.source);

    const lastBatch = await CuttingBatch.findOne({ source })
      .sort({ createdAt: -1 })
      .lean();

    const lastSeq = lastBatch ? getOrderSeq(lastBatch.toOrderNumber) : 0;

    const orders = await Order.find({
      source,
      orderNumber: { $exists: true, $ne: "" },
      fulfillmentStatus: { $nin: ["cancelled", "rto", "delivered"] },
    })
      .select("_id orderNumber")
      .lean();

    const newOrders = orders
      .filter((order) => getOrderSeq(order.orderNumber) > lastSeq)
      .sort((a, b) => getOrderSeq(a.orderNumber) - getOrderSeq(b.orderNumber));

    if (!newOrders.length) {
      return res.status(400).json({
        success: false,
        message: lastBatch
          ? `No new ${source} orders found after ${lastBatch.toOrderNumber}`
          : `No ${source} orders found for cutting`,
      });
    }

    const orderIds = newOrders.map((order) => order._id);

    const reservations = await InventoryReservation.find({
      refType: "order",
      status: "pending",
      refId: { $in: orderIds },
    }).lean();

    if (!reservations.length) {
      return res.status(400).json({
        success: false,
        message: `No pending inventory reservations found for new ${source} orders`,
      });
    }

    const validOrderNumberSet = new Set(
      reservations.map((item) => item.orderNumber).filter(Boolean)
    );

    const validOrders = newOrders.filter((order) =>
      validOrderNumberSet.has(order.orderNumber)
    );

    const fromOrderNumber =
      validOrders[0]?.orderNumber || newOrders[0].orderNumber;

    const toOrderNumber =
      validOrders[validOrders.length - 1]?.orderNumber ||
      newOrders[newOrders.length - 1].orderNumber;

    const grouped = {};

    for (const item of reservations) {
      const key =
        item.productCode ||
        item.variantSku ||
        item.productTitle ||
        String(item.productId);

      if (!grouped[key]) {
        grouped[key] = {
          productTitle: item.productTitle || "",
          productCode: item.productCode || "",
          productImage: item.productImage || "",

          xs: 0,
          s: 0,
          m: 0,
          l: 0,
          xl: 0,

          totalQty: 0,
        };
      }

      const size = sizeKey(item.selectedSize);
      const qty = Number(item.qty || 0);

      if (size) grouped[key][size] += qty;

      grouped[key].totalQty += qty;
    }

    const rows = Object.values(grouped).sort((a, b) =>
      String(a.productCode).localeCompare(String(b.productCode))
    );

    const totalPieces = rows.reduce(
      (sum, row) => sum + Number(row.totalQty || 0),
      0
    );

    const batch = await CuttingBatch.create({
      batchNumber: makeBatchNumber(source),
      source,

      fromOrderNumber,
      toOrderNumber,

      totalOrders: validOrders.length || newOrders.length,
      totalPieces,
      rows,

      logs: [
        {
          action: "created",
          message: `Auto ${source} batch created from ${fromOrderNumber} to ${toOrderNumber}`,
        },
        {
          action: "last_batch_checked",
          message: lastBatch
            ? `Previous ${source} cutting ended at ${lastBatch.toOrderNumber}`
            : `No previous ${source} cutting batch found`,
        },
        {
          action: "reservations_grouped",
          message: `${reservations.length} pending reservations grouped into ${rows.length} product rows`,
        },
      ],
    });

    return res.json({
      success: true,
      message: "Cutting batch generated successfully",
      batch,
    });
  } catch (error) {
    console.error("Cutting Batch Error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getCuttingBatches = async (req, res) => {
  try {
    const source = req.query.source ? normalizeSource(req.query.source) : null;

    const filters = source ? { source } : {};

    const batches = await CuttingBatch.find(filters)
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      batches,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getCuttingBatchById = async (req, res) => {
  try {
    const batch = await CuttingBatch.findById(req.params.id).lean();

    if (!batch) {
      return res.status(404).json({
        success: false,
        message: "Batch not found",
      });
    }

    return res.json({
      success: true,
      batch,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};