import express from "express";
import {
  listFootwearAdmin,
  getFootwearAdmin,
  createFootwear,
  updateFootwear,
  deleteFootwear,
  setPublishState,
  setFeatured,
  bulkAction,
  updateStock,
} from "./FootwearController.js";

// add your middleware here:
// import { requireAdmin } from "../middleware/auth.js";

const router = express.Router();

// router.use(requireAdmin);

router.get("/", listFootwearAdmin);
router.get("/:id", getFootwearAdmin);
router.post("/", createFootwear);
router.patch("/:id", updateFootwear);
router.delete("/:id", deleteFootwear);

router.patch("/:id/publish", setPublishState);
router.patch("/:id/featured", setFeatured);

router.post("/bulk", bulkAction);
router.patch("/:id/stock", updateStock);

export default router;
