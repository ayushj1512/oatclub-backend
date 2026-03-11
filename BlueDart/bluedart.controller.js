import Order from "../Orders/Orders.js";
import BlueDartShipment from "./BlueDartShipment.js";
import { BLUEDART } from "./bluedart.constants.js";
import {
  buildBlueDartShipmentDocFromOrder,
  buildCreateShipmentPayload,
} from "./bluedart.mapper.js";
import {
  createShipmentOnBlueDart,
  trackShipmentOnBlueDart,
} from "./bluedart.service.js";
import {
  normalizeTrackingStatus,
  parseDateSafe,
} from "./bluedart.utils.js";

const safe = (v) => (v == null ? "" : String(v).trim());

const ok = (res, message, data = {}) =>
  res.status(200).json({ success: true, message, ...data });

const fail = (res, status, message, extra = {}) =>
  res.status(status).json({ success: false, message, ...extra });

const toPositiveNumber = (value, fallback) => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
};

const getErrorMeta = (error) => {
  return {
    message: error?.message || "Unknown error",
    status: error?.response?.status || error?.status || 500,
    statusText: error?.response?.statusText || error?.statusText || "",
    data: error?.response?.data || error?.data || null,
  };
};

/* =========================================================
   PICKUP / SENDER ADDRESS
========================================================= */
const getPickupSender = () => ({
  fullName: "Mukesh Singh",
  phone: "7303491206",
  email: "support@mirayfashions.com",
  line1: "TA-97-A, Gali No.-2, Tuglakabad Extension",
  line2: "Near Haldiram",
  city: "Delhi",
  state: "Delhi",
  pincode: "110019",
  country: "India",
});

/* =========================================================
   RESPONSE PARSERS
========================================================= */
const extractCreateResult = (data = {}) => {
  const root = data ?? {};
  const meta = root?.meta ?? {};

  const d = Array.isArray(root?.data) ? root.data[0] || {} : root?.data ?? root;

  return {
    awbNumber:
      d?.awb_number ||
      d?.awb ||
      d?.awbNo ||
      d?.shipment?.awb ||
      d?.tracking_number ||
      d?.awb_no ||
      "",

    shipmentIdExternal:
      d?.shipment_id ||
      d?.shipmentId ||
      d?.shipment?.id ||
      d?.id ||
      d?.order_id ||
      d?.reference_number ||
      "",

    labelUrl:
      d?.label_url ||
      d?.labelUrl ||
      d?.shipment?.label_url ||
      d?.shipment?.labelUrl ||
      "",

    manifestUrl:
      d?.manifest_url ||
      d?.manifestUrl ||
      d?.shipment?.manifest_url ||
      "",

    invoiceUrl:
      d?.invoice_url ||
      d?.invoiceUrl ||
      d?.shipment?.invoice_url ||
      "",

    status:
      d?.status ||
      d?.order_status ||
      d?.shipment_status ||
      meta?.status ||
      "",

    statusCode:
      d?.status_code ||
      d?.code ||
      meta?.code ||
      "",
  };
};

const extractTrackingResult = (data = {}) => {
  const root = data ?? {};
  const d = Array.isArray(root?.data) ? root.data[0] || {} : root?.data ?? root;

  const events = Array.isArray(d?.events)
    ? d.events
    : Array.isArray(d?.tracking_events)
    ? d.tracking_events
    : Array.isArray(d?.scan_details)
    ? d.scan_details
    : Array.isArray(d?.scans)
    ? d.scans
    : [];

  const latest =
    d?.latest_event ||
    d?.latest_scan ||
    events[0] ||
    events[events.length - 1] ||
    {};

  const rawStatus =
    d?.status ||
    d?.shipment_status ||
    latest?.status ||
    latest?.event_name ||
    latest?.event ||
    latest?.scan_type ||
    "";

  return {
    rawStatus,
    normalizedStatus: normalizeTrackingStatus(rawStatus),

    latestTrackingRemark:
      latest?.remark ||
      latest?.description ||
      latest?.event_description ||
      latest?.details ||
      rawStatus ||
      "",

    latestTrackingLocation:
      latest?.location ||
      latest?.event_location ||
      latest?.scan_location ||
      "",

    deliveredAt: parseDateSafe(
      d?.delivered_at ||
        latest?.delivered_at ||
        latest?.delivery_time ||
        latest?.deliveredOn
    ),

    shippedAt: parseDateSafe(
      d?.shipped_at || d?.dispatched_at || latest?.shipped_at
    ),

    pickedUpAt: parseDateSafe(
      d?.picked_at || d?.pickup_at || latest?.picked_at
    ),

    events: events.map((ev) => ({
      eventCode: safe(ev?.code || ev?.event_code || ev?.scan_code),
      eventName: safe(
        ev?.event_name || ev?.event || ev?.status || ev?.scan_type
      ),
      eventDescription: safe(
        ev?.description || ev?.remark || ev?.details || ev?.event_description
      ),
      eventLocation: safe(
        ev?.location || ev?.event_location || ev?.scan_location
      ),
      eventTime: parseDateSafe(
        ev?.time ||
          ev?.event_time ||
          ev?.created_at ||
          ev?.updated_at ||
          ev?.scan_time
      ),
      raw: ev,
    })),
  };
};

