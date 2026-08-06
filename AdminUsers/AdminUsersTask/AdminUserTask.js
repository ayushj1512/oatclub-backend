import mongoose from "mongoose";

const { Schema } = mongoose;

const TASK_STATUSES = [
  "assigned",
  "in_progress",
  "submitted",
  "rework",
  "closed",
  "cancelled",
];

const TASK_PRIORITIES = ["low", "medium", "high", "urgent"];

const ACTIVITY_TYPES = [
  "task_created",
  "task_updated",
  "task_started",
  "task_submitted",
  "feedback_added",
  "rework_requested",
  "task_closed",
  "task_cancelled",
  "deadline_updated",
  "assignee_changed",
  "media_added",
];

const taskMediaSchema = new Schema(
  {
    url: {
      type: String,
      required: true,
      trim: true,
    },

    publicId: {
      type: String,
      trim: true,
      default: "",
    },

    resourceType: {
      type: String,
      enum: ["image", "video", "raw", "file", "other"],
      default: "image",
    },

    fileName: {
      type: String,
      trim: true,
      default: "",
    },

    mimeType: {
      type: String,
      trim: true,
      default: "",
    },

    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },

    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: true,
  },
);

const taskFeedbackSchema = new Schema(
  {
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },

    media: {
      type: [taskMediaSchema],
      default: [],
    },

    type: {
      type: String,
      enum: ["comment", "submission", "feedback", "rework"],
      default: "comment",
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
      index: true,
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },

    editedAt: {
      type: Date,
      default: null,
    },
  },
  {
    _id: true,
  },
);

const taskActivitySchema = new Schema(
  {
    type: {
      type: String,
      enum: ACTIVITY_TYPES,
      required: true,
    },

    message: {
      type: String,
      trim: true,
      default: "",
    },

    actor: {
      type: Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
      index: true,
    },

    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: true,
  },
);

const taskNotificationSchema = new Schema(
  {
    type: {
      type: String,
      enum: ACTIVITY_TYPES,
      required: true,
    },

    title: {
      type: String,
      trim: true,
      required: true,
      maxlength: 200,
    },

    message: {
      type: String,
      trim: true,
      default: "",
      maxlength: 1000,
    },

    actor: {
      type: Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
    },

    recipients: [
      {
        type: Schema.Types.ObjectId,
        ref: "AdminUser",
        required: true,
      },
    ],

    readBy: [
      {
        user: {
          type: Schema.Types.ObjectId,
          ref: "AdminUser",
          required: true,
        },

        readAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: true,
  },
);

const adminUserTaskSchema = new Schema(
  {
    taskNumber: {
      type: String,
      unique: true,
      sparse: true,
      uppercase: true,
      trim: true,
      index: true,
    },

    heading: {
      type: String,
      required: true,
      trim: true,
      maxlength: 250,
      index: true,
    },

    brief: {
      type: String,
      required: true,
      trim: true,
      maxlength: 10000,
    },

    media: {
      type: [taskMediaSchema],
      default: [],
    },

    assignedBy: {
      type: Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
      index: true,
    },

    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
      index: true,
    },

    priority: {
      type: String,
      enum: TASK_PRIORITIES,
      default: "medium",
      index: true,
    },

    status: {
      type: String,
      enum: TASK_STATUSES,
      default: "assigned",
      index: true,
    },

    deadline: {
      type: Date,
      default: null,
      index: true,
    },

    startedAt: {
      type: Date,
      default: null,
    },

    submittedAt: {
      type: Date,
      default: null,
    },

    closedAt: {
      type: Date,
      default: null,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },

    lastReworkRequestedAt: {
      type: Date,
      default: null,
    },

    reworkCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    submissionMessage: {
      type: String,
      trim: true,
      default: "",
      maxlength: 5000,
    },

    submissionMedia: {
      type: [taskMediaSchema],
      default: [],
    },

    feedback: {
      type: [taskFeedbackSchema],
      default: [],
    },

    activity: {
      type: [taskActivitySchema],
      default: [],
    },

    notifications: {
      type: [taskNotificationSchema],
      default: [],
    },

    tags: {
      type: [String],
      default: [],
    },

    isArchived: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

adminUserTaskSchema.index({
  assignedTo: 1,
  status: 1,
  deadline: 1,
});

adminUserTaskSchema.index({
  assignedBy: 1,
  status: 1,
  createdAt: -1,
});

adminUserTaskSchema.index({
  heading: "text",
  brief: "text",
  taskNumber: "text",
});

adminUserTaskSchema.virtual("isOverdue").get(function () {
  if (!this.deadline) return false;

  return (
    new Date(this.deadline).getTime() < Date.now() &&
    !["closed", "cancelled"].includes(this.status)
  );
});

adminUserTaskSchema.set("toJSON", {
  virtuals: true,
});

adminUserTaskSchema.set("toObject", {
  virtuals: true,
});

adminUserTaskSchema.pre("validate", async function (next) {
  try {
    if (this.taskNumber) return next();

    const date = new Date();

    const datePart = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("");

    const randomPart = Math.floor(1000 + Math.random() * 9000);

    this.taskNumber = `TASK-${datePart}-${randomPart}`;

    next();
  } catch (error) {
    next(error);
  }
});

if (mongoose.models.AdminUserTask) {
  delete mongoose.models.AdminUserTask;
}

const AdminUserTask = mongoose.model(
  "AdminUserTask",
  adminUserTaskSchema,
);

export {
  TASK_STATUSES,
  TASK_PRIORITIES,
  ACTIVITY_TYPES,
};

export default AdminUserTask;
