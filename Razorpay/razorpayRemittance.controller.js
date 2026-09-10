import axios from "axios";
import crypto from "crypto";

import Order from "../Orders/Orders.js";
import Remittance from "../Remittance/Remittance.js";

const clean = (value) =>
  String(value ?? "").trim();

const normalize = (value) =>
  clean(value).toLowerCase();

const money = (value) =>
  Number(
    (
      Number(value || 0) /
      100
    ).toFixed(2)
  );

const roundAmount = (value) =>
  Number(
    Number(value || 0).toFixed(2)
  );

const parseRazorpayDate = (
  value
) => {
  if (!value) return null;

  const timestamp =
    Number(value);

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const date = new Date(
    timestamp * 1000
  );

  return Number.isNaN(
    date.getTime()
  )
    ? null
    : date;
};

const normalizeOrderNumber = (
  value
) =>
  clean(value).toUpperCase();

const getShippingNo = (
  order = {}
) =>
  clean(
    order?.shipment?.shiprocket
      ?.awb ||
    order?.shipment?.delhivery
      ?.awb ||
    order?.shipment?.xpressbees
      ?.awb ||
    order?.shipment?.awb ||
    order?.trackingDetails
      ?.trackingId
  );

const getDeliveredDate = (
  order = {}
) =>
  order?.shipment?.deliveredAt ||
  order?.trackingDetails
    ?.deliveredAt ||
  null;

const getOrderPaymentMethod = (
  order = {}
) =>
  normalize(
    order.paymentMethod
  ).replace(/\s+/g, "_");

const getOrderExpectedAmount = (
  order = {}
) => {
  const candidates = [
    order.finalPayable,
    order.totalAmount,
    order.grandTotal,
  ];

  for (const value of candidates) {
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      continue;
    }

    const amount = Number(value);

    if (
      Number.isFinite(amount)
    ) {
      return roundAmount(
        amount
      );
    }
  }

  return 0;
};

const fetchSettlementRecon = async ({
  year,
  month,
  day,
}) => {
  const { data } =
    await axios.get(
      "https://api.razorpay.com/v1/settlements/recon/combined",
      {
        auth: {
          username:
            process.env
              .RAZORPAY_KEY_ID,

          password:
            process.env
              .RAZORPAY_KEY_SECRET,
        },

        params: {
          year,
          month,

          ...(day
            ? { day }
            : {}),
        },

        timeout: 30000,
      }
    );

  return Array.isArray(
    data?.items
  )
    ? data.items
    : [];
};

/**
 * POST /api/razorpay/reports/remittance/sync
 *
 * body:
 * {
 *   year: 2026,
 *   month: 9,
 *   day?: 10,
 *   settlementId?: "setl_xxx"
 * }
 */
