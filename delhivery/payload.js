import {
  DELHIVERY_CONFIG,
} from "./config.js";

const cleanText = (value) =>
  String(value || "")
    .replace(/[&#%;\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const positiveNumber = (
  value,
  fallback,
) => {
  const number = Number(value);

  return Number.isFinite(number) &&
    number > 0
    ? number
    : fallback;
};

/* ============================================================
   FORWARD SHIPMENT
============================================================ */

export const buildShipmentPayload = (
  order,
) => {
  if (!order) {
    throw new Error(
      "Order data is required.",
    );
  }

  const paymentMethod = String(
    order.paymentMethod ||
    order.paymentMode ||
    "",
  ).toLowerCase();

  const isCod =
    paymentMethod === "cod";

  const isPartialCod =
    paymentMethod ===
    "partial_cod";

  const totalAmount = Number(
    order.finalPayable ??
    order.totalAmount ??
    0,
  );

  const codAmount = isPartialCod
    ? Number(
      order.partialPayment
        ?.remainingCodAmount || 0,
    )
    : isCod
      ? totalAmount
      : 0;

  if (
    isPartialCod &&
    (
      order.paymentStatus !==
      "partially_paid" ||
      order.partialPayment
        ?.upfrontPaid !== true
    )
  ) {
    throw new Error(
      "Partial COD upfront payment is not completed.",
    );
  }

  if (
    (isCod || isPartialCod) &&
    codAmount <= 0
  ) {
    throw new Error(
      "Valid COD collection amount is required.",
    );
  }

  return {
    pickup_location: {
      name:
        DELHIVERY_CONFIG.pickupLocation,
    },

    shipments: [
      {
        name: cleanText(
          order.customerName,
        ),

        add: cleanText(
          order.address,
        ),

        pin: String(
          order.pincode || "",
        ),

        city: cleanText(order.city),
        state: cleanText(order.state),
        country: "India",

        phone: String(
          order.phone || "",
        ).replace(/\D/g, ""),

        order: cleanText(
          order.orderNumber,
        ),

        payment_mode:
          isCod || isPartialCod
            ? "COD"
            : "Prepaid",

        cod_amount: codAmount,

        total_amount:
          totalAmount,

        products_desc:
          cleanText(
            order.productDescription ||
            "Clothing",
          ),

        quantity: positiveNumber(
          order.quantity,
          1,
        ),

        weight: positiveNumber(
          order.weight,
          500,
        ),

        shipment_width:
          positiveNumber(
            order.width,
            20,
          ),

        shipment_height:
          positiveNumber(
            order.height,
            5,
          ),

        shipment_length:
          positiveNumber(
            order.length,
            25,
          ),
      },
    ],
  };
};

/* ============================================================
   REVERSE SHIPMENT
============================================================ */

export const buildReverseShipmentPayload =
  ({
    order,
    rma,
    packageDetails = {},
  }) => {
    if (!order) {
      throw new Error(
        "Order data is required.",
      );
    }

    if (!rma) {
      throw new Error(
        "RMA data is required.",
      );
    }

    const address =
      order.shippingAddressSnapshot ||
      {};

    const rmaItems =
      Array.isArray(rma.items)
        ? rma.items
        : [];

    if (!rmaItems.length) {
      throw new Error(
        "RMA items are required.",
      );
    }

    const orderItems =
      Array.isArray(order.items)
        ? order.items
        : [];

    const itemDetails =
      rmaItems.map(
        (rmaItem) => {
          const orderItem =
            orderItems.find(
              (item) =>
                String(
                  item?.lineId,
                ) ===
                String(
                  rmaItem
                    ?.orderLineId,
                ),
            );

          return {
            title:
              rmaItem?.title ||
              orderItem
                ?.productSnapshot
                ?.title ||
              "Clothing",

            hsnCode:
              orderItem
                ?.productSnapshot
                ?.hsnCode || "",

            quantity:
              positiveNumber(
                rmaItem
                  ?.quantity,
                1,
              ),

            price: Number(
              orderItem?.price ||
              0,
            ),
          };
        },
      );

    const quantity =
      itemDetails.reduce(
        (sum, item) =>
          sum + item.quantity,
        0,
      );

    const declaredValue =
      itemDetails.reduce(
        (sum, item) =>
          sum +
          item.price *
          item.quantity,
        0,
      );

    const productDescription =
      cleanText(
        itemDetails
          .map(
            (item) =>
              `${item.title} x${item.quantity}`,
          )
          .join(", "),
      );

    const hsnCodes = [
      ...new Set(
        itemDetails
          .map((item) =>
            cleanText(
              item.hsnCode,
            ),
          )
          .filter(Boolean),
      ),
    ].join(",");

    const reverseOrderId =
      cleanText(
        `${order.orderNumber}-${rma.rmaNumber}`,
      );

    const customerAddress =
      cleanText(
        [
          address.line1,
          address.line2,
        ]
          .filter(Boolean)
          .join(", "),
      );

    const pincode = String(
      address.pincode || "",
    )
      .replace(/\D/g, "")
      .slice(0, 6);

    const phone = String(
      address.phone || "",
    ).replace(/\D/g, "");

    if (!address.fullName) {
      throw new Error(
        "Customer name is missing.",
      );
    }

    if (!phone) {
      throw new Error(
        "Customer phone is missing.",
      );
    }

    if (
      !/^\d{6}$/.test(pincode)
    ) {
      throw new Error(
        "Valid customer pincode is missing.",
      );
    }

    if (!customerAddress) {
      throw new Error(
        "Customer address is missing.",
      );
    }

    return {
      pickup_location: {
        name:
          DELHIVERY_CONFIG
            .pickupLocation,
      },

      shipments: [
        {
          name: cleanText(
            address.fullName,
          ),

          add: customerAddress,

          pin: pincode,

          city: cleanText(
            address.city,
          ),

          state: cleanText(
            address.state,
          ),

          country: cleanText(
            address.country ||
            "India",
          ),

          phone,

          order: reverseOrderId,

          payment_mode:
            "Pickup",

          cod_amount: 0,

          total_amount:
            positiveNumber(
              packageDetails
                .declaredValue,
              declaredValue || 1,
            ),

          products_desc:
            productDescription ||
            "Customer return",

          quantity:
            positiveNumber(
              quantity,
              1,
            ),

          weight:
            positiveNumber(
              packageDetails
                .weight,
              500,
            ),

          shipment_length:
            positiveNumber(
              packageDetails
                .length,
              25,
            ),

          shipment_width:
            positiveNumber(
              packageDetails
                .width ??
              packageDetails
                .breadth,
              20,
            ),

          shipment_height:
            positiveNumber(
              packageDetails
                .height,
              5,
            ),

          ...(hsnCodes
            ? {
              hsn_code:
                hsnCodes,
            }
            : {}),
        },
      ],
    };
  };
