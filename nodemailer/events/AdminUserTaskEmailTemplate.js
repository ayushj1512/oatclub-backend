// nodemailer/events/AdminUserTaskEmailTemplate.js

const EVENT_CONFIG = {
  task_created: {
    subjectLabel: "New Task Assigned",
    kicker: "NEW TASK ASSIGNMENT",
    title: "A New Task Is Waiting",
    intro:
      "A new internal task has been assigned and is ready for action.",
    actionLabel: "Open Task",
    accent: "#2563eb",
    softAccent: "#eff6ff",
    statusLabel: "Assigned",
  },

  task_started: {
    subjectLabel: "Task Started",
    kicker: "WORK HAS STARTED",
    title: "Task Is Now In Progress",
    intro:
      "The assigned user has started working on this task.",
    actionLabel: "Review Progress",
    accent: "#d97706",
    softAccent: "#fffbeb",
    statusLabel: "In Progress",
  },

  task_submitted: {
    subjectLabel: "Task Submitted",
    kicker: "READY FOR REVIEW",
    title: "Work Has Been Submitted",
    intro:
      "The task has been submitted and is now waiting for review.",
    actionLabel: "Review Submission",
    accent: "#7c3aed",
    softAccent: "#f5f3ff",
    statusLabel: "Submitted",
  },

  feedback_added: {
    subjectLabel: "New Task Comment",
    kicker: "NEW CONVERSATION UPDATE",
    title: "A New Comment Was Added",
    intro:
      "There is a new comment or update on this task.",
    actionLabel: "View Conversation",
    accent: "#0f766e",
    softAccent: "#f0fdfa",
    statusLabel: "Comment Added",
  },

  rework_requested: {
    subjectLabel: "Rework Requested",
    kicker: "ACTION REQUIRED",
    title: "Changes Are Required",
    intro:
      "The submitted work needs updates before it can be approved.",
    actionLabel: "View Rework Notes",
    accent: "#ea580c",
    softAccent: "#fff7ed",
    statusLabel: "Rework",
  },

  task_closed: {
    subjectLabel: "Task Closed",
    kicker: "TASK COMPLETED",
    title: "Task Successfully Closed",
    intro:
      "The submitted work has been approved and the task is now complete.",
    actionLabel: "View Completed Task",
    accent: "#059669",
    softAccent: "#ecfdf5",
    statusLabel: "Closed",
  },

  task_cancelled: {
    subjectLabel: "Task Cancelled",
    kicker: "TASK UPDATE",
    title: "Task Has Been Cancelled",
    intro:
      "This task has been cancelled and no further action is required.",
    actionLabel: "View Task",
    accent: "#dc2626",
    softAccent: "#fef2f2",
    statusLabel: "Cancelled",
  },

  assignee_changed: {
    subjectLabel: "Task Reassigned",
    kicker: "ASSIGNMENT UPDATED",
    title: "Task Ownership Has Changed",
    intro:
      "This task has been reassigned to another admin user.",
    actionLabel: "Open Task",
    accent: "#4f46e5",
    softAccent: "#eef2ff",
    statusLabel: "Reassigned",
  },

  deadline_updated: {
    subjectLabel: "Deadline Updated",
    kicker: "SCHEDULE UPDATE",
    title: "Task Deadline Has Changed",
    intro:
      "The deadline for this task has been updated.",
    actionLabel: "Review Deadline",
    accent: "#9333ea",
    softAccent: "#faf5ff",
    statusLabel: "Deadline Updated",
  },

  task_updated: {
    subjectLabel: "Task Updated",
    kicker: "TASK DETAILS UPDATED",
    title: "Task Information Has Changed",
    intro:
      "Important details of this task have been updated.",
    actionLabel: "Review Changes",
    accent: "#111827",
    softAccent: "#f3f4f6",
    statusLabel: "Updated",
  },
};

