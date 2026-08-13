import "dotenv/config";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";

import Order from "../Orders/Order.js";
// ⚠️ apne actual Order model import path ke according adjust kar lena.

// ============================================================================
// CONFIG
// ============================================================================

const DRY_RUN =
  String(process.env.DRY_RUN ?? "true").toLowerCase() !== "false";

const GST_RATE = 5;
const GST_DIVISOR = 1 + GST_RATE / 100;

// Extra safety:
// Run only orders created BEFORE this script rollout.
// Recommended: set exact deployment date/time in env.
const CREATED_BEFORE = process.env.CREATED_BEFORE
  ? new Date(process.env.CREATED_BEFORE)
  : null;

// Optional:
// backfill only specific order
const ONLY_ORDER_NUMBER = String(
  process.env.ONLY_ORDER_NUMBER || "",
).trim();

// Maximum orders in one execution.
// Start with 10 → 100 → 500 → all.
const LIMIT = Math.max(
  1,
  Number(process.env.LIMIT || 10),
);

// If order changes by more than this amount during reconciliation,
// skip it instead of updating.
const MONEY_TOLERANCE = 0.1;

// Hard safety:
// NEVER touch these statuses.
const BLOCKED_STATUSES = new Set([
  "exchange_requested",
  "returned",
  "exchanged",
]);

// ============================================================================
// HELPERS
// ============================================================================

const round2 = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const nearlyEqual = (a, b, tolerance = MONEY_TOLERANCE) =>
  Math.abs(round2(a) - round2(b)) <= tolerance;

const log = (...args) => console.log(...args);

const safeStatus = (value) =>
  String(value || "").trim().toLowerCase();

const nowStamp = () =>
  new Date().toISOString().replace(/[:.]/g, "-");

const auditDir = path.resolve(
  process.cwd(),
  "backfill-audit",
);

if (!fs.existsSync(auditDir)) {
  fs.mkdirSync(auditDir, {
    recursive: true,
  });
}

const runId = nowStamp();

const auditPath = path.join(
  auditDir,
  `order-pricing-backfill-${runId}.json`,
);

const audit = {
  runId,
  dryRun: DRY_RUN,
  startedAt: new Date().toISOString(),

  config: {
    gstRate: GST_RATE,
    createdBefore: CREATED_BEFORE?.toISOString() || null,
    onlyOrderNumber: ONLY_ORDER_NUMBER || null,
    limit: LIMIT,
  },

  summary: {
    scanned: 0,
    eligible: 0,
    updated: 0,
    wouldUpdate: 0,
    alreadyCorrect: 0,
    skipped: 0,
    errors: 0,
  },

  orders: [],
};

const saveAudit = () => {
  fs.writeFileSync(
    auditPath,
    JSON.stringify(audit, null, 2),
    "utf8",
  );
};

// ============================================================================
// DETERMINE ORIGINAL ITEM VALUE
// ============================================================================

function getOriginalItemPricing(item = {}) {
  const qty = Math.max(
    1,
    num(item.quantity) || 1,
  );

  // --------------------------------------------------
  // SAFEST CASE:
  // already has original snapshot
  // --------------------------------------------------

  if (num(item.originalSubtotal) > 0) {
    const originalSubtotal = round2(
      item.originalSubtotal,
    );

    const originalPrice =
      num(item.originalPrice) > 0
        ? round2(item.originalPrice)
        : round2(originalSubtotal / qty);

    return {
      qty,
      originalPrice,
      originalSubtotal,
      source: "existing_original_snapshot",
    };
  }

  if (num(item.originalPrice) > 0) {
    const originalPrice = round2(
      item.originalPrice,
    );

    return {
      qty,
      originalPrice,
      originalSubtotal: round2(
        originalPrice * qty,
      ),
      source: "existing_original_price",
    };
  }

  // --------------------------------------------------
  // OLD ORDER:
  // price/subtotal are assumed original purchase values
  // --------------------------------------------------

  const storedPrice = num(item.price);
  const storedSubtotal = num(item.subtotal);

  if (storedPrice <= 0 && storedSubtotal <= 0) {
    throw new Error(
      "Item has no usable price/subtotal.",
    );
  }

  const originalSubtotal =
    storedSubtotal > 0
      ? round2(storedSubtotal)
      : round2(storedPrice * qty);

  const originalPrice =
    storedPrice > 0
      ? round2(storedPrice)
      : round2(originalSubtotal / qty);

  // --------------------------------------------------
  // Critical consistency validation
  // --------------------------------------------------

  const expectedFromUnit = round2(
    originalPrice * qty,
  );

  if (
    !nearlyEqual(
      expectedFromUnit,
      originalSubtotal,
      0.5,
    )
  ) {
    throw new Error(
      `Item price mismatch: price × qty=${expectedFromUnit}, subtotal=${originalSubtotal}`,
    );
  }

  return {
    qty,
    originalPrice,
    originalSubtotal,
    source: "legacy_price_snapshot",
  };
}

