import express from "express";
import { addSubscription, getAllSubscriptions } from "../controllers/newsletterController.js";

const router = express.Router();

router.post("/", addSubscription);
router.get("/", getAllSubscriptions);

export default router;
