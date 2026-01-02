import jwt from "jsonwebtoken";
import AdminUser from "./AdminUser.js";

export const protectAdmin = async (req, res, next) => {
  try {
    let token;

    // ✅ Token should be like: Authorization: Bearer <token>
    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
      token = req.headers.authorization.split(" ")[1];
    }

    // ❌ If token missing
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Not authorized, token missing",
      });
    }

    // ✅ Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ✅ Get admin from DB
    const admin = await AdminUser.findById(decoded.id).select("-password");

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

    // ✅ Attach admin in req
    req.admin = admin;

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Not authorized",
      error: error.message,
    });
  }
};
