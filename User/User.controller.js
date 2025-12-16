import mongoose from "mongoose";
import User from "./User.js"; // ✅ adjust path if needed

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value));
const pickIdFilter = (id) => (isObjectId(id) ? { _id: id } : { userId: String(id) });

const sanitizeString = (v) => String(v ?? "").trim();

/**
 * Normalize username: trim + lowercase
 */
const sanitizeUsername = (v) => String(v ?? "").trim().toLowerCase();

const MIN_PASS = 4;

export const createUser = async (req, res) => {
  try {
    const payload = req.body || {};

    // ✅ username required
    const username = sanitizeUsername(payload.username);
    if (!username) return res.status(400).json({ message: "username is required" });

    // ✅ password required
    const pass = String(payload.password || "").trim();
    if (pass.length < MIN_PASS) {
      return res.status(400).json({ message: `password is required (min ${MIN_PASS} chars)` });
    }

    const created = await User.create({
      username,
      password: pass, // ✅ will hash in pre('save')

      role: payload.role ? String(payload.role) : "user",
      isActive: payload.isActive !== undefined ? !!payload.isActive : true,
      notes: payload.notes !== undefined ? sanitizeString(payload.notes) : "",
    });

    // password is select:false so it won't show
    return res.status(201).json({ message: "User created", user: created });
  } catch (err) {
    console.error("❌ createUser:", err);

    if (err?.code === 11000) {
      const field = Object.keys(err.keyValue || {})[0] || "field";
      return res.status(409).json({ message: `${field} already exists` });
    }

    return res.status(500).json({ message: err.message });
  }
};

export const listUsers = async (req, res) => {
  try {
    const { page = 1, limit = 50, q = "", role = "", isActive = "" } = req.query;

    const filter = {};

    if (role) filter.role = String(role);
    if (isActive !== "") filter.isActive = String(isActive) === "true";

    // ✅ search userId + username + notes
    if (q) {
      const qq = String(q);
      filter.$or = [
        { userId: { $regex: qq, $options: "i" } },
        { username: { $regex: qq, $options: "i" } },
        { notes: { $regex: qq, $options: "i" } },
      ];
    }

    const safeLimit = Math.min(200, Math.max(1, Number(limit)));
    const skip = (Number(page) - 1) * safeLimit;

    const [items, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(safeLimit).lean(),
      User.countDocuments(filter),
    ]);

    return res.json({
      items: items || [],
      total: total || 0,
      page: Number(page),
      pages: Math.ceil((total || 0) / safeLimit),
    });
  } catch (err) {
    console.error("❌ listUsers:", err);
    return res.status(500).json({ message: err.message });
  }
};

// Get by Mongo _id OR by userId like "U-000123"
export const getUser = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findOne(pickIdFilter(id)).lean();
    if (!user) return res.status(404).json({ message: "User not found" });

    return res.json({ user });
  } catch (err) {
    console.error("❌ getUser:", err);
    return res.status(500).json({ message: err.message });
  }
};

// Update by Mongo _id OR by userId
export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = req.body || {};

    // ❌ never allow userId edits
    if (payload.userId) delete payload.userId;

    // ✅ IMPORTANT: document.save() so password hashing runs if password changes
    const user = await User.findOne(pickIdFilter(id)).select("+password");
    if (!user) return res.status(404).json({ message: "User not found" });

    // username update (optional)
    if (payload.username !== undefined) {
      const nextUsername = sanitizeUsername(payload.username);
      if (!nextUsername) return res.status(400).json({ message: "username cannot be empty" });
      user.username = nextUsername;
    }

    // password update (optional)
    if (payload.password !== undefined) {
      const nextPass = String(payload.password || "").trim();
      if (nextPass.length < MIN_PASS) {
        return res.status(400).json({ message: `password must be at least ${MIN_PASS} characters` });
      }
      user.password = nextPass; // hashed in pre('save')
    }

    if (payload.role !== undefined) user.role = String(payload.role || "user");
    if (payload.isActive !== undefined) user.isActive = !!payload.isActive;
    if (payload.notes !== undefined) user.notes = sanitizeString(payload.notes);

    await user.save();

    // return safe user (password not selected)
    const safeUser = await User.findById(user._id).lean();
    return res.json({ message: "User updated", user: safeUser });
  } catch (err) {
    console.error("❌ updateUser:", err);

    if (err?.code === 11000) {
      const field = Object.keys(err.keyValue || {})[0] || "field";
      return res.status(409).json({ message: `${field} already exists` });
    }

    return res.status(500).json({ message: err.message });
  }
};

// Delete by Mongo _id OR by userId
export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await User.findOneAndDelete(pickIdFilter(id));
    if (!deleted) return res.status(404).json({ message: "User not found" });

    return res.json({ message: "User deleted" });
  } catch (err) {
    console.error("❌ deleteUser:", err);
    return res.status(500).json({ message: err.message });
  }
};

// Quick active toggle
export const toggleUserActive = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findOne(pickIdFilter(id));
    if (!user) return res.status(404).json({ message: "User not found" });

    user.isActive = !user.isActive;
    await user.save();

    return res.json({ message: "User status updated", user });
  } catch (err) {
    console.error("❌ toggleUserActive:", err);
    return res.status(500).json({ message: err.message });
  }
};

/**
 * ✅ Dedicated endpoint:
 * PATCH /superadmin/users/:id/password
 * Body: { password: "newpass" }
 */
export const updateUserPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body || {};

    const nextPass = String(password || "").trim();
    if (nextPass.length < MIN_PASS) {
      return res.status(400).json({ message: `password is required (min ${MIN_PASS} chars)` });
    }

    const user = await User.findOne(pickIdFilter(id)).select("+password");
    if (!user) return res.status(404).json({ message: "User not found" });

    user.password = nextPass; // hashed in pre('save')
    await user.save();

    return res.json({ message: "Password updated" });
  } catch (err) {
    console.error("❌ updateUserPassword:", err);
    return res.status(500).json({ message: err.message });
  }
};
