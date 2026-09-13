import { shiprocketApi } from "./shiprocket.client.js";

const clean = (value) =>
  String(value || "").trim();

export const getShiprocketNdrList = (
  params = {},
) =>
  shiprocketApi({
    url: "/ndr/all",
    params,
  });

export const getShiprocketNdr = (
  awb,
) => {
  const value = clean(awb);

  if (!value) {
    throw new Error(
      "Shiprocket AWB is required",
    );
  }

  return shiprocketApi({
    url: `/ndr/${encodeURIComponent(
      value,
    )}`,
  });
};

export const reattemptShiprocketNdr =
  ({
    awb,
    address1,
    address2,
    phone,
    deferredDate,
  }) => {
    const value = clean(awb);

    if (!value) {
      throw new Error(
        "Shiprocket AWB is required",
      );
    }

    return shiprocketApi({
      method: "POST",
      url: "/ndr/reattempt",
      params: {
        awb: value,

        ...(clean(address1) && {
          address1: clean(address1),
        }),

        ...(clean(address2) && {
          address2: clean(address2),
        }),

        ...(clean(phone) && {
          phone: clean(phone).replace(
            /\D/g,
            "",
          ),
        }),

        ...(clean(deferredDate) && {
          deferred_date:
            clean(deferredDate),
        }),
      },
    });
  };