export function adminUserTaskEmailTemplate({
  eventType = "task_created",
  task = {},
  recipient = {},
  actor = {},
  message = "",
  feedback = "",
  ctaUrl = "#",
  brandName = "OATCLUB",
  supportEmail = process.env.MAIL_REPLY_TO || process.env.MAIL_USER || "",
} = {}) {
  const config =
    EVENT_CONFIG[eventType] || EVENT_CONFIG.task_updated;

  const taskNumber = task?.taskNumber || task?._id || "—";
  const heading = task?.heading || "Internal Admin Task";
  const brief = task?.brief || "";
  const priority = pretty(task?.priority || "medium");
  const status = pretty(
    task?.status || config.statusLabel || "assigned",
  );

  const assignedBy = getUserName(task?.assignedBy);
  const assignedTo = getUserName(task?.assignedTo);
  const actorName = getUserName(actor);
  const recipientName = getUserName(recipient, "Team Member");

  const createdAt = formatDate(task?.createdAt);
  const updatedAt = formatDate(task?.updatedAt);
  const deadline = task?.deadline
    ? formatDate(task.deadline)
    : "No deadline";

  const startedAt = task?.startedAt
    ? formatDate(task.startedAt)
    : "";

  const submittedAt = task?.submittedAt
    ? formatDate(task.submittedAt)
    : "";

  const closedAt = task?.closedAt
    ? formatDate(task.closedAt)
    : "";

  const reworkCount = Number(task?.reworkCount || 0);
  const tags = Array.isArray(task?.tags)
    ? task.tags.filter(Boolean).slice(0, 12)
    : [];

  const mediaCount =
    Number(task?.media?.length || 0) +
    Number(task?.submissionMedia?.length || 0);

  const actionMessage =
    feedback ||
    message ||
    task?.submissionMessage ||
    "";

  const hasValidCta = Boolean(ctaUrl && ctaUrl !== "#");

  const subject = `${config.subjectLabel} — ${taskNumber} | ${heading}`;

  const text = `
${brandName} ADMIN TASK UPDATE

${config.subjectLabel}

Hello ${recipientName},

${config.intro}

Task Number: ${taskNumber}
Task: ${heading}
Status: ${status}
Priority: ${priority}
Assigned To: ${assignedTo}
Created By: ${assignedBy}
Action By: ${actorName}
Deadline: ${deadline}
Rework Count: ${reworkCount}

${brief ? `Task Brief:\n${brief}\n` : ""}
${actionMessage ? `Latest Update:\n${actionMessage}\n` : ""}

Created: ${createdAt}
Updated: ${updatedAt}
${startedAt ? `Started: ${startedAt}` : ""}
${submittedAt ? `Submitted: ${submittedAt}` : ""}
${closedAt ? `Closed: ${closedAt}` : ""}

${tags.length ? `Tags: ${tags.join(", ")}` : ""}
Attachments: ${mediaCount}

${hasValidCta ? `Open Task: ${ctaUrl}` : ""}

This is an automated internal notification from ${brandName}.
${supportEmail ? `Support: ${supportEmail}` : ""}
  `.trim();

  const html = `
<!doctype html>
<html>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />

<style>
@import url("https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&family=Space+Grotesk:wght@600;700;800&display=swap");

body{
  margin:0;
  padding:0;
  background:#f2f3f5;
  color:#111111;
  font-family:Poppins,Arial,sans-serif;
}

*{
  box-sizing:border-box;
}

.task-bg{
  padding:26px 12px;
  background:
    radial-gradient(circle at top left, ${config.softAccent} 0, transparent 34%),
    #f2f3f5;
}

.task-shell{
  max-width:720px;
  margin:0 auto;
  background:#ffffff;
  border-radius:24px;
  overflow:hidden;
  box-shadow:0 24px 70px rgba(17,24,39,0.14);
}

.task-top{
  padding:10px 20px;
  background:#111111;
  color:#ffffff;
  text-align:center;
  font-size:10px;
  line-height:1.5;
  font-weight:800;
  letter-spacing:.22em;
  text-transform:uppercase;
}

.task-hero{
  position:relative;
  padding:28px 26px 24px;
  text-align:center;
  overflow:hidden;
}

.task-hero:before{
  content:"";
  position:absolute;
  top:-70px;
  right:-65px;
  width:170px;
  height:170px;
  border-radius:999px;
  background:${config.softAccent};
}

.task-hero:after{
  content:"";
  position:absolute;
  bottom:-80px;
  left:-55px;
  width:145px;
  height:145px;
  border-radius:999px;
  background:${config.softAccent};
}

.task-hero-inner{
  position:relative;
  z-index:1;
}

.task-logo{
  margin:0;
  font-family:"Space Grotesk",Arial,sans-serif;
  font-size:32px;
  line-height:1;
  font-weight:800;
  letter-spacing:.08em;
}

.task-kicker{
  margin:22px 0 8px;
  color:${config.accent};
  font-size:10px;
  font-weight:800;
  letter-spacing:.22em;
  text-transform:uppercase;
}

.task-title{
  margin:0;
  font-family:"Space Grotesk",Arial,sans-serif;
  font-size:27px;
  line-height:1.18;
  font-weight:800;
  color:#111111;
}

.task-subtitle{
  max-width:540px;
  margin:12px auto 0;
  font-size:13px;
  line-height:1.8;
  color:#5f6368;
}

.task-body{
  padding:0 26px 28px;
}

.task-status{
  display:inline-flex;
  align-items:center;
  gap:8px;
  margin-top:18px;
  padding:8px 13px;
  border-radius:999px;
  background:${config.softAccent};
  color:${config.accent};
  font-size:10px;
  font-weight:800;
  letter-spacing:.08em;
  text-transform:uppercase;
}

.task-status-dot{
  width:7px;
  height:7px;
  border-radius:999px;
  background:${config.accent};
}

.task-card{
  margin-top:16px;
  padding:18px;
  border-radius:18px;
  background:#fafafa;
  box-shadow:inset 0 0 0 1px rgba(17,24,39,0.06);
}

.task-number{
  margin:0;
  font-family:monospace;
  font-size:11px;
  font-weight:700;
  color:#6b7280;
}

.task-heading{
  margin:8px 0 0;
  font-family:"Space Grotesk",Arial,sans-serif;
  font-size:20px;
  line-height:1.35;
  font-weight:800;
  color:#111111;
}

.task-brief{
  margin:12px 0 0;
  white-space:pre-line;
  font-size:13px;
  line-height:1.85;
  color:#4b5563;
}

.task-grid{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:12px;
  margin-top:16px;
}

.task-info{
  padding:14px;
  border-radius:16px;
  background:#ffffff;
  box-shadow:inset 0 0 0 1px rgba(17,24,39,0.07);
}

.task-label{
  margin:0;
  color:#8a8f98;
  font-size:9px;
  line-height:1.5;
  font-weight:800;
  letter-spacing:.14em;
  text-transform:uppercase;
}

.task-value{
  margin:6px 0 0;
  color:#111111;
  font-size:12px;
  line-height:1.5;
  font-weight:800;
}

.task-update{
  margin-top:16px;
  padding:17px;
  border-left:4px solid ${config.accent};
  border-radius:4px 16px 16px 4px;
  background:${config.softAccent};
}

.task-update-title{
  margin:0;
  color:${config.accent};
  font-size:10px;
  font-weight:800;
  letter-spacing:.13em;
  text-transform:uppercase;
}

.task-update-text{
  margin:9px 0 0;
  white-space:pre-line;
  color:#30343b;
  font-size:13px;
  line-height:1.8;
}

.task-meta{
  margin-top:16px;
  overflow:hidden;
  border-radius:16px;
  box-shadow:inset 0 0 0 1px rgba(17,24,39,0.07);
}

.task-row{
  display:flex;
  justify-content:space-between;
  gap:18px;
  padding:11px 14px;
  border-bottom:1px solid rgba(17,24,39,0.07);
  background:#ffffff;
  font-size:12px;
  line-height:1.5;
  color:#6b7280;
}

.task-row:last-child{
  border-bottom:0;
}

.task-row b{
  color:#111111;
  text-align:right;
}

.task-tags{
  display:flex;
  flex-wrap:wrap;
  gap:7px;
  margin-top:16px;
}

.task-tag{
  display:inline-block;
  padding:7px 10px;
  border-radius:999px;
  background:#f3f4f6;
  color:#555b65;
  font-size:9px;
  font-weight:800;
}

.task-btn-wrap{
  margin-top:22px;
  text-align:center;
}

.task-btn{
  display:inline-block;
  padding:15px 28px;
  border-radius:999px;
  background:#111111;
  color:#ffffff !important;
  text-decoration:none;
  font-size:11px;
  font-weight:800;
  letter-spacing:.12em;
  text-transform:uppercase;
  box-shadow:0 14px 28px rgba(17,17,17,.18);
}

.task-note{
  margin:23px 0 0;
  color:#777c84;
  font-size:10px;
  line-height:1.8;
  text-align:center;
}

.task-footer{
  padding:20px 26px;
  background:#111111;
  color:#ffffff;
  text-align:center;
}

.task-footer-brand{
  margin:0;
  font-family:"Space Grotesk",Arial,sans-serif;
  font-size:13px;
  font-weight:800;
  letter-spacing:.12em;
}

.task-footer-copy{
  margin:6px 0 0;
  color:#b9bdc5;
  font-size:9px;
  line-height:1.8;
  letter-spacing:.1em;
  text-transform:uppercase;
}

@media only screen and (max-width:620px){
  .task-bg{
    padding:12px 7px;
  }

  .task-hero,
  .task-body{
    padding-left:17px;
    padding-right:17px;
  }

  .task-title{
    font-size:23px;
  }

  .task-grid{
    grid-template-columns:1fr;
  }

  .task-row{
    display:block;
  }

  .task-row b{
    display:block;
    margin-top:4px;
    text-align:left;
  }
}
</style>
</head>

<body>
<div class="task-bg">
  <div class="task-shell">

    <div class="task-top">
      ${escapeHtml(brandName)} / INTERNAL TASK NOTIFICATION
    </div>

    <div class="task-hero">
      <div class="task-hero-inner">
        <h2 class="task-logo">${escapeHtml(brandName)}</h2>

        <p class="task-kicker">
          ${escapeHtml(config.kicker)}
        </p>

        <h1 class="task-title">
          ${escapeHtml(config.title)}
        </h1>

        <p class="task-subtitle">
          Hello <b>${escapeHtml(recipientName)}</b>,<br/>
          ${escapeHtml(config.intro)}
        </p>

        <div class="task-status">
          <span class="task-status-dot"></span>
          ${escapeHtml(status)}
        </div>
      </div>
    </div>

    <div class="task-body">

      <div class="task-card">
        <p class="task-number">${escapeHtml(taskNumber)}</p>

        <h2 class="task-heading">
          ${escapeHtml(heading)}
        </h2>

        ${brief
      ? `
        <p class="task-brief">
          ${escapeHtml(brief)}
        </p>`
      : ""
    }
      </div>

      <div class="task-grid">
        ${infoCard("Priority", priority)}
        ${infoCard("Deadline", deadline)}
        ${infoCard("Assigned To", assignedTo)}
        ${infoCard("Created By", assignedBy)}
      </div>

      ${actionMessage
      ? `
      <div class="task-update">
        <p class="task-update-title">Latest Update</p>
        <p class="task-update-text">${escapeHtml(actionMessage)}</p>
      </div>`
      : ""
    }

      <div class="task-meta">
        ${metaRow("Action By", actorName)}
        ${metaRow("Created", createdAt)}
        ${metaRow("Last Updated", updatedAt)}
        ${startedAt ? metaRow("Started", startedAt) : ""}
        ${submittedAt ? metaRow("Submitted", submittedAt) : ""}
        ${closedAt ? metaRow("Closed", closedAt) : ""}
        ${metaRow("Rework Count", String(reworkCount))}
        ${metaRow("Attachments", String(mediaCount))}
      </div>

      ${tags.length
      ? `
      <div class="task-tags">
        ${tags
        .map(
          (tag) =>
            `<span class="task-tag">#${escapeHtml(tag)}</span>`,
        )
        .join("")}
      </div>`
      : ""
    }

      ${hasValidCta
      ? `
      <div class="task-btn-wrap">
        <a
          href="${escapeAttr(ctaUrl)}"
          class="task-btn"
        >
          ${escapeHtml(config.actionLabel)} →
        </a>
      </div>`
      : ""
    }

      <p class="task-note">
        This is an automated internal admin notification.
        ${supportEmail
      ? `For assistance, contact ${escapeHtml(supportEmail)}.`
      : ""
    }
      </p>
    </div>

    <div class="task-footer">
      <p class="task-footer-brand">${escapeHtml(brandName)}</p>

      <p class="task-footer-copy">
        Own All Trends • Internal Operations • Admin Task Management
      </p>
    </div>

  </div>
</div>
</body>
</html>
  `.trim();

  return {
    subject,
    text,
    html,
  };
}

