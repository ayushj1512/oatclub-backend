import express from "express";
import {
  createMarketingSpend,
  listMarketingSpend,
  marketingSpendSummary,
  deleteMarketingSpend,
} from "./marketingSpendController.js";

const router = express.Router();

// (optional) add auth middleware
// import { requireAdmin } from "../middleware/auth.js";

router.post("/spend", /* requireAdmin, */ createMarketingSpend);
router.get("/spend", /* requireAdmin, */ listMarketingSpend);
router.get("/spend/summary", /* requireAdmin, */ marketingSpendSummary);
router.delete("/spend/:id", /* requireAdmin, */ deleteMarketingSpend);

export default router;