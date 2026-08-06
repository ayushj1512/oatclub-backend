import { delhiveryClient } from "./client.js";
import { ENDPOINTS } from "./constants.js";

// Check Delhivery delivery serviceability
export const checkServiceability = async (pincode) => {
  const normalizedPincode = String(pincode || "")
    .replace(/\D/g, "")
    .slice(0, 6);

  if (!/^\d{6}$/.test(normalizedPincode)) {
    throw new Error("Valid 6-digit pincode is required.");
  }

  const { data } = await delhiveryClient.get(
    ENDPOINTS.SERVICEABILITY,
    {
      params: {
        filter_codes: normalizedPincode,
      },
      timeout: 10000,
    },
  );

  const deliveryCodes = Array.isArray(data?.delivery_codes)
    ? data.delivery_codes
    : [];

  const postalCode =
    deliveryCodes[0]?.postal_code || null;

  if (!postalCode) {
    return {
      serviceable: false,
      pincode: normalizedPincode,

      codAvailable: false,
      prepaidAvailable: false,
      pickupAvailable: false,

      embargoed: false,
      unavailableReason:
        "Delhivery does not service this pincode.",

      city: "",
      district: "",
      state: "",
      center: "",

      raw: data,
    };
  }

  const remarks = String(
    postalCode?.remarks || "",
  )
    .trim()
    .toLowerCase();

  const embargoed =
    remarks.includes("embargo") ||
    remarks.includes("restricted") ||
    remarks.includes("suspended") ||
    remarks.includes("temporarily unavailable");

  const codFlag =
    String(postalCode?.cod || "")
      .trim()
      .toUpperCase() === "Y";

  const prepaidFlag =
    String(postalCode?.pre_paid || "")
      .trim()
      .toUpperCase() === "Y";

  const pickupFlag =
    String(postalCode?.pickup || "")
      .trim()
      .toUpperCase() === "Y";

  // A pincode can have Y flags but still be under embargo.
  const serviceable =
    deliveryCodes.length > 0 &&
    !embargoed &&
    (codFlag || prepaidFlag);

  return {
    serviceable,
    pincode: normalizedPincode,

    codAvailable:
      serviceable && codFlag,

    prepaidAvailable:
      serviceable && prepaidFlag,

    pickupAvailable:
      !embargoed && pickupFlag,

    embargoed,

    unavailableReason: embargoed
      ? "Delhivery service is currently under embargo for this pincode."
      : serviceable
        ? ""
        : "Delhivery is unavailable for this pincode.",

    remarks: postalCode?.remarks || "",

    maxAmount: Number(
      postalCode?.max_amount || 0,
    ),

    maxWeight: Number(
      postalCode?.max_weight || 0,
    ),

    serviceWeightThreshold: Number(
      postalCode?.srv_wt_th || 0,
    ),

    city: postalCode?.city || "",
    district: postalCode?.district || "",
    state: postalCode?.state_code || "",
    center: postalCode?.inc || "",

    raw: data,
  };
};
