import mongoose from "mongoose";

import AdminUser from "../AdminUser.js";
import AdminUserTask, {
  TASK_PRIORITIES,
  TASK_STATUSES,
} from "./AdminUserTask.js";

import {
  triggerTaskAssignedEmail,
  triggerTaskStartedEmail,
  triggerTaskSubmittedEmail,
  triggerTaskCommentEmail,
  triggerTaskReworkEmail,
  triggerTaskClosedEmail,
  triggerTaskCancelledEmail,
  triggerTaskReassignedEmail,
  triggerTaskDeadlineUpdatedEmail,
  triggerTaskUpdatedEmail,
} from "./adminUserTaskEmailService.js";

const normalize = (value) => String(value ?? "").trim();

const normalizeLower = (value) => normalize(value).toLowerCase();

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const oid = (value) => new mongoose.Types.ObjectId(value);

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") return value;

  return ["true", "1", "yes"].includes(normalizeLower(value));
};

const toArray = (value) => {
  if (value === undefined || value === null) return [];

  if (Array.isArray(value)) {
    return value.flatMap(toArray);
  }

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const uniqueObjectIds = (values = []) => {
  const seen = new Set();

  return values.filter((value) => {
    if (!value) return false;

    const key = String(value);

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
};

const isSuperAdmin = (admin) => admin?.role === "superadmin";

const isTaskCreator = (task, adminId) =>
  String(task?.assignedBy?._id || task?.assignedBy) === String(adminId);

const isTaskAssignee = (task, adminId) =>
  String(task?.assignedTo?._id || task?.assignedTo) === String(adminId);

const canViewTask = (task, admin) => {
  return Boolean(task && admin);
};

const canManageTask = (task, admin) => {
  if (!task || !admin) return false;

  return isSuperAdmin(admin) || isTaskCreator(task, admin._id);
};

const sanitizeTags = (tags) => {
  return [
    ...new Set(
      toArray(tags)
        .map((tag) => normalizeLower(tag))
        .filter(Boolean)
        .slice(0, 30),
    ),
  ];
};

const sanitizeMedia = (media, adminId) => {
  if (!Array.isArray(media)) return [];

  return media
    .map((item) => {
      if (typeof item === "string") {
        return {
          url: normalize(item),
          uploadedBy: adminId,
          uploadedAt: new Date(),
        };
      }

      return {
        url: normalize(item?.url),
        publicId: normalize(item?.publicId),
        resourceType: [
          "image",
          "video",
          "raw",
          "file",
          "other",
        ].includes(item?.resourceType)
          ? item.resourceType
          : "image",
        fileName: normalize(item?.fileName),
        mimeType: normalize(item?.mimeType),
        uploadedBy: item?.uploadedBy || adminId,
        uploadedAt: item?.uploadedAt || new Date(),
      };
    })
    .filter((item) => item.url);
};

const getTaskRecipients = (task, actorId) => {
  const recipients = uniqueObjectIds([
    task.assignedBy?._id || task.assignedBy,
    task.assignedTo?._id || task.assignedTo,
  ]);

  return recipients.filter(
    (recipientId) => String(recipientId) !== String(actorId),
  );
};

const pushActivity = (
  task,
  {
    type,
    message = "",
    actor,
    metadata = {},
  },
) => {
  task.activity.push({
    type,
    message,
    actor,
    metadata,
    createdAt: new Date(),
  });

  // Prevent unlimited document growth.
  if (task.activity.length > 200) {
    task.activity = task.activity.slice(-200);
  }
};

const pushNotification = (
  task,
  {
    type,
    title,
    message = "",
    actor,
    recipients,
  },
) => {
  const safeRecipients = uniqueObjectIds(recipients || []).filter(
    (recipientId) => String(recipientId) !== String(actor),
  );

  if (!safeRecipients.length) return;

  task.notifications.push({
    type,
    title,
    message,
    actor,
    recipients: safeRecipients,
    readBy: [],
    createdAt: new Date(),
  });

  // Embedded notifications are convenient for task notifications,
  // but should remain capped.
  if (task.notifications.length > 100) {
    task.notifications = task.notifications.slice(-100);
  }
};

const populateTask = (query) => {
  return query
    .populate(
      "assignedBy",
      "username email fullName profileImage role isActive",
    )
    .populate(
      "assignedTo",
      "username email fullName profileImage role isActive",
    )
    .populate(
      "feedback.createdBy",
      "username email fullName profileImage role",
    )
    .populate(
      "activity.actor",
      "username email fullName profileImage role",
    )
    .populate(
      "notifications.actor",
      "username email fullName profileImage role",
    );
};

const validateAssignee = async (assignedTo) => {
  if (!isObjectId(assignedTo)) {
    return {
      ok: false,
      status: 400,
      message: "Invalid assignedTo admin user id",
    };
  }

  const adminUser = await AdminUser.findById(assignedTo)
    .select("_id fullName username email isActive")
    .lean();

  if (!adminUser) {
    return {
      ok: false,
      status: 404,
      message: "Assigned admin user not found",
    };
  }

  if (!adminUser.isActive) {
    return {
      ok: false,
      status: 400,
      message: "Task cannot be assigned to an inactive admin user",
    };
  }

  return {
    ok: true,
    adminUser,
  };
};

/* ============================================================
   POST /api/admin-user-tasks
   Create and assign task
============================================================ */

export const createAdminUserTask = async (req, res) => {
  try {
    const payload = req.body || {};

    const heading = normalize(payload.heading);
    const brief = normalize(payload.brief);
    const assignedTo = normalize(payload.assignedTo);
    const priority = normalizeLower(payload.priority || "medium");
    const deadline = payload.deadline || null;

    if (!heading) {
      return res.status(400).json({
        success: false,
        message: "Task heading is required",
      });
    }

    if (!brief) {
      return res.status(400).json({
        success: false,
        message: "Task brief is required",
      });
    }

    if (!assignedTo) {
      return res.status(400).json({
        success: false,
        message: "assignedTo is required",
      });
    }

    if (!TASK_PRIORITIES.includes(priority)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task priority",
      });
    }

    if (deadline && Number.isNaN(new Date(deadline).getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid deadline",
      });
    }

    const assigneeValidation = await validateAssignee(assignedTo);

    if (!assigneeValidation.ok) {
      return res.status(assigneeValidation.status).json({
        success: false,
        message: assigneeValidation.message,
      });
    }

    const task = new AdminUserTask({
      heading,
      brief,
      assignedBy: req.admin._id,
      assignedTo,
      priority,
      deadline: deadline ? new Date(deadline) : null,
      media: sanitizeMedia(payload.media, req.admin._id),
      tags: sanitizeTags(payload.tags),
      status: "assigned",
    });

    pushActivity(task, {
      type: "task_created",
      message: "Task created and assigned",
      actor: req.admin._id,
      metadata: {
        assignedTo,
        priority,
        deadline: task.deadline,
      },
    });

    pushNotification(task, {
      type: "task_created",
      title: "New task assigned",
      message: heading,
      actor: req.admin._id,
      recipients: [assignedTo],
    });

    await task.save();

    const createdTask = await populateTask(
      AdminUserTask.findById(task._id),
    ).lean();

    triggerTaskAssignedEmail({
      task: createdTask,
      actor: req.admin,
    });

    return res.status(201).json({
      success: true,
      message: "Task assigned successfully",
      task: createdTask,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Task number collision. Please try again.",
      });
    }

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ============================================================
   GET /api/admin-user-tasks
============================================================ */

export const getAdminUserTasks = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = "",
      status = "",
      priority = "",
      assignedTo = "",
      assignedBy = "",
      scope = "all",
      deadlineFrom = "",
      deadlineTo = "",
      overdue = "",
      isArchived = "false",
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query || {};

    const query = {};

    const normalizedScope = normalizeLower(scope);

    if (normalizedScope === "assigned-to-me") {
      query.assignedTo = req.admin._id;
    }

    if (normalizedScope === "created-by-me") {
      query.assignedBy = req.admin._id;
    }

    if (normalizedScope === "open") {
      query.status = {
        $nin: ["closed", "cancelled"],
      };
    }

    if (normalizedScope === "submitted") {
      query.status = "submitted";
    }

    if (normalizedScope === "closed") {
      query.status = "closed";
    }

    const normalizedSearch = normalize(search);

    if (normalizedSearch) {
      query.$or = [
        {
          heading: {
            $regex: normalizedSearch,
            $options: "i",
          },
        },
        {
          brief: {
            $regex: normalizedSearch,
            $options: "i",
          },
        },
        {
          taskNumber: {
            $regex: normalizedSearch,
            $options: "i",
          },
        },
        {
          tags: {
            $regex: normalizedSearch,
            $options: "i",
          },
        },
      ];
    }

    const statusList = toArray(status)
      .map(normalizeLower)
      .filter((item) => TASK_STATUSES.includes(item));

    if (statusList.length === 1) {
      query.status = statusList[0];
    }

    if (statusList.length > 1) {
      query.status = {
        $in: statusList,
      };
    }

    const priorityList = toArray(priority)
      .map(normalizeLower)
      .filter((item) => TASK_PRIORITIES.includes(item));

    if (priorityList.length === 1) {
      query.priority = priorityList[0];
    }

    if (priorityList.length > 1) {
      query.priority = {
        $in: priorityList,
      };
    }

    if (assignedBy) {
      if (!isObjectId(assignedBy)) {
        return res.status(400).json({
          success: false,
          message: "Invalid assignedBy",
        });
      }

      query.assignedBy = oid(assignedBy);
    }

    if (assignedTo) {
      if (!isObjectId(assignedTo)) {
        return res.status(400).json({
          success: false,
          message: "Invalid assignedTo",
        });
      }

      query.assignedTo = oid(assignedTo);
    }

    if (deadlineFrom || deadlineTo) {
      query.deadline = {};

      if (deadlineFrom) {
        const parsedFrom = new Date(deadlineFrom);

        if (Number.isNaN(parsedFrom.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Invalid deadlineFrom",
          });
        }

        query.deadline.$gte = parsedFrom;
      }

      if (deadlineTo) {
        const parsedTo = new Date(deadlineTo);

        if (Number.isNaN(parsedTo.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Invalid deadlineTo",
          });
        }

        parsedTo.setHours(23, 59, 59, 999);

        query.deadline.$lte = parsedTo;
      }
    }

    if (toBoolean(overdue)) {
      query.deadline = {
        ...(query.deadline || {}),
        $lt: new Date(),
      };

      query.status = {
        $nin: ["closed", "cancelled"],
      };
    }

    query.isArchived = toBoolean(isArchived);

    const allowedSortFields = [
      "createdAt",
      "updatedAt",
      "deadline",
      "priority",
      "status",
      "heading",
    ];

    const safeSortBy = allowedSortFields.includes(sortBy)
      ? sortBy
      : "createdAt";

    const safeSortOrder =
      normalizeLower(sortOrder) === "asc" ? 1 : -1;

    const safePage = Math.max(1, Number(page) || 1);

    const safeLimit = Math.min(
      100,
      Math.max(1, Number(limit) || 20),
    );

    const skip = (safePage - 1) * safeLimit;

    const sortQuery = {
      [safeSortBy]: safeSortOrder,
    };

    if (safeSortBy !== "createdAt") {
      sortQuery.createdAt = -1;
    }

    const [tasks, total] = await Promise.all([
      populateTask(
        AdminUserTask.find(query)
          .sort(sortQuery)
          .skip(skip)
          .limit(safeLimit),
      ).lean(),

      AdminUserTask.countDocuments(query),
    ]);

    const now = Date.now();

    const mappedTasks = tasks.map((task) => ({
      ...task,
      isOverdue:
        Boolean(task.deadline) &&
        new Date(task.deadline).getTime() < now &&
        !["closed", "cancelled"].includes(task.status),
    }));

    return res.status(200).json({
      success: true,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
      tasks: mappedTasks,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        error?.message ||
        "Failed to fetch admin user tasks",
    });
  }
};