// ============================================================================
// BUILD BACKFILL
// ============================================================================

function calculateBackfill(order) {
  if (!Array.isArray(order.items)) {
    throw new Error("Order items missing.");
  }

  if (!order.items.length) {
    throw new Error("Order has zero items.");
  }

  const status = safeStatus(
    order.fulfillmentStatus,
  );

  if (BLOCKED_STATUSES.has(status)) {
    throw new Error(
      `Blocked fulfillment status: ${status}`,
    );
  }

  // ============================================================
  // 1. Reconstruct original item values
  // ============================================================

  const originals = order.items.map(
    (item, index) => ({
      index,
      ...getOriginalItemPricing(item),
    }),
  );

  const grossSubtotal = round2(
    originals.reduce(
      (sum, item) =>
        sum + item.originalSubtotal,
      0,
    ),
  );

  if (grossSubtotal <= 0) {
    throw new Error(
      "Calculated gross subtotal <= 0.",
    );
  }

  // ============================================================
  // 2. Validate against stored order subtotal
  // ============================================================

  const storedOrderSubtotal = num(
    order.subtotal,
  );

  // We accept either:
  // A) stored subtotal matches gross subtotal
  // B) subtotal missing/zero
  //
  // Anything materially different is suspicious.
  if (
    storedOrderSubtotal > 0 &&
    !nearlyEqual(
      storedOrderSubtotal,
      grossSubtotal,
      1,
    )
  ) {
    throw new Error(
      `Order subtotal mismatch. stored=${storedOrderSubtotal}, reconstructed=${grossSubtotal}`,
    );
  }

  // ============================================================
  // 3. Order discount
  // ============================================================

  const storedDiscount = Math.max(
    0,
    num(
      order.discount ??
      order.coupon?.discount ??
      0,
    ),
  );

  const discount = round2(
    Math.min(
      storedDiscount,
      grossSubtotal,
    ),
  );

  // ============================================================
  // 4. Allocate discount across items proportionately
  // ============================================================

  let allocatedDiscount = 0;

  const newItems = order.items.map(
    (item, index) => {
      const original = originals[index];

      let itemDiscount = 0;

      if (
        discount > 0 &&
        grossSubtotal > 0
      ) {
        if (
          index ===
          order.items.length - 1
        ) {
          // Last item gets rounding remainder
          itemDiscount = round2(
            discount -
            allocatedDiscount,
          );
        } else {
          itemDiscount = round2(
            discount *
            (original.originalSubtotal /
              grossSubtotal),
          );

          allocatedDiscount = round2(
            allocatedDiscount +
            itemDiscount,
          );
        }
      }

      itemDiscount = round2(
        Math.min(
          Math.max(0, itemDiscount),
          original.originalSubtotal,
        ),
      );

      const discountedSubtotal = round2(
        original.originalSubtotal -
        itemDiscount,
      );

      const discountedUnitPrice =
        round2(
          discountedSubtotal /
          original.qty,
        );

      const taxableValue = round2(
        discountedSubtotal /
        GST_DIVISOR,
      );

      const taxAmount = round2(
        discountedSubtotal -
        taxableValue,
      );

      return {
        ...item.toObject?.(),
        ...(item.toObject
          ? {}
          : item),

        quantity: original.qty,

        originalPrice:
          original.originalPrice,

        originalSubtotal:
          original.originalSubtotal,

        discountAmount:
          itemDiscount,

        price:
          discountedUnitPrice,

        subtotal:
          discountedSubtotal,

        taxRate:
          GST_RATE,

        taxableValue,
        taxAmount,
      };
    },
  );

  // ============================================================
  // 5. Reconcile totals
  // ============================================================

  const discountedProductTotal =
    round2(
      newItems.reduce(
        (sum, item) =>
          sum +
          num(item.subtotal),
        0,
      ),
    );

  const totalTax = round2(
    newItems.reduce(
      (sum, item) =>
        sum +
        num(item.taxAmount),
      0,
    ),
  );

  const shippingFee = round2(
    Math.max(
      0,
      num(order.shippingFee),
    ),
  );

  const totalAmount = round2(
    discountedProductTotal +
    shippingFee,
  );

  // ============================================================
  // 6. CRITICAL FINAL PAYABLE PROTECTION
  // ============================================================

  const existingFinalPayable = round2(
    num(order.finalPayable),
  );

  const walletAmount = round2(
    Math.max(
      0,
      num(
        order.walletCredit?.amount ??
        order.paymentBreakdown
          ?.walletAmount ??
        0,
      ),
    ),
  );

  const calculatedFinalPayable = round2(
    Math.max(
      0,
      totalAmount - walletAmount,
    ),
  );

  // ------------------------------------------------------------
  // This is the BIGGEST SAFETY GUARD.
  //
  // We do NOT want historical backfill changing the amount
  // customer actually paid.
  //
  // If calculated payable doesn't reconcile with existing
  // historical payable -> SKIP ORDER.
  // ------------------------------------------------------------

  if (
    existingFinalPayable > 0 &&
    !nearlyEqual(
      existingFinalPayable,
      calculatedFinalPayable,
      1,
    )
  ) {
    throw new Error(
      [
        "FINAL PAYABLE RECONCILIATION FAILED",
        `stored=${existingFinalPayable}`,
        `calculated=${calculatedFinalPayable}`,
        `gross=${grossSubtotal}`,
        `discount=${discount}`,
        `shipping=${shippingFee}`,
        `wallet=${walletAmount}`,
      ].join(" | "),
    );
  }

  // ============================================================
  // 7. Discount reconciliation
  // ============================================================

  const allocatedTotal = round2(
    newItems.reduce(
      (sum, item) =>
        sum +
        num(item.discountAmount),
      0,
    ),
  );

  if (
    !nearlyEqual(
      allocatedTotal,
      discount,
      0.05,
    )
  ) {
    throw new Error(
      `Discount allocation mismatch. order=${discount}, allocated=${allocatedTotal}`,
    );
  }

  // ============================================================
  // 8. Tax reconciliation
  // ============================================================

  const taxableTotal = round2(
    newItems.reduce(
      (sum, item) =>
        sum +
        num(item.taxableValue),
      0,
    ),
  );

  if (
    !nearlyEqual(
      taxableTotal + totalTax,
      discountedProductTotal,
      0.1,
    )
  ) {
    throw new Error(
      `GST reconciliation failed. taxable=${taxableTotal}, tax=${totalTax}, product=${discountedProductTotal}`,
    );
  }

  return {
    items: newItems,

    subtotal: grossSubtotal,
    discount,

    // GST INCLUDED inside item/product value
    tax: totalTax,

    shippingFee,
    totalAmount,

    // Preserve existing historical payable whenever available.
    finalPayable:
      existingFinalPayable > 0
        ? existingFinalPayable
        : calculatedFinalPayable,

    meta: {
      grossSubtotal,
      discount,
      discountedProductTotal,
      taxableTotal,
      totalTax,
      shippingFee,
      walletAmount,
      calculatedFinalPayable,
      existingFinalPayable,
    },
  };
}

