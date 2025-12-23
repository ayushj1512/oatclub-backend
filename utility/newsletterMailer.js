import nodemailer from "nodemailer";

/**
 * --------------------------------------------------
 * MAIL TRANSPORTER
 * --------------------------------------------------
 * Uses SMTP (Gmail / Zoho / SES / custom)
 */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,       // eg: smtp.gmail.com
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,                     // true for 465, false for 587
  auth: {
    user: process.env.SMTP_USER,     // your email
    pass: process.env.SMTP_PASS,     // app password
  },
});

/**
 * --------------------------------------------------
 * SEND BULK NEWSLETTER
 * --------------------------------------------------
 * @param {Object} params
 * @param {string[]} params.recipients
 * @param {string} params.subject
 * @param {string} params.html
 */
export const sendBulkNewsletter = async ({
  recipients = [],
  subject,
  html,
}) => {
  if (!recipients.length) {
    throw new Error("No recipients provided");
  }

  const BATCH_SIZE = 50; // 🔥 safe batch size
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);

    try {
      await transporter.sendMail({
        from: `"Miray Fashions" <${process.env.SMTP_FROM}>`,
        bcc: batch, // 🔥 privacy safe
        subject,
        html,
      });

      sent += batch.length;
    } catch (err) {
      console.error("Newsletter batch failed:", err);
      failed += batch.length;
    }
  }

  return {
    total: recipients.length,
    sent,
    failed,
  };
};
