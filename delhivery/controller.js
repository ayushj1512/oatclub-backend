import {
  createShipment,
  createReverseShipment,
  updateShipment,
  cancelShipment,
  fetchWaybills,
} from "./shipment.js";

import {
  checkServiceability,
} from "./serviceability.js";

import {
  trackShipment,
  trackShipments,
  trackByReferenceId,
  getShippingLabel,
  getShippingLabels,
} from "./tracking.js";

import {
  createWarehouse,
  updateWarehouse,
} from "./warehouse.js";

import {
  createPickup,
} from "./pickup.js";

import {
  downloadDocument,
} from "./document.js";

import {
  syncDelhiveryPayload,
} from "./webhook.js";

import Order from "../Orders/Orders.js";
import {
  getNdrStatus,
  submitNdrAction,
} from "./ndr.js";

import { PDFDocument } from "pdf-lib";


const send = async (
  res,
  promise,
  status = 200,
) => {
  try {
    const data = await promise;

    return res.status(status).json({
      success: true,
      data,
    });
  } catch (error) {
    const statusCode =
      error?.response?.status ||
      error?.statusCode ||
      500;

    const response =
      error?.response?.data ||
      error?.responseData ||
      null;

    console.error(
      "\n========== DELHIVERY API ERROR ==========",
    );

    console.error({
      status: statusCode,
      message: error?.message,
      method:
        error?.config?.method?.toUpperCase(),
      url:
        `${error?.config?.baseURL || ""}` +
        `${error?.config?.url || ""}`,
      params: error?.config?.params,
      response,
    });

    console.error(
      "==========================================\n",
    );

    return res.status(statusCode).json({
      success: false,
      message:
        response?.message ||
        response?.rmk ||
        error?.message ||
        "Delhivery request failed.",
      error: response,
    });
  }
};

export const serviceabilityController = (
  req,
  res,
) =>
  send(
    res,
    checkServiceability(
      req.params.pincode,
    ),
  );

export const createShipmentController = (
  req,
  res,
) =>
  send(
    res,
    createShipment(req.body),
    201,
  );

export const updateShipmentController = (
  req,
  res,
) =>
  send(
    res,
    updateShipment(
      req.params.waybill,
      req.body,
    ),
  );

export const cancelShipmentController = (
  req,
  res,
) =>
  send(
    res,
    cancelShipment(
      req.params.waybill,
    ),
  );

export const trackingController = async (
  req,
  res,
) => {
  try {
    const data = await trackShipment(
      req.params.waybill,
    );

    const sync =
      await syncDelhiveryPayload(
        data,
        "tracking",
      );

    return res.json({
      success: true,
      data,
      sync,
    });
  } catch (error) {
    return send(
      res,
      Promise.reject(error),
    );
  }
};

export const bulkTrackingController = async (
  req,
  res,
) => {
  try {
    const data = await trackShipments(
      req.body?.waybills || [],
    );

    const sync =
      await syncDelhiveryPayload(
        data,
        "tracking",
      );

    return res.json({
      success: true,
      data,
      sync,
    });
  } catch (error) {
    return send(
      res,
      Promise.reject(error),
    );
  }
};

