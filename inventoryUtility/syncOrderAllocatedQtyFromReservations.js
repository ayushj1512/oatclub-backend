import mongoose from "mongoose";
import Order from "../Orders/Orders.js";
import InventoryReservation from "../InventoryReservation/InventoryReservation.js";

/* ---------------------------------------------------
   helpers
--------------------------------------------------- */
const s = (v) => String(v ?? "").trim();

const n = (v) =>
  Number.isFinite(Number(v))
    ? Number(v)
    : 0;

const oid = (v) =>
  new mongoose.Types.ObjectId(
    String(v),
  );

const isObjectId = (v) =>
  mongoose.Types.ObjectId.isValid(
    String(v || ""),
  );

const keyOf = (
  productId,
  variantId,
) =>
  `${String(productId)}::${variantId
    ? String(variantId)
    : "root"
  }`;

const itemProductIdOf = (item) =>
  s(
    item?.productId?._id ||
    item?.productId,
  );

const itemVariantIdOf = (item) =>
  s(
    item?.variant?.variantId ||
    item?.variantId ||
    item?.variant?._id ||
    "",
  );

/**
 * Sync order item allocation from reservations.
 *
 * Rules:
 * - only RESERVED reservations count as allocated
 * - PENDING reservations remain production demand
 * - allocatedQty cannot exceed unshipped qty
 * - toProduceQty = qty - allocatedQty - shippedQty
 * - split parent never owns operational allocation
 */
