import { Mailer } from "../../nodemailer/mailer.js";

const normalize = (value) => String(value ?? "").trim();

const getAdminId = (admin) => {
  return admin?._id || admin?.id || admin || null;
};

const getAdminEmail = (admin) => {
  return normalize(admin?.email).toLowerCase();
};

const getAdminName = (admin) => {
  return (
    normalize(admin?.fullName) ||
    normalize(admin?.username) ||
    normalize(admin?.name) ||
    normalize(admin?.email) ||
    "Admin User"
  );
};

const getTaskUserId = (value) => {
  return value?._id || value || null;
};

const getTaskCtaUrl = (task) => {
  const baseUrl =
    process.env.ADMIN_PANEL_URL ||
    process.env.ADMIN_URL ||
    process.env.CLIENT_URL ||
    "http://localhost:4000";

  if (!task?._id) {
    return `${baseUrl}/admin-user-tasks`;
  }

  return `${baseUrl}/admin-user-tasks/${task._id}`;
};

const uniqueRecipients = (recipients = []) => {
  const seen = new Set();

  return recipients.filter((recipient) => {
    const email = getAdminEmail(recipient);

    if (!email || seen.has(email)) {
      return false;
    }

    seen.add(email);
    return true;
  });
};

const resolveTaskUsers = (task = {}) => {
  return {
    creator: task.assignedBy || null,
    assignee: task.assignedTo || null,
  };
};

const shouldSkipRecipient = (recipient, actor) => {
  const recipientId = getAdminId(recipient);
  const actorId = getAdminId(actor);

  if (recipientId && actorId) {
    return String(recipientId) === String(actorId);
  }

  const recipientEmail = getAdminEmail(recipient);
  const actorEmail = getAdminEmail(actor);

  return Boolean(
    recipientEmail &&
    actorEmail &&
    recipientEmail === actorEmail,
  );
};

const sendTaskEmailToRecipient = async ({
  recipient,
  eventType,
  task,
  actor,
  message = "",
  feedback = "",
}) => {
  const to = getAdminEmail(recipient);

  if (!to) {
    return {
      success: false,
      skipped: true,
      reason: "Recipient email missing",
    };
  }

  if (shouldSkipRecipient(recipient, actor)) {
    return {
      success: false,
      skipped: true,
      reason: "Actor and recipient are same",
    };
  }

  try {
    await Mailer.sendAdminUserTaskEmail({
      to,
      eventType,
      task,
      recipient,
      actor,
      message,
      feedback,
      ctaUrl: getTaskCtaUrl(task),
      brandName: "OATCLUB",
      supportEmail:
        process.env.MAIL_REPLY_TO ||
        process.env.MAIL_USER ||
        "",
    });

    console.log("✅ Admin task email sent", {
      eventType,
      taskNumber: task?.taskNumber,
      recipient: to,
    });

    return {
      success: true,
      skipped: false,
      email: to,
    };
  } catch (error) {
    console.error("❌ Admin task email failed", {
      eventType,
      taskNumber: task?.taskNumber,
      recipient: to,
      error: error?.message || error,
    });

    return {
      success: false,
      skipped: false,
      email: to,
      error:
        error?.message ||
        "Admin task email failed",
    };
  }
};

const sendTaskEmailToRecipients = async ({
  recipients = [],
  eventType,
  task,
  actor,
  message = "",
  feedback = "",
}) => {
  const safeRecipients = uniqueRecipients(recipients).filter(
    (recipient) => !shouldSkipRecipient(recipient, actor),
  );

  if (!safeRecipients.length) {
    return {
      success: false,
      skipped: true,
      reason: "No eligible recipients",
      results: [],
    };
  }

  const results = await Promise.all(
    safeRecipients.map((recipient) =>
      sendTaskEmailToRecipient({
        recipient,
        eventType,
        task,
        actor,
        message,
        feedback,
      }),
    ),
  );

  return {
    success: results.some((result) => result.success),
    skipped: false,
    results,
  };
};

/* ============================================================
   TASK CREATED
============================================================ */

export const sendTaskAssignedEmail = async ({
  task,
  actor,
}) => {
  const { assignee } = resolveTaskUsers(task);

  return sendTaskEmailToRecipient({
    recipient: assignee,
    eventType: "task_created",
    task,
    actor,
    message: "A new task has been assigned to you.",
  });
};

/* ============================================================
   TASK STARTED
============================================================ */

export const sendTaskStartedEmail = async ({
  task,
  actor,
}) => {
  const { creator } = resolveTaskUsers(task);

  return sendTaskEmailToRecipient({
    recipient: creator,
    eventType: "task_started",
    task,
    actor,
    message: `${getAdminName(actor)} started working on this task.`,
  });
};

/* ============================================================
   TASK SUBMITTED
============================================================ */

export const sendTaskSubmittedEmail = async ({
  task,
  actor,
  message = "",
}) => {
  const { creator } = resolveTaskUsers(task);

  return sendTaskEmailToRecipient({
    recipient: creator,
    eventType: "task_submitted",
    task,
    actor,
    message:
      message ||
      task?.submissionMessage ||
      "The task has been submitted for review.",
  });
};

/* ============================================================
   COMMENT ADDED
============================================================ */