export const syncAllDelhiveryTrackingController =
  async (req, res) => {
    try {
      const orders = await Order.find({
        "shipment.provider": "delhivery",
        $or: [
          {
            "shipment.delhivery.waybill": {
              $exists: true,
              $ne: "",
            },
          },
          {
            "shipment.delhivery.awb": {
              $exists: true,
              $ne: "",
            },
          },
          {
            "shipment.awb": {
              $exists: true,
              $ne: "",
            },
          },
        ],
      })
        .select(
          [
            "orderNumber",
            "customerId",
            "shippingAddressSnapshot",
            "items",
            "subtotal",
            "discount",
            "shippingFee",
            "tax",
            "totalAmount",
            "finalPayable",
            "currency",
            "paymentMethod",
            "paymentStatus",
            "fulfillmentStatus",
            "shipment",
            "createdAt",
          ].join(" "),
        )
        .populate(
          "customerId",
          "name fullName phone mobile email",
        )
        .lean();

      const waybills = [
        ...new Set(
          orders
            .map(
              (order) =>
                order?.shipment?.delhivery
                  ?.waybill ||
                order?.shipment?.delhivery
                  ?.awb ||
                order?.shipment?.awb,
            )
            .map((value) =>
              String(value || "").trim(),
            )
            .filter(Boolean),
        ),
      ];

      if (!waybills.length) {
        return res.json({
          success: true,
          totalShipments: 0,
          synced: 0,
          changed: 0,
          failed: 0,
          message:
            "No Delhivery shipments found.",
        });
      }

      const batches = [];

      for (
        let i = 0;
        i < waybills.length;
        i += 50
      ) {
        batches.push(
          waybills.slice(i, i + 50),
        );
      }

      const results = [];

      for (const batch of batches) {
        try {
          const trackingData =
            await trackShipments(batch);

          const syncResults =
            await syncDelhiveryPayload(
              trackingData,
              "tracking",
            );

          results.push(
            ...syncResults,
          );
        } catch (error) {
          batch.forEach((awb) => {
            results.push({
              success: false,
              awb,
              reason:
                error?.response?.data
                  ?.message ||
                error?.message ||
                "Tracking sync failed.",
            });
          });
        }
      }

      const synced =
        results.filter(
          (item) => item.success,
        ).length;

      const failed =
        results.filter(
          (item) => !item.success,
        ).length;

      const changed =
        results.filter(
          (item) =>
            item.success &&
            item.fulfillmentChanged,
        ).length;

      return res.json({
        success: true,
        totalShipments:
          waybills.length,
        synced,
        changed,
        failed,
        results,
      });
    } catch (error) {
      console.error(
        "Sync all Delhivery tracking error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          error?.message ||
          "Unable to sync Delhivery shipments.",
      });
    }
  };

export const referenceTrackingController = (
  req,
  res,
) =>
  send(
    res,
    trackByReferenceId(
      req.params.referenceId,
    ),
  );

export const labelController = async (
  req,
  res,
) => {
  try {
    const waybill = String(
      req.params.waybill || "",
    ).trim();

    if (!waybill) {
      return res.status(400).json({
        success: false,
        message:
          "Waybill is required.",
      });
    }

    const data =
      await getShippingLabel(
        waybill,
        {
          pdf: true,
        },
      );

    return res.json({
      success: true,
      waybill,
      data,
    });
  } catch (error) {
    return send(
      res,
      Promise.reject(error),
    );
  }
};

