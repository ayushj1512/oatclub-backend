export function rmaReversePickupBookedTemplate({
  name = "Customer",
  orderNumber = "",
  rma = {},
  ctaUrl = "#",
} = {}) {
  const type =
    String(rma?.type).toLowerCase() === "exchange"
      ? "Exchange"
      : "Return";

  const shipment = rma?.reverseShipment || {};
  const rmaNumber = rma?.rmaNumber || "—";
  const courier = shipment?.courierName || shipment?.provider || "Courier Partner";
  const awb = shipment?.awb || "Will be updated shortly";
  const trackingUrl = shipment?.trackingUrl || ctaUrl;
  const pickupDate = formatDate(
    shipment?.expectedPickupAt || shipment?.pickupScheduledAt,
  );

  const subject =
    `OATCLUB ${type} Pickup Confirmed — ${rmaNumber}`;

  const text = `Hi ${name},

Your ${type.toLowerCase()} request has been approved and the reverse pickup has been booked.

Order: #${orderNumber}
Request: ${rmaNumber}
Courier: ${courier}
AWB: ${awb}
Expected Pickup: ${pickupDate}

Please keep the item unused, securely packed, and ready with all original tags.

${trackingUrl && trackingUrl !== "#" ? `Track Pickup: ${trackingUrl}` : ""}

With regards,
Team OATCLUB`;

  const html = `
<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    body{
      margin:0;background:#f2f2f2;color:#111;
      font-family:Inter,Arial,sans-serif;text-transform:uppercase;
    }
    .bg{padding:24px 12px}
    .shell{
      max-width:680px;margin:auto;background:#fff;
      border-radius:22px;overflow:hidden;
      box-shadow:0 24px 60px rgba(0,0,0,.12);
    }
    .top{
      padding:10px 18px;background:#111;color:#fff;
      text-align:center;font-size:10px;font-weight:900;
      letter-spacing:.24em;
    }
    .header{text-align:center;padding:24px}
    .logo{width:112px;height:auto}
    .kicker{
      margin:14px 0 7px;font-size:10px;font-weight:900;
      letter-spacing:.25em;color:#666;
    }
    h1{
      margin:0;font-size:28px;line-height:1.1;
      letter-spacing:-.04em;
    }
    .subtitle{
      margin:10px 0 0;color:#666;font-size:13px;
      line-height:1.6;
    }
    .body{padding:0 24px 26px}
    .greeting{font-size:20px;font-weight:900}
    .copy{
      color:#4a4a4a;font-size:14px;line-height:1.7;
      text-transform:none;
    }
    .status{
      margin:20px 0;padding:22px;border-radius:18px;
      background:#111;color:#fff;text-align:center;
    }
    .status small{
      display:block;font-size:10px;font-weight:900;
      letter-spacing:.22em;color:#ccc;
    }
    .status strong{
      display:block;margin-top:8px;font-size:24px;
    }
    .grid{
      display:grid;grid-template-columns:1fr 1fr;
      gap:12px;margin-top:18px;
    }
    .info{
      padding:13px;border-radius:14px;background:#f7f7f7;
      box-shadow:inset 0 0 0 1px rgba(0,0,0,.05);
    }
    .label{
      margin:0 0 7px;font-size:9px;font-weight:900;
      letter-spacing:.15em;color:#666;
    }
    .value{
      margin:0;font-size:13px;font-weight:900;
      word-break:break-word;
    }
    .note{
      margin-top:18px;padding:15px;border-radius:16px;
      background:#f6f6f6;
    }
    .btn-wrap{text-align:center;margin-top:20px}
    .btn{
      display:inline-block;padding:13px 21px;
      border-radius:999px;background:#111;color:#fff!important;
      text-decoration:none;font-size:11px;font-weight:900;
      letter-spacing:.14em;
    }
    .footer{
      padding:20px;background:#111;color:#fff;
      text-align:center;font-size:10px;font-weight:700;
      letter-spacing:.15em;
    }
    @media(max-width:620px){
      .bg{padding:10px 6px}
      .header,.body{padding-left:18px;padding-right:18px}
      .grid{grid-template-columns:1fr}
      h1{font-size:24px}
    }
  </style>
</head>

<body>
<div class="bg">
  <div class="shell">
    <div class="top">OATCLUB / REVERSE PICKUP</div>

    <div class="header">
      <img
        class="logo"
        src="https://res.cloudinary.com/dpsvrt4sd/image/upload/v1780338447/qavpt44lsxsy3wrvuwi8.png"
        alt="OATCLUB"
      />

      <p class="kicker">${escapeHtml(type)} REQUEST</p>
      <h1>Pickup Confirmed</h1>

      <p class="subtitle">
        Request <b>${escapeHtml(rmaNumber)}</b>
      </p>
    </div>

    <div class="body">
      <p class="greeting">Hi ${escapeHtml(name)},</p>

      <p class="copy">
        Your ${escapeHtml(type.toLowerCase())} request has been processed
        and the reverse courier pickup has been booked successfully.
      </p>

      <div class="status">
        <small>REQUEST STATUS</small>
        <strong>PICKUP SCHEDULED</strong>
      </div>

      <div class="grid">
        ${infoCard("Order", `#${orderNumber}`)}
        ${infoCard("Request ID", rmaNumber)}
        ${infoCard("Courier", courier)}
        ${infoCard("AWB / Tracking ID", awb)}
        ${infoCard("Request Type", type)}
        ${infoCard("Expected Pickup", pickupDate)}
      </div>

      <div class="note">
        <p class="copy" style="margin:0">
          Please keep the item <b>unused and securely packed</b> with
          all original tags and accessories. The courier executive may
          contact you before pickup.
        </p>
      </div>

      ${trackingUrl && trackingUrl !== "#"
      ? `
            <div class="btn-wrap">
              <a class="btn" href="${escapeAttr(trackingUrl)}">
                Track Reverse Pickup →
              </a>
            </div>
          `
      : ""
    }

      <p class="copy" style="margin-top:20px">
        Once the product reaches our warehouse, it will undergo a quality
        check. We will then process your
        ${type === "Exchange" ? "replacement shipment" : "refund"}.
      </p>

      <p class="copy">
        With regards,<br />
        <b>Team OATCLUB</b>
      </p>
    </div>

    <div class="footer">
      OATCLUB • OWN ALL TRENDS • HEY@OATCLUB.IN
    </div>
  </div>
</div>
</body>
</html>`;

  return { subject, text, html };
}

function infoCard(label, value) {
  return `
    <div class="info">
      <p class="label">${escapeHtml(label)}</p>
      <p class="value">${escapeHtml(value)}</p>
    </div>
  `;
}

function formatDate(value) {
  if (!value) return "Will be shared by courier";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Will be shared by courier";

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]);
}

const escapeAttr = escapeHtml;
