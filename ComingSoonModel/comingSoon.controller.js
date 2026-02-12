// controllers/comingSoon.controller.js
import mongoose from "mongoose";
import ComingSoon from "./ComingSoonModel.js";

/* ---------------- utils ---------------- */
const isObjId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const now = () => new Date();

const normEmail = (v) => String(v || "").trim().toLowerCase();
const normPhone = (v) => String(v || "").trim().replace(/[^\d+]/g, "");

const computeScore = (doc) => {
  const m = doc.metrics || {};
  const w = doc.scoring || {};
  return (
    (m.views || 0) * (w.wView ?? 1) +
    (m.notifyClicks || 0) * (w.wNotifyClick ?? 5) +
    (m.notifySubmits || 0) * (w.wNotifySubmit ?? 20) +
    (m.shares || 0) * (w.wShare ?? 8)
  );
};

/* -------------------------------------------------------
FRONTEND
------------------------------------------------------- */

/* Get by productId */
export const getByProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    if (!isObjId(productId)) return res.status(400).json({ message: "Invalid productId" });

    const doc = await ComingSoon.findOne({ productId }).lean();
    if (!doc) return res.status(404).json({ message: "Not found" });

    res.json(doc);
  } catch (e) {
    res.status(500).json({ message: "Failed", error: e.message });
  }
};

/* Subscribe notify */
export const subscribeNotify = async (req, res) => {
  try {
    const { productId } = req.params;
    if (!isObjId(productId)) return res.status(400).json({ message: "Invalid productId" });

    const { email, phone, channel = "any", source = "" } = req.body || {};
    const e = normEmail(email);
    const p = normPhone(phone);

    if (!e && !p) return res.status(400).json({ message: "Email or phone required" });

    const doc = await ComingSoon.findOne({ productId });
    if (!doc) return res.status(404).json({ message: "ComingSoon not found" });

    const already = doc.notifyList.some(
      (n) => (e && n.email === e) || (p && n.phone === p)
    );

    if (!already) {
      doc.notifyList.push({
        email: e,
        phone: p,
        channel,
        source,
        status: "subscribed",
      });

      doc.metrics.waitlistCount++;
      doc.metrics.notifySubmits++;
      doc.metrics.lastEngagedAt = now();
      doc.launchDecision.currentScore = computeScore(doc);

      await doc.save();
    }

    res.json({ ok: true, already });
  } catch (e) {
    res.status(500).json({ message: "Subscribe failed", error: e.message });
  }
};

/* Track engagement */
export const trackEngagement = async (req, res) => {
  try {
    const { productId } = req.params;
    const { type } = req.body;

    if (!isObjId(productId)) return res.status(400).json({ message: "Invalid productId" });
    if (!["view", "notify_click", "share"].includes(type))
      return res.status(400).json({ message: "Invalid type" });

    const doc = await ComingSoon.findOne({ productId });
    if (!doc) return res.status(404).json({ message: "ComingSoon not found" });

    if (type === "view") doc.metrics.views++;
    if (type === "notify_click") doc.metrics.notifyClicks++;
    if (type === "share") doc.metrics.shares++;

    doc.metrics.lastEngagedAt = now();
    doc.launchDecision.currentScore = computeScore(doc);

    // auto launch check
    if (
      doc.launchDecision.mode === "auto" &&
      doc.launchDecision.currentScore >= doc.launchDecision.thresholdScore &&
      !doc.launchDecision.decided
    ) {
      doc.status = "launched";
      doc.launchDecision.decided = true;
      doc.launchDecision.decidedAt = now();
    }

    await doc.save();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: "Tracking failed", error: e.message });
  }
};

/* -------------------------------------------------------
ADMIN
------------------------------------------------------- */

/* List all */
export const getAll = async (_req, res) => {
  try {
    const data = await ComingSoon.find().sort({ createdAt: -1 });
    res.json(data);
  } catch (e) {
    res.status(500).json({ message: "Failed", error: e.message });
  }
};

/* Manual launch */
export const manualLaunch = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isObjId(id)) return res.status(400).json({ message: "Invalid id" });

    const doc = await ComingSoon.findById(id);
    if (!doc) return res.status(404).json({ message: "Not found" });

    doc.status = "launched";
    doc.launchDecision.decided = true;
    doc.launchDecision.decidedAt = now();
    doc.launchDecision.mode = "manual";

    await doc.save();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: "Launch failed", error: e.message });
  }
};

/* Update threshold */
export const updateThreshold = async (req, res) => {
  try {
    const { id } = req.params;
    const { thresholdScore } = req.body;

    if (!isObjId(id)) return res.status(400).json({ message: "Invalid id" });

    const doc = await ComingSoon.findByIdAndUpdate(
      id,
      { "launchDecision.thresholdScore": Number(thresholdScore || 0) },
      { new: true }
    );

    res.json(doc);
  } catch (e) {
    res.status(500).json({ message: "Update failed", error: e.message });
  }
};
