import express from "express";

import {
  // Core
  createCustomer,
  getAllCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
  checkCustomerExists,
  getCustomerByCustomerId,
  getCustomerByFirebaseUID,
  lookupCustomerByEmail,
  // Analytics
  updateCustomerAnalytics,
  syncCustomerAnalytics,
  syncAllCustomerAnalytics,
  getCustomerAnalyticsSummary,

  // Credits / Wallet
  addCustomerCredit,
  debitCustomerCredit,
  getCustomerCreditLogs,
  getAllCustomerCreditLogs,

  // Cart Adds
  addCartAddByCustomerId,
  removeCartAddByCustomerId,
  mergeGuestCartAddsByCustomerId,

  // Banking / Payout
  addCustomerBankingDetails,
  getCustomerCreditSummary,

  createOrFindGuestCustomer
} from "../Customer/customerController.js";

import Customer from "../Customer/Customer.js";

const router = express.Router();

/* =========================
   Core
========================= */
/* =========================
   Core
========================= */
router.post("/", createCustomer);
router.get("/", getAllCustomers);
router.post("/guest", createOrFindGuestCustomer);

router.get("/exists", checkCustomerExists);
router.get("/by-customer-id/:customerId", getCustomerByCustomerId);
router.get("/by-firebase/:firebaseUID", getCustomerByFirebaseUID);

/* =========================
   Authentication Lookup
========================= */
router.post("/auth/email-lookup", lookupCustomerByEmail);

/* =========================
   Search
========================= */
router.get("/search", async (req, res) => {
  try {
    const email = String(req.query.email || req.query["by-email"] || "")
      .trim()
      .toLowerCase();

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const customer = await Customer.findOne({ email }).lean();

    return res.status(200).json({
      success: true,
      customer,
      items: customer ? [customer] : [],
    });
  } catch (error) {
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
});

/* =========================
   Analytics
========================= */
router.get("/analytics/summary", getCustomerAnalyticsSummary);
router.patch("/analytics/sync-all", syncAllCustomerAnalytics);

/* =========================
   Credits / Wallet
========================= */
router.get("/:id/credits/summary", getCustomerCreditSummary);
router.get("/credits/logs", getAllCustomerCreditLogs);

router.post("/:id/credits/add", addCustomerCredit);
router.post("/:id/credits/debit", debitCustomerCredit);
router.get("/:id/credits/logs", getCustomerCreditLogs);

/* =========================
   Cart Adds
========================= */
router.post("/:id/cart-adds/add", addCartAddByCustomerId);
router.post("/:id/cart-adds/remove", removeCartAddByCustomerId);
router.post("/:id/cart-adds/merge", mergeGuestCartAddsByCustomerId);

/* =========================
   Banking / Payout
========================= */
router.patch("/:id/payout-details", addCustomerBankingDetails);

/* =========================
   Single Customer
========================= */
router.patch("/:id/analytics/sync", syncCustomerAnalytics);
router.patch("/:id/analytics", updateCustomerAnalytics);

router.get("/:id", getCustomerById);
router.put("/:id", updateCustomer);
router.delete("/:id", deleteCustomer);

export default router;