export const syncRazorpayRemittance =
  async (req, res) => {
    const syncBatchId =
      crypto.randomUUID();

    try {
      const now = new Date();

      const year = Number(
        req.body?.year ||
        now.getFullYear()
      );

      const month = Number(
        req.body?.month ||
        now.getMonth() + 1
      );

      const day = req.body?.day
        ? Number(req.body.day)
        : undefined;

      const settlementIdFilter =
        clean(
          req.body?.settlementId
        );

      if (
        !Number.isInteger(year) ||
        year < 2020 ||
        year > 2100
      ) {
        return res
          .status(400)
          .json({
            success: false,
            code: "INVALID_YEAR",
            message:
              "Valid year is required",
          });
      }

      if (
        !Number.isInteger(month) ||
        month < 1 ||
        month > 12
      ) {
        return res
          .status(400)
          .json({
            success: false,
            code:
              "INVALID_MONTH",
            message:
              "Month must be between 1 and 12",
          });
      }

      if (
        day !== undefined &&
        (
          !Number.isInteger(day) ||
          day < 1 ||
          day > 31
        )
      ) {
        return res
          .status(400)
          .json({
            success: false,
            code: "INVALID_DAY",
            message:
              "Day must be between 1 and 31",
          });
      }

      let items =
        await fetchSettlementRecon({
          year,
          month,
          day,
        });

      if (settlementIdFilter) {
        items = items.filter(
          (item) =>
            clean(
              item.settlement_id
            ) ===
            settlementIdFilter
        );
      }

      /*
       * Existing Remittance model stores
       * one current entry per order.
       *
       * Only payment rows for fully
       * prepaid orders are processed.
       */
      const paymentRows =
        items.filter(
          (item) =>
            normalize(item.type) ===
            "payment" &&
            clean(
              item.order_receipt
            )
        );

      const processedRows = [];
      const duplicateRows = [];
      const unmappedRows = [];
      const skippedRows = [];
      const reviewRows = [];
      const failedRows = [];

      for (
        const item of paymentRows
      ) {
        const orderNumber =
          normalizeOrderNumber(
            item.order_receipt
          );

        try {
          const order =
            await Order.findOne({
              orderNumber,
            }).lean();

          if (!order) {
            unmappedRows.push({
              orderNumber,

              settlementId:
                clean(
                  item.settlement_id
                ),

              reason:
                "Order not found",
            });

            continue;
          }

          const paymentMethod =
            getOrderPaymentMethod(
              order
            );

          /*
           * Do not write partial COD
           * Razorpay advance into this
           * single-record Remittance model.
           */
          if (
            paymentMethod ===
            "partial_cod" ||
            paymentMethod ===
            "cod"
          ) {
            skippedRows.push({
              orderNumber,

              paymentMethod,

              settlementId:
                clean(
                  item.settlement_id
                ),

              reason:
                paymentMethod ===
                  "partial_cod"
                  ? "Partial COD Razorpay advance skipped to prevent courier remittance overwrite"
                  : "COD order skipped from Razorpay remittance sync",
            });

            continue;
          }

          if (
            ![
              "razorpay",
              "prepaid",
              "online",
            ].includes(
              paymentMethod
            )
          ) {
            skippedRows.push({
              orderNumber,

              paymentMethod,

              settlementId:
                clean(
                  item.settlement_id
                ),

              reason:
                "Order is not recognised as prepaid",
            });

            continue;
          }

          const settlementId =
            clean(
              item.settlement_id
            );

          const grossAmount =
            money(item.amount);

          const fee =
            money(
              item.fee ??
              item.fees
            );

          const tax =
            money(item.tax);

          const calculatedNet =
            roundAmount(
              grossAmount -
              fee -
              tax
            );

          const reportedCredit =
            money(item.credit);

          /*
           * Credit is the actual bank
           * settlement amount when present.
           */
          const receivedAmount =
            reportedCredit > 0
              ? reportedCredit
              : calculatedNet;

          const expectedBankAmount =
            calculatedNet;

          const differenceAmount =
            roundAmount(
              receivedAmount -
              expectedBankAmount
            );

          const orderExpectedAmount =
            getOrderExpectedAmount(
              order
            );

          const orderAmountDifference =
            roundAmount(
              grossAmount -
              orderExpectedAmount
            );

          const amountMatchesOrder =
            Math.abs(
              orderAmountDifference
            ) <= 1;

          const settledAt =
            parseRazorpayDate(
              item.settled_at
            );

          if (
            !settlementId ||
            !settledAt ||
            grossAmount <= 0
          ) {
            reviewRows.push({
              orderNumber,
              settlementId,

              reason:
                "Settlement ID, amount or settlement date is missing",
            });

            continue;
          }

          if (
            !amountMatchesOrder
          ) {
            reviewRows.push({
              orderNumber,
              settlementId,

              orderExpectedAmount,
              razorpayGrossAmount:
                grossAmount,

              difference:
                orderAmountDifference,

              reason:
                "Razorpay payment amount does not match order final payable",
            });

            continue;
          }

          const existing =
            await Remittance.findOne({
              orderNumber,
            })
              .select(
                "_id source providerReference reconciliationStatus isRemitted"
              )
              .lean();

          if (
            existing?.source &&
            existing.source !==
            "razorpay"
          ) {
            skippedRows.push({
              orderNumber,
              settlementId,

              existingSource:
                existing.source,

              reason:
                "Existing courier or manual remittance was not overwritten",
            });

            continue;
          }

          if (
            existing?.source ===
            "razorpay" &&
            existing
              .providerReference ===
            settlementId &&
            existing.isRemitted ===
            true
          ) {
            duplicateRows.push({
              orderNumber,
              settlementId,

              remittanceId:
                existing._id,

              reason:
                "Razorpay remittance already synced",
            });

            continue;
          }

          const remittanceData = {
            ewayBillId: "",

            shippingNo:
              getShippingNo(
                order
              ),

            orderNumber,

            deliveredDate:
              getDeliveredDate(
                order
              ),

            orderType:
              "razorpay",

            remittanceDate:
              settledAt,

            remittedAmount:
              receivedAmount,

            source:
              "razorpay",

            reportType:
              "razorpay_settlement_recon",

            providerReference:
              settlementId,

            utr: "",

            /*
             * Expected and received here
             * represent bank settlement
             * after Razorpay fee and tax.
             */
            expectedAmount:
              expectedBankAmount,

            receivedAmount,

            differenceAmount,

            adjustedAmount:
              roundAmount(
                fee + tax
              ),

            reconciliationStatus:
              Math.abs(
                differenceAmount
              ) <= 1
                ? "fully_remitted"
                : "needs_review",

            isRemitted:
              Math.abs(
                differenceAmount
              ) <= 1,

            requiresReview:
              Math.abs(
                differenceAmount
              ) > 1,

            matchedOrderId:
              order._id,

            matchType:
              "order_number",

            importBatchId:
              syncBatchId,

            importRowNumber:
              null,

            rawRow: {
              settlementId,

              orderReceipt:
                orderNumber,

              razorpayOrderId:
                clean(
                  item.order_id
                ),

              paymentId:
                clean(
                  item.payment_id ||
                  item.entity_id
                ),

              method:
                clean(item.method),

              type:
                clean(item.type),

              description:
                clean(
                  item.description
                ),

              grossAmount,

              fee,

              tax,

              expectedBankAmount,

              receivedAmount,

              debit:
                money(item.debit),

              credit:
                reportedCredit,

              settledAtRaw:
                item.settled_at,
            },
          };

          const saved =
            await Remittance.findOneAndUpdate(
              {
                orderNumber,
              },
              {
                $set:
                  remittanceData,
              },
              {
                new: true,
                upsert: true,
                runValidators: true,
                setDefaultsOnInsert:
                  true,
              }
            ).lean();

          processedRows.push({
            remittanceId:
              saved._id,

            orderNumber,

            settlementId,

            grossAmount,

            fee,

            tax,

            expectedBankAmount,

            receivedAmount,

            differenceAmount,

            status:
              saved.reconciliationStatus,
          });
        } catch (rowError) {
          failedRows.push({
            orderNumber,

            settlementId:
              clean(
                item.settlement_id
              ),

            reason:
              rowError.message,
          });
        }
      }

      return res
        .status(200)
        .json({
          success: true,

          message:
            "Razorpay remittance sync completed",

          data: {
            syncBatchId,

            filters: {
              year,
              month,
              day: day || null,

              settlementId:
                settlementIdFilter,
            },

            stats: {
              apiRows:
                items.length,

              paymentRows:
                paymentRows.length,

              processed:
                processedRows.length,

              duplicates:
                duplicateRows.length,

              unmapped:
                unmappedRows.length,

              skipped:
                skippedRows.length,

              needsReview:
                reviewRows.length,

              failed:
                failedRows.length,
            },

            processedRows,

            duplicateRows,

            unmappedRows,

            skippedRows,

            reviewRows,

            failedRows,
          },
        });
    } catch (error) {
      console.error(
        "syncRazorpayRemittance error:",
        error?.response?.data ||
        error
      );

      return res
        .status(
          error?.response?.status ||
          500
        )
        .json({
          success: false,

          code:
            "RAZORPAY_REMITTANCE_SYNC_FAILED",

          message:
            error?.response?.data
              ?.error
              ?.description ||
            error.message ||
            "Failed to sync Razorpay remittance",
        });
    }
  };