export const bulkLabelController = async (
  req,
  res,
) => {
  try {
    const waybills = [
      ...new Set(
        (req.body?.waybills || [])
          .map((awb) =>
            String(awb || "").trim(),
          )
          .filter(Boolean),
      ),
    ];

    if (!waybills.length) {
      return res.status(400).json({
        success: false,
        message:
          "At least one waybill is required.",
      });
    }

    const results =
      await getShippingLabels(
        waybills,
        { pdf: true },
      );

    const mergedPdf =
      await PDFDocument.create();

    let generated = 0;
    const failed = [];

    for (const item of results) {
      try {
        if (!item?.success) {
          throw new Error(
            item?.error ||
            "Label generation failed.",
          );
        }

        const labelData =
          item?.data;

        const findPdfUrl = (value) => {
          if (!value) return "";

          if (typeof value === "string") {
            const url = value.trim();

            if (
              /^https?:\/\//i.test(url) &&
              (
                /\.pdf($|\?)/i.test(url) ||
                /label|packing|waybill|download/i.test(url)
              )
            ) {
              return url;
            }

            return "";
          }

          if (Array.isArray(value)) {
            for (const child of value) {
              const url =
                findPdfUrl(child);

              if (url) return url;
            }

            return "";
          }

          if (
            typeof value === "object"
          ) {
            for (const [
              key,
              child,
            ] of Object.entries(value)) {
              if (
                /logo|image|icon|banner|static/i.test(
                  key,
                )
              ) {
                continue;
              }

              const url =
                findPdfUrl(child);

              if (url) return url;
            }
          }

          return "";
        };

        const pdfUrl =
          findPdfUrl(labelData);

        if (!pdfUrl) {
          throw new Error(
            "Label PDF URL not found.",
          );
        }

        const pdfResponse =
          await fetch(pdfUrl);

        if (!pdfResponse.ok) {
          throw new Error(
            `Unable to download label PDF (${pdfResponse.status}).`,
          );
        }

        const pdfBytes =
          new Uint8Array(
            await pdfResponse.arrayBuffer(),
          );

        const sourcePdf =
          await PDFDocument.load(
            pdfBytes,
          );

        const pages =
          await mergedPdf.copyPages(
            sourcePdf,
            sourcePdf.getPageIndices(),
          );

        pages.forEach((page) =>
          mergedPdf.addPage(page),
        );

        generated += 1;
      } catch (error) {
        failed.push({
          waybill: item?.waybill,
          message:
            error?.message ||
            "Label merge failed.",
        });
      }
    }

    if (!generated) {
      return res.status(500).json({
        success: false,
        message:
          "Unable to generate any Delhivery labels.",
        failed,
      });
    }

    const mergedBytes =
      await mergedPdf.save();

    res.setHeader(
      "Content-Type",
      "application/pdf",
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Delhivery-Labels-${generated}.pdf"`,
    );

    res.setHeader(
      "X-Labels-Generated",
      String(generated),
    );

    res.setHeader(
      "X-Labels-Failed",
      String(failed.length),
    );

    return res.send(
      Buffer.from(mergedBytes),
    );
  } catch (error) {
    return send(
      res,
      Promise.reject(error),
    );
  }
};

export const documentController = (
  req,
  res,
) =>
  send(
    res,
    downloadDocument({
      waybill:
        req.params.waybill,
      docType:
        req.query.doc_type,
    }),
  );

export const waybillController = (
  req,
  res,
) =>
  send(
    res,
    fetchWaybills(
      req.query.count,
    ),
  );

export const warehouseController = (
  req,
  res,
) =>
  send(
    res,
    createWarehouse(req.body),
    201,
  );

export const updateWarehouseController = (
  req,
  res,
) =>
  send(
    res,
    updateWarehouse(req.body),
  );

export const pickupController = async (req, res) => {
  try {
    const {
      pickupDate,
      pickupTime,
      packageCount = 1,
    } = req.body;

    if (!pickupDate || !pickupTime) {
      return res.status(400).json({
        success: false,
        message: "Pickup date and time are required.",
      });
    }

    const data = await createPickup({
      pickupDate,
      pickupTime,
      packageCount,
    });

    return res.status(201).json({
      success: true,
      message: "Pickup scheduled successfully.",
      data,
    });
  } catch (error) {
    const responseData = error.response?.data;

    return res
      .status(error.response?.status || 500)
      .json({
        success: false,
        message:
          responseData?.message ||
          responseData?.error ||
          error.message ||
          "Unable to schedule pickup.",
        data: responseData || null,
      });
  }
};

const findRma = (
  order,
  rmaNumber,
) =>
  (order?.rmas || []).find(
    (item) =>
      String(item?.rmaNumber) ===
      String(rmaNumber),
  );

const extractCreatedPackage = (
  data,
) => {
  if (Array.isArray(data?.packages)) {
    return data.packages[0] || {};
  }

  if (
    data?.package &&
    typeof data.package === "object"
  ) {
    return data.package;
  }

  return {};
};

const extractReverseWaybill = (
  data,
) => {
  const packageResult =
    extractCreatedPackage(data);

  return String(
    packageResult?.waybill ||
    packageResult?.waybill_no ||
    packageResult?.wbn ||
    data?.waybill ||
    data?.awb ||
    "",
  ).trim();
};

