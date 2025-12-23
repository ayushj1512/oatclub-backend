import Query from "./Query.js";

/**
 * @desc Create a new query
 * @route POST /api/queries
 * @access Public
 */
export const createQuery = async (req, res) => {
  try {
    const queryData = req.body;
    const query = await Query.create(queryData);

    res.status(201).json({ message: "Query submitted successfully", query });
  } catch (error) {
    console.error("Error creating query:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Get all queries (optionally filter by status/type)
 * @route GET /api/queries
 * @access Private/Admin
 */
export const getAllQueries = async (req, res) => {
  try {
    const { status, queryType } = req.query;

    const filters = {};
    if (status) filters.status = status;
    if (queryType) filters.queryType = queryType;

    const queries = await Query.find(filters)
      .populate("customerId", "name email")
      .populate("respondedBy", "name email")
      .sort({ createdAt: -1 });

    res.status(200).json(queries);
  } catch (error) {
    console.error("Error fetching queries:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Get a single query by ID
 * @route GET /api/queries/:id
 * @access Private/Admin
 */
export const getQueryById = async (req, res) => {
  try {
    const query = await Query.findById(req.params.id)
      .populate("customerId", "name email")
      .populate("respondedBy", "name email");

    if (!query) return res.status(404).json({ message: "Query not found" });

    res.status(200).json(query);
  } catch (error) {
    console.error("Error fetching query:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Update a query by ID (status, adminNotes, respondedBy)
 * @route PUT /api/queries/:id
 * @access Private/Admin
 */
export const updateQuery = async (req, res) => {
  try {
    const updatedQuery = await Query.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!updatedQuery) return res.status(404).json({ message: "Query not found" });

    res.status(200).json({ message: "Query updated successfully", query: updatedQuery });
  } catch (error) {
    console.error("Error updating query:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Delete a query by ID
 * @route DELETE /api/queries/:id
 * @access Private/Admin
 */
export const deleteQuery = async (req, res) => {
  try {
    const deletedQuery = await Query.findByIdAndDelete(req.params.id);

    if (!deletedQuery) return res.status(404).json({ message: "Query not found" });

    res.status(200).json({ message: "Query deleted successfully" });
  } catch (error) {
    console.error("Error deleting query:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