// ============================================================================
// CHECK WHETHER ALREADY BACKFILLED
// ============================================================================

function alreadyBackfilled(order) {
  if (
    !Array.isArray(order.items) ||
    !order.items.length
  ) {
    return false;
  }

  return order.items.every(
    (item) =>
      num(item.originalPrice) > 0 &&
      num(item.originalSubtotal) > 0 &&
      item.discountAmount !== undefined &&
      item.discountAmount !== null &&
      num(item.taxRate) === GST_RATE &&
      item.taxableValue !== undefined &&
      item.taxAmount !== undefined,
  );
}

// ============================================================================
// DB QUERY
// ============================================================================

function buildQuery() {
  const query = {};

  if (ONLY_ORDER_NUMBER) {
    query.orderNumber =
      ONLY_ORDER_NUMBER;
  }

  if (CREATED_BEFORE) {
    query.createdAt = {
      $lt: CREATED_BEFORE,
    };
  }

  // Exchange orders don't exist currently,
  // but still hard exclude them for future safety.
  query.paymentMethod = {
    $ne: "exchange",
  };

  query.fulfillmentStatus = {
    $nin: Array.from(
      BLOCKED_STATUSES,
    ),
  };

  return query;
}

// ============================================================================
// SAFE UPDATE
// ============================================================================

