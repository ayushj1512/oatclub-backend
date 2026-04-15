import Tailor from "./tailor.js";

const clean = (value) => (value == null ? "" : String(value).trim());

const normalizePayload = (body = {}) => ({
  name: clean(body.name),
  type: clean(body.type) || "all",
  email: clean(body.email).toLowerCase(),
  mobile: clean(body.mobile),
  status: clean(body.status) || "active",
  rating:
    body.rating === "" || body.rating == null ? 0 : Number(body.rating),
  joinedAt: body.joinedAt || undefined,
});

export const createTailor = async (req, res) => {
  try {
    const payload = normalizePayload(req.body);

    if (!payload.name) {
      return res.status(400).json({
        success: false,
        message: "Tailor name is required",
      });
    }

    const tailor = await Tailor.create(payload);

    return res.status(201).json({
      success: true,
      message: "Tailor created successfully",
      tailor,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to create tailor",
      error: error.message,
    });
  }
};

export const getAllTailors = async (req, res) => {
  try {
    const { search = "", status, type, sort = "newest" } = req.query;

    const query = {};

    if (clean(search)) {
      query.$or = [
        { name: { $regex: clean(search), $options: "i" } },
        { email: { $regex: clean(search), $options: "i" } },
        { mobile: { $regex: clean(search), $options: "i" } },
        { type: { $regex: clean(search), $options: "i" } },
      ];
    }

    if (clean(status)) query.status = clean(status);
    if (clean(type)) query.type = clean(type);

    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      name_asc: { name: 1 },
      name_desc: { name: -1 },
      rating_desc: { rating: -1 },
      rating_asc: { rating: 1 },
      joined_desc: { joinedAt: -1 },
      joined_asc: { joinedAt: 1 },
    };

    const tailors = await Tailor.find(query).sort(
      sortMap[sort] || { createdAt: -1 }
    );

    return res.status(200).json({
      success: true,
      count: tailors.length,
      tailors,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch tailors",
      error: error.message,
    });
  }
};

export const getTailorById = async (req, res) => {
  try {
    const tailor = await Tailor.findById(req.params.id);

    if (!tailor) {
      return res.status(404).json({
        success: false,
        message: "Tailor not found",
      });
    }

    return res.status(200).json({
      success: true,
      tailor,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch tailor",
      error: error.message,
    });
  }
};

export const updateTailor = async (req, res) => {
  try {
    const payload = normalizePayload(req.body);

    if (!payload.name) {
      return res.status(400).json({
        success: false,
        message: "Tailor name is required",
      });
    }

    const tailor = await Tailor.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true,
    });

    if (!tailor) {
      return res.status(404).json({
        success: false,
        message: "Tailor not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Tailor updated successfully",
      tailor,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to update tailor",
      error: error.message,
    });
  }
};

export const deleteTailor = async (req, res) => {
  try {
    const tailor = await Tailor.findByIdAndDelete(req.params.id);

    if (!tailor) {
      return res.status(404).json({
        success: false,
        message: "Tailor not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Tailor deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to delete tailor",
      error: error.message,
    });
  }
};