/* =========================================================
   CREATE SHIPMENT FROM ORDER
========================================================= */
export const createShipmentFromOrder = async (req, res) => {
  try {
    const {
      orderNumber,
      weight,
      length,
      breadth,
      height,
      pieces,
      notes,
      serviceType,
    } = req.body || {};

    console.log("\n========== BLUEDART CREATE FROM ORDER ==========");
    console.log("REQUEST BODY:", req.body);

    if (!safe(orderNumber)) {
      return fail(res, 400, "orderNumber is required");
    }

    const order = await Order.findOne({ orderNumber: safe(orderNumber) });
    console.log("ORDER FOUND:", !!order, order?.orderNumber || null);

    if (!order) {
      return fail(res, 404, "Order not found");
    }

    const existing = await BlueDartShipment.findOne({
      orderNumber: order.orderNumber,
      shipmentType: "forward",
      isCancelled: false,
      status: { $nin: ["cancelled", "failed"] },
    });

    if (existing) {
      console.log("ACTIVE SHIPMENT ALREADY EXISTS:", existing?._id);
      return fail(
        res,
        409,
        "Active BlueDart shipment already exists for this order",
        { shipment: existing }
      );
    }

    const paymentMethod = safe(order?.paymentMethod).toLowerCase();

    const finalServiceType =
      safe(serviceType) ||
      (paymentMethod === "cod"
        ? BLUEDART?.SERVICE_TYPES?.COD || "eTailCODAir"
        : BLUEDART?.SERVICE_TYPES?.PREPAID || "eTailPrePaidAir");

    const totalPieces = Array.isArray(order?.items)
      ? Math.max(
          1,
          order.items.reduce((sum, item) => sum + Number(item?.quantity || 0), 0)
        )
      : BLUEDART?.DEFAULTS?.PIECES || 1;

    const shipmentDoc = buildBlueDartShipmentDocFromOrder(order, {
      sender: getPickupSender(),
      weight: toPositiveNumber(weight, BLUEDART?.DEFAULTS?.WEIGHT || 0.5),
      length: toPositiveNumber(length, BLUEDART?.DEFAULTS?.LENGTH || 25),
      breadth: toPositiveNumber(breadth, BLUEDART?.DEFAULTS?.BREADTH || 20),
      height: toPositiveNumber(height, BLUEDART?.DEFAULTS?.HEIGHT || 5),
      pieces: toPositiveNumber(pieces, totalPieces),
      notes,
      serviceType: finalServiceType,
    });

    console.log("SHIPMENT DOC PREVIEW:", {
      orderNumber: shipmentDoc?.orderNumber,
      referenceNumber: shipmentDoc?.referenceNumber,
      serviceType: shipmentDoc?.serviceType,
      weight: shipmentDoc?.package?.weight || shipmentDoc?.weight,
      pieces: shipmentDoc?.package?.pieces || shipmentDoc?.pieces,
      sender: shipmentDoc?.sender,
      recipient: shipmentDoc?.recipient,
    });

    const payload = buildCreateShipmentPayload(shipmentDoc, order);
    console.log("CREATE PAYLOAD:", JSON.stringify(payload, null, 2));

    const apiResponse = await createShipmentOnBlueDart(payload);
    console.log("CREATE API RESPONSE:", JSON.stringify(apiResponse, null, 2));

    const parsed = extractCreateResult(apiResponse);

    const derivedStatus = parsed.awbNumber
      ? normalizeTrackingStatus(parsed.status || "created")
      : "order_pushed";

    const created = await BlueDartShipment.create({
      ...shipmentDoc,
      awbNumber: parsed.awbNumber || "",
      shipmentIdExternal:
        parsed.shipmentIdExternal ||
        shipmentDoc?.referenceNumber ||
        shipmentDoc?.orderNumber ||
        "",
      labelUrl: parsed.labelUrl || "",
      manifestUrl: parsed.manifestUrl || "",
      invoiceUrl: parsed.invoiceUrl || "",
      status: derivedStatus,
      statusCode: parsed.statusCode || "",
      rawCreateRequest: payload,
      rawCreateResponse: apiResponse,
    });

    console.log("CREATED SHIPMENT ID:", created?._id);
    console.log("CREATED STATUS:", created?.status);
    console.log("CREATED AWB:", created?.awbNumber || "N/A");
    console.log("===============================================\n");

    return ok(
      res,
      parsed.awbNumber
        ? "BlueDart shipment created successfully"
        : "BlueDart order pushed successfully",
      {
        shipment: created,
        externalResponse: apiResponse,
      }
    );
  } catch (error) {
    const meta = getErrorMeta(error);

    console.error("\n========== BLUEDART CREATE ERROR ==========");
    console.error("MESSAGE:", meta.message);
    console.error("STATUS:", meta.status);
    console.error("STATUS TEXT:", meta.statusText);
    console.error("DATA:", meta.data);
    console.error("==========================================\n");

    return fail(
      res,
      meta.status || 500,
      meta?.data?.meta?.message ||
        meta?.data?.message ||
        meta?.data?.error ||
        meta.message ||
        "Failed to create BlueDart shipment",
      {
        errorData: meta.data,
      }
    );
  }
};