async function updateOrderSafely(
  order,
  result,
) {
  // ----------------------------------------------------------------
  // Optimistic concurrency protection:
  //
  // Update only if updatedAt is STILL same as when we read the order.
  // If another process edited it during backfill -> update fails safely.
  // ----------------------------------------------------------------

  const filter = {
    _id: order._id,
  };

  if (order.updatedAt) {
    filter.updatedAt =
      order.updatedAt;
  }

  const update = {
    $set: {
      items: result.items,

      subtotal: result.subtotal,
      discount: result.discount,

      tax: result.tax,

      shippingFee:
        result.shippingFee,

      totalAmount:
        result.totalAmount,

      finalPayable:
        result.finalPayable,
    },
  };

  const response =
    await Order.updateOne(
      filter,
      update,
      {
        runValidators: true,
      },
    );

  if (
    response.matchedCount !== 1
  ) {
    throw new Error(
      "Optimistic concurrency check failed. Order changed while script was running.",
    );
  }

  if (
    response.modifiedCount !== 1
  ) {
    throw new Error(
      "Mongo matched order but did not modify it.",
    );
  }

  return response;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const mongoUri =
    process.env.MONGODB_URI ||
    process.env.MONGO_URI;

  if (!mongoUri) {
    throw new Error(
      "MONGODB_URI / MONGO_URI missing.",
    );
  }

  log("\n============================================");
  log("ORDER PRICING BACKFILL");
  log("============================================");

  log(
    `Mode           : ${DRY_RUN
      ? "🟡 DRY RUN"
      : "🔴 LIVE UPDATE"
    }`,
  );

  log(
    `GST            : ${GST_RATE}% inclusive`,
  );

  log(
    `Limit          : ${LIMIT}`,
  );

  log(
    `Created before : ${CREATED_BEFORE?.toISOString() ||
    "NOT SET"
    }`,
  );

  log(
    `Order only     : ${ONLY_ORDER_NUMBER ||
    "ALL MATCHING"
    }`,
  );

  if (!DRY_RUN) {
    log("");
    log(
      "⚠️ LIVE MODE ENABLED",
    );
  }

  log("============================================\n");

  await mongoose.connect(
    mongoUri,
  );

  log("✅ MongoDB connected\n");

  const query = buildQuery();

  const orders =
    await Order.find(query)
      .sort({
        createdAt: 1,
      })
      .limit(LIMIT);

  log(
    `Found ${orders.length} candidate orders.\n`,
  );

  for (const order of orders) {
    audit.summary.scanned += 1;

    const entry = {
      orderId:
        String(order._id),

      orderNumber:
        order.orderNumber,

      createdAt:
        order.createdAt,

      status:
        order.fulfillmentStatus,

      result: null,
      reason: null,
      before: null,
      after: null,
    };

    try {
      log(
        `→ #${order.orderNumber}`,
      );

      // ----------------------------------------------------------
      // Already migrated
      // ----------------------------------------------------------

      if (
        alreadyBackfilled(order)
      ) {
        entry.result =
          "already_correct";

        audit.summary.alreadyCorrect +=
          1;

        log(
          "  ⏭ Already backfilled\n",
        );

        audit.orders.push(
          entry,
        );

        saveAudit();

        continue;
      }

      audit.summary.eligible +=
        1;

      entry.before = {
        subtotal:
          order.subtotal,

        discount:
          order.discount,

        tax:
          order.tax,

        shippingFee:
          order.shippingFee,

        totalAmount:
          order.totalAmount,

        finalPayable:
          order.finalPayable,

        items:
          order.items.map(
            (item) => ({
              price:
                item.price,

              subtotal:
                item.subtotal,

              quantity:
                item.quantity,

              originalPrice:
                item.originalPrice,

              originalSubtotal:
                item.originalSubtotal,

              discountAmount:
                item.discountAmount,

              taxableValue:
                item.taxableValue,

              taxAmount:
                item.taxAmount,
            }),
          ),
      };

      // ----------------------------------------------------------
      // Calculation + validations
      // ----------------------------------------------------------

      const result =
        calculateBackfill(
          order,
        );

      entry.after = {
        subtotal:
          result.subtotal,

        discount:
          result.discount,

        tax:
          result.tax,

        shippingFee:
          result.shippingFee,

        totalAmount:
          result.totalAmount,

        finalPayable:
          result.finalPayable,

        items:
          result.items.map(
            (item) => ({
              price:
                item.price,

              subtotal:
                item.subtotal,

              quantity:
                item.quantity,

              originalPrice:
                item.originalPrice,

              originalSubtotal:
                item.originalSubtotal,

              discountAmount:
                item.discountAmount,

              taxableValue:
                item.taxableValue,

              taxAmount:
                item.taxAmount,
            }),
          ),
      };

      // ----------------------------------------------------------
      // DRY RUN
      // ----------------------------------------------------------

      if (DRY_RUN) {
        entry.result =
          "would_update";

        audit.summary.wouldUpdate +=
          1;

        log(
          `  🟡 WOULD UPDATE`,
        );

        log(
          `     Gross       : ₹${result.meta.grossSubtotal}`,
        );

        log(
          `     Discount    : ₹${result.meta.discount}`,
        );

        log(
          `     Product     : ₹${result.meta.discountedProductTotal}`,
        );

        log(
          `     Taxable     : ₹${result.meta.taxableTotal}`,
        );

        log(
          `     GST         : ₹${result.meta.totalTax}`,
        );

        log(
          `     Payable     : ₹${result.finalPayable}`,
        );

        log("");

        audit.orders.push(
          entry,
        );

        saveAudit();

        continue;
      }

      // ----------------------------------------------------------
      // LIVE WRITE
      // ----------------------------------------------------------

      await updateOrderSafely(
        order,
        result,
      );

      entry.result =
        "updated";

      audit.summary.updated += 1;

      log(
        `  ✅ UPDATED\n`,
      );

      audit.orders.push(
        entry,
      );

      // Save after every order.
      // Even if script crashes midway, audit remains available.
      saveAudit();
    } catch (error) {
      entry.result = "skipped";
      entry.reason =
        error?.message ||
        String(error);

      audit.summary.skipped +=
        1;

      log(
        `  🛑 SKIPPED: ${entry.reason}\n`,
      );

      audit.orders.push(
        entry,
      );

      saveAudit();
    }
  }

  audit.finishedAt =
    new Date().toISOString();

  saveAudit();

  log("\n============================================");
  log("DONE");
  log("============================================");

  log(
    JSON.stringify(
      audit.summary,
      null,
      2,
    ),
  );

  log(
    `\nAudit: ${auditPath}`,
  );

  log(
    `Mode : ${DRY_RUN
      ? "DRY RUN - DATABASE UNCHANGED"
      : "LIVE"
    }`,
  );

  await mongoose.disconnect();
}

// ============================================================================
// PROCESS SAFETY
// ============================================================================

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch(async (error) => {
    console.error(
      "\n❌ BACKFILL FATAL ERROR:",
      error,
    );

    audit.summary.errors += 1;
    audit.fatalError =
      error?.stack ||
      error?.message ||
      String(error);

    audit.finishedAt =
      new Date().toISOString();

    saveAudit();

    try {
      await mongoose.disconnect();
    } catch { }

    process.exitCode = 1;
  });
