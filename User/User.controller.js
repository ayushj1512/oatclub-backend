import mongoose from "mongoose";
import User from "./User.js";

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value));

const pickIdFilter = (id) => {
  const str = String(id || "").trim();

  // ✅ if looks like sequential userId, always treat as userId
  if (str.startsWith("U-")) return { userId: str };

  return isObjectId(str) ? { _id: str } : { userId: str };
};

const sanitizeString = (v) => String(v ?? "").trim();
const sanitizeUsername = (v) => String(v ?? "").trim().toLowerCase();

const MIN_PASS = 4;
const ALLOWED_ROLES = ["user", "admin", "superadmin"];

export const createUser = async (req, res) => {
  try {
    const payload = req.body || {};

    const username = sanitizeUsername(payload.username);
    if (!username) {
      return res.status(400).json({ message: "username is required" });
    }

    const pass = String(payload.password || "").trim();
    if (pass.length < MIN_PASS) {
      return res
        .status(400)
        .json({ message: `password is required (min ${MIN_PASS} chars)` });
    }

    // ✅ role safe
    const role = ALLOWED_ROLES.includes(String(payload.role))
      ? String(payload.role)
      : "user";

    const created = await User.create({
      username,
      password: pass,

      role,
      isActive: payload.isActive !== undefined ? !!payload.isActive : true,
      notes: payload.notes !== undefined ? sanitizeString(payload.notes) : "",

      activeCartId: null,
      lastCartActivityAt: null,
      cartCount: 0,
    });

    return res.status(201).json({
      message: "User created",
      user: {
        _id: created._id,
        userId: created.userId,
        username: created.username,
        role: created.role,
        isActive: created.isActive,
        cartCount: created.cartCount,
        createdAt: created.createdAt,
      },
    });
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

    if (role && ALLOWED_ROLES.includes(String(role))) {
      filter.role = String(role);
    }

    if (isActive !== "") filter.isActive = String(isActive) === "true";

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

export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = req.body || {};

    delete payload.userId;
    delete payload.activeCartId;
    delete payload.lastCartActivityAt;
    delete payload.cartCount;

    const user = await User.findOne(pickIdFilter(id)).select("+password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (payload.username !== undefined) {
      const nextUsername = sanitizeUsername(payload.username);
      if (!nextUsername) {
        return res.status(400).json({ message: "username cannot be empty" });
      }
      user.username = nextUsername;
    }

    if (payload.password !== undefined) {
      const nextPass = String(payload.password || "").trim();
      if (nextPass.length < MIN_PASS) {
        return res.status(400).json({
          message: `password must be at least ${MIN_PASS} characters`,
        });
      }
      user.password = nextPass;
    }

    if (payload.role !== undefined) {
      const role = String(payload.role);
      if (!ALLOWED_ROLES.includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }
      user.role = role;
    }

    if (payload.isActive !== undefined) {
      user.isActive = !!payload.isActive;
    }

    if (payload.notes !== undefined) {
      user.notes = sanitizeString(payload.notes);
    }

    await user.save();

    const safeUser = await User.findById(user._id)
      .select("userId username role isActive notes cartCount activeCartId lastCartActivityAt createdAt")
      .lean();

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

export const updateUserPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body || {};

    const nextPass = String(password || "").trim();
    if (nextPass.length < MIN_PASS) {
      return res.status(400).json({
        message: `password is required (min ${MIN_PASS} chars)`,
      });
    }

    const user = await User.findOne(pickIdFilter(id)).select("+password");
    if (!user) return res.status(404).json({ message: "User not found" });

    user.password = nextPass;
    await user.save();

    return res.json({ message: "Password updated" });
  } catch (err) {
    console.error("❌ updateUserPassword:", err);
    return res.status(500).json({ message: err.message });
  }
};
