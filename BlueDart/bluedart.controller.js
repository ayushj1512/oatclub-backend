import Order from "../Orders/Orders.js";
import BlueDartShipment from "./BlueDartShipment.js";
import { BLUEDART } from "./bluedart.constants.js";
import {
  buildBlueDartShipmentDocFromOrder,
  buildCreateShipmentPayload,
buildDirectCreateShipmentPayload,
buildServiceabilityPayload,
} from "./bluedart.mapper.js";
import {
  pushOrderToBlueDart,
  createShipmentOnBlueDart,
  trackShipmentOnBlueDart,
  getOrdersFromBlueDart,
  getSingleOrderFromBlueDart,
  getEddPredictionFromBlueDart,
  checkServiceabilityOnBlueDart,
} from "./bluedart.service.js";
import {
  normalizeTrackingStatus,
  parseDateSafe,
  extractEshipzIds,
  buildOrderShipmentPatch,
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

const getErrorMeta = (error) => ({
  message: error?.message || "Unknown error",
  status: error?.response?.status || error?.status || 500,
  statusText: error?.response?.statusText || error?.statusText || "",
  data: error?.response?.data || error?.data || null,
});

const getPickupSender = () => ({
  fullName:
    process.env.ESHIPZ_SENDER_NAME ||
    process.env.BLUEDART_SENDER_NAME ||
    "Mukesh Singh",
  phone:
    process.env.ESHIPZ_SENDER_PHONE ||
    process.env.BLUEDART_SENDER_PHONE ||
    "7303491206",
  email:
    process.env.ESHIPZ_SENDER_EMAIL ||
    process.env.BLUEDART_SENDER_EMAIL ||
    "support@mirayfashions.com",
  line1:
    process.env.ESHIPZ_SENDER_LINE1 ||
    process.env.BLUEDART_SENDER_LINE1 ||
    "TA-97-A, Gali No.-2, Tuglakabad Extension",
  line2:
    process.env.ESHIPZ_SENDER_LINE2 ||
    process.env.BLUEDART_SENDER_LINE2 ||
    "Near Haldiram",
  city:
    process.env.ESHIPZ_SENDER_CITY ||
    process.env.BLUEDART_SENDER_CITY ||
    "Delhi",
  state:
    process.env.ESHIPZ_SENDER_STATE ||
    process.env.BLUEDART_SENDER_STATE ||
    "Delhi",
  pincode:
    process.env.ESHIPZ_SENDER_PINCODE ||
    process.env.BLUEDART_SENDER_PINCODE ||
    "110019",
  country:
    process.env.ESHIPZ_SENDER_COUNTRY ||
    process.env.BLUEDART_SENDER_COUNTRY ||
    "India",
});

const pickDataNode = (data = {}) => {
  const root = data ?? {};
  if (Array.isArray(root?.data)) return root.data[0] || {};
  return root?.data || root?.result || root?.shipment || root;
};

const pickUrl = (...values) => {
  for (const value of values) {
    if (!value) continue;

    if (typeof value === "string") {
      const clean = value.trim();
      if (clean && clean !== "[object Object]") return clean;
      continue;
    }

    if (typeof value === "object") {
      const nested = pickUrl(
        value.url,
        value.contents,
        value.label_url,
        value.labelUrl,
        value.file_url,
        value.fileUrl,
        value.invoice,
        value.manifest,
        value.package_sticker_url
      );

      if (nested) return nested;
    }
  }

  return "";
};

const extractCreateResult = (data = {}) => {
  const root = data ?? {};
  const meta = root?.meta ?? {};
  const d = pickDataNode(root);

  const ids = extractEshipzIds(root);

  return {
    awbNumber: ids.awb,
    awb: ids.awb,

    shipmentIdExternal: ids.shipmentId,
    shipmentId: ids.shipmentId,

    externalOrderId: ids.orderId,
    eshipzOrderId: ids.orderId,

    carrierName: ids.carrierName || "BlueDart",
    carrierSlug: ids.carrierSlug || "bluedart",
    serviceType: ids.serviceType || "",

   trackingUrl: pickUrl(ids.trackingUrl, d?.tracking_link, d?.tracking_url),

labelUrl: pickUrl(
  ids.labelUrl,
  d?.label_url,
  d?.labelUrl,
  d?.files?.label?.label_meta?.url,
  d?.files?.label?.label_meta?.contents,
  d?.files?.label?.url,
  d?.files?.label
),

manifestUrl: pickUrl(
  ids.manifestUrl,
  d?.manifest_url,
  d?.manifestUrl,
  d?.files?.manifest
),

invoiceUrl: pickUrl(
  ids.invoiceUrl,
  d?.invoice_url,
  d?.invoiceUrl,
  d?.files?.invoice,
  d?.files?.label?.invoice
),

    expectedDelivery: ids.expectedDelivery || null,

    status:
      ids.status ||
      normalizeTrackingStatus(
        d?.status || d?.order_status || d?.shipment_status || meta?.status || ""
      ),

    rawStatus:
      ids.rawStatus ||
      d?.status ||
      d?.order_status ||
      d?.shipment_status ||
      meta?.status ||
      "",

    statusCode: ids.statusCode || d?.status_code || d?.code || meta?.code || "",
  };
};

const extractTrackingResult = (data = {}) => {
  const root = data ?? {};
  const d = pickDataNode(root);

  const ids = extractEshipzIds(root);

  const events = Array.isArray(d?.events)
    ? d.events
    : Array.isArray(d?.tracking_events)
    ? d.tracking_events
    : Array.isArray(d?.scan_details)
    ? d.scan_details
    : Array.isArray(d?.scans)
    ? d.scans
    : Array.isArray(d?.tracking)
    ? d.tracking
    : [];

  const latest =
    d?.latest_event ||
    d?.latest_scan ||
    d?.current_status ||
    events[0] ||
    events[events.length - 1] ||
    {};

  const rawStatus =
    ids.rawStatus ||
    d?.status ||
    d?.shipment_status ||
    d?.current_status ||
    latest?.status ||
    latest?.event_name ||
    latest?.event ||
    latest?.scan_type ||
    "";

  const normalizedStatus = normalizeTrackingStatus(rawStatus);

  return {
    ...ids,

    rawStatus,
    normalizedStatus,

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
        d?.deliveredAt ||
        latest?.delivered_at ||
        latest?.delivery_time ||
        latest?.deliveredOn
    ),

    shippedAt: parseDateSafe(
      d?.shipped_at ||
        d?.shippedAt ||
        d?.dispatched_at ||
        latest?.shipped_at
    ),

    pickedUpAt: parseDateSafe(
      d?.picked_at || d?.pickedAt || d?.pickup_at || latest?.picked_at
    ),

    outForDeliveryAt: normalizedStatus === "out_for_delivery" ? new Date() : null,
    rtoAt: normalizedStatus === "rto" ? new Date() : null,
    failedAt: normalizedStatus === "exception" ? new Date() : null,

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

const patchOrderWithShipment = async ({
  orderId,
  orderNumber,
  shipment,
  raw,
  source = "sync",
}) => {
  const orderFilter = orderId ? { _id: orderId } : { orderNumber };

  const patch = buildOrderShipmentPatch({
    shipment: {
      orderId: shipment?.eshipzOrderId || shipment?.externalOrderId || "",
      shipmentId: shipment?.shipmentId || shipment?.shipmentIdExternal || "",
      awb: shipment?.awb || shipment?.awbNumber || "",
      carrierName: shipment?.carrierName || "BlueDart",
      carrierId: shipment?.vendorId || "",
      serviceType: shipment?.serviceType || "",
      trackingUrl: shipment?.trackingUrl || "",
      labelUrl: shipment?.labelUrl || "",
      invoiceUrl: shipment?.invoiceUrl || "",
      manifestUrl: shipment?.manifestUrl || "",
      status: shipment?.status || "",
      rawStatus: shipment?.rawStatus || shipment?.status || "",
      statusCode: shipment?.statusCode || "",
      expectedDelivery: shipment?.expectedDelivery || null,
    },
    raw,
    source,
  });

  return Order.findOneAndUpdate(orderFilter, { $set: patch }, { new: true });
};

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
      carrierName,
      carrierSlug,
    } = req.body || {};

    const cleanOrderNumber = safe(orderNumber);

    if (!cleanOrderNumber) {
      return fail(res, 400, "orderNumber is required");
    }

    const order = await Order.findOne({ orderNumber: cleanOrderNumber });

    if (!order) {
      return fail(res, 404, "Order not found");
    }

    if (!order.isConfirmed) {
      return fail(res, 400, "Order must be confirmed before shipment booking");
    }

    const existing = await BlueDartShipment.findOne({
      orderNumber: order.orderNumber,
      shipmentType: "forward",
      isCancelled: false,
      status: { $nin: ["cancelled", "failed", "rto"] },
    }).sort({ updatedAt: -1 });

    const existingHasRealAwb = Boolean(
      safe(existing?.awbNumber).trim() || safe(existing?.awb).trim()
    );

    const existingAlreadyBooked = Boolean(
      existingHasRealAwb ||
        ["created", "booked", "pickup_pending", "pickup_scheduled", "picked", "shipped", "in_transit", "out_for_delivery", "delivered"].includes(
          safe(existing?.status).toLowerCase()
        )
    );

    if (existing && existingAlreadyBooked) {
      return fail(res, 409, "Active Eshipz shipment already exists for this order", {
        shipment: existing,
      });
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
          order.items.reduce(
            (sum, item) => sum + Number(item?.quantity || 0),
            0
          )
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
      carrierName: safe(carrierName) || BLUEDART?.CARRIER_NAME || "BlueDart",
      carrierSlug: safe(carrierSlug) || BLUEDART?.CARRIER_SLUG || "bluedart",
    });

