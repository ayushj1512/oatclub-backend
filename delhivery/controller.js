import { createShipment } from "./shipment.js";
import { checkServiceability } from "./serviceability.js";
import { trackShipment, getShippingLabel } from "./tracking.js";
import { createWarehouse } from "./warehouse.js";
import { createPickup } from "./pickup.js";

const send = async (res, promise, status = 200) => {
  try {
    const data = await promise;

    return res.status(status).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("\n================ DELHIVERY API ERROR ================");
    console.error("Status:", error?.response?.status);
    console.error("Message:", error?.message);

    console.error("\nRequest:");
    console.dir(
      {
        method: error?.config?.method?.toUpperCase(),
        url:
          (error?.config?.baseURL || "") +
          (error?.config?.url || ""),
        params: error?.config?.params,
        data: error?.config?.data,
      },
      { depth: null }
    );

    console.error("\nResponse:");
    console.dir(error?.response?.data, {
      depth: null,
    });

    console.error("====================================================\n");

    return res.status(error?.response?.status || 500).json({
      success: false,
      message:
        error?.response?.data?.message ||
        error?.message ||
        "Delhivery request failed.",
      error: error?.response?.data || null,
    });
  }
};

export const serviceabilityController = (req, res) =>
  send(res, checkServiceability(req.params.pincode));

export const createShipmentController = (req, res) =>
  send(res, createShipment(req.body), 201);

export const trackingController = (req, res) =>
  send(res, trackShipment(req.params.waybill));

export const labelController = (req, res) =>
  send(res, getShippingLabel(req.params.waybill));

export const warehouseController = (req, res) =>
  send(res, createWarehouse(req.body), 201);

export const pickupController = (req, res) =>
  send(res, createPickup(req.body), 201);
