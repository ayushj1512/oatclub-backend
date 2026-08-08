import express from "express";

import {
  deleteProductCosting,
  getProductCostingByCode,
  getProductCostings,
  upsertProductCosting,
} from "./ProductCostingController.js";

const router = express.Router();

/* =========================================================
   PRODUCT COSTING
========================================================= */

/*
GET /api/product-costing

Filters:
?q=
&productCode=

&minFabricCost=
&maxFabricCost=

&minStitchingCost=
&maxStitchingCost=

&minPackagingCost=
&maxPackagingCost=

&createdFrom=
&createdTo=

&updatedFrom=
&updatedTo=

&sortBy=updatedAt
&sortOrder=desc

&page=1
&limit=50
&all=false
*/
router.get(
  "/",
  getProductCostings,
);

/*
GET /api/product-costing/00564

Optional:
?sortBy=updatedAt
&sortOrder=desc
*/
router.get(
  "/:productCode",
  getProductCostingByCode,
);

/* Create or update */
router.put(
  "/:productCode",
  upsertProductCosting,
);

/* Delete */
router.delete(
  "/:productCode",
  deleteProductCosting,
);

export default router;
