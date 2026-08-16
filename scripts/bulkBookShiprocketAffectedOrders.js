import "dotenv/config";
import dns from "dns";
import mongoose from "mongoose";

import Order from "../Orders/Orders.js";
import {
  checkServiceability,
  createShipment,
  assignAwb,
} from "../shiprocket/index.js";

import { buildShiprocketPayload } from "../shiprocket/shiprocket.payload.js";

/* ============================================================
   CONFIG
============================================================ */

const DRY_RUN = false;
const DELAY_MS = 1500;

const ORDER_NUMBERS = [
  "00041",
  "00084",
  "00088",
  "00098",
  "00145",
  "00148",
  "00154",
  "00174",
  "00178",
  "00184",
  "00191",
  "00234",
  "00242",
  "00244",
  "00249",
  "00251",
  "00252",
  "00254",
  "00255",
  "00259",
  "00260",
  "00262",
  "00266",
  "00267",
  "00268",
  "00281",
  "00286",
  "00289",
];

/* ============================================================
   HELPERS
============================================================ */

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const str = (v) => String(v ?? "").trim();

const lower = (v) => str(v).toLowerCase();

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const getWeight = (order) =>
  order.items?.reduce((total, item) => {
    const weight =
      num(item?.variant?.weight) ||
      num(item?.productSnapshot?.weight) ||
      0.5;

    return total + weight * Math.max(1, num(item?.quantity));
  }, 0) || 0.5;

/* ============================================================
   VALIDATION
============================================================ */

const validateOrder = (order) => {
  if (!order) return { ok: false, reason: "not_found" };

  if (lower(order.orderType) === "parent") {
    return { ok: false, reason: "parent_order" };
  }

  if (!order.isConfirmed) {
    return { ok: false, reason: "not_confirmed" };
  }

  if (lower(order.fulfillmentStatus) !== "packed") {
    return {
      ok: false,
      reason: `not_packed:${order.fulfillmentStatus}`,
    };
  }

  if (
    lower(order.paymentMethod) === "razorpay" &&
    lower(order.paymentStatus) !== "paid"
  ) {
    return {
      ok: false,
      reason: "razorpay_not_paid",
    };
  }

  if (!str(order?.shippingAddressSnapshot?.pincode)) {
    return {
      ok: false,
      reason: "missing_pincode",
    };
  }

  const awb =
    str(order?.shipment?.awb) ||
    str(order?.shipment?.shiprocket?.awb);

  if (awb) {
    return {
      ok: false,
      reason: `awb_exists:${awb}`,
    };
  }

  const shipmentId =
    str(order?.shipment?.shipmentId) ||
    str(order?.shipment?.shiprocket?.shipmentId);

  if (shipmentId) {
    return {
      ok: false,
      reason: `shipment_exists:${shipmentId}`,
    };
  }

  return { ok: true };
};

/* ============================================================
   BUILD CORRECT SHIPROCKET PAYLOAD
============================================================ */

const buildFixedPayload = (order) => {
  const payload = buildShiprocketPayload(order);

  const isCOD =
    lower(order.paymentMethod) === "cod";

  const finalPayable =
    Math.max(0, num(order.finalPayable));

  const shippingFee =
    Math.max(0, num(order.shippingFee));

  /*
    GST IS ALREADY INCLUDED IN SELLING PRICE.

    DO NOT subtract order.tax again.
  */
  const goodsPayable =
    Math.max(
      0,
      finalPayable - shippingFee,
    );

  payload.payment_method =
    isCOD ? "COD" : "Prepaid";

  payload.shipping_charges =
    shippingFee;

  payload.collectable_amount =
    isCOD ? finalPayable : 0;

  payload.transaction_charges =
    num(payload.transaction_charges);

  if (isCOD) {
    payload.sub_total = goodsPayable;

    /*
      Align item totals with actual GST-inclusive goods amount.
    */
    if (
      Array.isArray(payload.order_items) &&
      payload.order_items.length
    ) {
      const sourceItems =
        Array.isArray(order.items)
          ? order.items
          : [];

      let allocated = 0;

      payload.order_items =
        payload.order_items.map((item, index) => {
          const units =
            Math.max(1, num(item.units));

          const source =
            sourceItems[index];

          let lineTotal =
            num(source?.subtotal);

          if (
            index ===
            payload.order_items.length - 1
          ) {
            lineTotal =
              Math.max(
                0,
                goodsPayable - allocated,
              );
          } else {
            allocated += lineTotal;
          }

          return {
            ...item,

            selling_price:
              String(
                Number(
                  (
                    lineTotal / units
                  ).toFixed(2),
                ),
              ),

            discount: "0",
          };
        });
    }
  }

  return payload;
};

/* ============================================================
   SAVE SHIPMENT
============================================================ */

