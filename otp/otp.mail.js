import * as mailerModule from "../nodemailer/mailer.js";
import { OTP_CONFIG } from "./otp.constants.js";

/* =========================================================
   BRAND CONFIG
========================================================= */

const BRAND = {
  name: "OATCLUB",
  tagline: "Own All Trends",
  website: process.env.FRONTEND_URL || "https://www.oatclub.in",
  supportEmail:
    process.env.SUPPORT_EMAIL ||
    process.env.SMTP_FROM_EMAIL ||
    process.env.SMTP_USER ||
    "support@oatclub.in",
};

/* =========================================================
   MAILER RESOLVER

   Existing mailer.js ke common export formats support karta hai.
========================================================= */

const sendMail = async (options) => {
  if (typeof mailerModule.sendMail === "function") {
    return mailerModule.sendMail(options);
  }

  if (typeof mailerModule.sendEmail === "function") {
    return mailerModule.sendEmail(options);
  }

  if (typeof mailerModule.default === "function") {
    return mailerModule.default(options);
  }

  if (typeof mailerModule.default?.sendMail === "function") {
    return mailerModule.default.sendMail(options);
  }

  if (typeof mailerModule.transporter?.sendMail === "function") {
    return mailerModule.transporter.sendMail(options);
  }

  throw new Error(
    "No compatible mail sender found inside nodemailer/mailer.js",
  );
};

/* =========================================================
   PURPOSE CONTENT
========================================================= */

const OTP_CONTENT = {
  login: {
    title: "Login Verification",
    message:
      "Use this verification code to securely log in to your OATCLUB account.",
  },

  signup: {
    title: "Complete Your Signup",
    message:
      "Use this verification code to complete your OATCLUB account registration.",
  },

  email_verification: {
    title: "Verify Your Email",
    message: "Use this verification code to verify your email address.",
  },

  password_reset: {
    title: "Reset Your Password",
    message:
      "Use this verification code to securely reset your OATCLUB account password.",
  },

  order_verification: {
    title: "Verify Your Order",
    message:
      "Use this verification code to securely verify your OATCLUB order.",
  },
};

const getOtpContent = (purpose) =>
  OTP_CONTENT[purpose] || {
    title: "Verification Code",
    message: "Use this verification code to complete your request.",
  };

/* =========================================================
   SAFE HTML
========================================================= */

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

/* =========================================================
   EMAIL TEMPLATE
========================================================= */

