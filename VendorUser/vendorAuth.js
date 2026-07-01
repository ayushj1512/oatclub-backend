import jwt from "jsonwebtoken";
import VendorUser from "./VendorUser.js";

export const protectVendor = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    const token =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.split(" ")[1]
        : null;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Vendor token missing",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const vendor = await VendorUser.findById(decoded.id).select("-password");

    if (!vendor || !vendor.isActive) {
      return res.status(401).json({
        success: false,
        message: "Vendor not authorized",
      });
    }

    req.vendor = vendor;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Vendor token failed",
    });
  }
};