const saveShipment = async ({
  order,
  shipment,
}) => {
  const shipmentId =
    str(
      shipment?.shipment_id ||
      shipment?.shipmentId ||
      shipment?.response?.data?.shipment_id,
    );

  const shiprocketOrderId =
    str(
      shipment?.order_id ||
      shipment?.orderId ||
      shipment?.response?.data?.order_id,
    );

  let awb =
    str(
      shipment?.awb_code ||
      shipment?.awb ||
      shipment?.response?.data?.awb_code,
    );

  if (!shipmentId) {
    throw new Error(
      "Shiprocket response missing shipment_id",
    );
  }

  let courierName =
    str(
      shipment?.courier_name ||
      shipment?.courierName ||
      shipment?.response?.data?.courier_name,
    );

  let trackingUrl =
    str(
      shipment?.tracking_url ||
      shipment?.trackingUrl ||
      shipment?.response?.data?.tracking_url,
    );

  /* --------------------------------------------------------
     ASSIGN AWB
  -------------------------------------------------------- */

  if (!awb) {
    try {
      const assigned =
        await assignAwb(shipmentId);

      awb =
        str(
          assigned?.awb_code ||
          assigned?.awb ||
          assigned?.response?.data?.awb_code,
        );

      courierName =
        str(
          assigned?.courier_name ||
          assigned?.courierName ||
          assigned?.response?.data?.courier_name,
        ) || courierName;

      trackingUrl =
        str(
          assigned?.tracking_url ||
          assigned?.trackingUrl ||
          assigned?.response?.data?.tracking_url,
        ) || trackingUrl;
    } catch (error) {
      console.log(
        `⚠️ ${order.orderNumber} | AWB pending`,
        error?.response?.data ||
        error?.message,
      );
    }
  }

  /* --------------------------------------------------------
     SAVE TO ORDER
  -------------------------------------------------------- */

  order.shipment =
    order.shipment || {};

  order.shipment.shiprocket =
    order.shipment.shiprocket || {};

  order.shipment.provider =
    "shiprocket";

  order.shipment.status =
    awb ? "booked" : "processing";

  order.shipment.orderId =
    shiprocketOrderId;

  order.shipment.shipmentId =
    shipmentId;

  order.shipment.awb =
    awb;

  order.shipment.courierName =
    courierName;

  order.shipment.trackingUrl =
    trackingUrl;

  order.shipment.shiprocket.orderId =
    shiprocketOrderId;

  order.shipment.shiprocket.shipmentId =
    shipmentId;

  order.shipment.shiprocket.awb =
    awb;

  order.shipment.shiprocket.courierName =
    courierName;

  order.shipment.shiprocket.trackingUrl =
    trackingUrl;

  order.trackingDetails = {
    ...(order.trackingDetails?.toObject?.() ||
      order.trackingDetails ||
      {}),

    provider: "shiprocket",
    trackingId: awb,
    awb,
    courierName,
    trackingUrl,
    lastUpdatedAt: new Date(),
  };

  if (
    order.shipment.xpressbees === undefined ||
    (
      order.shipment.xpressbees !== null &&
      typeof order.shipment.xpressbees !== "object"
    )
  ) {
    delete order.shipment.xpressbees;
  }

  await order.save();

  return {
    shipmentId,
    shiprocketOrderId,
    awb,
    courierName,
  };
};

/* ============================================================
   BOOK SINGLE ORDER
============================================================ */

const bookSingleOrder = async (order) => {
  const isCOD =
    lower(order.paymentMethod) === "cod";

  const weight =
    getWeight(order);

  const couriers =
    await checkServiceability({
      pickupPincode:
        str(
          process.env
            .SHIPROCKET_PICKUP_PINCODE,
        ),

      deliveryPincode:
        str(
          order
            .shippingAddressSnapshot
            .pincode,
        ),

      weight,

      cod:
        isCOD ? 1 : 0,
    });

  if (
    !Array.isArray(couriers) ||
    !couriers.length
  ) {
    throw new Error(
      "No Shiprocket courier available",
    );
  }

  const payload =
    buildFixedPayload(order);

  console.log(
    `\n🚀 BOOKING ${order.orderNumber}`,
  );

  console.log({
    finalPayable:
      order.finalPayable,

    taxIncluded:
      order.tax,

    shippingFee:
      order.shippingFee,

    shiprocketSubTotal:
      payload.sub_total,

    collectableAmount:
      payload.collectable_amount,

    paymentMethod:
      payload.payment_method,

    weight,
  });

  const shipment =
    await createShipment(payload);

  return saveShipment({
    order,
    shipment,
  });
};

/* ============================================================
   MAIN
============================================================ */

