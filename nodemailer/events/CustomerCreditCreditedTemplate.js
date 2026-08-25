// nodemailer/events/CustomerCreditCreditedTemplate.js

export function customerCreditCreditedTemplate({
  name = "Customer",
  amount = 0,
  balance = 0,
  orderNumber = "",
  creditId = "",
  reason = "Refund",
  ctaUrl = "#",
  creditedAt = new Date(),
  currency = "INR",
} = {}) {
  const creditedAmount = num(amount);
  const currentBalance = num(balance);

  const orderId = String(orderNumber || "").trim();
  const transactionId = String(creditId || "").trim();

  const creditedOn = formatDate(creditedAt);
  const hasValidCta = Boolean(ctaUrl && ctaUrl !== "#");

  const subject = `OATCLUB Credits Added — ${money(
    creditedAmount,
    currency
  )}`;

  const text = `Hi ${name},

Your OATCLUB Credits have been updated successfully.

Credited Amount: ${money(creditedAmount, currency)}
Available Balance: ${money(currentBalance, currency)}
${orderId ? `Order ID: ${orderId}\n` : ""}${transactionId ? `Credit ID: ${transactionId}\n` : ""
    }Reason: ${reason || "Refund"}
Credited On: ${creditedOn}

Your refund has been processed as OATCLUB Credits. These credits are available in your account and can be used towards your future OATCLUB purchases.

${hasValidCta ? `Shop Now: ${ctaUrl}\n` : ""}
With regards,
Team OATCLUB
`;

  const html = `
<!doctype html>
<html>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />

<style>
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap");

body{
  margin:0;
  padding:0;
  background:#f2f2f2;
  color:#111111;
  font-family:Inter,Arial,sans-serif;
  text-transform:uppercase;
}

.oat-bg{
  padding:24px 12px;
  background:#f2f2f2;
}

.oat-shell{
  max-width:680px;
  margin:0 auto;
  background:#ffffff;
  border-radius:22px;
  overflow:hidden;
  box-shadow:0 24px 60px rgba(34,24,18,0.14);
}

.oat-top{
  background:#111111;
  color:#ffffff;
  text-align:center;
  padding:10px 18px;
  font-size:10px;
  font-weight:900;
  letter-spacing:.24em;
}

.oat-header{
  padding:24px 24px 18px;
  text-align:center;
}

.oat-logo{
  width:112px;
  max-width:160px;
  height:auto;
  display:block;
  margin:0 auto;
  object-fit:contain;
}

.oat-kicker{
  margin:14px 0 6px;
  font-size:10px;
  font-weight:900;
  letter-spacing:.26em;
  color:#5e5e5e;
}

.oat-title{
  margin:0;
  font-size:28px;
  line-height:1.08;
  font-weight:900;
  letter-spacing:-.04em;
  color:#111111;
}

.oat-subtitle{
  margin:8px 0 0;
  font-size:13px;
  line-height:1.7;
  color:#5e5e5e;
}

.oat-body{
  padding:6px 24px 24px;
}

.oat-greeting{
  margin:0;
  font-size:20px;
  line-height:1.15;
  font-weight:900;
  letter-spacing:-.03em;
  color:#111111;
}

.oat-copy{
  margin:10px 0 0;
  font-size:14px;
  line-height:1.7;
  color:#4a4a4a;
}

.oat-credit-card{
  margin-top:22px;
  background:#111111;
  color:#ffffff;
  padding:24px 18px;
  border-radius:18px;
  text-align:center;
  box-shadow:0 14px 30px rgba(17,17,17,0.14);
}

.oat-credit-label{
  margin:0 0 8px;
  font-size:10px;
  font-weight:900;
  letter-spacing:.22em;
  color:#cfcfcf;
}

.oat-credit-value{
  margin:0;
  font-size:34px;
  line-height:1.1;
  font-weight:900;
  letter-spacing:-.04em;
  color:#ffffff;
}

.oat-credit-sub{
  margin:10px 0 0;
  font-size:11px;
  font-weight:700;
  letter-spacing:.12em;
  color:#cfcfcf;
}

.oat-grid{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:12px;
  margin-top:18px;
}

.oat-info{
  background:#f7f7f7;
  padding:12px;
  border-radius:14px;
  box-shadow:inset 0 0 0 1px rgba(32,26,23,0.05);
}

.oat-info-label{
  margin:0 0 7px;
  font-size:10px;
  font-weight:900;
  letter-spacing:.16em;
  color:#666666;
}

.oat-info-value{
  margin:0;
  font-size:13px;
  font-weight:900;
  color:#111111;
  word-break:break-word;
}

.oat-section{
  margin-top:18px;
}

.oat-section-title{
  margin:0 0 8px;
  font-size:10px;
  font-weight:900;
  letter-spacing:.2em;
  color:#111111;
}

.oat-card{
  background:#fafafa;
  padding:14px;
  border-radius:16px;
  box-shadow:inset 0 0 0 1px rgba(32,26,23,0.05);
}

.oat-row{
  display:flex;
  justify-content:space-between;
  gap:16px;
  padding:8px 0;
  border-bottom:1px solid rgba(32,26,23,0.08);
  font-size:13px;
  color:#4a4a4a;
}

.oat-row:last-child{
  border-bottom:0;
}

.oat-row b{
  color:#111111;
}

.oat-total{
  font-size:16px;
  font-weight:900;
  color:#111111;
}

.oat-note-card{
  margin-top:18px;
  background:#f6f6f6;
  padding:14px;
  border-radius:16px;
  box-shadow:inset 0 0 0 1px rgba(32,26,23,0.04);
}

.oat-btn-wrap{
  margin-top:18px;
  text-align:center;
}

.oat-btn{
  display:inline-block;
  background:#111111;
  color:#ffffff !important;
  text-decoration:none;
  padding:12px 20px;
  font-size:11px;
  font-weight:900;
  letter-spacing:.16em;
  border-radius:999px;
  box-shadow:0 12px 24px rgba(17,17,17,0.16);
}

.oat-footer{
  padding:20px 26px;
  background:#111111;
  color:#ffffff;
  text-align:center;
}

.oat-footer p{
  margin:0;
  font-size:10px;
  line-height:1.8;
  font-weight:700;
  letter-spacing:.16em;
  color:#ffffff;
}

@media only screen and (max-width:620px){
  .oat-bg{
    padding:12px 7px;
  }

  .oat-header,
  .oat-body{
    padding-left:18px;
    padding-right:18px;
  }

  .oat-grid{
    grid-template-columns:1fr;
  }

  .oat-title{
    font-size:24px;
  }

  .oat-greeting{
    font-size:22px;
  }

  .oat-credit-value{
    font-size:30px;
  }

  .oat-row{
    display:block;
  }

  .oat-row b{
    display:block;
    margin-top:3px;
  }
}
</style>
</head>

<body>
<div class="oat-bg">
  <div class="oat-shell">

    <div class="oat-top">
      OATCLUB / CREDIT UPDATE
    </div>

    <div class="oat-header">
      <img
        class="oat-logo"
        src="https://res.cloudinary.com/dpsvrt4sd/image/upload/v1780338447/qavpt44lsxsy3wrvuwi8.png"
        alt="OATCLUB"
      />

      <p class="oat-kicker">CREDITS ADDED</p>

      <h1 class="oat-title">
        Your Credits Are Ready
      </h1>

      <p class="oat-subtitle">
        Added successfully on
        <b>${escapeHtml(creditedOn)}</b>
      </p>
    </div>

    <div class="oat-body">

      <h2 class="oat-greeting">
        Hi ${escapeHtml(name)},
      </h2>

      <p class="oat-copy">
        Your refund has been successfully processed and added to your
        OATCLUB Credits.
      </p>

      <div class="oat-credit-card">
        <p class="oat-credit-label">
          CREDITED AMOUNT
        </p>

        <p class="oat-credit-value">
          ${escapeHtml(money(creditedAmount, currency))}
        </p>

        <p class="oat-credit-sub">
          SUCCESSFULLY ADDED TO YOUR OATCLUB ACCOUNT
        </p>
      </div>

      <div class="oat-grid">
        ${infoCard(
    "Available Balance",
    money(currentBalance, currency)
  )}

        ${infoCard("Credit Type", reason || "Refund")}

        ${orderId
      ? infoCard(
        "Order",
        `#${String(orderId).replace(/^#/, "")}`
      )
      : ""
    }

        ${transactionId ? infoCard("Credit ID", transactionId) : ""}
      </div>

      <div class="oat-section">
        <p class="oat-section-title">
          Credit Summary
        </p>

        <div class="oat-card">
          ${summaryRow(
      "Amount Credited",
      money(creditedAmount, currency)
    )}

          ${summaryRow("Reason", reason || "Refund")}

          ${orderId ? summaryRow("Order ID", orderId) : ""}

          ${transactionId
      ? summaryRow("Credit ID", transactionId)
      : ""}

          ${summaryRow("Credited On", creditedOn)}

          ${summaryRow(
        "Available Balance",
        money(currentBalance, currency),
        true
      )}
        </div>
      </div>

      <div class="oat-note-card">
        <p class="oat-copy" style="margin:0;">
          Your refund has been issued as <b>OATCLUB Credits</b>.
          The available balance can be used towards your future
          purchases on OATCLUB.
        </p>
      </div>

      ${hasValidCta
      ? `
      <div class="oat-btn-wrap">
        <a
          href="${escapeAttr(ctaUrl)}"
          class="oat-btn"
        >
          Shop With Your Credits →
        </a>
      </div>
      `
      : ""
    }

      <p class="oat-copy" style="margin-top:18px;">
        With regards,<br/>
        <b>Team OATCLUB</b>
      </p>

    </div>

    <div class="oat-footer">
      <p>
        OATCLUB • OWN ALL TRENDS • hey@oatclub.in
      </p>
    </div>

  </div>
</div>
</body>
</html>
`;

  return {
    subject,
    text,
    html,
  };
}

/* ---------------- HELPERS ---------------- */

function infoCard(label, value) {
  return `
  <div class="oat-info">
    <p class="oat-info-label">
      ${escapeHtml(label)}
    </p>

    <p class="oat-info-value">
      ${escapeHtml(value)}
    </p>
  </div>`;
}

function summaryRow(label, value, strong = false) {
  return `
  <div class="oat-row ${strong ? "oat-total" : ""}">
    <span>${escapeHtml(label)}</span>
    <b>${escapeHtml(value)}</b>
  </div>`;
}

function formatDate(date) {
  try {
    return new Date(date).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "Recently";
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function money(value, currency = "INR") {
  const n = num(value);

  return currency === "INR"
    ? `₹${n.toLocaleString("en-IN", {
      maximumFractionDigits: 2,
    })}`
    : `${currency} ${n.toLocaleString()}`;
}

function escapeHtml(str) {
  return String(str ?? "").replace(
    /[&<>"']/g,
    (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[m]
  );
}

function escapeAttr(str) {
  return escapeHtml(str);
}
