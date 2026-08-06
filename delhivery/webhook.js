// Receive Delhivery shipment updates
export const delhiveryWebhook = async (req, res) => {
  try {
    const update = req.body;

    console.log("Delhivery webhook:", update);

    // Update order status here using AWB/order number

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
