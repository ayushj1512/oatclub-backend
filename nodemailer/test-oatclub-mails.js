// nodemailer/test-oatclub-mails.js
import "dotenv/config";
import { Mailer } from "./mailer.js";

const TEST_RECIPIENT = "ayush.oatclub@gmail.com";

const order = {
  _id: "6a248951ea9dabd7425a611e",
  customerId: {
    email: "ayush.oatclub@gmail.com",
    name: "Ayush Juneja",
    phone: "",
  },
  shippingAddressSnapshot: {
    fullName: "Ayush Juneja",
    phone: "0111111111",
    email: "ayush.oatclub@gmail.com",
    pincode: "110011",
  },
  items: [
    {
      lineId: "be5e25e9-5d07-4b98-8ed3-fd3a7a605128",
      productSnapshot: {
        productCode: "00014",
        title: "Sienna Sculpt Halter Top",
        thumbnail:
          "https://res.cloudinary.com/dpsvrt4sd/image/upload/v1780509742/baixr0ubpwlv2eq32iar.webp",
      },
      variant: {
        sku: "TOP-00014-M",
      },
      selectedSize: "M",
      selectedColor: "",
      quantity: 1,
      price: 799,
      subtotal: 799,
    },
  ],
  subtotal: 799,
  discount: 0,
  shippingFee: 0,
  tax: 0,
  totalAmount: 799,
  finalPayable: 799,
  currency: "INR",
  paymentMethod: "cod",
  paymentStatus: "pending",
  fulfillmentStatus: "delivered",
  shipment: {
    shiprocket: {
      awb: "TEST123456789",
      courierName: "Shiprocket Test Courier",
      trackingUrl: "https://oatclub.in/account/orders",
    },
    status: "shipped",
  },
  priority: "normal",
  isConfirmed: true,
  orderDate: "2026-06-06T20:55:45.261Z",
  orderNumber: "000001",
  createdAt: "2026-06-06T20:55:45.321Z",
};

async function run() {
  try {
    console.log("\n🚀 Starting OATCLUB email test...\n");

    await Mailer.sendUserOnboarding({
      to: TEST_RECIPIENT,
      name: "Ayush Juneja",
      ctaUrl: "https://oatclub.in",
      brandName: "OATCLUB",
      supportEmail: "hey@oatclub.in",
    });

    await Mailer.sendOrderConfirmation({
      to: TEST_RECIPIENT,
      name: "Ayush Juneja",
      order,
      ctaUrl: "https://oatclub.in/account/orders",
    });

    await Mailer.sendAdminOrderReceived({
      to: TEST_RECIPIENT,
      order,
      ctaUrl: "https://admin.oatclub.in/orders/000001",
    });

    await Mailer.sendOrderShipped({
      to: TEST_RECIPIENT,
      name: "Ayush Juneja",
      order,
      ctaUrl: "https://oatclub.in/account/orders",
    });

    await Mailer.sendOrderTracking({
      to: TEST_RECIPIENT,
      name: "Ayush Juneja",
      awb: "TEST123456789",
      courierName: "Shiprocket Test Courier",
      trackingLink: "https://oatclub.in/account/orders",
      order,
    });

    await Mailer.sendOrderDelivered({
      to: TEST_RECIPIENT,
      name: "Ayush Juneja",
      order,
      ctaUrl: "https://oatclub.in/account/orders",
    });

    await Mailer.sendOrderCancelled({
      to: TEST_RECIPIENT,
      name: "Ayush Juneja",
      order: {
        ...order,
        fulfillmentStatus: "cancelled",
      },
      ctaUrl: "https://oatclub.in/account/orders",
      reason: "Test cancellation email",
    });

    await Mailer.sendRmaCreated({
      to: TEST_RECIPIENT,
      name: "Ayush Juneja",
      order,
      rma: {
        rmaNumber: "RMA-TEST-000001",
        type: "return",
        status: "requested",
        reason: "Size issue",
        refundPreference: "store_credit",
        createdAt: new Date().toISOString(),
        items: order.items,
      },
      policy: {
        fee: 0,
        message: "This is a test RMA request.",
      },
      ctaUrl: "https://oatclub.in/account/rma",
    });

    console.log("\n✅ All OATCLUB test emails sent successfully!\n");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ OATCLUB email test failed:");
    console.error(err);
    process.exit(1);
  }
}

run();