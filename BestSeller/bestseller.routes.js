import { Router } from "express";
import {
  createBestseller,
  getAllBestsellers,
  getAllBestsellerIds,
  getBestsellerById,
  updateBestseller,
  deleteBestseller,
  deleteBestsellerByProductId,
  setBestsellerOrder,
} from "../BestSeller/BestSeller.Controller.js";

const router = Router();

router.post("/bestseller", createBestseller);

router.get("/bestseller", getAllBestsellers);
router.get("/bestseller/ids", getAllBestsellerIds);

router.put("/bestseller/order", setBestsellerOrder);
router.post("/bestseller/order", setBestsellerOrder); // optional fallback

router.get("/bestseller/:id", getBestsellerById);
router.put("/bestseller/:id", updateBestseller);
router.delete("/bestseller/:id", deleteBestseller);

router.delete("/bestseller/product/:productId", deleteBestsellerByProductId);

export default router;