/* =========================================================
   LIST SHIPMENTS
========================================================= */
export const listShipments = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      q = "",
      status = "",
      shipmentType = "",
    } = req.query;

    const filter = {};

    if (safe(status)) filter.status = safe(status);
    if (safe(shipmentType)) filter.shipmentType = safe(shipmentType);

    if (safe(q)) {
      filter.$or = [
        { orderNumber: { $regex: safe(q), $options: "i" } },
        { awbNumber: { $regex: safe(q), $options: "i" } },
        { referenceNumber: { $regex: safe(q), $options: "i" } },
        { "recipient.fullName": { $regex: safe(q), $options: "i" } },
      ];
    }

    const pageNum = Math.max(1, Number(page || 1));
    const lim = Math.max(1, Math.min(100, Number(limit || 20)));
    const skip = (pageNum - 1) * lim;

    const [rows, total] = await Promise.all([
      BlueDartShipment.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(lim),
      BlueDartShipment.countDocuments(filter),
    ]);

    return ok(res, "Shipments fetched successfully", {
      shipments: rows,
      pagination: {
        page: pageNum,
        limit: lim,
        total,
        totalPages: Math.ceil(total / lim),
      },
    });
  } catch (error) {
    const meta = getErrorMeta(error);
    return fail(
      res,
      meta.status || 500,
      meta.message || "Failed to fetch shipments",
      { errorData: meta.data }
    );
  }
};

/* =========================================================
   GET SHIPMENT BY ID
========================================================= */
export const getShipmentById = async (req, res) => {
  try {
    const shipment = await BlueDartShipment.findById(req.params.id);
    if (!shipment) return fail(res, 404, "Shipment not found");

    return ok(res, "Shipment fetched successfully", { shipment });
  } catch (error) {
    const meta = getErrorMeta(error);
    return fail(
      res,
      meta.status || 500,
      meta.message || "Failed to fetch shipment",
      { errorData: meta.data }
    );
  }
};

/* =========================================================
   GET SHIPMENT BY ORDER NUMBER
========================================================= */
export const getShipmentByOrderNumber = async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const shipments = await BlueDartShipment.find({ orderNumber }).sort({
      createdAt: -1,
    });

    return ok(res, "Order shipments fetched successfully", { shipments });
  } catch (error) {
    const meta = getErrorMeta(error);
    return fail(
      res,
      meta.status || 500,
      meta.message || "Failed to fetch order shipments",
      { errorData: meta.data }
    );
  }
};