const payload = buildDirectCreateShipmentPayload(shipmentDoc, order);

    console.log("\n========== ESHIPZ ORDER CREATE REQUEST ==========");
    console.log("ORDER:", order.orderNumber);
    console.log("PAYMENT:", paymentMethod);
    console.log("SERVICE:", finalServiceType);
    console.log("EXISTING_LOCAL:", existing ? existing._id : "none");
    console.log("PAYLOAD:", JSON.stringify(payload, null, 2));
    console.log("==============================================\n");

const apiResponse = await createShipmentOnBlueDart(payload);
    console.log("\n========== ESHIPZ ORDER CREATE RESPONSE ==========");
    console.log(JSON.stringify(apiResponse, null, 2));
    console.log("===============================================\n");

    const parsed = extractCreateResult(apiResponse);

    const hasAwb = Boolean(parsed?.awbNumber || parsed?.awb);

    const derivedStatus = hasAwb
      ? normalizeTrackingStatus(parsed.status || "created")
      : "order_pushed";

    const shipmentPayload = {
      ...shipmentDoc,

      provider: "eshipz",
      partner: "eshipz",
      shipmentType: "forward",

      awbNumber: parsed.awbNumber || parsed.awb || "",
      awb: parsed.awb || parsed.awbNumber || "",

      shipmentIdExternal:
        parsed.shipmentIdExternal ||
        parsed.shipmentId ||
        parsed.externalOrderId ||
        parsed.eshipzOrderId ||
        "",

      shipmentId:
        parsed.shipmentId ||
        parsed.shipmentIdExternal ||
        parsed.externalOrderId ||
        parsed.eshipzOrderId ||
        "",

      externalOrderId:
        parsed.externalOrderId ||
        parsed.eshipzOrderId ||
        parsed.shipmentIdExternal ||
        "",

      eshipzOrderId:
        parsed.eshipzOrderId ||
        parsed.externalOrderId ||
        parsed.shipmentIdExternal ||
        "",

      carrierName: parsed.carrierName || shipmentDoc.carrierName || "BlueDart",
      carrierSlug: parsed.carrierSlug || shipmentDoc.carrierSlug || "bluedart",

      trackingUrl: parsed.trackingUrl || "",
      labelUrl: parsed.labelUrl || "",
      manifestUrl: parsed.manifestUrl || "",
      invoiceUrl: parsed.invoiceUrl || "",

      expectedDelivery: parsed.expectedDelivery || null,

      status: derivedStatus,
      rawStatus: parsed.rawStatus || parsed.status || "",
      statusCode: parsed.statusCode || "",

      bookingRequestedAt: existing?.bookingRequestedAt || new Date(),
      bookedAt: hasAwb ? new Date() : null,
      lastSyncedAt: new Date(),

      rawCreateRequest: payload,
      rawCreateResponse: apiResponse,
    };

    const created = existing
      ? await BlueDartShipment.findByIdAndUpdate(
          existing._id,
          { $set: shipmentPayload },
          { new: true }
        )
      : await BlueDartShipment.create(shipmentPayload);

    const updatedOrder = await patchOrderWithShipment({
      orderId: order._id,
      shipment: created,
      raw: apiResponse,
      source: hasAwb ? "booking" : "order_push",
    });

    return ok(
      res,
      hasAwb
        ? "Eshipz shipment booked successfully"
        : existing
        ? "Eshipz order re-pushed and local record updated successfully"
        : "Eshipz order pushed successfully. Shipment/AWB is not generated by this API.",
      {
        shipment: created,
        order: updatedOrder,
        externalResponse: apiResponse,
        pushedOnly: !hasAwb,
        hasAwb,
        updatedExisting: Boolean(existing),
      }
    );
  } catch (error) {
    const meta = getErrorMeta(error);

    console.error("\n========== ESHIPZ CREATE FROM ORDER ERROR ==========");
    console.error("MESSAGE:", meta.message);
    console.error("STATUS:", meta.status);
    console.error("DATA:", JSON.stringify(meta.data || {}, null, 2));
    console.error("===================================================\n");

    return fail(
      res,
      meta.status || 500,
      meta?.data?.meta?.message ||
        meta?.data?.message ||
        meta?.data?.error ||
        meta.message ||
        "Failed to create Eshipz order/shipment",
      { errorData: meta.data }
    );
  }
};

