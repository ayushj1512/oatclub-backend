import { delhiveryClient } from "./client.js";
import { ENDPOINTS } from "./constants.js";
import { DELHIVERY_CONFIG } from "./config.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export const createPickup = async ({
  pickupDate,
  pickupTime,
  packageCount,
}) => {
  const date = String(
    pickupDate || "",
  ).trim();

  const time = String(
    pickupTime || "",
  ).trim();

  const count = Math.max(
    1,
    Math.floor(Number(packageCount || 1)),
  );

  if (!DATE_RE.test(date)) {
    throw new Error(
      "Pickup date must be YYYY-MM-DD.",
    );
  }

  if (!TIME_RE.test(time)) {
    throw new Error(
      "Pickup time must be HH:MM.",
    );
  }

  if (!DELHIVERY_CONFIG.pickupLocation) {
    throw new Error(
      "Delhivery pickup location is not configured.",
    );
  }

  const { data } =
    await delhiveryClient.post(
      ENDPOINTS.PICKUP,
      {
        pickup_location:
          DELHIVERY_CONFIG.pickupLocation,

        pickup_date: date,
        pickup_time: time,
        expected_package_count: count,
      },
      {
        headers: {
          "Content-Type":
            "application/json",
        },
        timeout: 20000,
      },
    );

  return data;
};
