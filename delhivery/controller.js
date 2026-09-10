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
          "_id orderNumber fulfillmentStatus shipment",
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

  const rawStatus = String(
    statusData?.Status ||
    statusData?.Instructions ||
    shipment?.status ||
    "",
  ).trim();

  const statusCode = String(
    statusData?.StatusCode ||
    statusData?.StatusType ||
    shipment?.status_code ||
    "",
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
