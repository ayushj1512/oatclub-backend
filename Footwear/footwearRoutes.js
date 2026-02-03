import express from "express";
import {
  listFootwearPublic,
  getFootwearBySlugPublic,
  resolveFootwearForCheckout,
} from "./FootwearController.js";

const router = express.Router();

router.get("/", listFootwearPublic);
router.get("/:slug", getFootwearBySlugPublic);

// used by cart/checkout to validate stock + build snapshot
router.post("/resolve-for-checkout", resolveFootwearForCheckout);

export default router;
