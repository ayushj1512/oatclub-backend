import express from "express";

import { protectAdmin } from "../protectAdmin.js";

import {
  createAdminUserTask,
  getAdminUserTasks,
  getAdminUserTaskSummary,
  getAdminUserTaskById,
  updateAdminUserTask,
  reassignAdminUserTask,
  startAdminUserTask,
  submitAdminUserTask,
  addAdminUserTaskFeedback,
  requestAdminUserTaskRework,
  closeAdminUserTask,
  cancelAdminUserTask,
  archiveAdminUserTask,
  getAdminUserTaskNotifications,
  markAdminUserTaskNotificationRead,
  markAllAdminUserTaskNotificationsRead,
  deleteAdminUserTask,
} from "./adminUserTaskController.js";

const router = express.Router();

/**
 * Base route:
 * /api/admin-user-tasks
 */

router.use(protectAdmin);

/* ============================================================
   STATIC ROUTES
   Keep these before /:id
============================================================ */

router.get("/summary", getAdminUserTaskSummary);

router.get("/notifications", getAdminUserTaskNotifications);

router.patch(
  "/notifications/read-all",
  markAllAdminUserTaskNotificationsRead,
);

/* ============================================================
   TASK LIST + CREATE
============================================================ */

router
  .route("/")
  .get(getAdminUserTasks)
  .post(createAdminUserTask);

/* ============================================================
   TASK ACTIONS
============================================================ */

router.patch("/:id/reassign", reassignAdminUserTask);

router.patch("/:id/start", startAdminUserTask);

router.patch("/:id/submit", submitAdminUserTask);

router.post("/:id/feedback", addAdminUserTaskFeedback);

router.patch("/:id/rework", requestAdminUserTaskRework);

router.patch("/:id/close", closeAdminUserTask);

router.patch("/:id/cancel", cancelAdminUserTask);

router.patch("/:id/archive", archiveAdminUserTask);

router.patch(
  "/:id/notifications/:notificationId/read",
  markAdminUserTaskNotificationRead,
);

/* ============================================================
   SINGLE TASK
============================================================ */

router
  .route("/:id")
  .get(getAdminUserTaskById)
  .patch(updateAdminUserTask)
  .delete(deleteAdminUserTask);

export default router;
