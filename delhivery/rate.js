import { delhiveryClient } from "./client.js";
import { ENDPOINTS } from "./constants.js";

const DELHIVERY_ORIGIN_PINCODE = "110044";

export const calculateDelhiveryRate = async ({
  destinationPincode,
  weightInGrams = 500,
  paymentMode = "prepaid",
}) => {
  const destination = String(destinationPincode || "")
    .replace(/\D/g, "")
    .slice(0, 6);

  const weight = Math.max(
    500,
    Math.ceil(Number(weightInGrams || 500)),
  );

  if (!/^\d{6}$/.test(destination)) {
    throw new Error(
      "Valid Delhivery destination pincode is required.",
    );
  }

  const paymentType =
    String(paymentMode || "")
      .trim()
      .toLowerCase() === "cod"
      ? "COD"
      : "Pre-paid";

  const { data } = await delhiveryClient.get(
    ENDPOINTS.SHIPPING_CHARGE,
    {
      params: {
        md: "S",
        ss: "Delivered",
        o_pin: DELHIVERY_ORIGIN_PINCODE,
        d_pin: destination,
        cgm: weight,
        pt: paymentType,
      },
      timeout: 15000,
    },
  );

  const result = Array.isArray(data)
    ? data[0]
    : data;

  if (!result || typeof result !== "object") {
    throw new Error(
      "Invalid response received from Delhivery rate API.",
    );
  }

  const totalAmount = Number(
    result?.total_amount ??
    result?.totalAmount ??
    result?.gross_amount ??
    0,
  );

  return {
    rate: totalAmount,
    totalAmount,

    grossAmount: Number(
      result?.gross_amount ??
      result?.grossAmount ??
      0,
    ),

    taxAmount: Number(
      result?.tax_amount ??
      result?.taxAmount ??
      result?.tax ??
      0,
    ),

    zone: String(result?.zone || ""),
    paymentMode: paymentType,

    originPincode: DELHIVERY_ORIGIN_PINCODE,
    destinationPincode: destination,
    weightInGrams: weight,

    pricingAvailable: totalAmount > 0,

    raw: data,
  };
};
