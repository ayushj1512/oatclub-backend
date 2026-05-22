import jwt from "jsonwebtoken";
import AdminUser from "./AdminUser.js";

export const protectAdmin = async (req, res, next) => {
  try {
    let token = null;

    const authHeader = req.headers.authorization || "";

    if (authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        code: "TOKEN_MISSING",
        message: "Not authorized, token missing",
      });
    }

    let decoded;

    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({
        success: false,
        code: "TOKEN_INVALID",
        message: "Not authorized, invalid/expired token",
      });
    }

    const admin = await AdminUser.findById(decoded.id)
      .select("-password")
      .lean();

    if (!admin) {
      return res.status(401).json({
        success: false,
        code: "ADMIN_NOT_FOUND",
        message: "Not authorized, admin not found",
      });
    }

    if (!admin.isActive) {
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_DISABLED",
        message: "Account disabled. Contact superadmin.",
      });
    }

    if (admin.lockUntil && admin.lockUntil > Date.now()) {
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_LOCKED",
        message:
          "Account locked temporarily due to failed attempts. Try again later.",
      });
    }

    // ✅ Main force-logout/session invalidation check
    const tokenSessionVersion = Number(decoded.sessionVersion || 0);
    const currentSessionVersion = Number(admin.sessionVersion || 0);

    if (tokenSessionVersion !== currentSessionVersion) {
      return res.status(401).json({
        success: false,
        code: "SESSION_REVOKED",
        message: "Session expired. Please login again.",
      });
    }

    req.admin = {
      _id: admin._id,
      username: admin.username,
      email: admin.email,
      role: admin.role,
      fullName: admin.fullName || "",
      profileImage: admin.profileImage || "",
      phone: admin.phone || "",
      permissions: admin.permissions || [],
      isActive: admin.isActive,
      sessionVersion: admin.sessionVersion || 0,
      forceLoggedOutAt: admin.forceLoggedOutAt || null,
      createdAt: admin.createdAt,
      updatedAt: admin.updatedAt,
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      code: "NOT_AUTHORIZED",
      message: "Not authorized",
      error: error.message,
    });
  }
};  