export const sendTaskCommentEmail = async ({
  task,
  actor,
  message = "",
}) => {
  const { creator, assignee } = resolveTaskUsers(task);

  return sendTaskEmailToRecipients({
    recipients: [creator, assignee],
    eventType: "feedback_added",
    task,
    actor,
    message:
      message ||
      "A new comment was added to this task.",
  });
};

/* ============================================================
   REWORK REQUESTED
============================================================ */

export const sendTaskReworkEmail = async ({
  task,
  actor,
  feedback = "",
}) => {
  const { assignee } = resolveTaskUsers(task);

  return sendTaskEmailToRecipient({
    recipient: assignee,
    eventType: "rework_requested",
    task,
    actor,
    feedback:
      feedback ||
      "Changes are required before this task can be approved.",
  });
};

/* ============================================================
   TASK CLOSED
============================================================ */

export const sendTaskClosedEmail = async ({
  task,
  actor,
  feedback = "",
}) => {
  const { assignee } = resolveTaskUsers(task);

  return sendTaskEmailToRecipient({
    recipient: assignee,
    eventType: "task_closed",
    task,
    actor,
    feedback:
      feedback ||
      "The task has been approved and closed.",
  });
};

/* ============================================================
   TASK CANCELLED
============================================================ */

export const sendTaskCancelledEmail = async ({
  task,
  actor,
  reason = "",
}) => {
  const { creator, assignee } = resolveTaskUsers(task);

  return sendTaskEmailToRecipients({
    recipients: [creator, assignee],
    eventType: "task_cancelled",
    task,
    actor,
    message:
      reason ||
      "This task has been cancelled.",
  });
};

/* ============================================================
   TASK REASSIGNED
============================================================ */

export const sendTaskReassignedEmail = async ({
  task,
  actor,
  previousAssignee = null,
}) => {
  const { assignee } = resolveTaskUsers(task);

  return sendTaskEmailToRecipients({
    recipients: [assignee, previousAssignee],
    eventType: "assignee_changed",
    task,
    actor,
    message: `This task is now assigned to ${getAdminName(
      assignee,
    )}.`,
  });
};

/* ============================================================
   DEADLINE UPDATED
============================================================ */

export const sendTaskDeadlineUpdatedEmail = async ({
  task,
  actor,
}) => {
  const { creator, assignee } = resolveTaskUsers(task);

  return sendTaskEmailToRecipients({
    recipients: [creator, assignee],
    eventType: "deadline_updated",
    task,
    actor,
    message: task?.deadline
      ? `The deadline has been updated to ${new Date(
        task.deadline,
      ).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })}.`
      : "The task deadline has been removed.",
  });
};

/* ============================================================
   TASK UPDATED
============================================================ */

export const sendTaskUpdatedEmail = async ({
  task,
  actor,
  changedFields = [],
}) => {
  const { creator, assignee } = resolveTaskUsers(task);

  const fields = Array.isArray(changedFields)
    ? changedFields.filter(Boolean)
    : [];

  return sendTaskEmailToRecipients({
    recipients: [creator, assignee],
    eventType: "task_updated",
    task,
    actor,
    message: fields.length
      ? `Updated fields: ${fields.join(", ")}.`
      : "Task details have been updated.",
  });
};

/* ============================================================
   NON-BLOCKING TRIGGERS
============================================================ */

const runInBackground = (label, callback) => {
  try {
    Promise.resolve(callback()).catch((error) => {
      console.error(`❌ ${label} trigger failed`, {
        error: error?.message || error,
      });
    });
  } catch (error) {
    console.error(`❌ ${label} trigger failed`, {
      error: error?.message || error,
    });
  }
};

export const triggerTaskAssignedEmail = (payload) => {
  runInBackground("Task assigned email", () =>
    sendTaskAssignedEmail(payload),
  );
};

export const triggerTaskStartedEmail = (payload) => {
  runInBackground("Task started email", () =>
    sendTaskStartedEmail(payload),
  );
};

export const triggerTaskSubmittedEmail = (payload) => {
  runInBackground("Task submitted email", () =>
    sendTaskSubmittedEmail(payload),
  );
};

export const triggerTaskCommentEmail = (payload) => {
  runInBackground("Task comment email", () =>
    sendTaskCommentEmail(payload),
  );
};

export const triggerTaskReworkEmail = (payload) => {
  runInBackground("Task rework email", () =>
    sendTaskReworkEmail(payload),
  );
};

export const triggerTaskClosedEmail = (payload) => {
  runInBackground("Task closed email", () =>
    sendTaskClosedEmail(payload),
  );
};

export const triggerTaskCancelledEmail = (payload) => {
  runInBackground("Task cancelled email", () =>
    sendTaskCancelledEmail(payload),
  );
};

export const triggerTaskReassignedEmail = (payload) => {
  runInBackground("Task reassigned email", () =>
    sendTaskReassignedEmail(payload),
  );
};

export const triggerTaskDeadlineUpdatedEmail = (payload) => {
  runInBackground("Task deadline email", () =>
    sendTaskDeadlineUpdatedEmail(payload),
  );
};

export const triggerTaskUpdatedEmail = (payload) => {
  runInBackground("Task updated email", () =>
    sendTaskUpdatedEmail(payload),
  );
};
