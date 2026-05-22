import { createEshipzShipmentApi } from "./eshipz.service.js";

export const createEshipzShipment = async (req, res) => {
  try {
    const payload = req.body;

    if (!payload || Object.keys(payload).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Request body is required",
      });
    }

    const result = await createEshipzShipmentApi(payload);

    return res.status(200).json({
      success: true,
      message: `eShipz request successful via ${result.endpoint}`,
      endpoint: result.endpoint,
      data: result.response,
    });
  } catch (error) {
    return res.status(error.response?.status || 500).json({
      success: false,
      message:
        error.response?.data?.remark ||
        error.response?.data?.message ||
        error.message ||
        "Failed to create eShipz shipment",
      error: error.response?.data || null,
    });
  }
};