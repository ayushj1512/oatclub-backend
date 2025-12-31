import transporter from "./transporter.js";

export const sendEmail = async ({ to, subject, text, html }) => {
  try {
    const fromName = process.env.MAIL_FROM_NAME || "MIRAY FASHIONS";
    const fromEmail = process.env.MAIL_FROM_EMAIL || process.env.MAIL_USER;

    const info = await transporter.sendMail({
      from: `${fromName} <${fromEmail}>`,
      replyTo: process.env.MAIL_REPLY_TO || fromEmail,
      to,
      subject,
      text,
      html,
    });

    return info;
  } catch (error) {
    console.error("❌ Email Send Error:", error.message);
    throw error;
  }
};