async function main() {
  const result = {
    ready: [],
    booked: [],
    skipped: [],
    failed: [],
  };

  try {
    if (!process.env.MONGO_URI) {
      throw new Error(
        "MONGO_URI missing in .env",
      );
    }

    if (
      !process.env
        .SHIPROCKET_PICKUP_PINCODE
    ) {
      throw new Error(
        "SHIPROCKET_PICKUP_PINCODE missing",
      );
    }

    if (
      !process.env
        .SHIPROCKET_PICKUP_LOCATION
    ) {
      throw new Error(
        "SHIPROCKET_PICKUP_LOCATION missing",
      );
    }

    dns.setServers([
      "1.1.1.1",
      "1.0.0.1",
    ]);

    console.log(
      "🔌 Connecting MongoDB...",
    );

    await mongoose.connect(
      process.env.MONGO_URI,
    );

    console.log(
      "✅ MongoDB connected",
    );

    console.log(
      `🧪 DRY_RUN: ${DRY_RUN}`,
    );

    console.log(
      `📦 Requested: ${ORDER_NUMBERS.length}`,
    );

    /* ========================================================
       LOAD ORDERS
    ======================================================== */

    const orders =
      await Order.find({
        orderNumber: {
          $in: ORDER_NUMBERS,
        },
      });

    const orderMap =
      new Map(
        orders.map((order) => [
          order.orderNumber,
          order,
        ]),
      );

    /* ========================================================
       PREVIEW
    ======================================================== */

    console.log(
      "\n============================================",
    );

    console.log(
      "SHIPROCKET BULK BOOKING PREVIEW",
    );

    console.log(
      "============================================",
    );

    for (
      const orderNumber
      of ORDER_NUMBERS
    ) {
      const order =
        orderMap.get(orderNumber);

      const check =
        validateOrder(order);

      if (!check.ok) {
        console.log(
          `⏭️ ${orderNumber} | SKIP | ${check.reason}`,
        );

        result.skipped.push({
          orderNumber,
          reason: check.reason,
        });

        continue;
      }

      const finalPayable =
        num(order.finalPayable);

      const shippingFee =
        num(order.shippingFee);

      const goodsPayable =
        Math.max(
          0,
          finalPayable -
          shippingFee,
        );

      console.log(
        `✅ ${orderNumber}` +
        ` | ${order.paymentMethod}` +
        ` | ₹${finalPayable}` +
        ` | GST ₹${num(order.tax)}` +
        ` | SR subtotal ₹${goodsPayable}`,
      );

      result.ready.push(
        orderNumber,
      );
    }

    console.log(
      "============================================",
    );

    console.log(
      `Ready: ${result.ready.length}`,
    );

    console.log(
      `Skipped: ${result.skipped.length}`,
    );

    /* ========================================================
       DRY RUN STOP
    ======================================================== */

    if (DRY_RUN) {
      console.log(
        "\n🧪 DRY RUN COMPLETE",
      );

      console.log(
        "✅ No Shiprocket booking performed.",
      );

      console.log(
        "👉 If Ready = 28, set DRY_RUN = false.",
      );

      return;
    }

    /* ========================================================
       LIVE BOOKING
    ======================================================== */

    console.log(
      "\n🚨 LIVE BULK BOOKING STARTED\n",
    );

    for (
      const orderNumber
      of result.ready
    ) {
      try {
        /*
          Refetch before every booking.
          Prevents duplicate booking.
        */
        const order =
          await Order.findOne({
            orderNumber,
          });

        const check =
          validateOrder(order);

        if (!check.ok) {
          console.log(
            `⏭️ ${orderNumber} | ${check.reason}`,
          );

          result.skipped.push({
            orderNumber,
            reason: check.reason,
          });

          continue;
        }

        const booked =
          await bookSingleOrder(order);

        result.booked.push({
          orderNumber,
          ...booked,
        });

        console.log(
          `✅ BOOKED ${orderNumber}`,
          {
            shipmentId:
              booked.shipmentId,

            awb:
              booked.awb ||
              "pending",
          },
        );
      } catch (error) {
        const errorData =
          error?.response?.data ||
          error?.message ||
          error;

        result.failed.push({
          orderNumber,
          error: errorData,
        });

        console.error(
          `❌ FAILED ${orderNumber}`,
          errorData,
        );
      }

      await sleep(DELAY_MS);
    }

    /* ========================================================
       SUMMARY
    ======================================================== */

    console.log(
      "\n============================================",
    );

    console.log(
      "SHIPROCKET BULK BOOKING COMPLETE",
    );

    console.log(
      "============================================",
    );

    console.log(
      `✅ Booked: ${result.booked.length}`,
    );

    console.log(
      `⏭️ Skipped: ${result.skipped.length}`,
    );

    console.log(
      `❌ Failed: ${result.failed.length}`,
    );

    if (
      result.failed.length
    ) {
      console.log(
        "\nFAILED ORDERS:",
      );

      for (
        const item
        of result.failed
      ) {
        console.log(
          `❌ ${item.orderNumber}`,
        );
      }
    }
  } catch (error) {
    console.error(
      "\n❌ SCRIPT FAILED:",
      error?.response?.data ||
      error?.message ||
      error,
    );

    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();

    console.log(
      "\n🔌 MongoDB disconnected",
    );
  }
}

main();
