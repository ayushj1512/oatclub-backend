import Product from "./Products.js";

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const productSelect =
  "title productCode thumbnail images isSamplingDone isPatternReady variants createdAt updatedAt";

const normalizeStatus = (product) =>
  product?.isPatternReady ? "ready" : "pending";

const normalizeSampleStatus = (product) =>
  product?.isSamplingDone ? "done" : "pending";

/* =========================================================
   VENDOR SAMPLING
========================================================= */

export const getVendorSamplingProducts = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const { search = "", status = "all", productCode = "" } = req.query;

    const query = {
      isActive: true,
      isDraft: { $ne: true },
    };

    if (status === "done") query.isSamplingDone = true;
    if (status === "pending") query.isSamplingDone = false;

    if (productCode) {
      query.productCode = { $regex: escapeRegex(productCode), $options: "i" };
    }

    if (search) {
      query.$or = [
        { title: { $regex: escapeRegex(search), $options: "i" } },
        { productCode: { $regex: escapeRegex(search), $options: "i" } },
      ];
    }

    const [products, total] = await Promise.all([
      Product.find(query)
        .select(productSelect)
        .sort({ isSamplingDone: 1, updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(query),
    ]);

    const samples = products.map((product) => ({
      ...product,
      status: normalizeSampleStatus(product),
      samplingStatus: normalizeSampleStatus(product),
    }));

    return res.json({
      success: true,
      samples,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    console.error("getVendorSamplingProducts error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch sampling products",
    });
  }
};

export const updateVendorSamplingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const rawStatus = req.body.status || req.body.samplingStatus;

    if (!["done", "pending"].includes(rawStatus)) {
      return res.status(400).json({
        success: false,
        message: "Status must be done or pending",
      });
    }

    const product = await Product.findByIdAndUpdate(
      id,
      {
        $set: {
          isSamplingDone: rawStatus === "done",
        },
      },
      { new: true }
    )
      .select(productSelect)
      .lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const sample = {
      ...product,
      status: normalizeSampleStatus(product),
      samplingStatus: normalizeSampleStatus(product),
    };

    return res.json({
      success: true,
      message: "Sampling status updated",
      sample,
    });
  } catch (error) {
    console.error("updateVendorSamplingStatus error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update sampling status",
    });
  }
};

export const addVendorSamplingRemark = async (req, res) => {
  return res.status(400).json({
    success: false,
    message: "Sampling remark field is not available in Product schema yet",
  });
};

/* =========================================================
   VENDOR PATTERN
========================================================= */

export const getVendorPatternProducts = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const {
      search = "",
      status = "all",
      productCode = "",
      patternNumber = "",
    } = req.query;

    const query = {
      isActive: true,
      isDraft: { $ne: true },
    };

    if (status === "ready" || status === "done") {
      query.isPatternReady = true;
    }

    if (status === "pending") {
      query.isPatternReady = false;
    }

    if (productCode) {
      query.productCode = { $regex: escapeRegex(productCode), $options: "i" };
    }

    if (patternNumber) {
      query["variants.patternNumber"] = {
        $regex: escapeRegex(patternNumber),
        $options: "i",
      };
    }

    if (search) {
      query.$or = [
        { title: { $regex: escapeRegex(search), $options: "i" } },
        { productCode: { $regex: escapeRegex(search), $options: "i" } },
        {
          "variants.patternNumber": {
            $regex: escapeRegex(search),
            $options: "i",
          },
        },
      ];
    }

    const [products, total] = await Promise.all([
      Product.find(query)
        .select(productSelect)
        .sort({ isPatternReady: 1, updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(query),
    ]);

    const patterns = products.map((product) => ({
      ...product,
      status: normalizeStatus(product),
      patternStatus: normalizeStatus(product),
    }));

    return res.json({
      success: true,
      patterns,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    console.error("getVendorPatternProducts error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch pattern jobs",
    });
  }
};

export const updateVendorPatternStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const rawStatus = req.body.status || req.body.patternStatus;

    if (!["ready", "done", "pending"].includes(rawStatus)) {
      return res.status(400).json({
        success: false,
        message: "Status must be ready, done or pending",
      });
    }

    const isReady = rawStatus === "ready" || rawStatus === "done";

    const product = await Product.findByIdAndUpdate(
      id,
      {
        $set: {
          isPatternReady: isReady,
        },
      },
      { new: true }
    )
      .select(productSelect)
      .lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const pattern = {
      ...product,
      status: normalizeStatus(product),
      patternStatus: normalizeStatus(product),
    };

    return res.json({
      success: true,
      message: "Pattern status updated",
      pattern,
    });
  } catch (error) {
    console.error("updateVendorPatternStatus error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update pattern status",
    });
  }
};