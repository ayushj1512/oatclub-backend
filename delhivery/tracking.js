import { delhiveryClient } from "./client.js";
import { ENDPOINTS } from "./constants.js";

// Track shipment using AWB
export const trackShipment = async (waybill) => {
  const { data } = await delhiveryClient.get(ENDPOINTS.TRACKING, {
    params: { waybill },
  });

  return data;
};

// Fetch shipping label
export const getShippingLabel = async (waybill) => {
  const { data } = await delhiveryClient.get(ENDPOINTS.LABEL, {
    params: { wbns: waybill },
  });

  return data;
};
