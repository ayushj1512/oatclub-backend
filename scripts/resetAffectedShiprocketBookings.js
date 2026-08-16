import "dotenv/config";
import dns from "dns";
import mongoose from "mongoose";
import Order from "../Orders/Orders.js";

/* ============================================================
   CONFIG
============================================================ */

const DRY_RUN = false;

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

const clean = (v) => String(v ?? "").trim();

/* ============================================================
   MAIN
============================================================ */

async function main() {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI missing in .env");
    }

    dns.setServers(["1.1.1.1", "1.0.0.1"]);

    console.log("🔌 Connecting MongoDB...");
    await mongoose.connect(process.env.MONGO_URI);

    console.log("✅ MongoDB connected");
    console.log(`🧪 DRY_RUN: ${DRY_RUN}`);
    console.log(`📦 Requested orders: ${ORDER_NUMBERS.length}`);

    const orders = await Order.find({
      orderNumber: { $in: ORDER_NUMBERS },
    })
      .select(
        [
          "_id",
          "orderNumber",
          "orderType",
          "isConfirmed",
          "fulfillmentStatus",
          "paymentMethod",
          "paymentStatus",
          "finalPayable",
          "shipment",
          "trackingDetails",
        ].join(" "),
      )
      .lean();

    const orderMap = new Map(
      orders.map((order) => [order.orderNumber, order]),
    );

    const ready = [];
    const skipped = [];

    console.log("\n============================================");
    console.log("SHIPROCKET FORCE RESET PREVIEW");
    console.log("============================================");

    for (const orderNumber of ORDER_NUMBERS) {
      const order = orderMap.get(orderNumber);

      if (!order) {
        console.log(`❌ ${orderNumber} | NOT FOUND`);

        skipped.push({
          orderNumber,
          reason: "not_found",
        });

        continue;
      }

      if (String(order.orderType || "").toLowerCase() === "parent") {
        console.log(`⏭️ ${orderNumber} | SKIP | parent order`);

        skipped.push({
          orderNumber,
          reason: "parent_order",
        });

        continue;
      }

      const awb =
        clean(order?.shipment?.awb) ||
        clean(order?.shipment?.shiprocket?.awb) ||
        clean(order?.trackingDetails?.awb) ||
        clean(order?.trackingDetails?.trackingId);

      const shipmentId =
        clean(order?.shipment?.shipmentId) ||
        clean(order?.shipment?.shiprocket?.shipmentId);

      const shiprocketOrderId =
        clean(order?.shipment?.orderId) ||
        clean(order?.shipment?.shiprocket?.orderId);

      console.log(
        `✅ ${orderNumber}` +
        ` | ${order.fulfillmentStatus} → packed` +
        ` | awb=${awb || "-"}` +
        ` | shipmentId=${shipmentId || "-"}` +
        ` | srOrderId=${shiprocketOrderId || "-"}` +
        ` | ₹${Number(order.finalPayable || 0)}`,
      );

      ready.push(order);
    }

    console.log("============================================");
    console.log(`Ready to reset: ${ready.length}`);
    console.log(`Skipped: ${skipped.length}`);

    if (DRY_RUN) {
      console.log("\n🧪 DRY RUN COMPLETE");
      console.log("✅ Nothing changed in MongoDB.");
      console.log("👉 Verify above list, then set DRY_RUN = false.");
      return;
    }

    console.log("\n⚠️ LIVE MODE — force resetting shipment data...\n");

    let updated = 0;
    let failed = 0;

    for (const order of ready) {
      try {
        const result = await Order.updateOne(
          { _id: order._id },
          {
            $set: {
              fulfillmentStatus: "packed",

              "shipment.provider": "unassigned",
              "shipment.status": "pending",

              "shipment.orderId": "",
              "shipment.shipmentId": "",
              "shipment.awb": "",
              "shipment.courierName": "",
              "shipment.trackingUrl": "",
              "shipment.labelUrl": "",

              "shipment.rawStatus": "",
              "shipment.statusCode": "",

              "shipment.lastSyncedAt": null,
              "shipment.lastWebhookAt": null,
              "shipment.lastTrackAt": null,

              "shipment.lastWebhook": null,
              "shipment.lastTrack": null,

              "shipment.shiprocket.orderId": "",
              "shipment.shiprocket.shipmentId": "",
              "shipment.shiprocket.awb": "",
              "shipment.shiprocket.courierName": "",
              "shipment.shiprocket.trackingUrl": "",
              "shipment.shiprocket.labelUrl": "",
              "shipment.shiprocket.lastWebhook": null,
              "shipment.shiprocket.lastTrack": null,

              "trackingDetails.trackingId": "",
              "trackingDetails.awb": "",
              "trackingDetails.provider": "",
              "trackingDetails.courierName": "",
              "trackingDetails.trackingUrl": "",
              "trackingDetails.lastUpdatedAt": null,

              "fulfillmentDates.shippedAt": null,
              "fulfillmentDates.pickedAt": null,
              "fulfillmentDates.outForDeliveryAt": null,
            },

            $unset: {
              "shipment.shippedAt": "",
              "shipment.pickedAt": "",
              "shipment.outForDeliveryAt": "",

              "trackingDetails.shippedAt": "",
              "trackingDetails.deliveredAt": "",
              "trackingDetails.expectedDelivery": "",
            },
          },
        );

        if (result.modifiedCount !== 1) {
          console.log(`⏭️ ${order.orderNumber} | NOT MODIFIED`);
          continue;
        }

        updated += 1;

        console.log(
          `✅ ${order.orderNumber} | fully reset → packed`,
        );
      } catch (error) {
        failed += 1;

        console.error(
          `❌ ${order.orderNumber}`,
          error?.message || error,
        );
      }
    }

    console.log("\n🔍 Final verification...\n");

    const verification = await Order.find({
      orderNumber: {
        $in: ready.map((x) => x.orderNumber),
      },
    })
      .select(
        "orderNumber fulfillmentStatus shipment trackingDetails",
      )
      .lean();

    let cleanCount = 0;

    for (const order of verification) {
      const awb =
        clean(order?.shipment?.awb) ||
        clean(order?.shipment?.shiprocket?.awb) ||
        clean(order?.trackingDetails?.awb) ||
        clean(order?.trackingDetails?.trackingId);

      const shipmentId =
        clean(order?.shipment?.shipmentId) ||
        clean(order?.shipment?.shiprocket?.shipmentId);

      const srOrderId =
        clean(order?.shipment?.orderId) ||
        clean(order?.shipment?.shiprocket?.orderId);

      const cleanForBooking =
        order.fulfillmentStatus === "packed" &&
        !awb &&
        !shipmentId &&
        !srOrderId;

      if (cleanForBooking) {
        cleanCount += 1;
        console.log(`✅ ${order.orderNumber} | READY FOR REBOOK`);
      } else {
        console.log(
          `⚠️ ${order.orderNumber}` +
          ` | status=${order.fulfillmentStatus}` +
          ` | shipmentId=${shipmentId || "-"}` +
          ` | orderId=${srOrderId || "-"}` +
          ` | awb=${awb || "-"}`,
        );
      }
    }

    console.log("\n============================================");
    console.log("SHIPROCKET RESET COMPLETE");
    console.log("============================================");
    console.log(`✅ Updated: ${updated}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`🚀 Ready for rebooking: ${cleanCount}`);
    console.log("============================================");
  } catch (error) {
    console.error(
      "\n❌ SCRIPT FAILED:",
      error?.message || error,
    );

    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log("\n🔌 MongoDB disconnected");
  }
}

main();