export const buildOtpEmail = ({ otp, name = "", purpose = "login" }) => {
  const content = getOtpContent(purpose);

  const customerName = escapeHtml(String(name || "").trim() || "there");

  const safeOtp = escapeHtml(otp);

  const subject = `${otp} is your OATCLUB verification code`;

  const text = `Hi ${name || "there"},

${content.message}

Your OTP is: ${otp}

This OTP is valid for ${OTP_CONFIG.EXPIRY_MINUTES} minutes.

Please do not share this OTP with anyone. OATCLUB will never ask you to share your OTP over a call, message, or email.

Thank you,
Team OATCLUB
Own All Trends`;

  const html = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />

    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />

    <title>${escapeHtml(content.title)}</title>
  </head>

  <body
    style="
      margin:0;
      padding:0;
      background:#f5f5f5;
      font-family:Arial,Helvetica,sans-serif;
      color:#111111;
    "
  >
    <table
      role="presentation"
      width="100%"
      cellspacing="0"
      cellpadding="0"
      border="0"
      style="background:#f5f5f5;padding:32px 12px;"
    >
      <tr>
        <td align="center">
          <table
            role="presentation"
            width="100%"
            cellspacing="0"
            cellpadding="0"
            border="0"
            style="
              max-width:560px;
              overflow:hidden;
              border:1px solid #e8e8e8;
              border-radius:18px;
              background:#ffffff;
            "
          >
            <!-- Header -->
<tr>
  <td
    align="center"
    style="
      padding:28px 20px;
      background:#000000;
    "
  >
    <img
      src="https://res.cloudinary.com/dpsvrt4sd/image/upload/v1781123546/odb5ckquouajjzfbxin0.webp"
      alt="${BRAND.name}"
      width="180"
      style="
        display:block;
        margin:0 auto;
        width:180px;
        max-width:80%;
        height:auto;
        border:0;
        outline:none;
        text-decoration:none;
      "
    />

    <div
      style="
        margin-top:12px;
        font-size:11px;
        font-weight:600;
        letter-spacing:2px;
        color:#d4d4d4;
        text-transform:uppercase;
      "
    >
      ${BRAND.tagline}
    </div>
  </td>
</tr>

            <!-- Body -->
            <tr>
              <td style="padding:32px 28px;">
                <p
                  style="
                    margin:0 0 14px;
                    font-size:16px;
                    line-height:1.6;
                  "
                >
                  Hi ${customerName},
                </p>

                <h1
                  style="
                    margin:0 0 12px;
                    font-size:24px;
                    line-height:1.3;
                    color:#111111;
                  "
                >
                  ${escapeHtml(content.title)}
                </h1>

                <p
                  style="
                    margin:0;
                    font-size:15px;
                    line-height:1.7;
                    color:#555555;
                  "
                >
                  ${escapeHtml(content.message)}
                </p>

                <!-- OTP -->
                <div
                  style="
                    margin:28px 0;
                    padding:24px 16px;
                    border:1px solid #e5e5e5;
                    border-radius:14px;
                    background:#f7f7f7;
                    text-align:center;
                  "
                >
                  <div
                    style="
                      margin-bottom:10px;
                      font-size:11px;
                      font-weight:700;
                      letter-spacing:1.5px;
                      text-transform:uppercase;
                      color:#777777;
                    "
                  >
                    Your verification code
                  </div>

                  <div
                    style="
                      font-size:38px;
                      font-weight:800;
                      letter-spacing:10px;
                      color:#000000;
                    "
                  >
                    ${safeOtp}
                  </div>
                </div>

                <p
                  style="
                    margin:0 0 14px;
                    font-size:14px;
                    line-height:1.7;
                    color:#555555;
                  "
                >
                  This OTP is valid for
                  <strong>
                    ${OTP_CONFIG.EXPIRY_MINUTES} minutes
                  </strong>.
                </p>

                <div
                  style="
                    padding:14px;
                    border-radius:12px;
                    background:#fff8e6;
                    color:#6b5216;
                    font-size:13px;
                    line-height:1.65;
                  "
                >
                  Please do not share this OTP with anyone.
                  OATCLUB will never ask you to share your OTP over
                  a call, message, or email.
                </div>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td
                align="center"
                style="
                  padding:22px 24px;
                  border-top:1px solid #eeeeee;
                  font-size:12px;
                  line-height:1.7;
                  color:#888888;
                "
              >
                Need help?

                <a
                  href="mailto:${BRAND.supportEmail}"
                  style="
                    color:#111111;
                    font-weight:600;
                    text-decoration:none;
                  "
                >
                  ${BRAND.supportEmail}
                </a>

                <br />

                <a
                  href="${BRAND.website}"
                  style="
                    color:#111111;
                    text-decoration:none;
                  "
                >
                  ${BRAND.website}
                </a>

                <br />

                ${BRAND.name} — ${BRAND.tagline}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

  return {
    subject,
    text,
    html,
  };
};

/* =========================================================
   SEND OTP EMAIL
========================================================= */

export const sendOtpEmail = async ({
  to,
  otp,
  name = "",
  purpose = "login",
}) => {
  if (!to) {
    throw new Error("OTP recipient email is required");
  }

  if (!otp) {
    throw new Error("OTP value is required");
  }

  const template = buildOtpEmail({
    otp,
    name,
    purpose,
  });

  const fromEmail =
    process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || BRAND.supportEmail;

  const fromName = process.env.SMTP_FROM_NAME || BRAND.name;

  return sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject: template.subject,
    text: template.text,
    html: template.html,
  });
};

export default sendOtpEmail;
