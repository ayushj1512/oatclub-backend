import crypto from "crypto";
import mongoose from "mongoose";

import Order from "../Orders/Orders.js";
import PackagingEvidence from "./PackagingEvidence.js";

const cleanText = (value = "") =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ");

const cleanOrderNumber = (value = "") =>
  cleanText(value)
    .replace(/^#/, "")
    .toUpperCase();

const safeFilePart = (value = "") =>
  cleanText(value)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\.+$/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const normalizeEvidenceType = (value = "") => {
  const normalized = cleanText(value).toLowerCase();

  if (!["forward", "rto"].includes(normalized)) {
    return "";
  }

  return normalized;
};

const positiveNumber = (value, fallback = 0) => {
  const number = Number(value);

  return Number.isFinite(number) && number >= 0
    ? number
    : fallback;
};

const getForwardAwb = (order) =>
  cleanText(
    order?.shipment?.awb ||
    order?.shipment?.delhivery?.awb ||
    order?.shipment?.delhivery?.waybill ||
    order?.shipment?.shiprocket?.awb ||
    order?.shipment?.xpressbees?.awb ||
    order?.shipment?.eshipz?.awb ||
    order?.trackingDetails?.awb ||
    order?.trackingDetails?.trackingId,
  );

const getForwardCourier = (order) =>
  cleanText(
    order?.shipment?.courierName ||
    order?.shipment?.delhivery?.courierName ||
    order?.shipment?.shiprocket?.courierName ||
    order?.shipment?.xpressbees?.courierName ||
    order?.shipment?.eshipz?.courierName ||
    order?.trackingDetails?.courierName ||
    order?.shipment?.provider,
  );

const findRma = (order, rmaNumber = "") => {
  const normalizedRmaNumber = cleanText(rmaNumber).toUpperCase();

  if (!normalizedRmaNumber) {
    return null;
  }

  return (
    order?.rmas?.find(
      (rma) =>
        cleanText(rma?.rmaNumber).toUpperCase() ===
        normalizedRmaNumber,
    ) || null
  );
};

const getRtoAwb = (order, rmaNumber = "") => {
  const rma = findRma(order, rmaNumber);

  if (rma?.reverseShipment?.awb) {
    return cleanText(rma.reverseShipment.awb);
  }

  /*
   * Courier RTO generally uses the original forward AWB.
   * Therefore fallback to the main shipment AWB.
   */
  return getForwardAwb(order);
};

const getRtoCourier = (order, rmaNumber = "") => {
  const rma = findRma(order, rmaNumber);

  return cleanText(
    rma?.reverseShipment?.courierName ||
    rma?.reverseShipment?.provider ||
    getForwardCourier(order),
  );
};

const getOrderSummary = (order) => ({
  _id: order._id,
  orderNumber: order.orderNumber,
  fulfillmentStatus: order.fulfillmentStatus || "",
  shipmentStatus: order.shipment?.status || "",
  customerName:
    order.shippingAddressSnapshot?.fullName ||
    order.shippingAddressSnapshot?.name ||
    order.billingAddressSnapshot?.fullName ||
    order.billingAddressSnapshot?.name ||
    "",
  items: (order.items || []).map((item) => ({
    lineId: item.lineId,
    productId: item.productId,
    productCode: item.productSnapshot?.productCode || "",
    title: item.productSnapshot?.title || "",
    image:
      item.productSnapshot?.thumbnail ||
      item.productSnapshot?.images?.[0] ||
      "",
    selectedSize: item.selectedSize || "",
    selectedColor: item.selectedColor || "",
    quantity: item.quantity || 0,
  })),
});

export const lookupOrderForEvidence = async (req, res) => {
  try {
    const orderNumber = cleanOrderNumber(req.params.orderNumber);
    const evidenceType = normalizeEvidenceType(
      req.query.evidenceType || req.query.type || "forward",
    );
    const rmaNumber = cleanText(req.query.rmaNumber).toUpperCase();

    if (!orderNumber) {
      return res.status(400).json({
        success: false,
        message: "Order number is required.",
      });
    }

    if (!evidenceType) {
      return res.status(400).json({
        success: false,
        message: "evidenceType must be forward or rto.",
      });
    }

    const order = await Order.findOne({ orderNumber })
      .select({
        orderNumber: 1,
        fulfillmentStatus: 1,
        shipment: 1,
        trackingDetails: 1,
        shippingAddressSnapshot: 1,
        billingAddressSnapshot: 1,
        items: 1,
        rmas: 1,
      })
      .lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        message: `Order #${orderNumber} not found.`,
      });
    }

    const awb =
      evidenceType === "rto"
        ? getRtoAwb(order, rmaNumber)
        : getForwardAwb(order);

    const courierPartner =
      evidenceType === "rto"
        ? getRtoCourier(order, rmaNumber)
        : getForwardCourier(order);

    const safeOrderNumber = safeFilePart(order.orderNumber);
    const safeAwb = safeFilePart(awb || "NO-AWB");

    const orderFolder = safeOrderNumber;
    const fileName = `${safeOrderNumber}-${safeAwb}-${evidenceType}.webm`;
    const relativePath = `${orderFolder}\\${fileName}`;

    return res.status(200).json({
      success: true,
      message: "Order ready for evidence recording.",
      data: {
        order: getOrderSummary(order),
        evidence: {
          evidenceType,
          awb,
          courierPartner,
          rmaNumber,
          orderFolder,
          fileName,
          relativePath,
        },
      },
    });
  } catch (error) {
    console.error("lookupOrderForEvidence error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch order for evidence recording.",
      error: error.message,
    });
  }
};

