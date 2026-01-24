// MediaUser/mediaAuthController.js
import jwt from "jsonwebtoken";
import MediaUser from "./MediaUser.js";

const signToken = (user) => {
  return jwt.sign(
    { sub: String(user._id), username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
};

const getReqMeta = (req) => ({
  ip: req.headers["x-forwarded-for"]?.split(",")?.[0]?.trim() || req.ip,
  userAgent: req.headers["user-agent"] || "",
});

// POST /media-user/register
export const register = async (req, res) => {
  try {
    const { username, password, role } = req.body || {};

    if (!username?.trim() || !password) {
      return res.status(400).json({ message: "Username and password required" });
    }
    if (String(password).length < 4) {
      return res.status(400).json({ message: "Password must be at least 4 characters" });
    }

    const exists = await MediaUser.findOne({ username: username.trim() }).lean();
    if (exists) return res.status(409).json({ message: "Username already exists" });

    const safeRole = ["admin", "editor", "viewer"].includes(role) ? role : "viewer";
    const passwordHash = await MediaUser.hashPassword(password);

    const user = await MediaUser.create({
      username: username.trim(),
      passwordHash,
      role: safeRole, // default viewer if role invalid/empty
    });

    await user.addActivity({
      type: "register",
      message: "User registered",
      meta: getReqMeta(req),
    });

    const token = signToken(user);

    return res.status(201).json({
      message: "Registered",
      token,
      user: { id: user._id, username: user.username, role: user.role },
    });
  } catch (err) {
    console.error("❌ register:", err);
    return res.status(500).json({ message: err.message });
  }
};

// POST /media-user/login
export const login = async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username?.trim() || !password) {
      return res.status(400).json({ message: "Username and password required" });
    }

    const user = await MediaUser.findOne({ username: username.trim() });
    if (!user || user.isActive === false) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const ok = await user.comparePassword(password);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    await user.addActivity({
      type: "login",
      message: "User logged in",
      meta: getReqMeta(req),
    });

    const token = signToken(user);

    return res.json({
      message: "Logged in",
      token,
      user: { id: user._id, username: user.username, role: user.role },
    });
  } catch (err) {
    console.error("❌ login:", err);
    return res.status(500).json({ message: err.message });
  }
};

// POST /media-user/logout (protected)
export const logout = async (req, res) => {
  try {
    // requireAuth middleware sets req.user
    const userId = req.user?.id;

    if (userId) {
      const user = await MediaUser.findById(userId);
      if (user) {
        await user.addActivity({
          type: "logout",
          message: "User logged out",
          meta: getReqMeta(req),
        });
      }
    }

    return res.json({ message: "Logged out" });
  } catch (err) {
    console.error("❌ logout:", err);
    return res.status(500).json({ message: err.message });
  }
};

// GET /media-user/me (protected)
export const me = async (req, res) => {
  try {
    // requireAuth middleware sets req.user
    return res.json({ user: req.user });
  } catch (err) {
    console.error("❌ me:", err);
    return res.status(500).json({ message: err.message });
  }
};
