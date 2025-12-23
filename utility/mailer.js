import nodemailer from "nodemailer";

/**
 * Create reusable transporter
 * Uses your custom domain email
 */
export const mailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST, // e.g. mail.mirayfashions.com
  port: Number(process.env.SMTP_PORT || 587),
  secure: false, // true only for 465
  auth: {
    user: process.env.SMTP_USER, // no-reply@mirayfashions.com
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Optional: verify on startup
 */
export const verifyMailer = async () => {
  try {
    await mailTransporter.verify();
    console.log("✅ Mail server ready");
  } catch (err) {
    console.error("❌ Mail server error:", err.message);
  }
};
