import NewsletterSubscription from "../models/NewsletterSubscription.js";

/**
 * @desc Add a new newsletter subscription
 * @route POST /api/newsletter
 * @access Public
 */
export const addSubscription = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) return res.status(400).json({ message: "Email is required." });

    // Check if already subscribed
    const existing = await NewsletterSubscription.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: "This email is already subscribed." });
    }

    const subscription = await NewsletterSubscription.create({ email });
    res.status(201).json({ message: "Subscription added successfully", subscription });
  } catch (error) {
    console.error("Error adding subscription:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * @desc Get all newsletter subscriptions
 * @route GET /api/newsletter
 * @access Private/Admin
 */
export const getAllSubscriptions = async (req, res) => {
  try {
    const subscriptions = await NewsletterSubscription.find()
      .sort({ subscribedAt: -1 });
    res.status(200).json(subscriptions);
  } catch (error) {
    console.error("Error fetching subscriptions:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
