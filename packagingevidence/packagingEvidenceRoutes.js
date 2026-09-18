import express from "express";

import {
  createPackagingEvidence,
  generateEvidenceSessionId,
  getOrderPackagingEvidence,
  getPackagingEvidenceById,
  getPackagingEvidenceList,
  getPackagingEvidenceStats,
  lookupOrderForEvidence,
  updatePackagingEvidenceStatus,
} from "./packagingEvidenceController.js";

const router = express.Router();

/*
 * No authentication middleware as requested.
 */

router.get("/stats", getPackagingEvidenceStats);
router.get("/session", generateEvidenceSessionId);

router.get(
  "/lookup/:orderNumber",
  lookupOrderForEvidence,
);

router.get(
  "/order/:orderNumber",
  getOrderPackagingEvidence,
);

router.get("/", getPackagingEvidenceList);
router.post("/", createPackagingEvidence);

router.patch(
  "/:id/status",
  updatePackagingEvidenceStatus,
);

router.get("/:id", getPackagingEvidenceById);

export default router;
