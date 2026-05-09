import express from "express";
import {
  createCampaign,
  createTrackingLink,
  trackClickAndRedirect,
  trackJourneyEvent,
  markConversion,
  getCampaigns,
  getCampaignDetails,
} from "./marketingCampaignController.js";

const router = express.Router();

router.post("/", createCampaign);
router.get("/", getCampaigns);

// Specific routes first
router.get("/t/:shortCode", trackClickAndRedirect);
router.post("/journey/track", trackJourneyEvent);
router.post("/conversion/track", markConversion);

// Dynamic campaign routes last
router.get("/:campaignId", getCampaignDetails);
router.post("/:campaignId/link", createTrackingLink);

export default router;