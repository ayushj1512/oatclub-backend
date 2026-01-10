import jwt from "jsonwebtoken";
import AdminUser from "./AdminUser.js";

export const protectAdmin = async (req, res, next) => {
  try {
    let token = null;

    // ✅ Token format: Authorization: Bearer <token>
    const authHeader = req.headers.authorization || "";
    if (authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    }

    // ❌ Token missing
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Not authorized, token missing",
      });
    }

    // ✅ Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: "Not authorized, invalid/expired token",
      });
    }

    // ✅ Fetch admin from DB
    const admin = await AdminUser.findById(decoded.id)
      .select("-password")
      .lean();

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Not authorized, admin not found",
      });
    }

    // ✅ Block disabled admins
    if (!admin.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account disabled. Contact superadmin.",
      });
    }

    // ✅ Block locked admins (lockUntil)
    if (admin.lockUntil && admin.lockUntil > Date.now()) {
      return res.status(403).json({
        success: false,
        message:
          "Account locked temporarily due to failed attempts. Try again later.",
      });
    }

    // ✅ Attach safe admin object to req
    req.admin = {
      _id: admin._id,
      username: admin.username,
      email: admin.email,
      role: admin.role,
      fullName: admin.fullName || "",
      permissions: admin.permissions || [],
      isActive: admin.isActive,
      createdAt: admin.createdAt,
      updatedAt: admin.updatedAt,
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Not authorized",
      error: error.message,
    });
  }
};
