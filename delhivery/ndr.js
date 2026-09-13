import {
  delhiveryClient,
} from "./client.js";

import {
  ENDPOINTS,
} from "./constants.js";

export const NDR_ACTIONS = {
  REATTEMPT: "RE-ATTEMPT",
  PICKUP_RESCHEDULE:
    "PICKUP_RESCHEDULE",
};

export const NDR_CODES = {
  REATTEMPT: [
    "EOD-74",
    "EOD-15",
    "EOD-104",
    "EOD-43",
    "EOD-86",
    "EOD-11",
    "EOD-69",
    "EOD-6",
  ],

  PICKUP_RESCHEDULE: [
    "EOD-777",
    "EOD-21",
  ],
};

const clean = (value) =>
  String(value || "").trim();

export const submitNdrAction =
  async ({
    waybill,
    action,
  }) => {
    const awb = clean(waybill);
    const act = clean(
      action,
    ).toUpperCase();

    if (!awb) {
      throw new Error(
        "Waybill is required.",
      );
    }

    if (
      !Object.values(
        NDR_ACTIONS,
      ).includes(act)
    ) {
      throw new Error(
        "Use RE-ATTEMPT or PICKUP_RESCHEDULE.",
      );
    }

    const { data } =
      await delhiveryClient.post(
        ENDPOINTS.NDR,
        {
          data: [
            {
              waybill: awb,
              act,
            },
          ],
        },
        {
          headers: {
            "Content-Type":
              "application/json",
          },
        },
      );

    const result =
      data?.data?.[0] ||
      data?.[0] ||
      data;

    return {
      waybill: awb,
      action: act,

      requestId:
        result?.request_id ||
        result?.upl_id ||
        data?.request_id ||
        data?.upl_id ||
        "",

      response: data,
    };
  };

export const getNdrStatus =
  async (requestId) => {
    const id = clean(
      requestId,
    );

    if (!id) {
      throw new Error(
        "NDR request ID is required.",
      );
    }

    const { data } =
      await delhiveryClient.get(
        `${ENDPOINTS.NDR_STATUS}/${encodeURIComponent(
          id,
        )}`,
        {
          params: {
            verbose: true,
          },
        },
      );

    return data;
  };

export const isEligibleForNdr =
  ({
    statusCode,
    attemptCount,
    action,
  }) => {
    const code = clean(
      statusCode,
    ).toUpperCase();

    const attempts = Number(
      attemptCount,
    );

    if (![1, 2].includes(attempts)) {
      return false;
    }

    return action ===
      NDR_ACTIONS.PICKUP_RESCHEDULE
      ? NDR_CODES.PICKUP_RESCHEDULE.includes(
        code,
      )
      : NDR_CODES.REATTEMPT.includes(
        code,
      );
  };
