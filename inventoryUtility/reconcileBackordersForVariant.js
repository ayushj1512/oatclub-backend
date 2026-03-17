import mongoose from "mongoose";
import {
  reconcilePendingReservationsInternal,
} from "../InventoryReservation/InventoryReservationController.js";
import InventoryReservation from "../InventoryReservation/InventoryReservation.js";

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export const reconcileBackordersForVariant = async ({
  productId,
  variantId = null,
  maxRows = 300,
} = {}) => {
  if (!isObjectId(productId)) throw new Error("Invalid productId");
  if (variantId && !isObjectId(variantId)) throw new Error("Invalid variantId");

  const session = await mongoose.startSession();

  try {
    let summary = null;

    await session.withTransaction(async () => {
      const pendingBefore = await InventoryReservation.countDocuments({
        productId: oid(productId),
        ...(variantId ? { variantId: oid(variantId) } : { variantId: null }),
        status: "pending",
      }).session(session);

      const pendingQtyBeforeRows = await InventoryReservation.find({
        productId: oid(productId),
        ...(variantId ? { variantId: oid(variantId) } : { variantId: null }),
        status: "pending",
      })
        .select("qty")
        .limit(Math.max(1, Number(maxRows || 300)))
        .session(session);

      const pendingQtyBefore = pendingQtyBeforeRows.reduce((sum, r) => sum + n(r.qty), 0);

      const result = await reconcilePendingReservationsInternal({
        productId,
        variantId,
        maxRows,
        session,
      });

      const pendingAfter = await InventoryReservation.countDocuments({
        productId: oid(productId),
        ...(variantId ? { variantId: oid(variantId) } : { variantId: null }),
        status: "pending",
      }).session(session);

      summary = {
        productId: String(productId),
        variantId: variantId ? String(variantId) : null,
        pendingBefore,
        pendingQtyBefore,
        promotedCount: result.promotedCount,
        promotedQty: result.promotedQty,
        pendingAfter,
      };
    });

    return summary;
  } finally {
    session.endSession();
  }
};

export default reconcileBackordersForVariant;