/* ============================================================
   GET /api/admin-user-tasks/summary
============================================================ */

export const getAdminUserTaskSummary = async (req, res) => {
  try {
    const baseFilter = {
      isArchived: false,
    };



    const now = new Date();

    const [
      statusSummary,
      prioritySummary,
      overdueCount,
      assignedToMeCount,
      createdByMeCount,
      submittedForReviewCount,
    ] = await Promise.all([
      AdminUserTask.aggregate([
        {
          $match: baseFilter,
        },
        {
          $group: {
            _id: "$status",
            count: {
              $sum: 1,
            },
          },
        },
      ]),

      AdminUserTask.aggregate([
        {
          $match: baseFilter,
        },
        {
          $group: {
            _id: "$priority",
            count: {
              $sum: 1,
            },
          },
        },
      ]),

      AdminUserTask.countDocuments({
        ...baseFilter,
        deadline: {
          $lt: now,
        },
        status: {
          $nin: ["closed", "cancelled"],
        },
      }),

      AdminUserTask.countDocuments({
        assignedTo: req.admin._id,
        isArchived: false,
        status: {
          $nin: ["closed", "cancelled"],
        },
      }),

      AdminUserTask.countDocuments({
        assignedBy: req.admin._id,
        isArchived: false,
        status: {
          $nin: ["closed", "cancelled"],
        },
      }),

      AdminUserTask.countDocuments({
        assignedBy: req.admin._id,
        status: "submitted",
        isArchived: false,
      }),
    ]);

    const status = TASK_STATUSES.reduce((acc, item) => {
      acc[item] =
        statusSummary.find((entry) => entry._id === item)?.count || 0;

      return acc;
    }, {});

    const priority = TASK_PRIORITIES.reduce((acc, item) => {
      acc[item] =
        prioritySummary.find((entry) => entry._id === item)?.count ||
        0;

      return acc;
    }, {});

    return res.status(200).json({
      success: true,
      summary: {
        status,
        priority,
        overdueCount,
        assignedToMeCount,
        createdByMeCount,
        submittedForReviewCount,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ============================================================
   GET /api/admin-user-tasks/:id
============================================================ */

export const getAdminUserTaskById = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task id",
      });
    }

    const task = await populateTask(
      AdminUserTask.findById(req.params.id),
    ).lean();

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (!canViewTask(task, req.admin)) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to view this task",
      });
    }

    return res.status(200).json({
      success: true,
      task: {
        ...task,
        isOverdue:
          !!task.deadline &&
          new Date(task.deadline).getTime() < Date.now() &&
          !["closed", "cancelled"].includes(task.status),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ============================================================
   PATCH /api/admin-user-tasks/:id
   Creator/superadmin updates main task details
============================================================ */

export const updateAdminUserTask = async (req, res) => {
  try {
    const task = await AdminUserTask.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (!canManageTask(task, req.admin)) {
      return res.status(403).json({
        success: false,
        message: "Only task creator or superadmin can update this task",
      });
    }

    if (["closed", "cancelled"].includes(task.status)) {
      return res.status(400).json({
        success: false,
        message: "Closed or cancelled task cannot be edited",
      });
    }

    const payload = req.body || {};
    const changedFields = [];

    if (payload.heading !== undefined) {
      const heading = normalize(payload.heading);

      if (!heading) {
        return res.status(400).json({
          success: false,
          message: "Task heading cannot be empty",
        });
      }

      task.heading = heading;
      changedFields.push("heading");
    }

    if (payload.brief !== undefined) {
      const brief = normalize(payload.brief);

      if (!brief) {
        return res.status(400).json({
          success: false,
          message: "Task brief cannot be empty",
        });
      }

      task.brief = brief;
      changedFields.push("brief");
    }

    if (payload.priority !== undefined) {
      const priority = normalizeLower(payload.priority);

      if (!TASK_PRIORITIES.includes(priority)) {
        return res.status(400).json({
          success: false,
          message: "Invalid task priority",
        });
      }

      task.priority = priority;
      changedFields.push("priority");
    }

    if (payload.deadline !== undefined) {
      if (
        payload.deadline &&
        Number.isNaN(new Date(payload.deadline).getTime())
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid deadline",
        });
      }

      task.deadline = payload.deadline
        ? new Date(payload.deadline)
        : null;

      changedFields.push("deadline");

      pushActivity(task, {
        type: "deadline_updated",
        message: task.deadline
          ? "Task deadline updated"
          : "Task deadline removed",
        actor: req.admin._id,
        metadata: {
          deadline: task.deadline,
        },
      });
    }

    if (payload.media !== undefined) {
      task.media = sanitizeMedia(payload.media, req.admin._id);
      changedFields.push("media");
    }

    if (payload.tags !== undefined) {
      task.tags = sanitizeTags(payload.tags);
      changedFields.push("tags");
    }

    if (!changedFields.length) {
      return res.status(400).json({
        success: false,
        message: "No valid task fields supplied",
      });
    }

    pushActivity(task, {
      type: "task_updated",
      message: "Task details updated",
      actor: req.admin._id,
      metadata: {
        changedFields,
      },
    });

    pushNotification(task, {
      type: "task_updated",
      title: "Task updated",
      message: task.heading,
      actor: req.admin._id,
      recipients: getTaskRecipients(task, req.admin._id),
    });

    await task.save();

    const updatedTask = await populateTask(
      AdminUserTask.findById(task._id),
    ).lean();

    const nonDeadlineFields = changedFields.filter(
      (field) => field !== "deadline",
    );

    if (changedFields.includes("deadline")) {
      triggerTaskDeadlineUpdatedEmail({
        task: updatedTask,
        actor: req.admin,
      });
    }

    if (nonDeadlineFields.length) {
      triggerTaskUpdatedEmail({
        task: updatedTask,
        actor: req.admin,
        changedFields: nonDeadlineFields,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Task updated successfully",
      task: updatedTask,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ============================================================
   PATCH /api/admin-user-tasks/:id/reassign
============================================================ */

export const reassignAdminUserTask = async (req, res) => {
  try {
    const task = await AdminUserTask.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (!canManageTask(task, req.admin)) {
      return res.status(403).json({
        success: false,
        message: "Only task creator or superadmin can reassign task",
      });
    }

    if (["closed", "cancelled"].includes(task.status)) {
      return res.status(400).json({
        success: false,
        message: "Closed or cancelled task cannot be reassigned",
      });
    }

    const assignedTo = normalize(req.body?.assignedTo);

    const assigneeValidation = await validateAssignee(assignedTo);

    if (!assigneeValidation.ok) {
      return res.status(assigneeValidation.status).json({
        success: false,
        message: assigneeValidation.message,
      });
    }

    if (String(task.assignedTo) === String(assignedTo)) {
      return res.status(400).json({
        success: false,
        message: "Task is already assigned to this admin user",
      });
    }

    const previousAssigneeId = task.assignedTo;

    const previousAssignee = await AdminUser.findById(
      previousAssigneeId,
    )
      .select(
        "_id fullName username email role profileImage isActive",
      )
      .lean();

    task.assignedTo = assignedTo;
    task.status = "assigned";
    task.startedAt = null;
    task.submittedAt = null;

    pushActivity(task, {
      type: "assignee_changed",
      message: "Task reassigned to another admin user",
      actor: req.admin._id,
      metadata: {
        previousAssignee: previousAssigneeId,
        assignedTo,
      },
    });

    pushNotification(task, {
      type: "assignee_changed",
      title: "Task assigned to you",
      message: task.heading,
      actor: req.admin._id,
      recipients: [assignedTo],
    });

    pushNotification(task, {
      type: "assignee_changed",
      title: "Task reassigned",
      message: task.heading,
      actor: req.admin._id,
      recipients: [previousAssignee],
    });

    await task.save();

    const updatedTask = await populateTask(
      AdminUserTask.findById(task._id),
    ).lean();

    triggerTaskReassignedEmail({
      task: updatedTask,
      actor: req.admin,
      previousAssignee,
    });

    return res.status(200).json({
      success: true,
      message: "Task reassigned successfully",
      task: updatedTask,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ============================================================
   PATCH /api/admin-user-tasks/:id/start
   Only assignee starts task
============================================================ */

export const startAdminUserTask = async (req, res) => {
  try {
    const task = await AdminUserTask.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (
      !isTaskAssignee(task, req.admin._id) &&
      !isSuperAdmin(req.admin)
    ) {
      return res.status(403).json({
        success: false,
        message: "Only assigned admin user can start this task",
      });
    }

    if (!["assigned", "rework"].includes(task.status)) {
      return res.status(400).json({
        success: false,
        message: `Task cannot be started from ${task.status} status`,
      });
    }

    task.status = "in_progress";

    if (!task.startedAt) {
      task.startedAt = new Date();
    }

    pushActivity(task, {
      type: "task_started",
      message: "Work started on task",
      actor: req.admin._id,
    });

    pushNotification(task, {
      type: "task_started",
      title: "Task work started",
      message: task.heading,
      actor: req.admin._id,
      recipients: [task.assignedBy],
    });

    await task.save();

    const updatedTask = await populateTask(
      AdminUserTask.findById(task._id),
    ).lean();

    triggerTaskStartedEmail({
      task: updatedTask,
      actor: req.admin,
    });

    return res.status(200).json({
      success: true,
      message: "Task marked as in progress",
      task: updatedTask,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ============================================================
   PATCH /api/admin-user-tasks/:id/submit
   Assignee submits completed work
============================================================ */

export const submitAdminUserTask = async (req, res) => {
  try {
    const task = await AdminUserTask.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (
      !isTaskAssignee(task, req.admin._id) &&
      !isSuperAdmin(req.admin)
    ) {
      return res.status(403).json({
        success: false,
        message: "Only assigned admin user can submit this task",
      });
    }

    if (!["assigned", "in_progress", "rework"].includes(task.status)) {
      return res.status(400).json({
        success: false,
        message: `Task cannot be submitted from ${task.status} status`,
      });
    }

    const message = normalize(req.body?.message);
    const media = sanitizeMedia(req.body?.media, req.admin._id);

    if (!message && !media.length) {
      return res.status(400).json({
        success: false,
        message: "Submission message or submission media is required",
      });
    }

    task.status = "submitted";
    task.submittedAt = new Date();
    task.submissionMessage = message;
    task.submissionMedia = media;

    task.feedback.push({
      message: message || "Work submitted",
      media,
      type: "submission",
      createdBy: req.admin._id,
      createdAt: new Date(),
    });

    pushActivity(task, {
      type: "task_submitted",
      message: "Task submitted for review",
      actor: req.admin._id,
      metadata: {
        hasMessage: !!message,
        mediaCount: media.length,
      },
    });

    pushNotification(task, {
      type: "task_submitted",
      title: "Task submitted for review",
      message: task.heading,
      actor: req.admin._id,
      recipients: [task.assignedBy],
    });

    await task.save();

    const updatedTask = await populateTask(
      AdminUserTask.findById(task._id),
    ).lean();

    triggerTaskSubmittedEmail({
      task: updatedTask,
      actor: req.admin,
      message:
        message ||
        "The assigned work has been submitted for review.",
    });

    return res.status(200).json({
      success: true,
      message: "Task submitted successfully",
      task: updatedTask,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ============================================================
   POST /api/admin-user-tasks/:id/feedback
   Both users may add comments
============================================================ */

export const addAdminUserTaskFeedback = async (req, res) => {
  try {
    const task = await AdminUserTask.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (!canViewTask(task, req.admin)) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to comment on this task",
      });
    }

    const message = normalize(req.body?.message);
    const media = sanitizeMedia(req.body?.media, req.admin._id);

    if (!message && !media.length) {
      return res.status(400).json({
        success: false,
        message: "Feedback message or media is required",
      });
    }

    task.feedback.push({
      message: message || "Media shared",
      media,
      type: "comment",
      createdBy: req.admin._id,
      createdAt: new Date(),
    });

    pushActivity(task, {
      type: "feedback_added",
      message: "Comment added to task",
      actor: req.admin._id,
      metadata: {
        mediaCount: media.length,
      },
    });

    pushNotification(task, {
      type: "feedback_added",
      title: "New task comment",
      message: message || task.heading,
      actor: req.admin._id,
      recipients: getTaskRecipients(task, req.admin._id),
    });

    await task.save();

    const updatedTask = await populateTask(
      AdminUserTask.findById(task._id),
    ).lean();

    triggerTaskCommentEmail({
      task: updatedTask,
      actor: req.admin,
      message:
        message ||
        (media.length
          ? `${media.length} attachment${media.length === 1 ? "" : "s"
          } shared on this task.`
          : "A new comment was added to this task."),
    });

    return res.status(201).json({
      success: true,
      message: "Feedback added successfully",
      task: updatedTask,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ============================================================
   PATCH /api/admin-user-tasks/:id/rework
   Creator requests rework after submission
============================================================ */

export const requestAdminUserTaskRework = async (req, res) => {
  try {
    const task = await AdminUserTask.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (!canManageTask(task, req.admin)) {
      return res.status(403).json({
        success: false,
        message: "Only task creator or superadmin can request rework",
      });
    }

    if (task.status !== "submitted") {
      return res.status(400).json({
        success: false,
        message: "Rework can only be requested for submitted tasks",
      });
    }

    const feedback = normalize(req.body?.feedback);
    const media = sanitizeMedia(req.body?.media, req.admin._id);

    if (!feedback) {
      return res.status(400).json({
        success: false,
        message: "Rework feedback is required",
      });
    }

    task.status = "rework";
    task.reworkCount = Number(task.reworkCount || 0) + 1;
    task.lastReworkRequestedAt = new Date();
    task.submittedAt = null;

    task.feedback.push({
      message: feedback,
      media,
      type: "rework",
      createdBy: req.admin._id,
      createdAt: new Date(),
    });

    pushActivity(task, {
      type: "rework_requested",
      message: "Rework requested on submitted task",
      actor: req.admin._id,
      metadata: {
        reworkCount: task.reworkCount,
      },
    });

    pushNotification(task, {
      type: "rework_requested",
      title: "Rework requested",
      message: feedback,
      actor: req.admin._id,
      recipients: [task.assignedTo],
    });

    await task.save();

    const updatedTask = await populateTask(
      AdminUserTask.findById(task._id),
    ).lean();

    triggerTaskReworkEmail({
      task: updatedTask,
      actor: req.admin,
      feedback,
    });

    return res.status(200).json({
      success: true,
      message: "Task sent for rework",
      task: updatedTask,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ============================================================
   PATCH /api/admin-user-tasks/:id/close
   Creator accepts work and closes task
============================================================ */

export const closeAdminUserTask = async (req, res) => {
  try {
    const task = await AdminUserTask.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (!canManageTask(task, req.admin)) {
      return res.status(403).json({
        success: false,
        message: "Only task creator or superadmin can close task",
      });
    }

    if (task.status !== "submitted") {
      return res.status(400).json({
        success: false,
        message: "Only submitted tasks can be closed",
      });
    }

    const feedback = normalize(req.body?.feedback);

    if (feedback) {
      task.feedback.push({
        message: feedback,
        media: sanitizeMedia(req.body?.media, req.admin._id),
        type: "feedback",
        createdBy: req.admin._id,
        createdAt: new Date(),
      });
    }

    task.status = "closed";
    task.closedAt = new Date();

    pushActivity(task, {
      type: "task_closed",
      message: "Submitted work accepted and task closed",
      actor: req.admin._id,
    });

    pushNotification(task, {
      type: "task_closed",
      title: "Task approved and closed",
      message: task.heading,
      actor: req.admin._id,
      recipients: [task.assignedTo],
    });

    await task.save();

    const updatedTask = await populateTask(
      AdminUserTask.findById(task._id),
    ).lean();

    triggerTaskClosedEmail({
      task: updatedTask,
      actor: req.admin,
      feedback:
        feedback ||
        "The submitted work has been approved and the task is now closed.",
    });

    return res.status(200).json({
      success: true,
      message: "Task closed successfully",
      task: updatedTask,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ============================================================
   PATCH /api/admin-user-tasks/:id/cancel
============================================================ */

export const cancelAdminUserTask = async (req, res) => {
  try {
    const task = await AdminUserTask.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (!canManageTask(task, req.admin)) {
      return res.status(403).json({
        success: false,
        message: "Only task creator or superadmin can cancel task",
      });
    }

    if (["closed", "cancelled"].includes(task.status)) {
      return res.status(400).json({
        success: false,
        message: `Task is already ${task.status}`,
      });
    }

    const reason = normalize(req.body?.reason);

    task.status = "cancelled";
    task.cancelledAt = new Date();

    pushActivity(task, {
      type: "task_cancelled",
      message: reason || "Task cancelled",
      actor: req.admin._id,
    });

    pushNotification(task, {
      type: "task_cancelled",
      title: "Task cancelled",
      message: reason || task.heading,
      actor: req.admin._id,
      recipients: [task.assignedTo],
    });

    await task.save();

    await task.save();

    const updatedTask = await populateTask(
      AdminUserTask.findById(task._id),
    ).lean();

    triggerTaskCancelledEmail({
      task: updatedTask,
      actor: req.admin,
      reason:
        reason ||
        "This task has been cancelled.",
    });

    return res.status(200).json({
      success: true,
      message: "Task cancelled successfully",
      task: updatedTask,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ============================================================
   PATCH /api/admin-user-tasks/:id/archive
============================================================ */

export const archiveAdminUserTask = async (req, res) => {
  try {
    const task = await AdminUserTask.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    if (!canManageTask(task, req.admin)) {
      return res.status(403).json({
        success: false,
        message: "Only task creator or superadmin can archive task",
      });
    }

    if (!["closed", "cancelled"].includes(task.status)) {
      return res.status(400).json({
        success: false,
        message: "Only closed or cancelled tasks can be archived",
      });
    }

    task.isArchived = toBoolean(req.body?.isArchived, true);

    await task.save();

    return res.status(200).json({
      success: true,
      message: task.isArchived
        ? "Task archived successfully"
        : "Task restored successfully",
      isArchived: task.isArchived,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ============================================================
   GET /api/admin-user-tasks/notifications
============================================================ */

export const getAdminUserTaskNotifications = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      unreadOnly = "false",
    } = req.query || {};

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(
      100,
      Math.max(1, Number(limit) || 20),
    );

    const userId = oid(req.admin._id);

    const pipeline = [
      {
        $match: {
          "notifications.recipients": userId,
        },
      },
      {
        $unwind: "$notifications",
      },
      {
        $match: {
          "notifications.recipients": userId,
        },
      },
      {
        $addFields: {
          notificationRead: {
            $in: [
              userId,
              {
                $map: {
                  input: "$notifications.readBy",
                  as: "read",
                  in: "$$read.user",
                },
              },
            ],
          },
        },
      },
    ];

    if (toBoolean(unreadOnly)) {
      pipeline.push({
        $match: {
          notificationRead: false,
        },
      });
    }

    pipeline.push(
      {
        $sort: {
          "notifications.createdAt": -1,
        },
      },
      {
        $facet: {
          items: [
            {
              $skip: (safePage - 1) * safeLimit,
            },
            {
              $limit: safeLimit,
            },
            {
              $project: {
                _id: "$notifications._id",
                taskId: "$_id",
                taskNumber: 1,
                heading: 1,
                taskStatus: "$status",
                type: "$notifications.type",
                title: "$notifications.title",
                message: "$notifications.message",
                actor: "$notifications.actor",
                isRead: "$notificationRead",
                createdAt: "$notifications.createdAt",
              },
            },
          ],

          total: [
            {
              $count: "count",
            },
          ],
        },
      },
    );

    const [result] = await AdminUserTask.aggregate(pipeline);

    const notifications = result?.items || [];
    const total = result?.total?.[0]?.count || 0;

    await AdminUser.populate(notifications, {
      path: "actor",
      select: "username email fullName profileImage role",
    });

    const unreadCountResult = await AdminUserTask.aggregate([
      {
        $match: {
          "notifications.recipients": userId,
        },
      },
      {
        $unwind: "$notifications",
      },
      {
        $match: {
          "notifications.recipients": userId,
          "notifications.readBy.user": {
            $ne: userId,
          },
        },
      },
      {
        $count: "count",
      },
    ]);

    return res.status(200).json({
      success: true,
      total,
      unreadCount: unreadCountResult?.[0]?.count || 0,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
      notifications,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ============================================================
   PATCH /api/admin-user-tasks/:id/notifications/:notificationId/read
============================================================ */

export const markAdminUserTaskNotificationRead = async (req, res) => {
  try {
    const { id, notificationId } = req.params;

    if (!isObjectId(id) || !isObjectId(notificationId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task or notification id",
      });
    }

    const task = await AdminUserTask.findOne({
      _id: id,
      notifications: {
        $elemMatch: {
          _id: notificationId,
          recipients: req.admin._id,
        },
      },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    const notification = task.notifications.id(notificationId);

    const alreadyRead = notification.readBy.some(
      (entry) => String(entry.user) === String(req.admin._id),
    );

    if (!alreadyRead) {
      notification.readBy.push({
        user: req.admin._id,
        readAt: new Date(),
      });

      await task.save();
    }

    return res.status(200).json({
      success: true,
      message: "Notification marked as read",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ============================================================
   PATCH /api/admin-user-tasks/notifications/read-all
============================================================ */

export const markAllAdminUserTaskNotificationsRead = async (
  req,
  res,
) => {
  try {
    const userId = oid(req.admin._id);
    const now = new Date();

    const tasks = await AdminUserTask.find({
      notifications: {
        $elemMatch: {
          recipients: userId,
          "readBy.user": {
            $ne: userId,
          },
        },
      },
    });

    let markedCount = 0;

    for (const task of tasks) {
      let changed = false;

      for (const notification of task.notifications) {
        const isRecipient = notification.recipients.some(
          (recipient) => String(recipient) === String(userId),
        );

        if (!isRecipient) continue;

        const alreadyRead = notification.readBy.some(
          (entry) => String(entry.user) === String(userId),
        );

        if (!alreadyRead) {
          notification.readBy.push({
            user: userId,
            readAt: now,
          });

          markedCount += 1;
          changed = true;
        }
      }

      if (changed) {
        await task.save();
      }
    }

    return res.status(200).json({
      success: true,
      message: "All task notifications marked as read",
      markedCount,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ============================================================
   DELETE /api/admin-user-tasks/:id
   Hard delete only superadmin
============================================================ */

export const deleteAdminUserTask = async (req, res) => {
  try {
    if (!isSuperAdmin(req.admin)) {
      return res.status(403).json({
        success: false,
        message: "Only superadmin can permanently delete tasks",
      });
    }

    const task = await AdminUserTask.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    await task.deleteOne();

    return res.status(200).json({
      success: true,
      message: "Task permanently deleted",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
