import NewsletterSubscription from "../Newsletter/NewsletterSubscription.js";
import { sendBulkNewsletter } from "../utility/newsletterMailer.js";

/**
 * --------------------------------------------------
 * SUBSCRIBE (SINGLE / BULK)
 * --------------------------------------------------
 * POST /api/newsletters/subscribe
 */
export const addSubscription = async (req, res) => {
  try {
    const { email, emails } = req.body;

    const list = Array.isArray(emails)
      ? emails
      : email
      ? [email]
      : [];

    if (!list.length) {
      return res.status(400).json({ message: "Email(s) required" });
    }

    const validEmails = [
      ...new Set(
        list
          .map((e) => String(e || "").toLowerCase().trim())
          .filter((e) =>
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
          )
      ),
    ];

    if (!validEmails.length) {
      return res.status(400).json({ message: "No valid emails found" });
    }

    const now = new Date();

    const ops = validEmails.map((email) => ({
      updateOne: {
        filter: { email },
        update: {
          $setOnInsert: { subscribedAt: now },
          $set: { isActive: true, unsubscribedAt: null },
        },
        upsert: true,
      },
    }));

    const result = await NewsletterSubscription.bulkWrite(ops, {
      ordered: false,
    });

    return res.status(200).json({
      success: true,
      message: "Subscription processed",
      summary: {
        input: list.length,
        valid: validEmails.length,
        inserted: result.upsertedCount || 0,
        updated: result.modifiedCount || 0,
      },
    });
  } catch (err) {
    console.error("Newsletter subscribe error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * --------------------------------------------------
 * GET ALL SUBSCRIBERS (ADMIN)
 * --------------------------------------------------
 * GET /api/newsletters/subscribers
 */
export const getAllSubscriptions = async (_req, res) => {
  try {
    const subscriptions = await NewsletterSubscription.find()
      .sort({ subscribedAt: -1 })
      .select("-verificationToken -__v");

    return res.status(200).json(subscriptions);
  } catch (err) {
    console.error("Fetch subscriptions error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * --------------------------------------------------
 * 🔥 SEND BULK NEWSLETTER (ADMIN)
 * --------------------------------------------------
 * POST /api/newsletters/send
 *
 * body:
 * {
 *   subject: "Winter Sale is Live",
 *   html: "<h1>Flat 40% OFF</h1>"
 * }
 */
export const sendBulkNewsletterUpdate = async (req, res) => {
  try {
    const { subject, html } = req.body;

    if (!subject || !html) {
      return res.status(400).json({
        message: "Subject and HTML content are required",
      });
    }

    /* ---------------- FETCH TARGET USERS ---------------- */
    const subscribers = await NewsletterSubscription.find({
      isActive: true,
      isSuppressed: false,
    }).select("email");

    const emails = subscribers.map((s) => s.email);

    if (!emails.length) {
      return res.status(400).json({
        message: "No active subscribers found",
      });
    }

    /* ---------------- SEND MAIL ---------------- */
    const result = await sendBulkNewsletter({
      recipients: emails,
      subject,
      html,
    });

    /* ---------------- ANALYTICS UPDATE ---------------- */
    await NewsletterSubscription.updateMany(
      { email: { $in: emails } },
      {
        $inc: { "analytics.totalSent": 1 },
        $set: { lastSentAt: new Date() },
      }
    );

    return res.status(200).json({
      success: true,
      message: "Newsletter sent successfully",
      stats: result,
    });
  } catch (err) {
    console.error("Bulk newsletter send error:", err);
    return res.status(500).json({
      message: "Failed to send newsletter",
    });
  }
};