const getReverseStatus = (
  trackingData,
) => {
  const shipment =
    trackingData?.ShipmentData?.[0]
      ?.Shipment ||
    trackingData?.shipment ||
    {};

  const statusData =
    shipment?.Status || {};

  const statusCode = String(
    delhivery.statusCode ||
    delhivery.lastWebhook?.NSLCode ||
    order.shipment?.statusCode ||
    order.shipment?.lastWebhook
      ?.NSLCode ||
    lastTrack?.Status?.StatusCode ||
    lastTrack?.StatusCode ||
    "",
  )
    .trim()
    .toUpperCase();

  const reason = String(
    delhivery.lastWebhook
      ?.Status?.Instructions ||
    order.shipment?.lastWebhook
      ?.Status?.Instructions ||
    lastTrack?.Status?.Instructions ||
    rawStatus ||
    "Delivery attempt failed",
  ).trim();

  const normalized =
    rawStatus.toLowerCase();

  let status = "pickup_scheduled";

  if (
    normalized.includes("cancel")
  ) {
    status = "cancelled";
  } else if (
    normalized.includes("delivered") ||
    normalized.includes(
      "returned to client",
    )
  ) {
    status = "received";
  } else if (
    normalized.includes(
      "in transit",
    ) ||
    normalized.includes("transit") ||
    normalized.includes(
      "dispatched",
    )
  ) {
    status = "in_transit";
  } else if (
    normalized.includes("picked") ||
    normalized.includes(
      "pickup complete",
    )
  ) {
    status = "picked";
  }

  return {
    status,
    rawStatus,
    statusCode,
    shipment,
  };
};

