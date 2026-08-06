import { delhiveryClient } from "./client.js";
import { ENDPOINTS } from "./constants.js";
import { DELHIVERY_CONFIG } from "./config.js";

// Raise pickup request
export const createPickup = async ({
  pickupDate,
  pickupTime,
  packageCount,
}) => {
  const { data } = await delhiveryClient.post(ENDPOINTS.PICKUP, {
    pickup_location: DELHIVERY_CONFIG.pickupLocation,
    pickup_date: pickupDate,
    pickup_time: pickupTime,
    expected_package_count: Number(packageCount),
  });

  return data;
};
