import express from "express";
import {
  createOffer,
  getAllOffers,
  getOfferById,
  updateOffer,
  deleteOffer,
} from "../controller/offerController.js";

const router = express.Router();

router.post("/", createOffer);
router.get("/", getAllOffers);
router.get("/:id", getOfferById);
router.put("/:id", updateOffer);
router.delete("/:id", deleteOffer);

export default router;