/* ============================================================
   OPTIONAL CONVENIENCE EXPORTS
============================================================ */

export function taskAssignedEmailTemplate(payload = {}) {
  return adminUserTaskEmailTemplate({
    ...payload,
    eventType: "task_created",
  });
}

export function taskStartedEmailTemplate(payload = {}) {
  return adminUserTaskEmailTemplate({
    ...payload,
    eventType: "task_started",
  });
}

export function taskSubmittedEmailTemplate(payload = {}) {
  return adminUserTaskEmailTemplate({
    ...payload,
    eventType: "task_submitted",
  });
}

export function taskCommentEmailTemplate(payload = {}) {
  return adminUserTaskEmailTemplate({
    ...payload,
    eventType: "feedback_added",
  });
}

export function taskReworkEmailTemplate(payload = {}) {
  return adminUserTaskEmailTemplate({
    ...payload,
    eventType: "rework_requested",
  });
}

export function taskClosedEmailTemplate(payload = {}) {
  return adminUserTaskEmailTemplate({
    ...payload,
    eventType: "task_closed",
  });
}

export function taskCancelledEmailTemplate(payload = {}) {
  return adminUserTaskEmailTemplate({
    ...payload,
    eventType: "task_cancelled",
  });
}

export function taskReassignedEmailTemplate(payload = {}) {
  return adminUserTaskEmailTemplate({
    ...payload,
    eventType: "assignee_changed",
  });
}

export function taskDeadlineUpdatedEmailTemplate(payload = {}) {
  return adminUserTaskEmailTemplate({
    ...payload,
    eventType: "deadline_updated",
  });
}

/* ============================================================
   HELPERS
============================================================ */

function getUserName(user, fallback = "Admin User") {
  if (!user) return fallback;

  if (typeof user === "string") {
    return user.trim() || fallback;
  }

  return (
    user.fullName ||
    user.username ||
    user.name ||
    user.email ||
    fallback
  );
}

function infoCard(label, value) {
  return `
  <div class="task-info">
    <p class="task-label">${escapeHtml(label)}</p>
    <p class="task-value">${escapeHtml(value || "—")}</p>
  </div>`;
}

function metaRow(label, value) {
  return `
  <div class="task-row">
    <span>${escapeHtml(label)}</span>
    <b>${escapeHtml(value || "—")}</b>
  </div>`;
}

function pretty(value) {
  return String(value || "")
    .trim()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) =>
      character.toUpperCase(),
    );
}

function formatDate(value) {
  if (!value) return "Not available";

  try {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "Not available";
    }

    return date.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    });
  } catch {
    return "Not available";
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const escapeAttr = escapeHtml;
