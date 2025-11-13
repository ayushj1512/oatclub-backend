import express from "express";
import {
  createCustomer,
  getAllCustomers,
  getCustomerById,
  updateCustomer,
  updateCustomerAnalytics,
  deleteCustomer,
} from "../controllers/customerController.js";

const router = express.Router();

router.post("/", createCustomer);
router.get("/", getAllCustomers);
router.get("/:id", getCustomerById);
router.put("/:id", updateCustomer);
router.patch("/:id/analytics", updateCustomerAnalytics);
router.delete("/:id", deleteCustomer);

export default router;
