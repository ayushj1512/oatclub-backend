import { shiprocketApi } from "./shiprocket.client.js";

const clean = (value) => String(value ?? "").trim();

export const SHIPROCKET_NDR_ACTIONS = [
  "re-attempt",
  "return",
  "fake-attempt",
];

const requireAwb = (awb) => {
  const value = clean(awb);

  if (!value) {
    throw new Error("Shiprocket AWB is required");
  }

  return value;
};

export const getShiprocketNdrList = (params = {}) =>
  shiprocketApi({
    url: "/ndr/all",
    params,
  });

export const getShiprocketNdr = (awb) =>
  shiprocketApi({
    url: `/ndr/${encodeURIComponent(requireAwb(awb))}`,
  });

export const getAllShiprocketNdrPages = async (
  params = {},
) => {
  const perPage = Math.min(
    Math.max(Number(params.per_page) || 100, 1),
    100,
  );

  const ndrOrders = [];
  const syncErrors = [];
  let page = 1;
  let totalPages = 1;
  let total = 0;

  do {
    try {
      const response = await getShiprocketNdrList({
        ...params,
        page,
        per_page: perPage,
      });

      const rows = Array.isArray(response?.data)
        ? response.data
        : [];

      const pagination =
        response?.meta?.pagination || {};

      ndrOrders.push(...rows);

      total = Number(
        pagination.total ?? total,
      );

      totalPages = Math.max(
        Number(
          pagination.total_pages ??
          pagination.last_page ??
          1,
        ),
        1,
      );

      page += 1;
    } catch (error) {
      syncErrors.push({
        page,
        message:
          error?.response?.data?.message ||
          error?.message ||
          "Unable to fetch Shiprocket NDR page",
      });

      break;
    }
  } while (page <= totalPages);

  return {
    totalNdrOrders:
      total || ndrOrders.length,
    totalPages,
    ndrOrders,
    syncErrors,
  };
};

export const submitShiprocketNdrAction = ({
  awb,
  action,
  comments,
  phone,
  address1,
  address2,
  deferredDate,
  proofAudio,
  proofImage,
  remarks,
}) => {
  const awbValue = requireAwb(awb);
  const actionValue = clean(action).toLowerCase();
  const commentsValue = clean(comments);

  if (
    !SHIPROCKET_NDR_ACTIONS.includes(
      actionValue,
    )
  ) {
    throw new Error(
      `Invalid Shiprocket NDR action. Allowed actions: ${SHIPROCKET_NDR_ACTIONS.join(", ")}`,
    );
  }

  if (!commentsValue) {
    throw new Error(
      "Comments are required for Shiprocket NDR action",
    );
  }

  return shiprocketApi({
    method: "POST",
    url: `/ndr/${encodeURIComponent(
      awbValue,
    )}/action`,
    data: {
      action: actionValue,
      comments: commentsValue,

      ...(clean(phone) && {
        phone: clean(phone).replace(/\D/g, ""),
      }),

      ...(clean(address1) && {
        address1: clean(address1),
      }),

      ...(clean(address2) && {
        address2: clean(address2),
      }),

      ...(clean(deferredDate) && {
        deferred_date: clean(deferredDate),
      }),

      ...(clean(proofAudio) && {
        proof_audio: clean(proofAudio),
      }),

      ...(clean(proofImage) && {
        proof_image: clean(proofImage),
      }),

      ...(clean(remarks) && {
        remarks: clean(remarks),
      }),
    },
  });
};

/*
 * Temporary backward compatibility.
 * Existing controller will continue working until
 * we patch shipping.controller.js next.
 */
export const reattemptShiprocketNdr = ({
  awb,
  comments = "Customer confirmed delivery reattempt",
  address1,
  address2,
  phone,
  deferredDate,
}) =>
  submitShiprocketNdrAction({
    awb,
    action: "re-attempt",
    comments,
    address1,
    address2,
    phone,
    deferredDate,
  });
