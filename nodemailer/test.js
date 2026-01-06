// nodemailer/test.js
import "dotenv/config";

import { EVENTS, eventBus } from "./eventBus.js";

// ✅ IMPORTANT: Register handlers once
import "./emailHandlers.js";

// ----------------------------------------------------
// ✅ MOCK DATA
// ----------------------------------------------------
const mockCustomer = {
  name: "Ayush",
  email: "miray.ayushjuneja@gmail.com",
};

const mockOrder = {
  orderNumber: "MF90001",
  paymentMethod: "cod",
  paymentStatus: "pending",
  fulfillmentStatus: "processing",
  currency: "INR",

  subtotal: 999,
  discount: 100,
  shippingFee: 50,
  tax: 0,
  totalAmount: 1049,
  finalPayable: 949,

  coupon: { code: "WELCOME100", discount: 100, finalTotal: 949 },

  source: "website",
  isGiftOrder: false,

  shippingAddressSnapshot: {
    name: "Ayush Juneja",
    line1: "12, MG Road",
    line2: "Near Metro Station",
    city: "New Delhi",
    state: "Delhi",
    pincode: "110001",
    country: "India",
    phone: "+91 99999 99999",
  },

  items: [
    {
      quantity: 1,
      price: 999,
      productSnapshot: {
        title: "Black Kurta",
        thumbnail:
          "https://images.unsplash.com/photo-1520975958225-9984d6b1429b?w=300",
      },
      variant: {
        sku: "KURTA-BLK-M",
        attributes: { size: "M", color: "Black" },
        image:
          "https://images.unsplash.com/photo-1520975958225-9984d6b1429b?w=300",
      },
    },
    {
      quantity: 1,
      price: 0,
      productSnapshot: {
        title: "Dupatta (Free Add-on)",
      },
      variant: {
        sku: "DUP-FREE",
        attributes: { note: "Free Add-on" },
      },
    },
  ],
};

const mockRma = {
  rmaNumber: "RMA8899",
  type: "exchange",
  status: "requested",
  reason: "size_issue",
  customerNote: "Size thoda tight hai, exchange chahiye.",
  fee: { amount: 0, currency: "INR", status: "waived" },
  items: [
    {
      title: "Black Kurta",
      productCode: "MF-KURTA-001",
      variantSku: "KURTA-BLK-M",
      quantity: 1,
    },
  ],
};

const mockPolicy = { windowDays: 7 };

// ----------------------------------------------------
// ✅ TEST RUNNER
// ----------------------------------------------------
async function runTests() {
  console.log("\n🚀 Running Nodemailer Tests...\n");

  // ✅ 1) Onboarding
  eventBus.emit(EVENTS.USER_REGISTERED, {
    email: mockCustomer.email,
    name: mockCustomer.name,
  });

  // ✅ 2) Order Confirmation (Customer)
  eventBus.emit(EVENTS.ORDER_CONFIRMED, {
    email: mockCustomer.email,
    name: mockCustomer.name,
    order: mockOrder,
    ctaUrl: "https://mirayfashions.com/account/orders",
  });

  // ✅ 3) Order Received (Stakeholders)
  eventBus.emit(EVENTS.ORDER_RECEIVED, {
    order: mockOrder,
  });

  // ✅ 4) RMA Created (Customer)
  eventBus.emit(EVENTS.RMA_REQUESTED, {
    email: mockCustomer.email,
    name: mockCustomer.name,
    order: mockOrder,
    rma: mockRma,
    policy: mockPolicy,
    ctaUrl: "https://mirayfashions.com/account/rma",
  });

  console.log("✅ All events emitted. Check console + inbox.\n");
}

runTests().catch((err) => {
  console.error("❌ Test runner failed:", err);
});
