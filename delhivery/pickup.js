import { delhiveryClient } from "./client.js";
import { ENDPOINTS } from "./constants.js";
import { DELHIVERY_CONFIG } from "./config.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

const normalizeTime = (value) => {
  const time = String(value || "").trim();

  if (!TIME_RE.test(time)) {
    throw new Error(
      "Pickup time must be HH:mm or HH:mm:ss.",
    );
  }

  return time.length === 5
    ? `${time}:00`
    : time;
};

export const createPickup = async ({
  pickupDate,
  pickupTime,
  packageCount = 1,
}) => {
  const date = String(
    pickupDate || "",
  ).trim();

  if (!DATE_RE.test(date)) {
    throw new Error(
      "Pickup date must be YYYY-MM-DD.",
    );
  }

  const time = normalizeTime(pickupTime);

  const count = Math.max(
    1,
    Math.floor(Number(packageCount) || 1),
  );

  const pickupLocation = String(
    DELHIVERY_CONFIG.pickupLocation || "",
  ).trim();

  if (!pickupLocation) {
    throw new Error(
      "Delhivery pickup location is not configured.",
    );
  }

  const payload = {
    pickup_location: pickupLocation,
    pickup_date: date,
    pickup_time: time,
    expected_package_count: count,
  };

  console.log(
    "DELHIVERY PICKUP PAYLOAD:",
    payload,
  );

  try {
    const { data } =
      await delhiveryClient.post(
        ENDPOINTS.PICKUP,
        payload,
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 20000,
        },
      );

    console.log(
      "DELHIVERY PICKUP RESPONSE:",
      data,
    );

    return data;
  } catch (error) {
    console.error(
      "DELHIVERY PICKUP FAILED:",
      {
        status: error.response?.status,
        data: error.response?.data,
        url: error.config?.url,
        method: error.config?.method,
        payload,
      },
    );

    // Keep original Axios error
    throw error;
  }
};
