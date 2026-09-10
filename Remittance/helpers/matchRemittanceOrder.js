// Remittance/helpers/matchRemittanceOrder.js

import Order from "../../Orders/Orders.js";

const clean = (value) =>
  String(value ?? "").trim();

const normalizeOrderNumber = (value) =>
  clean(value).toUpperCase();

const normalizeShippingNo = (value) =>
  clean(value).replace(/\.0+$/, "");

/**
 * Matches a normalized remittance row
 * with the Orders collection.
 *
 * Priority:
 * 1. Order Number
 * 2. AWB / Waybill Number
 */
export default async function matchRemittanceOrder(
  normalizedRow = {}
) {
  const orderNumber =
    normalizeOrderNumber(
      normalizedRow.orderNumber
    );

  const shippingNo =
    normalizeShippingNo(
      normalizedRow.shippingNo ||
      normalizedRow.awb ||
      normalizedRow.waybillNumber
    );

  /*
   * Primary matching:
   * Shiprocket Order Id and Delhivery
   * Order Number both map to orderNumber.
   */
  if (orderNumber) {
    const order = await Order.findOne({
      orderNumber,
    }).lean();

    if (order) {
      return {
        matched: true,

        matchType:
          "order_number",

        order,

        orderId: order._id,

        orderNumber:
          normalizeOrderNumber(
            order.orderNumber
          ),
      };
    }
  }

  /*
   * Fallback matching through AWB.
   */
  if (shippingNo) {
    const order = await Order.findOne({
      $or: [
        {
          "shipment.shiprocket.awb":
            shippingNo,
        },
        {
          "shipment.delhivery.awb":
            shippingNo,
        },
        {
          "shipment.xpressbees.awb":
            shippingNo,
        },
        {
          "shipment.awb":
            shippingNo,
        },
        {
          "trackingDetails.trackingId":
            shippingNo,
        },
      ],
    }).lean();

    if (order) {
      return {
        matched: true,

        matchType: "shipping_no",

        order,

        orderId: order._id,

        orderNumber:
          normalizeOrderNumber(
            order.orderNumber
          ),
      };
    }
  }

  return {
    matched: false,

    matchType: null,

    order: null,

    orderId: null,

    orderNumber,

    reason:
      orderNumber || shippingNo
        ? "No matching order found"
        : "Order Number and Shipping Number are missing",
  };
}
