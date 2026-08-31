import {
  delhiveryClient,
} from "./client.js";

import {
  ENDPOINTS,
} from "./constants.js";

const cleanWaybill = (value) =>
  String(value || "").trim();

export const trackShipment = async (
  waybill,
) => {
  const wbn =
    cleanWaybill(waybill);

  if (!wbn) {
    throw new Error(
      "Waybill is required.",
    );
  }

  const { data } =
    await delhiveryClient.get(
      ENDPOINTS.TRACKING,
      {
        params: {
          waybill: wbn,
        },
        timeout: 15000,
      },
    );

  return data;
};

export const trackShipments = async (
  waybills = [],
) => {
  const wbns = [
    ...new Set(
      waybills
        .map(cleanWaybill)
        .filter(Boolean),
    ),
  ];

  if (!wbns.length) {
    throw new Error(
      "At least one waybill is required.",
    );
  }

  if (wbns.length > 50) {
    throw new Error(
      "Delhivery supports maximum 50 waybills per tracking request.",
    );
  }

  const { data } =
    await delhiveryClient.get(
      ENDPOINTS.TRACKING,
      {
        params: {
          waybill:
            wbns.join(","),
        },
        timeout: 20000,
      },
    );

  return data;
};

export const trackByReferenceId = async (
  referenceId,
) => {
  const refId = String(
    referenceId || "",
  ).trim();

  if (!refId) {
    throw new Error(
      "Reference ID is required.",
    );
  }

  const { data } =
    await delhiveryClient.get(
      ENDPOINTS.TRACKING,
      {
        params: {
          ref_ids: refId,
        },
        timeout: 15000,
      },
    );

  return data;
};

export const getShippingLabel = async (
  waybill,
  { pdf = false } = {},
) => {
  const wbn =
    cleanWaybill(waybill);

  if (!wbn) {
    throw new Error(
      "Waybill is required.",
    );
  }

  const { data } =
    await delhiveryClient.get(
      ENDPOINTS.LABEL,
      {
        params: {
          wbns: wbn,
          ...(pdf
            ? { pdf: "True" }
            : {}),
        },
        timeout: 20000,
      },
    );

  return data;
};

export const getShippingLabels = async (
  waybills = [],
  options = {},
) => {
  const wbns = [
    ...new Set(
      waybills
        .map(cleanWaybill)
        .filter(Boolean),
    ),
  ];

  if (!wbns.length) {
    throw new Error(
      "At least one waybill is required.",
    );
  }

  const results =
    await Promise.allSettled(
      wbns.map(
        async (waybill) => ({
          waybill,
          data:
            await getShippingLabel(
              waybill,
              options,
            ),
        }),
      ),
    );

  return results.map(
    (result, index) =>
      result.status ===
        "fulfilled"
        ? {
          success: true,
          ...result.value,
        }
        : {
          success: false,
          waybill:
            wbns[index],
          error:
            result.reason
              ?.response?.data ||
            result.reason
              ?.message ||
            "Label generation failed.",
        },
  );
};