export const syncOrderAllocatedQtyFromReservations =
  async ({
    orderId,
    debug = true,
    session = null,
  } = {}) => {
    if (!isObjectId(orderId)) {
      throw new Error(
        "Invalid orderId",
      );
    }

    const runId =
      `syncAlloc:${Date.now()}:` +
      Math.random()
        .toString(16)
        .slice(2, 7);

    const log = (...args) =>
      debug &&
      console.log(
        `🧩 [${runId}]`,
        ...args,
      );

    const ownSession = !session;

    const dbSession =
      session ||
      (await mongoose.startSession());

    const summary = {
      runId,
      orderId: String(orderId),

      orderNumber: "",
      orderType: "",

      itemsCount: 0,

      reservedReservations: 0,
      pendingReservations: 0,

      linesUpdated: 0,

      totalAllocatedQty: 0,
      totalToProduceQty: 0,

      changed: false,
      skippedBecause: "",
    };

    try {
      const runner = async () => {
        const order =
          await Order.findById(
            orderId,
          ).session(dbSession);

        if (!order) {
          throw new Error(
            "Order not found",
          );
        }

        const items =
          Array.isArray(order.items)
            ? order.items
            : [];

        summary.orderNumber =
          s(order.orderNumber);

        summary.orderType =
          s(
            order.orderType ||
            "shipment",
          ).toLowerCase();

        summary.itemsCount =
          items.length;

        if (!items.length) {
          summary.skippedBecause =
            "no_items";

          return;
        }

        /* ---------------------------------------------------
           SPLIT PARENT SAFETY
        --------------------------------------------------- */

        if (
          summary.orderType ===
          "parent"
        ) {
          let changed = false;

          for (const item of items) {
            if (!item.fulfillment) {
              item.fulfillment = {};
            }

            const qty =
              Math.max(
                0,
                n(item.quantity),
              );

            const shippedQty =
              Math.max(
                0,
                n(
                  item?.fulfillment
                    ?.shippedQty,
                ),
              );

            const oldAllocated =
              Math.max(
                0,
                n(
                  item?.fulfillment
                    ?.allocatedQty,
                ),
              );

            const oldToProduce =
              Math.max(
                0,
                n(
                  item?.fulfillment
                    ?.toProduceQty,
                ),
              );

            const newAllocated = 0;
            const newToProduce = 0;

            item.fulfillment.allocatedQty =
              newAllocated;

            item.fulfillment.toProduceQty =
              newToProduce;

            /*
             * Parent is logical only.
             * It must never contribute
             * inventory/production demand.
             */

            if (
              oldAllocated !==
              newAllocated ||
              oldToProduce !==
              newToProduce
            ) {
              changed = true;

              summary.linesUpdated +=
                1;

              log(
                "PARENT LINE CLEARED",
                {
                  lineId:
                    item.lineId,

                  qty,
                  shippedQty,

                  oldAllocated,
                  oldToProduce,
                },
              );
            }
          }

          if (changed) {
            order.isPackable = false;

            await order.save({
              session:
                dbSession,
            });
          }

          summary.changed =
            changed;

          summary.totalAllocatedQty =
            0;

          summary.totalToProduceQty =
            0;

          summary.skippedBecause =
            "split_parent";

          return;
        }

        /* ---------------------------------------------------
           ACTIVE RESERVATIONS
        --------------------------------------------------- */

        const reservations =
          await InventoryReservation.find({
            refType: "order",

            refId:
              oid(orderId),

            status: {
              $in: [
                "pending",
                "reserved",
              ],
            },
          })
            .select(
              "productId variantId qty status",
            )
            .sort({
              createdAt: 1,
              _id: 1,
            })
            .session(
              dbSession,
            );

        const reservedQtyMap =
          new Map();

        for (const reservation of reservations) {
          if (
            reservation.status ===
            "pending"
          ) {
            summary.pendingReservations +=
              1;

            continue;
          }

          summary.reservedReservations +=
            1;

          const key =
            keyOf(
              reservation.productId,
              reservation.variantId ||
              null,
            );

          reservedQtyMap.set(
            key,
            (reservedQtyMap.get(
              key,
            ) || 0) +
            Math.max(
              0,
              n(
                reservation.qty,
              ),
            ),
          );
        }

        /* ---------------------------------------------------
           SYNC ORDER ITEMS
        --------------------------------------------------- */

        let changed = false;

        for (const item of items) {
          const productId =
            itemProductIdOf(
              item,
            );

          if (!productId) {
            continue;
          }

          const variantId =
            itemVariantIdOf(
              item,
            ) || null;

          const key =
            keyOf(
              productId,
              variantId,
            );

          const reservedForGroup =
            Math.max(
              0,
              n(
                reservedQtyMap.get(
                  key,
                ) || 0,
              ),
            );

          const qty =
            Math.max(
              0,
              n(item.quantity),
            );

          const shippedQty =
            Math.max(
              0,
              n(
                item
                  ?.fulfillment
                  ?.shippedQty,
              ),
            );

          const maxAllocatable =
            Math.max(
              0,
              qty - shippedQty,
            );

          const newAllocatedQty =
            Math.min(
              maxAllocatable,
              reservedForGroup,
            );

          const newToProduceQty =
            Math.max(
              0,
              qty -
              newAllocatedQty -
              shippedQty,
            );

          const oldAllocatedQty =
            Math.max(
              0,
              n(
                item
                  ?.fulfillment
                  ?.allocatedQty,
              ),
            );

          const oldToProduceQty =
            Math.max(
              0,
              n(
                item
                  ?.fulfillment
                  ?.toProduceQty,
              ),
            );

          if (!item.fulfillment) {
            item.fulfillment = {};
          }

          item.fulfillment.allocatedQty =
            newAllocatedQty;

          item.fulfillment.toProduceQty =
            newToProduceQty;

          reservedQtyMap.set(
            key,
            Math.max(
              0,
              reservedForGroup -
              newAllocatedQty,
            ),
          );

          summary.totalAllocatedQty +=
            newAllocatedQty;

          summary.totalToProduceQty +=
            newToProduceQty;

          if (
            oldAllocatedQty !==
            newAllocatedQty ||
            oldToProduceQty !==
            newToProduceQty
          ) {
            changed = true;

            summary.linesUpdated +=
              1;

            log(
              "LINE UPDATED",
              {
                lineId:
                  item.lineId,

                productId,
                variantId,

                qty,
                shippedQty,

                oldAllocatedQty,
                newAllocatedQty,

                oldToProduceQty,
                newToProduceQty,
              },
            );
          }
        }

        /* ---------------------------------------------------
           PACKABILITY
        --------------------------------------------------- */

        const newIsPackable =
          items.length > 0 &&
          items.every(
            (item) => {
              const qty =
                Math.max(
                  0,
                  n(
                    item.quantity,
                  ),
                );

              const allocated =
                Math.max(
                  0,
                  n(
                    item
                      ?.fulfillment
                      ?.allocatedQty,
                  ),
                );

              const shipped =
                Math.max(
                  0,
                  n(
                    item
                      ?.fulfillment
                      ?.shippedQty,
                  ),
                );

              return (
                allocated +
                shipped >=
                qty
              );
            },
          );

        if (
          Boolean(
            order.isPackable,
          ) !==
          newIsPackable
        ) {
          order.isPackable =
            newIsPackable;

          changed = true;
        }

        if (changed) {
          await order.save({
            session:
              dbSession,
          });
        }

        summary.changed =
          changed;
      };

      if (ownSession) {
        await dbSession.withTransaction(
          runner,
        );
      } else {
        await runner();
      }

      return summary;
    } finally {
      if (ownSession) {
        await dbSession.endSession();
      }
    }
  };

export default syncOrderAllocatedQtyFromReservations;
