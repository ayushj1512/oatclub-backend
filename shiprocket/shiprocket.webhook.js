export async function shiprocketWebhook(req, res) {
  const data = req.body;

  // Example mapping
  // data.current_status === "Delivered"
  // data.awb
  // data.order_id

  console.log("Shiprocket Webhook:", data);

  // TODO:
  // updateOrderStatus(data.order_id, data.current_status)

  res.status(200).json({ success: true });
}