export const listShipments = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      q = "",
      status = "",
      shipmentType = "",
      carrierName = "",
      carrierSlug = "",
    } = req.query;

    const filter = { provider: "eshipz" };

    if (safe(status)) filter.status = safe(status);
    if (safe(shipmentType)) filter.shipmentType = safe(shipmentType);
    if (safe(carrierName)) filter.carrierName = safe(carrierName);
    if (safe(carrierSlug)) filter.carrierSlug = safe(carrierSlug);

    if (safe(q)) {
      filter.$or = [
        { orderNumber: { $regex: safe(q), $options: "i" } },
        { awbNumber: { $regex: safe(q), $options: "i" } },
        { awb: { $regex: safe(q), $options: "i" } },
        { referenceNumber: { $regex: safe(q), $options: "i" } },
        { shipmentId: { $regex: safe(q), $options: "i" } },
        { shipmentIdExternal: { $regex: safe(q), $options: "i" } },
        { "recipient.fullName": { $regex: safe(q), $options: "i" } },
        { "recipient.phone": { $regex: safe(q), $options: "i" } },
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

    return ok(res, "Eshipz shipments fetched successfully", {
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
    return fail(res, meta.status || 500, meta.message || "Failed to fetch shipments", {
      errorData: meta.data,
    });
  }
};

export const getShipmentById = async (req, res) => {
  try {
    const shipment = await BlueDartShipment.findById(req.params.id);
    if (!shipment) return fail(res, 404, "Shipment not found");

    return ok(res, "Shipment fetched successfully", { shipment });
  } catch (error) {
    const meta = getErrorMeta(error);
    return fail(res, meta.status || 500, meta.message || "Failed to fetch shipment", {
      errorData: meta.data,
    });
  }
};

export const getShipmentByOrderNumber = async (req, res) => {
  try {
    const { orderNumber } = req.params;

    const shipments = await BlueDartShipment.find({
      orderNumber: safe(orderNumber),
    }).sort({ createdAt: -1 });

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

export const trackShipment = async (req, res) => {
  try {
    const shipment = await BlueDartShipment.findById(req.params.id);
    if (!shipment) return fail(res, 404, "Shipment not found");

    if (
      !safe(shipment.awbNumber) &&
      !safe(shipment.awb) &&
      !safe(shipment.referenceNumber) &&
      !safe(shipment.shipmentId)
    ) {
      return fail(res, 400, "Shipment has no AWB/reference/shipmentId to track");
    }

    const apiResponse = await trackShipmentOnBlueDart({
      awbNumber: shipment.awbNumber || shipment.awb,
      referenceNumber: shipment.referenceNumber || shipment.orderNumber,
      shipmentId: shipment.shipmentId || shipment.shipmentIdExternal,
      carrierSlug: shipment.carrierSlug,
      vendorId: shipment.vendorId,
    });

    const parsed = extractTrackingResult(apiResponse);

    shipment.awbNumber = parsed.awb || shipment.awbNumber;
    shipment.awb = parsed.awb || shipment.awb || shipment.awbNumber;

    shipment.shipmentId = parsed.shipmentId || shipment.shipmentId;
    shipment.shipmentIdExternal =
      parsed.shipmentId || shipment.shipmentIdExternal;

    shipment.externalOrderId = parsed.orderId || shipment.externalOrderId;
    shipment.eshipzOrderId = parsed.orderId || shipment.eshipzOrderId;

    shipment.carrierName = parsed.carrierName || shipment.carrierName;
    shipment.carrierSlug = parsed.carrierSlug || shipment.carrierSlug;
    shipment.serviceType = parsed.serviceType || shipment.serviceType;

    shipment.trackingUrl = parsed.trackingUrl || shipment.trackingUrl;
    shipment.labelUrl = parsed.labelUrl || shipment.labelUrl;
    shipment.invoiceUrl = parsed.invoiceUrl || shipment.invoiceUrl;
    shipment.manifestUrl = parsed.manifestUrl || shipment.manifestUrl;

    shipment.status = parsed.normalizedStatus || shipment.status;
    shipment.rawStatus = parsed.rawStatus || shipment.rawStatus;
    shipment.statusCode = parsed.statusCode || shipment.statusCode;

    shipment.latestTrackingRemark =
      parsed.latestTrackingRemark || shipment.latestTrackingRemark;
    shipment.latestTrackingLocation =
      parsed.latestTrackingLocation || shipment.latestTrackingLocation;

    shipment.deliveredAt = parsed.deliveredAt || shipment.deliveredAt;
    shipment.shippedAt = parsed.shippedAt || shipment.shippedAt;
    shipment.pickedUpAt = parsed.pickedUpAt || shipment.pickedUpAt;
    shipment.outForDeliveryAt =
      parsed.outForDeliveryAt || shipment.outForDeliveryAt;
    shipment.rtoAt = parsed.rtoAt || shipment.rtoAt;
    shipment.failedAt = parsed.failedAt || shipment.failedAt;
    shipment.expectedDelivery =
      parsed.expectedDelivery || shipment.expectedDelivery;

    shipment.trackingEvents = parsed.events;
    shipment.lastSyncedAt = new Date();
    shipment.lastTrackAt = new Date();
    shipment.syncPending = false;
    shipment.syncError = "";
    shipment.rawTrackingResponse = apiResponse;

    await shipment.save();

    const updatedOrder = await patchOrderWithShipment({
      orderId: shipment.orderId,
      orderNumber: shipment.orderNumber,
      shipment,
      raw: apiResponse,
      source: "track",
    });

    return ok(res, "Shipment tracked successfully", {
      shipment,
      order: updatedOrder,
    });
  } catch (error) {
    const meta = getErrorMeta(error);

    return fail(
      res,
      meta.status || 500,
      meta?.data?.meta?.message ||
        meta?.data?.message ||
        meta?.data?.error ||
        meta.message ||
        "Failed to track shipment",
      { errorData: meta.data }
    );
  }
};

export const bulkSyncShipments = async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.body?.limit || 50)));

    const rows = await BlueDartShipment.find({
      provider: "eshipz",
      status: {
        $in: [
          "order_pushed",
          "created",
          "booked",
          "pickup_pending",
          "pickup_scheduled",
          "picked",
          "shipped",
          "in_transit",
          "out_for_delivery",
          "exception",
        ],
      },
      isCancelled: false,
    })
      .sort({ updatedAt: 1 })
      .limit(limit);

    const results = [];

    for (const shipment of rows) {
      try {
        const apiResponse = await trackShipmentOnBlueDart({
          awbNumber: shipment.awbNumber || shipment.awb,
          referenceNumber: shipment.referenceNumber || shipment.orderNumber,
          shipmentId: shipment.shipmentId || shipment.shipmentIdExternal,
          carrierSlug: shipment.carrierSlug,
          vendorId: shipment.vendorId,
        });

        const parsed = extractTrackingResult(apiResponse);

        shipment.awbNumber = parsed.awb || shipment.awbNumber;
        shipment.awb = parsed.awb || shipment.awb || shipment.awbNumber;

        shipment.shipmentId = parsed.shipmentId || shipment.shipmentId;
        shipment.shipmentIdExternal =
          parsed.shipmentId || shipment.shipmentIdExternal;

        shipment.externalOrderId = parsed.orderId || shipment.externalOrderId;
        shipment.eshipzOrderId = parsed.orderId || shipment.eshipzOrderId;

        shipment.carrierName = parsed.carrierName || shipment.carrierName;
        shipment.carrierSlug = parsed.carrierSlug || shipment.carrierSlug;
        shipment.serviceType = parsed.serviceType || shipment.serviceType;

        shipment.trackingUrl = parsed.trackingUrl || shipment.trackingUrl;
        shipment.labelUrl = parsed.labelUrl || shipment.labelUrl;
        shipment.invoiceUrl = parsed.invoiceUrl || shipment.invoiceUrl;
        shipment.manifestUrl = parsed.manifestUrl || shipment.manifestUrl;

        shipment.status = parsed.normalizedStatus || shipment.status;
        shipment.rawStatus = parsed.rawStatus || shipment.rawStatus;
        shipment.statusCode = parsed.statusCode || shipment.statusCode;

        shipment.latestTrackingRemark =
          parsed.latestTrackingRemark || shipment.latestTrackingRemark;
        shipment.latestTrackingLocation =
          parsed.latestTrackingLocation || shipment.latestTrackingLocation;

        shipment.deliveredAt = parsed.deliveredAt || shipment.deliveredAt;
        shipment.shippedAt = parsed.shippedAt || shipment.shippedAt;
        shipment.pickedUpAt = parsed.pickedUpAt || shipment.pickedUpAt;
        shipment.outForDeliveryAt =
          parsed.outForDeliveryAt || shipment.outForDeliveryAt;
        shipment.rtoAt = parsed.rtoAt || shipment.rtoAt;
        shipment.failedAt = parsed.failedAt || shipment.failedAt;
        shipment.expectedDelivery =
          parsed.expectedDelivery || shipment.expectedDelivery;

        shipment.trackingEvents = parsed.events;
        shipment.lastSyncedAt = new Date();
        shipment.lastTrackAt = new Date();
        shipment.syncPending = false;
        shipment.syncError = "";
        shipment.rawTrackingResponse = apiResponse;

        await shipment.save();

        await patchOrderWithShipment({
          orderId: shipment.orderId,
          orderNumber: shipment.orderNumber,
          shipment,
          raw: apiResponse,
          source: "track",
        });

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
        shipment.syncPending = true;

        await shipment.save();

        results.push({
          id: shipment._id,
          orderNumber: shipment.orderNumber,
          awbNumber: shipment.awbNumber,
          success: false,
          error: shipment.syncError,
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

export const listBlueDartOrdersFromApi = async (req, res) => {
  try {
    const { perPage = 10, page = 1, shipStatus = "", carrierSlug = "" } =
      req.query;

    const apiResponse = await getOrdersFromBlueDart({
      perPage: Number(perPage) || 10,
      page: Number(page) || 1,
      shipStatus: safe(shipStatus),
      carrierSlug: safe(carrierSlug),
    });

    const orders = Array.isArray(apiResponse?.data)
      ? apiResponse.data
      : Array.isArray(apiResponse?.orders)
      ? apiResponse.orders
      : Array.isArray(apiResponse?.results)
      ? apiResponse.results
      : [];

    return ok(res, "Eshipz orders fetched successfully", {
      orders,
      externalResponse: apiResponse,
      pagination: apiResponse?.pagination || apiResponse?.meta || null,
    });
  } catch (error) {
    const meta = getErrorMeta(error);

    return fail(
      res,
      meta.status || 500,
      meta?.data?.meta?.message ||
        meta?.data?.message ||
        meta?.data?.error ||
        meta.message ||
        "Failed to fetch Eshipz orders",
      { errorData: meta.data }
    );
  }
};

export const getBlueDartOrderBySalesChannelId = async (req, res) => {
  try {
    const salesChannelOrderId =
      req.params.salesChannelOrderId || req.params.orderId || "";

    if (!safe(salesChannelOrderId)) {
      return fail(res, 400, "salesChannelOrderId is required");
    }

    const apiResponse = await getSingleOrderFromBlueDart(salesChannelOrderId);

    return ok(res, "Eshipz order fetched successfully", {
      order: apiResponse?.data || apiResponse?.order || apiResponse,
      externalResponse: apiResponse,
    });
  } catch (error) {
    const meta = getErrorMeta(error);

    return fail(
      res,
      meta.status || 500,
      meta?.data?.meta?.message ||
        meta?.data?.message ||
        meta?.data?.error ||
        meta.message ||
        "Failed to fetch Eshipz order",
      { errorData: meta.data }
    );
  }
};

export const getBlueDartEddPrediction = async (req, res) => {
  try {
    const {
      originPincode,
      destinationPincode,
      slug,
      origin_pincode,
      destination_pincode,
    } = req.body || {};

    const finalOrigin = safe(originPincode || origin_pincode);
    const finalDestination = safe(destinationPincode || destination_pincode);
    const finalSlug = safe(slug) || BLUEDART?.CARRIER_SLUG || "bluedart";

    if (!finalOrigin) return fail(res, 400, "originPincode is required");
    if (!finalDestination) {
      return fail(res, 400, "destinationPincode is required");
    }

    const apiResponse = await getEddPredictionFromBlueDart({
      originPincode: finalOrigin,
      destinationPincode: finalDestination,
      slug: finalSlug,
    });

    return ok(res, "Eshipz EDD prediction fetched successfully", {
      prediction: apiResponse?.data || apiResponse,
      externalResponse: apiResponse,
    });
  } catch (error) {
    const meta = getErrorMeta(error);

    return fail(
      res,
      meta.status || 500,
      meta?.data?.meta?.message ||
        meta?.data?.message ||
        meta?.data?.error ||
        meta.message ||
        "Failed to fetch Eshipz EDD prediction",
      { errorData: meta.data }
    );
  }
};

export const checkBlueDartServiceability = async (req, res) => {
  try {
    const {
      orderNumber,

      pickupPincode,
      deliveryPincode,

      originPincode,
      destinationPincode,

      pickup_pincode,
      delivery_pincode,

      origin_pincode,
      destination_pincode,

      weight,
      cod,
      paymentMode,
      serviceType,
      carrierSlug,
      vendorId,
    } = req.body || {};

    let order = null;

    if (safe(orderNumber)) {
      order = await Order.findOne({ orderNumber: safe(orderNumber) });

      if (!order) {
        return fail(res, 404, "Order not found");
      }
    }

    const orderAddress =
      order?.shippingAddressSnapshot || order?.shippingAddress || {};

    const finalPickupPincode = safe(
      pickupPincode ||
        pickup_pincode ||
        originPincode ||
        origin_pincode ||
        BLUEDART?.PICKUP_PINCODE ||
        getPickupSender()?.pincode
    );

    const finalDeliveryPincode = safe(
      deliveryPincode ||
        delivery_pincode ||
        destinationPincode ||
        destination_pincode ||
        orderAddress?.pincode ||
        orderAddress?.zipcode ||
        orderAddress?.zip
    );

    const finalPaymentMode = safe(
      paymentMode || order?.paymentMethod || ""
    ).toLowerCase();

    const finalCod =
  cod === true ||
  cod === 1 ||
  cod === "1" ||
  safe(cod).toLowerCase() === "true" ||
  finalPaymentMode === "cod";

const finalServiceType =
  safe(serviceType) ||
  (finalCod
    ? BLUEDART?.SERVICE_TYPES?.COD || "eTailCODAir"
    : BLUEDART?.SERVICE_TYPES?.PREPAID || "eTailPrePaidAir");

    const finalWeight = toPositiveNumber(
      weight,
      BLUEDART?.DEFAULTS?.WEIGHT || 0.5
    );

    if (!finalPickupPincode) {
      return fail(res, 400, "pickupPincode is required");
    }

    if (!finalDeliveryPincode) {
      return fail(res, 400, "deliveryPincode is required");
    }

    console.log("\n========== ESHIPZ SERVICEABILITY CHECK ==========");
    console.log("ORDER:", order?.orderNumber || "manual");
    console.log("PICKUP:", finalPickupPincode);
    console.log("DELIVERY:", finalDeliveryPincode);
    console.log("PAYMENT_MODE:", finalPaymentMode || "manual");
    console.log("COD:", finalCod);
    console.log("SERVICE:", finalServiceType);
    console.log("WEIGHT:", finalWeight);
    console.log("================================================\n");

   const shipmentDoc = buildBlueDartShipmentDocFromOrder(
  order || {},
  {
    sender: getPickupSender(),

    weight: finalWeight,

    serviceType: finalServiceType,

    carrierName:
      BLUEDART?.CARRIER_NAME || "BlueDart",

    carrierSlug:
      BLUEDART?.CARRIER_SLUG || "bluedart",
  }
);

const payload =
  buildServiceabilityPayload(
    shipmentDoc,
    order
  );

console.log(
  "\n========== SERVICEABILITY PAYLOAD =========="
);

console.log(
  JSON.stringify(payload, null, 2)
);

console.log(
  "============================================\n"
);

const apiResponse =
  await checkServiceabilityOnBlueDart(
    payload
  );

    const rawCouriers =
      apiResponse?.data?.available_courier_companies ||
      apiResponse?.available_courier_companies ||
      apiResponse?.data?.couriers ||
      apiResponse?.couriers ||
      apiResponse?.data ||
      [];

    const couriers = Array.isArray(rawCouriers) ? rawCouriers : [];

    const blueDartCourier =
      couriers.find((c) => {
        const name = safe(
          c?.courier_name ||
            c?.carrier_name ||
            c?.name ||
            c?.courier ||
            c?.slug
        ).toLowerCase();

        return (
          name.includes("blue") ||
          name.includes("bluedart") ||
          name.includes("blue dart")
        );
      }) || null;

    const serviceable =
      Boolean(blueDartCourier) ||
      Boolean(apiResponse?.serviceable) ||
      Boolean(apiResponse?.is_serviceable);

    return ok(res, "Eshipz serviceability checked successfully", {
      serviceable,
      blueDartAvailable: Boolean(blueDartCourier),
      courier: blueDartCourier,
      couriers,
      order: order
        ? {
            orderNumber: order.orderNumber,
            paymentMethod: order.paymentMethod,
            pincode: finalDeliveryPincode,
          }
        : null,
      request: {
        pickupPincode: finalPickupPincode,
        deliveryPincode: finalDeliveryPincode,
        weight: finalWeight,
        cod: finalCod,
        paymentMode: finalPaymentMode,
        serviceType: finalServiceType,
      },
      externalResponse: apiResponse,
    });
  } catch (error) {
    const meta = getErrorMeta(error);

    console.error("\n========== ESHIPZ SERVICEABILITY ERROR ==========");
    console.error("MESSAGE:", meta.message);
    console.error("STATUS:", meta.status);
    console.error("DATA:", JSON.stringify(meta.data || {}, null, 2));
    console.error("================================================\n");

    return fail(
      res,
      meta.status || 500,
      meta?.data?.meta?.message ||
        meta?.data?.message ||
        meta?.data?.error ||
        meta.message ||
        "Failed to check Eshipz serviceability",
      { errorData: meta.data }
    );
  }
};