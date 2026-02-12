// scripts/testOrderConfirmationMail.js

import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { orderReceivedAdminTemplate } from "../nodemailer/events/AdminOrderReceivedTemplate.js";

dotenv.config();

/* ================================================================= */
/* ======================== MAIL TRANSPORT ========================= */
/* ================================================================= */

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: Number(process.env.MAIL_PORT),
  secure: process.env.MAIL_SECURE === "true",
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
  name: process.env.MAIL_EHLO_NAME,
});

/* ================================================================= */
/* ============================ TEST ORDER ========================== */
/* ================================================================= */

const order = {
  _id: "698d7f5d0507868d481524b7",
  orderNumber: "MIRAY-000267",
  orderDate: new Date(),
  createdAt: new Date(),

  currency: "INR",
  source: "website",
  priority: "normal",
  isGiftOrder: false,
  isConfirmed: false,

  customer: {
    name: "Angel Garg",
    email: "angelgarg9210@gmail.com",
    phone: "9210916277",
  },

  shippingAddressSnapshot: {
    fullName: "Angel Garg",
    phone: "9210916277",
    email: "angelgarg9210@gmail.com",
    line1: "F2 block 145-146 sec 11 rohini",
    line2: "Near Jain Sthanak",
    city: "North Delhi",
    state: "Delhi",
    pincode: "110085",
    country: "India",
  },

  billingAddressSnapshot: {
    fullName: "Angel Garg",
    phone: "9210916277",
    email: "angelgarg9210@gmail.com",
  },

  items: [
    {
      lineId: "cd67ea35-275e-461d-b6bb-cf3c127bd74c",
      quantity: 1,
      price: 799,
      subtotal: 799,
      selectedSize: "XL",

      productSnapshot: {
        productCode: "00224",
        title: "Brown Animal Print Bandeau Top with Scarf",
        sku: "TOP-00224",
        thumbnail:
          "https://res.cloudinary.com/djtva6hec/image/upload/v1768498915/miray/products/gallery/u0wwpc3xlwdvxkargzgj.jpg",
      },

      variant: {
        sku: "TOP-00224-XL",
        attributes: [{ key: "Size", value: "XL" }],
      },
    },
  ],

  subtotal: 799,
  discount: 112,
  shippingFee: 0,
  tax: 0,
  totalAmount: 799,
  finalPayable: 687,

  coupon: {
    code: "VALENTINE14",
    discount: 112,
  },

  paymentMethod: "cod",
  paymentStatus: "pending",
  fulfillmentStatus: "processing",

  razorpay: {
    orderId: "",
    paymentId: "",
    amount: 0,
  },
};

/* ================================================================= */
/* ============================ SEND MAIL =========================== */
/* ================================================================= */

async function sendAdminOrderMail() {
  const { subject, text, html } = orderReceivedAdminTemplate({
    order,
    ctaUrl: `https://mirayfashions.com/admin/orders/${order.orderNumber}`,
  });

  const info = await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to: "miray.ayushjuneja@gmail.com",
    subject,
    text,
    html,
  });

  console.log("✅ Admin order received test mail sent");
  console.log("📧 Message ID:", info.messageId);
}

sendAdminOrderMail().catch((err) => {
  console.error("❌ Mail failed");
  console.error(err);
});
