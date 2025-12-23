import { mailTransporter } from "./mailer.js";

/**
 * Send a single email
 */
export const sendEmail = async ({
  to,
  subject,
  html,
  text,
  from = `"Miray Fashions" <no-reply@mirayfashions.com>`,
}) => {
  if (!to) throw new Error("Recipient email missing");

  return mailTransporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
  });
};
