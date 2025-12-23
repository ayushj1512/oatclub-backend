import { mailTransporter } from "./mailer.js";

/**
 * Send newsletter in batches (rate-safe)
 */
export const sendNewsletterBatch = async ({
  recipients = [],
  subject,
  html,
  batchSize = 50, // safe for most SMTP servers
  delayMs = 1000, // 1s between batches
}) => {
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);

    await Promise.allSettled(
      batch.map((email) =>
        mailTransporter.sendMail({
          from: `"Miray Fashions" <no-reply@mirayfashions.com>`,
          to: email,
          subject,
          html,
        })
      )
    ).then((results) => {
      results.forEach((r) =>
        r.status === "fulfilled" ? sent++ : failed++
      );
    });

    // delay between batches (important)
    if (i + batchSize < recipients.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return { sent, failed };
};