export const createPackagingEvidence = async (req, res) => {
  try {
    const {
      orderId,
      orderNumber: rawOrderNumber,
      evidenceType: rawEvidenceType,
      awb: rawAwb,
      courierPartner,
      rmaNumber,
      stationName,
      computerName,
      packerName,
      storageRoot,
      orderFolder: requestedOrderFolder,
      fileName: requestedFileName,
      relativePath: requestedRelativePath,
      mimeType,
      fileSizeBytes,
      durationSeconds,
      sha256,
      width,
      height,
      framesPerSecond,
      hasAudio,
      recordedAt,
      notes,
    } = req.body;

    const orderNumber = cleanOrderNumber(rawOrderNumber);
    const evidenceType = normalizeEvidenceType(rawEvidenceType);

    if (!orderNumber && !mongoose.isValidObjectId(orderId)) {
      return res.status(400).json({
        success: false,
        message: "Valid orderId or orderNumber is required.",
      });
    }

    if (!evidenceType) {
      return res.status(400).json({
        success: false,
        message: "evidenceType must be forward or rto.",
      });
    }

    if (!cleanText(stationName)) {
      return res.status(400).json({
        success: false,
        message: "stationName is required.",
      });
    }

    if (!cleanText(storageRoot)) {
      return res.status(400).json({
        success: false,
        message: "storageRoot is required.",
      });
    }

    const orderQuery = mongoose.isValidObjectId(orderId)
      ? { _id: orderId }
      : { orderNumber };

    const order = await Order.findOne(orderQuery)
      .select({
        orderNumber: 1,
        shipment: 1,
        trackingDetails: 1,
        rmas: 1,
      })
      .lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    const normalizedRmaNumber = cleanText(rmaNumber).toUpperCase();

    const resolvedAwb =
      cleanText(rawAwb) ||
      (evidenceType === "rto"
        ? getRtoAwb(order, normalizedRmaNumber)
        : getForwardAwb(order));

    if (!resolvedAwb) {
      return res.status(400).json({
        success: false,
        message:
          "AWB was not found on the order. Please provide awb manually.",
      });
    }

    const resolvedCourier =
      cleanText(courierPartner) ||
      (evidenceType === "rto"
        ? getRtoCourier(order, normalizedRmaNumber)
        : getForwardCourier(order));

    const safeOrderNumber = safeFilePart(order.orderNumber);
    const safeAwb = safeFilePart(resolvedAwb);

    const generatedOrderFolder = safeOrderNumber;

    const generatedFileName =
      `${safeOrderNumber}-${safeAwb}-${evidenceType}.webm`;

    const generatedRelativePath =
      `${generatedOrderFolder}\\${generatedFileName}`;

    const finalOrderFolder =
      safeFilePart(requestedOrderFolder) ||
      generatedOrderFolder;

    const finalFileName =
      safeFilePart(requestedFileName) ||
      generatedFileName;

    const finalRelativePath =
      cleanText(requestedRelativePath) ||
      `${finalOrderFolder}\\${finalFileName}`;

    const normalizedChecksum = cleanText(sha256).toLowerCase();

    if (
      normalizedChecksum &&
      !/^[a-f0-9]{64}$/.test(normalizedChecksum)
    ) {
      return res.status(400).json({
        success: false,
        message: "sha256 must be a valid 64-character SHA-256 hash.",
      });
    }

    const evidence = await PackagingEvidence.create({
      order: order._id,
      orderNumber: order.orderNumber,
      evidenceType,
      awb: resolvedAwb,
      courierPartner: resolvedCourier,
      rmaNumber: normalizedRmaNumber,

      station: {
        stationName: cleanText(stationName),
        computerName: cleanText(computerName),
        packerName: cleanText(packerName),
      },

      storage: {
        storageRoot: cleanText(storageRoot),
        orderFolder: finalOrderFolder,
        fileName: finalFileName,
        relativePath: finalRelativePath,
        mimeType: cleanText(mimeType) || "video/webm",
        fileSizeBytes: positiveNumber(fileSizeBytes),
        durationSeconds: positiveNumber(durationSeconds),
        sha256: normalizedChecksum,
      },

      video: {
        width: positiveNumber(width),
        height: positiveNumber(height),
        framesPerSecond: positiveNumber(framesPerSecond),
        hasAudio: Boolean(hasAudio),
      },

      status: "saved",
      recordedAt: recordedAt ? new Date(recordedAt) : new Date(),
      saveVerifiedAt: new Date(),
      notes: cleanText(notes),
    });

    return res.status(201).json({
      success: true,
      message: "Packaging evidence registered successfully.",
      data: evidence,
    });
  } catch (error) {
    console.error("createPackagingEvidence error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to register packaging evidence.",
      error: error.message,
    });
  }
};

