import jwt from "jsonwebtoken";

import VendorUser from "./VendorUser.js";

export const protectVendor = async (
  req,
  res,
  next
) => {
  try {
    const authHeader =
      req.headers.authorization;

    if (
      !authHeader ||
      !authHeader.startsWith(
        "Bearer "
      )
    ) {
      return res
        .status(401)
        .json({
          success: false,
          message:
            "Vendor authentication required",
        });
    }

    const token =
      authHeader.split(" ")[1];

    const decoded =
      jwt.verify(
        token,
        process.env.JWT_SECRET
      );

    const vendor =
      await VendorUser.findById(
        decoded.id
      ).select("-password");

    if (!vendor) {
      return res
        .status(401)
        .json({
          success: false,
          message:
            "Vendor account not found",
        });
    }

    if (!vendor.isActive) {
      return res
        .status(403)
        .json({
          success: false,
          message:
            "Vendor account is disabled",
        });
    }

    req.vendor = vendor;

    req.vendorId =
      vendor._id;

    req.isVendorSuperAdmin =
      vendor.role ===
      "superadmin";

    next();
  } catch (error) {
    return res
      .status(401)
      .json({
        success: false,
        message:
          "Invalid or expired vendor token",
      });
  }
};

export const allowVendorModule =
  (moduleName) => {
    return (
      req,
      res,
      next
    ) => {
      if (
        req.vendor?.role ===
        "superadmin"
      ) {
        return next();
      }

      if (
        req.vendor
          ?.modules?.[
          moduleName
        ] !== true
      ) {
        return res
          .status(403)
          .json({
            success: false,
            message: `Access denied for ${moduleName}`,
          });
      }

      next();
    };
  };

export const vendorSuperAdminOnly =
  (
    req,
    res,
    next
  ) => {
    if (
      req.vendor?.role !==
      "superadmin"
    ) {
      return res
        .status(403)
        .json({
          success: false,
          message:
            "Vendor super admin access required",
        });
    }

    next();
  };