/* =========================================================
   TRACK SHIPMENT
========================================================= */
export const trackShipment = async (req, res) => {
  try {
    const shipment = await BlueDartShipment.findById(req.params.id);
    if (!shipment) return fail(res, 404, "Shipment not found");

    if (!safe(shipment.awbNumber) && !safe(shipment.referenceNumber)) {
      return fail(res, 400, "Shipment has no AWB/reference to track");
    }

    console.log("\n========== BLUEDART TRACK SHIPMENT ==========");
    console.log("SHIPMENT ID:", shipment?._id);
    console.log("AWB:", shipment?.awbNumber);
    console.log(
      "REFERENCE:",
      shipment?.referenceNumber || shipment?.orderNumber
    );

    const apiResponse = await trackShipmentOnBlueDart({
      awbNumber: shipment.awbNumber,
      referenceNumber: shipment.referenceNumber || shipment.orderNumber,
    });

    console.log("TRACK API RESPONSE:", JSON.stringify(apiResponse, null, 2));

    const parsed = extractTrackingResult(apiResponse);

    shipment.status = parsed.normalizedStatus || shipment.status;
    shipment.latestTrackingRemark =
      parsed.latestTrackingRemark || shipment.latestTrackingRemark;
    shipment.latestTrackingLocation =
      parsed.latestTrackingLocation || shipment.latestTrackingLocation;
    shipment.deliveredAt = parsed.deliveredAt || shipment.deliveredAt;
    shipment.shippedAt = parsed.shippedAt || shipment.shippedAt;
    shipment.pickedUpAt = parsed.pickedUpAt || shipment.pickedUpAt;
    shipment.trackingEvents = parsed.events;
    shipment.lastSyncedAt = new Date();
    shipment.syncError = "";
    shipment.rawTrackingResponse = apiResponse;

    await shipment.save();

    console.log("UPDATED TRACK STATUS:", shipment.status);
    console.log("============================================\n");

    return ok(res, "Shipment tracked successfully", { shipment });
  } catch (error) {
    const meta = getErrorMeta(error);

    console.error("\n========== BLUEDART TRACK ERROR ==========");
    console.error("MESSAGE:", meta.message);
    console.error("STATUS:", meta.status);
    console.error("DATA:", meta.data);
    console.error("=========================================\n");

    return fail(
      res,
      meta.status || 500,
      meta?.data?.meta?.message ||
        meta?.data?.message ||
        meta?.data?.error ||
        meta.message ||
        "Failed to track shipment",
      {
        errorData: meta.data,
      }
    );
  }
};

/* =========================================================
   BULK SYNC SHIPMENTS
========================================================= */
export const bulkSyncShipments = async (req, res) => {
  try {
    const rows = await BlueDartShipment.find({
      status: {
        $in: [
          "order_pushed",
          "created",
          "pickup_pending",
          "picked",
          "in_transit",
          "out_for_delivery",
        ],
      },
      isCancelled: false,
    })
      .sort({ updatedAt: 1 })
      .limit(50);

    const results = [];

    for (const shipment of rows) {
      try {
        const apiResponse = await trackShipmentOnBlueDart({
          awbNumber: shipment.awbNumber,
          referenceNumber: shipment.referenceNumber || shipment.orderNumber,
        });

        const parsed = extractTrackingResult(apiResponse);

        shipment.status = parsed.normalizedStatus || shipment.status;
        shipment.latestTrackingRemark =
          parsed.latestTrackingRemark || shipment.latestTrackingRemark;
        shipment.latestTrackingLocation =
          parsed.latestTrackingLocation || shipment.latestTrackingLocation;
        shipment.deliveredAt = parsed.deliveredAt || shipment.deliveredAt;
        shipment.shippedAt = parsed.shippedAt || shipment.shippedAt;
        shipment.pickedUpAt = parsed.pickedUpAt || shipment.pickedUpAt;
        shipment.trackingEvents = parsed.events;
        shipment.lastSyncedAt = new Date();
        shipment.syncError = "";
        shipment.rawTrackingResponse = apiResponse;

        await shipment.save();

        results.push({
          id: shipment._id,
          orderNumber: shipment.orderNumber,
          awbNumber: shipment.awbNumber,
          success: true,
          status: shipment.status,
        });
      } catch (err) {
        const meta = getErrorMeta(err);

        shipment.syncError =
          meta?.data?.meta?.message ||
          meta?.data?.message ||
          meta?.data?.error ||
          meta.message ||
          "Sync failed";
        shipment.lastSyncedAt = new Date();
        await shipment.save();

        results.push({
          id: shipment._id,
          orderNumber: shipment.orderNumber,
          awbNumber: shipment.awbNumber,
          success: false,
          error:
            meta?.data?.meta?.message ||
            meta?.data?.message ||
            meta?.data?.error ||
            meta.message ||
            "Sync failed",
          errorData: meta.data,
        });
      }
    }

    return ok(res, "Bulk sync completed", {
      results,
      count: results.length,
    });
  } catch (error) {
    const meta = getErrorMeta(error);
    return fail(
      res,
      meta.status || 500,
      meta.message || "Failed to bulk sync shipments",
      { errorData: meta.data }
    );
  }
};