export const getPackagingEvidenceList = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number(req.query.limit) || 20),
    );

    const query = {};

    if (req.query.orderNumber) {
      query.orderNumber = cleanOrderNumber(req.query.orderNumber);
    }

    if (req.query.awb) {
      query.awb = cleanText(req.query.awb);
    }

    if (req.query.evidenceType) {
      const evidenceType = normalizeEvidenceType(
        req.query.evidenceType,
      );

      if (!evidenceType) {
        return res.status(400).json({
          success: false,
          message: "evidenceType must be forward or rto.",
        });
      }

      query.evidenceType = evidenceType;
    }

    if (req.query.stationName) {
      query["station.stationName"] = cleanText(
        req.query.stationName,
      );
    }

    if (req.query.status) {
      query.status = cleanText(req.query.status).toLowerCase();
    }

    const [records, total] = await Promise.all([
      PackagingEvidence.find(query)
        .sort({ recordedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),

      PackagingEvidence.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      data: records,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("getPackagingEvidenceList error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch packaging evidence.",
      error: error.message,
    });
  }
};

export const getOrderPackagingEvidence = async (req, res) => {
  try {
    const orderNumber = cleanOrderNumber(req.params.orderNumber);

    const records = await PackagingEvidence.find({
      orderNumber,
    })
      .sort({ recordedAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: records,
      count: records.length,
    });
  } catch (error) {
    console.error("getOrderPackagingEvidence error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch order packaging evidence.",
      error: error.message,
    });
  }
};

export const getPackagingEvidenceById = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid evidence ID.",
      });
    }

    const evidence = await PackagingEvidence.findById(
      req.params.id,
    ).lean();

    if (!evidence) {
      return res.status(404).json({
        success: false,
        message: "Packaging evidence not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: evidence,
    });
  } catch (error) {
    console.error("getPackagingEvidenceById error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch packaging evidence.",
      error: error.message,
    });
  }
};

export const updatePackagingEvidenceStatus = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid evidence ID.",
      });
    }

    const allowedStatuses = [
      "saved",
      "missing",
      "corrupted",
      "failed",
    ];

    const status = cleanText(req.body.status).toLowerCase();

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message:
          "status must be saved, missing, corrupted or failed.",
      });
    }

    const update = {
      status,
      failureReason: cleanText(req.body.failureReason),
    };

    if (status === "saved") {
      update.saveVerifiedAt = new Date();
      update.failureReason = "";
    }

    const evidence = await PackagingEvidence.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      {
        new: true,
        runValidators: true,
      },
    );

    if (!evidence) {
      return res.status(404).json({
        success: false,
        message: "Packaging evidence not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Evidence status updated.",
      data: evidence,
    });
  } catch (error) {
    console.error("updatePackagingEvidenceStatus error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to update evidence status.",
      error: error.message,
    });
  }
};

export const getPackagingEvidenceStats = async (req, res) => {
  try {
    const match = {};

    if (req.query.from || req.query.to) {
      match.recordedAt = {};

      if (req.query.from) {
        match.recordedAt.$gte = new Date(req.query.from);
      }

      if (req.query.to) {
        const toDate = new Date(req.query.to);
        toDate.setHours(23, 59, 59, 999);
        match.recordedAt.$lte = toDate;
      }
    }

    const [summary, stations] = await Promise.all([
      PackagingEvidence.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            forward: {
              $sum: {
                $cond: [
                  { $eq: ["$evidenceType", "forward"] },
                  1,
                  0,
                ],
              },
            },
            rto: {
              $sum: {
                $cond: [
                  { $eq: ["$evidenceType", "rto"] },
                  1,
                  0,
                ],
              },
            },
            totalSizeBytes: {
              $sum: "$storage.fileSizeBytes",
            },
            totalDurationSeconds: {
              $sum: "$storage.durationSeconds",
            },
          },
        },
      ]),

      PackagingEvidence.aggregate([
        { $match: match },
        {
          $group: {
            _id: "$station.stationName",
            total: { $sum: 1 },
            lastRecordingAt: { $max: "$recordedAt" },
          },
        },
        { $sort: { total: -1 } },
      ]),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        summary: summary[0] || {
          total: 0,
          forward: 0,
          rto: 0,
          totalSizeBytes: 0,
          totalDurationSeconds: 0,
        },
        stations: stations.map((station) => ({
          stationName: station._id,
          total: station.total,
          lastRecordingAt: station.lastRecordingAt,
        })),
      },
    });
  } catch (error) {
    console.error("getPackagingEvidenceStats error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch evidence statistics.",
      error: error.message,
    });
  }
};

export const generateEvidenceSessionId = (req, res) => {
  return res.status(200).json({
    success: true,
    data: {
      sessionId: crypto.randomUUID(),
      generatedAt: new Date(),
    },
  });
};
