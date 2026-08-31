import {
  createShipment,
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

export const pickupController = (
  req,
  res,
) =>
  send(
    res,
    createPickup(req.body),
    201,
  );
