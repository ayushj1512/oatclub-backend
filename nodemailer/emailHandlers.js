// nodemailer/emailHandlers.js

import { EVENTS, eventBus } from "./eventBus.js";
import { sendMail } from "./mailer.js";

// Customer email templates
import { onboardingTemplate } from "./OnboardingEmailTempalte.js";
import { orderConfirmationTemplate } from "./OrderConfirmationTemplate.js";
import { orderReceivedTemplate } from "./OrderReceivedTemplate.js";
import { rmaCreatedTemplate } from "./events/RmaEmailTemplate.js";
import { orderPaymentPendingTemplate } from "./events/OrderPaymentPendingTemplate.js";
import { customerCreditCreditedTemplate } from "./events/CustomerCreditCreditedTemplate.js";

// Fixed recipients for internal ORDER_RECEIVED emails
const ORDER_RECEIVED_RECIPIENTS = [
  "oatclub.in@gmail.com",
];

/* =========================================================
   HELPER → Resolve Customer Email
========================================================= */

function getCustomerEmail({
  email,
  order,
}) {
  return (
    email ||
    order?.customerId?.email ||
    order?.shippingAddressSnapshot?.email ||
    order?.billingAddressSnapshot?.email ||
    ""
  );
}

/* =========================================================
   HELPER → Resolve Customer Name
========================================================= */

function getCustomerName({
  name,
  order,
}) {
  return (
    name ||
    order?.customerId?.name ||
    order?.shippingAddressSnapshot?.fullName ||
    order?.billingAddressSnapshot?.fullName ||
    "Customer"
  );
}

/* =========================================================
   HELPER → Create Payment Retry Link
========================================================= */

function getPaymentRetryLink({
  paymentLink,
  order,
}) {
  if (paymentLink) {
    return paymentLink;
  }

  const orderId =
    order?._id ||
    order?.orderId ||
    order?.orderNumber;

  if (!orderId) {
    return "https://oatclub.in/account/orders";
  }

  return `https://oatclub.in/payment/retry/${orderId}`;
}

/* =========================================================
   USER REGISTERED → Onboarding Email

   Event payload:
   {
     email,
     name,
     ctaUrl?
   }
========================================================= */

eventBus.on(
  EVENTS.USER_REGISTERED,
  async ({
    email,
    name,
    ctaUrl,
  }) => {
    try {
      if (!email) {
        throw new Error(
          "Missing email in USER_REGISTERED event"
        );
      }

      const {
        subject,
        text,
        html,
      } = onboardingTemplate({
        name,
        ctaUrl:
          ctaUrl ||
          "https://oatclub.in",
      });

      await sendMail({
        to: email,
        subject,
        text,
        html,
      });

      console.log(
        "✅ USER_REGISTERED onboarding email sent to:",
        email
      );
    } catch (err) {
      console.error(
        "❌ USER_REGISTERED email failed:",
        err.message
      );
    }
  }
);

/* =========================================================
   ORDER CONFIRMED → Order Confirmation Email

   Event payload:
   {
     email,
     name,
     order,
     ctaUrl?
   }
========================================================= */

eventBus.on(
  EVENTS.ORDER_CONFIRMED,
  async ({
    email,
    name,
    order,
    ctaUrl,
  }) => {
    try {
      if (!email) {
        throw new Error(
          "Missing email in ORDER_CONFIRMED event"
        );
      }

      if (!order) {
        throw new Error(
          "Missing order in ORDER_CONFIRMED event"
        );
      }

      const {
        subject,
        text,
        html,
      } = orderConfirmationTemplate({
        name,
        order,
        ctaUrl:
          ctaUrl ||
          "https://oatclub.in/account/orders",
      });

      await sendMail({
        to: email,
        subject,
        text,
        html,
      });

      console.log(
        "✅ ORDER_CONFIRMED email sent to:",
        email
      );
    } catch (err) {
      console.error(
        "❌ ORDER_CONFIRMED email failed:",
        err.message
      );
    }
  }
);

/* =========================================================
   ORDER RECEIVED → Internal Team Email

   Event payload:
   {
     order
   }
========================================================= */

eventBus.on(
  EVENTS.ORDER_RECEIVED,
  async ({
    order,
  }) => {
    try {
      if (!order) {
        throw new Error(
          "Missing order in ORDER_RECEIVED event"
        );
      }

      const {
        subject,
        text,
        html,
      } = orderReceivedTemplate({
        order,
      });

      await sendMail({
        to: ORDER_RECEIVED_RECIPIENTS,
        subject,
        text,
        html,
      });

      console.log(
        "✅ ORDER_RECEIVED email sent to OATCLUB team:",
        order?.orderNumber ||
        order?._id
      );
    } catch (err) {
      console.error(
        "❌ ORDER_RECEIVED email failed:",
        err.message
      );
    }
  }
);

/* =========================================================
   PAYMENT PENDING → Payment Recovery Email

   Event payload:
   {
     email?,
     name?,
     order,
     paymentLink?,
     expiresAt?
   }
========================================================= */

