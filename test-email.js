// test-email.js
import "dotenv/config";
import nodemailer from "nodemailer";

async function sendTestEmail() {
  console.log("🧪 Running email test script...\n");

  console.log("📨 MAIL_ENABLED:", process.env.MAIL_ENABLED);
  console.log("📧 MAIL_USER:", process.env.MAIL_USER);
  console.log("🔐 MAIL_PASS:", process.env.MAIL_PASS ? "✅ present" : "❌ missing");
  console.log("🌐 MAIL_HOST:", process.env.MAIL_HOST);
  console.log("🔢 MAIL_PORT:", process.env.MAIL_PORT);
  console.log("🔒 MAIL_SECURE:", process.env.MAIL_SECURE);

  if (process.env.MAIL_ENABLED !== "true") {
    console.log("\n📭 MAIL_ENABLED is not true → exiting.");
    process.exit(0);
  }

  if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
    console.log("\n❌ MAIL_USER or MAIL_PASS missing → exiting.");
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST || "smtp.gmail.com",
    port: Number(process.env.MAIL_PORT || 587),
    secure: process.env.MAIL_SECURE === "true",
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
    },
  });

  try {
    console.log("\n🔍 Verifying SMTP...");
    await transporter.verify();
    console.log("✅ SMTP Verify OK");

    console.log("\n📩 Sending test email...");

    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.MAIL_USER,
      to: "miray.ayushjuneja@gmail.com",
      subject: "✅ Miray Backend Test Email",
      text: "Test email from Miray backend (nodemailer). If you received this, SMTP is working ✅",
      html: `
        <div style="font-family: Arial; padding: 12px;">
          <h2>✅ Miray Backend Test Email</h2>
          <p>Hi <b>Ayush</b>,</p>
          <p>This is a manual test email sent from <b>nodemailer</b>.</p>
          <p>If you received this, your SMTP setup is working ✅</p>
          <hr />
          <small>Mailer: ${process.env.MAIL_USER}</small>
        </div>
      `,
      replyTo: process.env.MAIL_REPLY_TO || process.env.MAIL_USER,
    });

    console.log("\n✅ Email Sent Successfully!");
    console.log("📨 Message ID:", info.messageId);
    console.log("📬 Response:", info.response);

    process.exit(0);
  } catch (err) {
    console.error("\n❌ Email Test Failed FULL ERROR:");
    console.error(err);
    process.exit(1);
  }
}

sendTestEmail();
