import Order from "../Orders/Orders.js"; // ⚠️ adjust path
import { Mailer } from "../nodemailer/mailer.js"; // ⚠️ adjust path

// If you want to reuse existing booking logic, import it.
// Option A (recommended): call existing controller/service that already books shiprocket
// import { autoBookShiprocketForOrder } from "../../Orders/order.controller.js"; // ⚠️ only if exported
// Option B: call an endpoint/service you already have.

const getCustomerIdentity = (order) => {
  const email =
    order?.shippingAddressSnapshot?.email ||
    order?.customerId?.email ||
    order?.billingAddressSnapshot?.email ||
    order?.email ||
    "";

  const name =
    order?.shippingAddressSnapshot?.fullName ||
    order?.shippingAddressSnapshot?.name ||
    order?.customerId?.name ||
    "Customer";

  return { email: String(email).trim(), name: String(name).trim() };
};

const getCustomerCtaUrl = (order) => {
  const clientBase = process.env.CLIENT_URL || "http://localhost:3000";
  const publicId = order?.orderId || order?.orderNumber || order?._id;
  return `${clientBase}/account/orders/${publicId}`;
};

/**
 * POST /api/admin/orders/:id/actions/send-confirmation-email
 */
export const sendConfirmationEmail = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("customerId", "name email phone")
      .lean();

    if (!order) return res.status(404).json({ message: "Order not found" });

    const { email, name } = getCustomerIdentity(order);
    if (!email) return res.status(400).json({ message: "Customer email missing" });

    await Mailer.sendOrderConfirmation({
      to: email,
      name,
      order,
      ctaUrl: getCustomerCtaUrl(order),
    });

    return res.status(200).json({ message: "Confirmation email sent ✅" });
  } catch (err) {
    console.error("❌ sendConfirmationEmail:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};

/**
 * POST /api/admin/orders/:id/actions/send-tracking-email
 * body (optional overrides):
 * { awb, trackingId, courierName, trackingUrl }
 */
export const sendTrackingEmail = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("customerId", "name email phone")
      .lean();

    if (!order) return res.status(404).json({ message: "Order not found" });

    const { email, name } = getCustomerIdentity(order);
    if (!email) return res.status(400).json({ message: "Customer email missing" });

    // ✅ allow overrides from admin panel inputs
    const awb = String(
      req.body?.awb ||
        req.body?.trackingId ||
        order?.shipment?.shiprocket?.awb ||
        order?.trackingDetails?.trackingId ||
        ""
    ).trim();

    const courierName = String(
      req.body?.courierName ||
        order?.shipment?.shiprocket?.courierName ||
        order?.trackingDetails?.courierName ||
        ""
    ).trim();

    const trackingLink = String(
      req.body?.trackingUrl ||
        order?.shipment?.shiprocket?.trackingUrl ||
        order?.trackingDetails?.trackingUrl ||
        ""
    ).trim();

    if (!awb && !trackingLink) {
      return res.status(400).json({ message: "AWB or Tracking URL required" });
    }

    await Mailer.sendOrderTracking({
      to: email,
      name,
      awb: awb || "—",
      courierName: courierName || "—",
      trackingLink: trackingLink || "#",
      order,
    });

    return res.status(200).json({ message: "Tracking email sent ✅" });
  } catch (err) {
    console.error("❌ sendTrackingEmail:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};

/**
 * POST /api/admin/orders/:id/actions/book-courier
 *
 * NOTE:
 * You already have autoBookShiprocketForOrder(order) inside order controller.
 * Best is to MOVE that logic into a service file and import here.
 *
 * For now, this controller:
 * - loads order
 * - performs basic guards
 * - returns "pending hookup" if booking function not wired
 */
export const bookCourier = async (req, res) => {
  try {
    const orderDoc = await Order.findById(req.params.id);
    if (!orderDoc) return res.status(404).json({ message: "Order not found" });

    // ✅ basic guards like your existing code
    if (!orderDoc?.isConfirmed) {
      return res.status(400).json({ message: "Order must be confirmed before booking courier" });
    }

    // already booked?
    if (orderDoc?.shipment?.shiprocket?.awb || orderDoc?.shipment?.shiprocket?.shipmentId) {
      return res.status(200).json({
        message: "Courier already booked ✅",
        shipment: orderDoc.shipment?.shiprocket || {},
      });
    }

    // ✅ TODO: wire to your existing shiprocket booking function
    // Example if you extract a service:
    // await autoBookShiprocketForOrder(orderDoc);

    return res.status(501).json({
      message: "Book courier hookup pending (wire autoBookShiprocketForOrder here)",
    });
  } catch (err) {
    console.error("❌ bookCourier:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};
