import { delhiveryClient } from "./client.js";
import { ENDPOINTS } from "./constants.js";
import { buildShipmentPayload } from "./payload.js";

// Create forward Delhivery shipment
export const createShipment = async (order) => {
  if (!order) {
    throw new Error("Order data is required");
  }

  const payload = buildShipmentPayload(order);

  const body = new URLSearchParams();
  body.append("format", "json");
  body.append("data", JSON.stringify(payload));

  try {
    console.log("\n========== DELHIVERY SHIPMENT REQUEST ==========");
    console.dir(payload, { depth: null });

    const { data } = await delhiveryClient.post(
      ENDPOINTS.CREATE_SHIPMENT || ENDPOINTS.SHIPMENT,
      body.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 30000,
      },
    );

    console.log("\n========== DELHIVERY SHIPMENT RESPONSE ==========");
    console.dir(data, { depth: null });

    const packageResult = Array.isArray(data?.packages)
      ? data.packages[0]
      : null;

    const isFailed =
      data?.success === false ||
      data?.status === false ||
      String(data?.status || "").toLowerCase() === "failed" ||
      String(packageResult?.status || "").toLowerCase() === "failed" ||
      String(packageResult?.status || "").toLowerCase() === "fail";

    if (isFailed) {
      const message =
        packageResult?.remarks ||
        packageResult?.remark ||
        packageResult?.rmk ||
        data?.rmk ||
        data?.message ||
        data?.error ||
        "Delhivery shipment creation failed";

      const error = new Error(
        typeof message === "string"
          ? message
          : JSON.stringify(message),
      );

      error.statusCode = 400;
      error.responseData = data;
      error.delhiveryPayload = payload;

      throw error;
    }

    return data;
  } catch (error) {
    const responseData =
      error?.response?.data ||
      error?.responseData ||
      null;

    console.error("\n========== DELHIVERY SHIPMENT ERROR ==========");
    console.error("Message:", error?.message);
    console.error(
      "Status:",
      error?.response?.status ||
      error?.statusCode ||
      500,
    );

    console.error("Payload:");
    console.dir(
      error?.delhiveryPayload || payload,
      { depth: null },
    );

    console.error("Response:");
    console.dir(responseData, { depth: null });

    console.error("===============================================\n");

    const apiMessage =
      responseData?.packages?.[0]?.remarks ||
      responseData?.packages?.[0]?.remark ||
      responseData?.packages?.[0]?.rmk ||
      responseData?.rmk ||
      responseData?.message ||
      responseData?.error ||
      error?.message ||
      "Unable to create Delhivery shipment";

    const err = new Error(
      typeof apiMessage === "string"
        ? apiMessage
        : JSON.stringify(apiMessage),
    );

    err.statusCode =
      error?.response?.status ||
      error?.statusCode ||
      500;

    err.responseData = responseData;
    err.delhiveryPayload =
      error?.delhiveryPayload || payload;

    throw err;
  }
};


// Update existing Delhivery shipment
export const updateShipment = async (
  waybill,
  updates = {}
) => {
  const wbn = String(waybill || "").trim();

  if (!wbn) {
    throw new Error("Waybill is required.");
  }

  const allowed = [
    "name",
    "add",
    "phone",
    "cod",
    "gm",
    "shipment_length",
    "shipment_width",
    "shipment_height",
    "product_details",
    "pt",
  ];

  const payload = {
    waybill: wbn,
  };

  for (const key of allowed) {
    if (
      updates[key] !== undefined &&
      updates[key] !== null &&
      updates[key] !== ""
    ) {
      payload[key] = updates[key];
    }
  }

  const { data } = await delhiveryClient.post(
    ENDPOINTS.UPDATE_SHIPMENT,
    payload,
    {
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 20000,
    }
  );

  return data;
};

// Cancel Delhivery shipment
export const cancelShipment = async (
  waybill
) => {
  const wbn = String(waybill || "").trim();

  if (!wbn) {
    throw new Error("Waybill is required.");
  }

  const { data } = await delhiveryClient.post(
    ENDPOINTS.CANCEL_SHIPMENT,
    {
      waybill: wbn,
      cancellation: "true",
    },
    {
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 20000,
    }
  );

  return data;
};

// Fetch fresh Delhivery waybills
export const fetchWaybills = async (
  count = 1
) => {
  const qty = Math.min(
    10000,
    Math.max(1, Number(count || 1))
  );

  const { data } = await delhiveryClient.get(
    ENDPOINTS.FETCH_WAYBILLS,
    {
      params: {
        count: qty,
      },
      timeout: 15000,
    }
  );

  return data;
};