export const createReversePickupController = async (
  req,
  res,
) => {
  try {
    const order = await Order.findById(
      req.params.orderId,
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    const rma = findRma(
      order,
      req.params.rmaNumber,
    );

    if (!rma) {
      return res.status(404).json({
        success: false,
        message: "RMA not found.",
      });
    }

    if (rma.reverseShipment?.awb) {
      return res.status(409).json({
        success: false,
        message:
          "Reverse pickup is already booked.",
      });
    }

    const data = await createReverseShipment({
      ...req.body,
      order: order.toObject(),
      rma:
        typeof rma.toObject === "function"
          ? rma.toObject()
          : rma,
    });

    const packageData =
      extractCreatedPackage(data);

    const waybill =
      extractReverseWaybill(data);

    if (!waybill) {
      return res.status(502).json({
        success: false,
        message:
          data?.rmk ||
          data?.message ||
          "Delhivery did not return a waybill.",
        data,
      });
    }

    const now = new Date();

    rma.reverseShipment.provider =
      "delhivery";

    rma.reverseShipment.awb =
      waybill;

    rma.reverseShipment.orderId =
      String(
        packageData?.refnum ||
        packageData?.reference_number ||
        req.body?.reference_number ||
        "",
      );

    rma.reverseShipment.shipmentId =
      String(
        packageData?.shipment_id ||
        packageData?.id ||
        "",
      );

    rma.reverseShipment.courierName =
      "Delhivery";

    rma.reverseShipment.status =
      "pickup_scheduled";

    rma.reverseShipment.rawStatus =
      String(
        packageData?.status ||
        data?.status ||
        "Pickup scheduled",
      );

    rma.reverseShipment.pickupScheduledAt =
      now;

    rma.reverseShipment.lastSyncedAt =
      now;

    rma.reverseShipment.lastTrack =
      data;

    rma.status = "pickup_scheduled";

    order.markModified("rmas");
    await order.save();

    return res.status(201).json({
      success: true,
      message:
        "Delhivery reverse pickup booked successfully.",
      data: {
        waybill,
        status: "pickup_scheduled",
        reverseShipment:
          rma.reverseShipment,
        response: data,
      },
    });
  } catch (error) {
    return send(
      res,
      Promise.reject(error),
    );
  }
};

export const syncReversePickupController =
  async (req, res) => {
    try {
      const order =
        await Order.findById(
          req.params.orderId,
        );

      if (!order) {
        return res.status(404).json({
          success: false,
          message:
            "Order not found.",
        });
      }

      const rma = findRma(
        order,
        req.params.rmaNumber,
      );

      if (!rma) {
        return res.status(404).json({
          success: false,
          message:
            "RMA not found.",
        });
      }

      const waybill = String(
        rma.reverseShipment?.awb ||
        "",
      ).trim();

      if (!waybill) {
        return res.status(400).json({
          success: false,
          message:
            "Reverse Delhivery waybill is not assigned.",
        });
      }

      const trackingData =
        await trackShipment(
          waybill,
        );

      const {
        status,
        rawStatus,
        statusCode,
      } = getReverseStatus(
        trackingData,
      );

      const now = new Date();

      rma.reverseShipment.provider =
        "delhivery";

      rma.reverseShipment.status =
        status;

      rma.reverseShipment.rawStatus =
        rawStatus;

      rma.reverseShipment.statusCode =
        statusCode;

      rma.reverseShipment.lastTrack =
        trackingData;

      rma.reverseShipment.lastTrackAt =
        now;

      rma.reverseShipment.lastSyncedAt =
        now;

      if (
        status === "picked" &&
        !rma.reverseShipment.pickedAt
      ) {
        rma.reverseShipment.pickedAt =
          now;

        rma.returnPickupCompleted =
          true;
      }

      if (
        status === "in_transit" &&
        !rma.reverseShipment.inTransitAt
      ) {
        rma.reverseShipment.inTransitAt =
          now;
      }

      if (
        status === "received" &&
        !rma.reverseShipment.receivedAt
      ) {
        rma.reverseShipment.receivedAt =
          now;
      }

      if (
        status === "cancelled" &&
        !rma.reverseShipment.cancelledAt
      ) {
        rma.reverseShipment.cancelledAt =
          now;
      }

      const rmaStatuses = [
        "pickup_scheduled",
        "picked",
        "in_transit",
        "received",
      ];

      if (
        rmaStatuses.includes(status)
      ) {
        rma.status = status;
      }

      order.markModified("rmas");
      await order.save();

      return res.status(200).json({
        success: true,
        message:
          "Reverse pickup tracking synced.",
        data: {
          waybill,
          status,
          rawStatus,
          statusCode,
          reverseShipment:
            rma.reverseShipment,
        },
      });
    } catch (error) {
      return send(
        res,
        Promise.reject(error),
      );
    }
  };

export const updateNdrController = (
  req,
  res,
) =>
  send(
    res,
    submitNdrAction({
      waybill:
        req.params.waybill,
      action:
        req.body?.action,
    }),
  );

export const getNdrStatusController = (
  req,
  res,
) =>
  send(
    res,
    getNdrStatus(
      req.params.requestId,
    ),
  );


const DELHIVERY_NDR_CODES = new Set([
  "EOD-74",
  "EOD-15",
  "EOD-104",
  "EOD-43",
  "EOD-86",
  "EOD-11",
  "EOD-69",
  "EOD-6",
]);

export const getDelhiveryNdrOrdersController =
  async (req, res) => {
    try {
      const filter = {
        fulfillmentStatus: {
          $nin: [
            "delivered",
            "cancelled",
            "returned",
            "rto_delivered",
          ],
        },

        $and: [
          {
            $or: [
              {
                "shipment.provider": {
                  $regex: /^delhivery$/i,
                },
              },
              {
                "shipment.delhivery.waybill": {
                  $exists: true,
                  $nin: ["", null],
                },
              },
              {
                "shipment.delhivery.awb": {
                  $exists: true,
                  $nin: ["", null],
                },
              },
            ],
          },
          {
            $or: [
              {
                "shipment.delhivery.waybill": {
                  $exists: true,
                  $nin: ["", null],
                },
              },
             
        {
                "shipment.delhivery.awb": {
                  $exists: true,
                  $nin: ["", null],
                },
              },
              {
                "shipment.awb": {
                  $exists: true,
                  $nin: ["", null],
                },
              },
            ],
          },
        ],
      };

      const orders = await Order.find(
        filter,
      )
        .select("shipment")
        .lean();

      const waybills = [
        ...new Set(
          orders
            .map(
              (order) =>
                order.shipment
                  ?.delhivery?.waybill ||
                order.shipment
                  ?.delhivery?.awb ||
                order.shipment?.awb ||
                "",
            )
            .filter(Boolean),
        ),
      ];

      const syncErrors = [];

      for (
        let index = 0;
        index < waybills.length;
        index += 50
      ) {
        const batch = waybills.slice(
          index,
          index + 50,
        );

        try {
          const trackingData =
            await trackShipments(batch);

          await syncDelhiveryPayload(
            trackingData,
            "tracking",
          );
        } catch (error) {
          syncErrors.push({
            waybills: batch,

            error:
              error?.response?.data ||
              error?.message ||
              "Tracking sync failed",
          });
        }
      }

      const syncedOrders =
        await Order.find(filter)
          .select(
            [
              "orderNumber",
              "customerId",
              "shippingAddressSnapshot",
              "items",
              "subtotal",
              "discount",
              "shippingFee",
              "tax",
              "totalAmount",
              "finalPayable",
              "currency",
              "paymentMethod",
              "paymentStatus",
              "fulfillmentStatus",
              "shipment",
              "createdAt",
            ].join(" "),
          )
          .populate(
            "customerId",
            "name fullName phone mobile email",
          )
          .sort({ createdAt: -1 })
          .lean();

      const normalizedOrders =
        syncedOrders.map((order) => {
          const shipment =
            order.shipment || {};

          const delhivery =
            shipment.delhivery || {};

          const lastTrack =
            delhivery.lastTrack ||
            shipment.lastTrack ||
            {};

          const lastWebhook =
            delhivery.lastWebhook ||
            shipment.lastWebhook ||
            {};

          const scans = Array.isArray(lastTrack.Scans)
            ? lastTrack.Scans.map(
              (item) => item?.ScanDetail || item || {},
            )
            : [];

          const lastScan = scans.at(-1) || {};

          const ndrScan =
            [...scans].reverse().find((scan) => {
              const code = String(
                scan.StatusCode ||
                scan.NSLCode ||
                "",
              )
                .trim()
                .toUpperCase();

              const text = [
                scan.Scan,
                scan.Status,
                scan.Instructions,
              ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();

              return (
                DELHIVERY_NDR_CODES.has(code) ||
                text.includes("consignee unavailable") ||
                text.includes("undelivered") ||
                text.includes("delivery attempt")
              );
            }) || {};

          const waybill =
            delhivery.waybill ||
            delhivery.awb ||
            shipment.awb ||
            "";

          const statusCode = String(
            lastWebhook?.NSLCode ||
            lastWebhook?.Status?.StatusCode ||
            ndrScan.StatusCode ||
            ndrScan.NSLCode ||
            delhivery.statusCode ||
            shipment.statusCode ||
            lastTrack?.Status?.StatusCode ||
            lastScan.StatusCode ||
            "",
          )
            .trim()
            .toUpperCase();

          const rawStatus = String(
            lastWebhook?.Status?.Status ||
            ndrScan.Scan ||
            ndrScan.Status ||
            delhivery.rawStatus ||
            shipment.rawStatus ||
            lastTrack?.Status?.Status ||
            lastScan.Scan ||
            "Pending",
          ).trim();

          const reason = String(
            lastWebhook?.Status?.Instructions ||
            ndrScan.Instructions ||
            lastTrack?.Status?.Instructions ||
            lastScan.Instructions ||
            rawStatus ||
            "Delivery attempt failed",
          ).trim();

          const ndrText = [
            rawStatus,
            reason,
            ndrScan.Scan,
            ndrScan.Status,
            ndrScan.Instructions,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

          const isNdr =
            DELHIVERY_NDR_CODES.has(statusCode) ||
            ndrText.includes("consignee unavailable") ||
            ndrText.includes("undelivered") ||
            ndrText.includes("delivery attempt");

          const detectedAttempts = scans.filter((scan) => {
            const code = String(
              scan.StatusCode || scan.NSLCode || "",
            )
              .trim()
              .toUpperCase();

            return DELHIVERY_NDR_CODES.has(code);
          }).length;

          const attemptCount =
            Number(
              lastTrack.DispatchCount ??
              lastTrack.attempt_count ??
              lastTrack.attemptCount ??
              delhivery.attemptCount ??
              0,
            ) ||
            detectedAttempts ||
            (isNdr ? 1 : 0);

          const address =
            order.shippingAddressSnapshot ||
            {};

          const customer =
            order.customerId &&
            typeof order.customerId ===
              "object"
              ? order.customerId
              : {};

          const products = (
            Array.isArray(order.items)
              ? order.items
              : []
          ).map((item) => {
            const product =
              item.productSnapshot || {};

            const size =
              item.selectedSize ||
              item.variant?.attributes?.find(
                (attribute) =>
                  String(
                    attribute?.key || "",
                  ).toLowerCase() ===
                  "size",
              )?.value ||
              "";

            return {
              lineId: item.lineId,
              productId:
                item.productId,

              title:
                product.title ||
                "Product",

              productCode:
                product.productCode ||
                "",

              image:
                product.thumbnail ||
                product.images?.[0] ||
                "",

              sku:
                item.variant?.sku ||
                product.sku ||
                "",

              selectedSize: size,
              selectedColor:
                item.selectedColor ||
                "",

              quantity: Number(
                item.quantity || 1,
              ),

              price: Number(
                item.price || 0,
              ),

              subtotal: Number(
                item.subtotal || 0,
              ),
            };
          });

          return {
            _id: order._id,
            orderNumber:
              order.orderNumber,

            createdAt:
              order.createdAt,

            paymentMethod:
              order.paymentMethod,

            paymentStatus:
              order.paymentStatus,

            fulfillmentStatus:
              order.fulfillmentStatus,

            shipment,

            customer: {
              id:
                customer._id ||
                order.customerId ||
                null,

              name:
                address.fullName ||
                customer.fullName ||
                customer.name ||
                "Customer",

              phone:
                address.phone ||
                customer.phone ||
                customer.mobile ||
                "",

              email:
                address.email ||
                customer.email ||
                "",
            },

            shippingAddress: {
              name:
                address.fullName || "",

              phone:
                address.phone || "",

              email:
                address.email || "",

              line1:
                address.line1 || "",

              line2:
                address.line2 || "",

              city:
                address.city || "",

              state:
                address.state || "",

              country:
                address.country ||
                "India",

              pincode:
                address.pincode || "",
            },

            products,

            pricing: {
              subtotal: Number(
                order.subtotal || 0,
              ),

              discount: Number(
                order.discount || 0,
              ),

              shippingFee: Number(
                order.shippingFee || 0,
              ),

              tax: Number(
                order.tax || 0,
              ),

              totalAmount: Number(
                order.totalAmount || 0,
              ),

              finalPayable: Number(
                order.finalPayable ||
                  order.totalAmount ||
                  0,
              ),

              currency:
                order.currency || "INR",
            },

            ndr: {
              waybill,
              statusCode,
              rawStatus,
              reason,
              attemptCount,
              eligible:
                isNdr &&
                [1, 2].includes(attemptCount),
              allowedActions: ["RE-ATTEMPT"],
            },
          };
        });

      const ndrOrders =
        normalizedOrders.filter(
          (order) =>
            order.ndr.eligible,
        );

      return res.status(200).json({
        success: true,
        message:
          "Delhivery orders synced successfully",

        data: {
          totalOrders: normalizedOrders.length,
          totalWaybills: waybills.length,
          totalBatches: Math.ceil(
            waybills.length / 50,
          ),
          totalNdrOrders: ndrOrders.length,
          ndrOrders,
          orders: normalizedOrders,
          syncErrors,
        },
      });
    } catch (error) {
      console.error(
        "[Delhivery] NDR sync error:",
        error,
      );

      return res.status(500).json({
        success: false,

        message:
          "Unable to sync Delhivery NDR orders",

        error:
          error?.response?.data ||
          error?.message,
      });
    }
  };




export const getCustomerNdrOrderController = async (
  req,
  res,
) => {
  try {
    const orderNumber = String(
      req.params.token || "",
    ).trim();

    const order = await Order.findOne({
      orderNumber,
      "shipment.provider": "delhivery",
    })
      .select(
        [
          "orderNumber",
          "shippingAddressSnapshot",
          "items",
          "subtotal",
          "discount",
          "shippingFee",
          "tax",
          "totalAmount",
          "finalPayable",
          "paymentMethod",
          "paymentStatus",
          "fulfillmentStatus",
          "shipment",
        ].join(" "),
      )
      .lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const shipment = order.shipment || {};
    const delhivery = shipment.delhivery || {};
    const webhook =
      delhivery.lastWebhook ||
      shipment.lastWebhook ||
      {};
    const track =
      delhivery.lastTrack ||
      shipment.lastTrack ||
      {};

    const statusCode = String(
      webhook.NSLCode ||
      delhivery.statusCode ||
      shipment.statusCode ||
      track?.Status?.StatusCode ||
      "",
    )
      .trim()
      .toUpperCase();

    const attemptCount = Number(
      track.DispatchCount ??
      track.attempt_count ??
      track.attemptCount ??
      delhivery.attemptCount ??
      0,
    );

    const rawStatus = String(
      webhook?.Status?.Status ||
      track?.Status?.Status ||
      delhivery.rawStatus ||
      shipment.rawStatus ||
      "Pending",
    ).trim();

    const reason = String(
      webhook?.Status?.Instructions ||
      track?.Status?.Instructions ||
      webhook?.Instructions ||
      delhivery.reason ||
      rawStatus ||
      "Delivery attempt failed",
    ).trim();

    return res.json({
      success: true,
      data: {
        ...order,
        ndr: {
          waybill:
            delhivery.waybill ||
            delhivery.awb ||
            shipment.awb ||
            "",
          statusCode,
          rawStatus,
          reason,
          attemptCount,
          eligible:
            DELHIVERY_NDR_CODES.has(statusCode) &&
            [1, 2].includes(attemptCount),
          allowedActions: ["RE-ATTEMPT"],
        },
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        error?.message ||
        "Unable to fetch NDR order",
    });
  }
};

export const submitCustomerNdrActionController =
  async (req, res) => {
    try {
      const orderNumber = String(
        req.params.token || "",
      ).trim();

      const action = String(
        req.body?.action || "",
      )
        .trim()
        .toUpperCase();

      if (action !== "RE-ATTEMPT") {
        return res.status(400).json({
          success: false,
          message:
            "Only delivery reattempt is supported",
        });
      }

      const order = await Order.findOne({
        orderNumber,
        "shipment.provider":
          "delhivery",
        fulfillmentStatus: {
          $in: [
            "packed",
            "shipped",
            "out_for_delivery",
          ],
        },
      });

      if (!order) {
        return res.status(404).json({
          success: false,
          message:
            "Eligible Delhivery order not found",
        });
      }

      const delhivery =
        order.shipment?.delhivery || {};

      const waybill =
        delhivery.waybill ||
        delhivery.awb ||
        order.shipment?.awb;

      const statusCode = String(
        delhivery.statusCode ||
        delhivery.lastWebhook
          ?.NSLCode ||
        order.shipment?.statusCode ||
        "",
      )
        .trim()
        .toUpperCase();

      if (!waybill) {
        return res.status(400).json({
          success: false,
          message:
            "Delhivery waybill not found",
        });
      }

      if (
        !DELHIVERY_NDR_CODES.has(
          statusCode,
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Order is not eligible for reattempt",
        });
      }

      const result =
        await submitNdrAction({
          waybill,
          action: "RE-ATTEMPT",
        });

      return res.status(200).json({
        success: true,
        message:
          "Delivery reattempt requested successfully",
        data: {
          requestId:
            result?.requestId ||
            result?.upl ||
            result?.data?.upl ||
            null,

          providerResponse: result,

          order: {
            _id: order._id,
            orderNumber:
              order.orderNumber,
            fulfillmentStatus:
              order.fulfillmentStatus,
            shipment: order.shipment,
          },
        },
      });
    } catch (error) {
      console.error(
        "[Delhivery] Customer NDR action error:",
        error,
      );

      return res.status(
        error?.response?.status || 500,
      ).json({
        success: false,
        message:
          error?.response?.data
            ?.message ||
          error?.message ||
          "Unable to submit reattempt request",
      });
    }
  };
