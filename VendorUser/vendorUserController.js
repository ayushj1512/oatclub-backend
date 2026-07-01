import jwt from "jsonwebtoken";
import VendorUser from "./VendorUser.js";

const generateToken = (id) => {
  return jwt.sign({ id, role: "vendor" }, process.env.JWT_SECRET, {
    expiresIn: "30d",
  });
};

export const createVendorUser = async (req, res) => {
  try {
    const { name, username, password, phone, modules } = req.body;

    if (!name || !username || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, username and password are required",
      });
    }

    const existingVendor = await VendorUser.findOne({
      username: username.toLowerCase(),
    });

    if (existingVendor) {
      return res.status(409).json({
        success: false,
        message: "Vendor username already exists",
      });
    }

    const vendor = await VendorUser.create({
      name,
      username,
      password,
      phone,
      modules,
    });

    return res.status(201).json({
      success: true,
      message: "Vendor user created successfully",
      vendor: {
        _id: vendor._id,
        name: vendor.name,
        username: vendor.username,
        phone: vendor.phone,
        modules: vendor.modules,
        isActive: vendor.isActive,
      },
    });
  } catch (error) {
    console.error("Create vendor user error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create vendor user",
    });
  }
};

export const loginVendorUser = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Username and password are required",
      });
    }

    const vendor = await VendorUser.findOne({
      username: username.toLowerCase(),
    }).select("+password");

    if (!vendor) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password",
      });
    }

    if (!vendor.isActive) {
      return res.status(403).json({
        success: false,
        message: "Vendor account is disabled",
      });
    }

    const isMatch = await vendor.matchPassword(password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password",
      });
    }

    vendor.lastLoginAt = new Date();
    await vendor.save();

    const token = generateToken(vendor._id);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      vendor: {
        _id: vendor._id,
        name: vendor.name,
        username: vendor.username,
        phone: vendor.phone,
        modules: vendor.modules,
        isActive: vendor.isActive,
      },
    });
  } catch (error) {
    console.error("Vendor login error:", error);
    return res.status(500).json({
      success: false,
      message: "Vendor login failed",
    });
  }
};

export const getVendorProfile = async (req, res) => {
  return res.status(200).json({
    success: true,
    vendor: req.vendor,
  });
};

export const getAllVendorUsers = async (req, res) => {
  try {
    const vendors = await VendorUser.find()
      .select("-password")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: vendors.length,
      vendors,
    });
  } catch (error) {
    console.error("Get vendors error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch vendors",
    });
  }
};

export const updateVendorUser = async (req, res) => {
  try {
    const { id } = req.params;

    const vendor = await VendorUser.findByIdAndUpdate(
      id,
      {
        name: req.body.name,
        phone: req.body.phone,
        modules: req.body.modules,
        isActive: req.body.isActive,
      },
      {
        new: true,
        runValidators: true,
      }
    ).select("-password");

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Vendor updated successfully",
      vendor,
    });
  } catch (error) {
    console.error("Update vendor error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update vendor",
    });
  }
};