eventBus.on(
  EVENTS.ORDER_PAYMENT_PENDING,
  async ({
    email,
    name,
    order,
    paymentLink,
    expiresAt,
  }) => {
    try {
      if (!order) {
        throw new Error(
          "Missing order in ORDER_PAYMENT_PENDING event"
        );
      }

      const customerEmail =
        getCustomerEmail({
          email,
          order,
        });

      const customerName =
        getCustomerName({
          name,
          order,
        });

      if (!customerEmail) {
        throw new Error(
          "Missing customer email in ORDER_PAYMENT_PENDING event"
        );
      }

      const retryPaymentLink =
        getPaymentRetryLink({
          paymentLink,
          order,
        });

      const {
        subject,
        text,
        html,
      } = orderPaymentPendingTemplate({
        name: customerName,

        order: {
          ...order,
          paymentStatus: "pending",
        },

        paymentLink:
          retryPaymentLink,

        expiresAt:
          expiresAt ||
          new Date(
            Date.now() +
            24 *
            60 *
            60 *
            1000
          ),
      });

      await sendMail({
        to: customerEmail,
        subject,
        text,
        html,
      });

      console.log(
        "✅ ORDER_PAYMENT_PENDING recovery email sent:",
        {
          email: customerEmail,
          orderId:
            order?.orderNumber ||
            order?._id,
        }
      );
    } catch (err) {
      console.error(
        "❌ ORDER_PAYMENT_PENDING email failed:",
        err.message
      );
    }
  }
);

/* =========================================================
   PAYMENT FAILED → Payment Recovery Email

   Event payload:
   {
     email?,
     name?,
     order,
     paymentLink?,
     expiresAt?
   }
========================================================= */

eventBus.on(
  EVENTS.ORDER_PAYMENT_FAILED,
  async ({
    email,
    name,
    order,
    paymentLink,
    expiresAt,
  }) => {
    try {
      if (!order) {
        throw new Error(
          "Missing order in ORDER_PAYMENT_FAILED event"
        );
      }

      const customerEmail =
        getCustomerEmail({
          email,
          order,
        });

      const customerName =
        getCustomerName({
          name,
          order,
        });

      if (!customerEmail) {
        throw new Error(
          "Missing customer email in ORDER_PAYMENT_FAILED event"
        );
      }

      const retryPaymentLink =
        getPaymentRetryLink({
          paymentLink,
          order,
        });

      const {
        subject,
        text,
        html,
      } = orderPaymentPendingTemplate({
        name: customerName,

        order: {
          ...order,
          paymentStatus: "failed",
        },

        paymentLink:
          retryPaymentLink,

        expiresAt:
          expiresAt ||
          new Date(
            Date.now() +
            24 *
            60 *
            60 *
            1000
          ),
      });

      await sendMail({
        to: customerEmail,
        subject,
        text,
        html,
      });

      console.log(
        "✅ ORDER_PAYMENT_FAILED recovery email sent:",
        {
          email: customerEmail,
          orderId:
            order?.orderNumber ||
            order?._id,
        }
      );
    } catch (err) {
      console.error(
        "❌ ORDER_PAYMENT_FAILED email failed:",
        err.message
      );
    }
  }
);

/* =========================================================
   RMA REQUESTED → RMA Created Email

   Event payload:
   {
     email,
     name,
     order,
     rma,
     policy,
     ctaUrl?
   }
========================================================= */

eventBus.on(
  EVENTS.RMA_REQUESTED,
  async ({
    email,
    name,
    order,
    rma,
    policy,
    ctaUrl,
  }) => {
    try {
      if (!email) {
        throw new Error(
          "Missing email in RMA_REQUESTED event"
        );
      }

      if (!order) {
        throw new Error(
          "Missing order in RMA_REQUESTED event"
        );
      }

      if (!rma) {
        throw new Error(
          "Missing rma in RMA_REQUESTED event"
        );
      }

      const {
        subject,
        text,
        html,
      } = rmaCreatedTemplate({
        name,
        order,
        rma,
        policy,
        ctaUrl:
          ctaUrl ||
          "https://oatclub.in/account/rma",
      });

      await sendMail({
        to: email,
        subject,
        text,
        html,
      });

      console.log(
        "✅ RMA_REQUESTED email sent to:",
        email
      );
    } catch (err) {
      console.error(
        "❌ RMA_REQUESTED email failed:",
        err.message
      );
    }
  }
);

/* =========================================================
   CUSTOMER CREDIT CREDITED → Customer Credit Email

   Event payload:
   {
     email,
     name?,
     amount,
     balance,
     orderNumber?,
     creditId?,
     reason?,
     creditedAt?,
     ctaUrl?
   }
========================================================= */

eventBus.on(
  EVENTS.CUSTOMER_CREDIT_CREDITED,
  async ({
    email,
    name,
    amount,
    balance,
    orderNumber,
    creditId,
    reason,
    creditedAt,
    ctaUrl,
  }) => {
    try {
      if (!email) {
        throw new Error(
          "Missing email in CUSTOMER_CREDIT_CREDITED event"
        );
      }

      if (Number(amount) <= 0) {
        throw new Error(
          "Invalid amount in CUSTOMER_CREDIT_CREDITED event"
        );
      }

      const { subject, text, html } =
        customerCreditCreditedTemplate({
          name: name || "Customer",
          amount,
          balance,
          orderNumber,
          creditId,
          reason: reason || "Refund",
          creditedAt: creditedAt || new Date(),
          ctaUrl: ctaUrl || "https://oatclub.in",
        });

      await sendMail({
        to: email,
        subject,
        text,
        html,
      });

      console.log(
        "✅ CUSTOMER_CREDIT_CREDITED email sent:",
        {
          email,
          amount,
          balance,
          orderNumber,
          creditId,
        }
      );
    } catch (err) {
      console.error(
        "❌ CUSTOMER_CREDIT_CREDITED email failed:",
        err.message
      );
    }
  }
);

console.log(
  "✅ OATCLUB email handlers registered successfully."
);
