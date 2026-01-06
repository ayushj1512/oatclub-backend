import NewsletterSubscription from "../Newsletter/NewsletterSubscription.js";
import { sendBulkNewsletter } from "../utility/newsletterMailer.js";
import { newsletterWarmWelcomeTemplate } from "../nodemailer/template/NewsletterWelcomeTemplate.js";

/* --------------------------------------------------
   HELPERS
-------------------------------------------------- */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeEmails = (input = []) => {
  const list = Array.isArray(input) ? input : [input];

  return [
    ...new Set(
      list
        .map((e) => String(e || "").toLowerCase().trim())
        .filter((e) => EMAIL_REGEX.test(e))
    ),
  ];
};

/**
 * --------------------------------------------------
 * ✅ SUBSCRIBE (SINGLE / BULK)
 * --------------------------------------------------
 * POST /api/newsletters/subscribe
 *
 * Body:
 *  { email: "a@b.com", source:"modal", tags:["sale"] }
 *  OR
 *  { emails: ["a@b.com", "b@c.com"], source:"footer" }
 */
export const addSubscription = async (req, res) => {
  try {
    const { email, emails, source = "modal", tags = [] } = req.body;

    const validEmails = normalizeEmails(emails || email);

    if (!validEmails.length) {
      return res.status(400).json({ message: "Valid email(s) required" });
    }

    const now = new Date();
    const safeTags = Array.isArray(tags)
      ? [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))]
      : [];

    const ops = validEmails.map((email) => ({
      updateOne: {
        filter: { email },
        update: {
          $setOnInsert: {
            subscribedAt: now,
            source,
          },
          $set: {
            isActive: true,
            unsubscribedAt: null,
          },
          ...(safeTags.length
            ? { $addToSet: { tags: { $each: safeTags } } }
            : {}),
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
        received: Array.isArray(emails) ? emails.length : email ? 1 : 0,
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
 * ✅ GET ALL SUBSCRIBERS (ADMIN)
 * --------------------------------------------------
 * GET /api/newsletters/subscribers
 *
 * Query Params (optional):
 *  ?page=1&limit=50
 *  ?active=true
 *  ?verified=true
 *  ?suppressed=false
 *  ?tag=sale
 *  ?source=modal
 *  ?search=gmail
 */
export const getAllSubscriptions = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      active,
      verified,
      suppressed,
      tag,
      source,
      search,
    } = req.query;

    const filters = {};

    if (active !== undefined) filters.isActive = active === "true";
    if (verified !== undefined) filters.isVerified = verified === "true";
    if (suppressed !== undefined) filters.isSuppressed = suppressed === "true";
    if (tag) filters.tags = tag;
    if (source) filters.source = source;

    if (search) {
      filters.email = { $regex: search, $options: "i" };
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [subscriptions, total] = await Promise.all([
      NewsletterSubscription.find(filters)
        .sort({ subscribedAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .select(
          "email isActive isVerified isSuppressed source tags subscribedAt unsubscribedAt analytics lastSentAt createdAt updatedAt"
        ),
      NewsletterSubscription.countDocuments(filters),
    ]);

    return res.status(200).json({
      success: true,
      total,
      page: Number(page),
      limit: Number(limit),
      subscriptions,
    });
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
 * Body:
 * {
 *   subject: "Winter Sale Live ❄️",
 *   data: {
 *     title: "Winter Sale is LIVE!",
 *     message: "Flat 40% OFF for limited time only.",
 *     buttonText: "Shop Now",
 *     buttonLink: "https://mirayfashions.com/sale"
 *   }
 * }
 *
 * ✅ NO active / verified checks
 * ✅ jitne DB me emails hain sabko jayega
 */
export const sendBulkNewsletterUpdate = async (req, res) => {
  try {
    const {
      subject,
      data = {}, // extra template fields
    } = req.body;

    /* ---------------- FETCH ALL USERS (NO FILTERS) ---------------- */
    const subscribers = await NewsletterSubscription.find({}).select("email");

    const emails = [...new Set(subscribers.map((s) => s.email))];

    if (!emails.length) {
      return res.status(400).json({
        message: "No subscribers found",
      });
    }

    /* ---------------- GENERATE TEMPLATE HTML ---------------- */
    // ✅ Use your premium welcome template
    const templatePayload = newsletterWarmWelcomeTemplate({
      ...data,
    });

    const finalSubject = subject || templatePayload.subject;
    const html = templatePayload.html;
    const text = templatePayload.text;

    /* ---------------- SEND MAIL ---------------- */
    const result = await sendBulkNewsletter({
      recipients: emails,
      subject: finalSubject,
      html,
      text,
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
      totalRecipients: emails.length,
      stats: result,
      subjectUsed: finalSubject,
    });
  } catch (err) {
    console.error("Bulk newsletter send error:", err);
    return res.status(500).json({
      message: "Failed to send newsletter",
    });
  }
};
