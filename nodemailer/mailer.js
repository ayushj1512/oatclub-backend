import nodemailer from "nodemailer";

let cachedTransporter;

function getBool(v, fallback = false) {
  if (v == null) return fallback;
  return String(v).toLowerCase() === "true";
}

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.MAIL_HOST || "smtp-relay.gmail.com";
  const port = Number(process.env.MAIL_PORT || 587);
  const secure = getBool(process.env.MAIL_SECURE, port === 465);

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,

    // ✅ Relay on 587 should use STARTTLS
    requireTLS: true,

    // ✅ Avoid HELO/EHLO mismatch warnings in Workspace relay
    name: process.env.SMTP_EHLO_NAME || "mirayfashions.com",

    // ✅ Reuse connections (prevents baar-baar login/handshake)
    pool: true,
    maxConnections: Number(process.env.MAIL_MAX_CONNECTIONS || 2),
    maxMessages: Number(process.env.MAIL_MAX_MESSAGES || 500),
    rateDelta: Number(process.env.MAIL_RATE_DELTA || 1000),
    rateLimit: Number(process.env.MAIL_RATE_LIMIT || 5),

    // ✅ Useful timeouts for ETIMEDOUT
    connectionTimeout: Number(process.env.MAIL_CONN_TIMEOUT || 30_000),
    greetingTimeout: Number(process.env.MAIL_GREET_TIMEOUT || 30_000),
    socketTimeout: Number(process.env.MAIL_SOCKET_TIMEOUT || 60_000),

    // ✅ If you enabled "Require SMTP Authentication" in Admin console
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
    },
  });

  return cachedTransporter;
}

export async function sendMail({ to, subject, html, text, headers = {} }) {
  if (String(process.env.MAIL_ENABLED).toLowerCase() === "false") {
    return { disabled: true };
  }

  const t = getTransporter();

  // ✅ Force envelope MAIL FROM to your Workspace mailbox (helps relay acceptance)
  const envelopeFrom = process.env.MAIL_ENVELOPE_FROM || process.env.MAIL_USER;

  return t.sendMail({
    from: process.env.MAIL_FROM || process.env.MAIL_USER,
    replyTo: process.env.MAIL_REPLY_TO || undefined,

    envelope: {
      from: envelopeFrom,
      to,
    },

    to,
    subject,
    text,
    html,
    headers,
  });
}
