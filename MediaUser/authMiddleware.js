import jwt from "jsonwebtoken";
import MediaUser from "./MediaUser.js";

/**
 * requireAuth:
 * - Checks Authorization: Bearer <token>
 * - Verifies JWT
 * - Loads user from DB
 * - Adds req.user
 */
export const requireAuth = async (req, res, next) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) {
      return res.status(401).json({ message: "Unauthorized (token missing)" });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const user = await MediaUser.findById(payload.sub).lean();
    if (!user || user.isActive === false) {
      return res.status(401).json({ message: "Unauthorized (invalid user)" });
    }

    req.user = {
      id: String(user._id),
      username: user.username,
      role: user.role,
    };

    next();
  } catch (err) {
    return res.status(401).json({ message: "Unauthorized (token invalid)" });
  }
};

/**
 * requireRole:
 * - Usage: requireRole("admin", "editor")
 * - First requireAuth must run so req.user exists
 */
export const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    const role = req.user?.role;

    if (!role) return res.status(401).json({ message: "Unauthorized" });

    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ message: "Forbidden (insufficient role)" });
    }

    next();
  };
};
