import mongoose from "mongoose";

const packagingEvidenceSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },

    orderNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    /*
     * forward = Warehouse → Customer
     * rto     = Returned parcel received at warehouse
     */
    evidenceType: {
      type: String,
      enum: ["forward", "rto"],
      required: true,
      index: true,
    },

    awb: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    courierPartner: {
      type: String,
      default: "",
      trim: true,
    },

    /*
     * RTO evidence may be linked with a specific RMA.
     * Kept optional because courier RTO and customer RMA are different cases.
     */
    rmaNumber: {
      type: String,
      default: "",
      trim: true,
      uppercase: true,
      index: true,
    },

    station: {
      stationName: {
        type: String,
        required: true,
        trim: true,
      },

      computerName: {
        type: String,
        default: "",
        trim: true,
      },

      packerName: {
        type: String,
        default: "",
        trim: true,
      },
    },

    location: {
      latitude: {
        type: Number,
        default: null,
        min: -90,
        max: 90,
      },

      longitude: {
        type: Number,
        default: null,
        min: -180,
        max: 180,
      },

      accuracyMeters: {
        type: Number,
        default: 0,
        min: 0,
      },

      altitude: {
        type: Number,
        default: null,
      },

      source: {
        type: String,
        enum: [
          "browser-geolocation",
          "unavailable",
        ],
        default: "unavailable",
      },

      capturedAt: {
        type: Date,
        default: null,
      },

      permissionStatus: {
        type: String,
        enum: [
          "granted",
          "denied",
          "prompt",
          "unknown",
        ],
        default: "unknown",
      },
    },

    storage: {
      /*
       * Example:
       * D:\oatclub-evidence
       *
       * Informational only. This path exists on the packing PC,
       * not necessarily on the backend server.
       */
      storageRoot: {
        type: String,
        required: true,
        trim: true,
      },

      /*
       * Example:
       * 000486
       */
      orderFolder: {
        type: String,
        required: true,
        trim: true,
      },

      /*
       * Example:
       * 000486-123456789-forward.webm
       */
      fileName: {
        type: String,
        required: true,
        trim: true,
      },

      /*
       * Example:
       * 000486\000486-123456789-forward.webm
       */
      relativePath: {
        type: String,
        required: true,
        trim: true,
      },

      mimeType: {
        type: String,
        default: "video/webm",
        trim: true,
      },

      fileSizeBytes: {
        type: Number,
        default: 0,
        min: 0,
      },

      durationSeconds: {
        type: Number,
        default: 0,
        min: 0,
      },

      sha256: {
        type: String,
        default: "",
        trim: true,
        lowercase: true,
      },
    },

    video: {
      width: {
        type: Number,
        default: 0,
        min: 0,
      },

      height: {
        type: Number,
        default: 0,
        min: 0,
      },

      framesPerSecond: {
        type: Number,
        default: 0,
        min: 0,
      },

      hasAudio: {
        type: Boolean,
        default: false,
      },
    },

    status: {
      type: String,
      enum: ["saved", "missing", "corrupted", "failed"],
      default: "saved",
      index: true,
    },

    recordedAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },

    saveVerifiedAt: {
      type: Date,
      default: null,
    },

    failureReason: {
      type: String,
      default: "",
      trim: true,
    },

    notes: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000,
    },
  },
  {
    timestamps: true,
  },
);

packagingEvidenceSchema.index({
  orderNumber: 1,
  evidenceType: 1,
  recordedAt: -1,
});

packagingEvidenceSchema.index({
  "station.stationName": 1,
  recordedAt: -1,
});

packagingEvidenceSchema.index({
  awb: 1,
  evidenceType: 1,
});

packagingEvidenceSchema.index({
  status: 1,
  createdAt: -1,
});

export default mongoose.models.PackagingEvidence ||
  mongoose.model("PackagingEvidence", packagingEvidenceSchema);
