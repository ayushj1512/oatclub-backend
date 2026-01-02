import AdminUser from "./AdminUser.js";
import jwt from "jsonwebtoken"; // ✅ REQUIRED for token generation

/**
 * ✅ GET: /api/admin-users
 * List admin users with pagination, search, filters
 * For now: sab roles ko full access (no restriction)
 */
export const getAdminUsers = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = "", role, isActive } = req.query;

    const query = {};

    // 🔍 Search by username/email/fullName/phone
    if (search) {
      query.$or = [
        { username: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { fullName: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }

    // 🎭 Role filter
    if (role) query.role = role;

    // ✅ Active filter
    if (isActive !== undefined) query.isActive = isActive === "true";

    const skip = (Number(page) - 1) * Number(limit);

    const [users, total] = await Promise.all([
      AdminUser.find(query)
        .select("-password")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      AdminUser.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
      users,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * ✅ GET: /api/admin-users/:id
 * Get single admin user
 */
export const getAdminUserById = async (req, res) => {
  try {
    const user = await AdminUser.findById(req.params.id).select("-password");
    if (!user)
      return res.status(404).json({ success: false, message: "Admin user not found" });

    res.status(200).json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * ✅ POST: /api/admin-users
 * Create admin user
 */
export const createAdminUser = async (req, res) => {
  try {
    const { username, email, password, role, fullName, phone, profileImage, permissions } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "username, email and password are required",
      });
    }

    const exists = await AdminUser.findOne({ $or: [{ username }, { email }] });
    if (exists)
      return res.status(400).json({
        success: false,
        message: "Username or email already exists",
      });

    const user = await AdminUser.create({
      username,
      email,
      password, // hashed by pre-save in schema
      role: role || "admin",
      fullName,
      phone,
      profileImage,
      permissions: permissions || [],
      createdBy: req.admin?._id || null,
    });

    const createdUser = await AdminUser.findById(user._id).select("-password");

    res.status(201).json({
      success: true,
      message: "Admin user created successfully",
      user: createdUser,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * ✅ PATCH: /api/admin-users/:id
 * Update profile fields (not password)
 */
export const updateAdminUser = async (req, res) => {
  try {
    const { fullName, phone, profileImage, isActive } = req.body;

    const user = await AdminUser.findById(req.params.id).select("-password");
    if (!user)
      return res.status(404).json({ success: false, message: "Admin user not found" });

    if (fullName !== undefined) user.fullName = fullName;
    if (phone !== undefined) user.phone = phone;
    if (profileImage !== undefined) user.profileImage = profileImage;
    if (isActive !== undefined) user.isActive = isActive;

    await user.save();

    res.status(200).json({
      success: true,
      message: "Admin user updated successfully",
      user,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * ✅ PATCH: /api/admin-users/:id/role
 * Update role + permissions
 */
export const updateAdminRoleAndPermissions = async (req, res) => {
  try {
    const { role, permissions } = req.body;

    const user = await AdminUser.findById(req.params.id).select("-password");
    if (!user)
      return res.status(404).json({ success: false, message: "Admin user not found" });

    if (role) user.role = role;
    if (permissions) user.permissions = permissions;

    await user.save();

    res.status(200).json({
      success: true,
      message: "Role/permissions updated successfully",
      user,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * ✅ PATCH: /api/admin-users/:id/password
 * Change password securely
 */
export const changeAdminPassword = async (req, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 6 chars",
      });
    }

    const user = await AdminUser.findById(req.params.id).select("+password");
    if (!user)
      return res.status(404).json({ success: false, message: "Admin user not found" });

    user.password = newPassword; // hashed via pre-save
    await user.save();

    res.status(200).json({ success: true, message: "Password updated successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * ✅ PATCH: /api/admin-users/:id/unlock
 * Reset login attempts & lockUntil
 */
export const unlockAdminUser = async (req, res) => {
  try {
    const user = await AdminUser.findById(req.params.id);
    if (!user)
      return res.status(404).json({ success: false, message: "Admin user not found" });

    user.loginAttempts = 0;
    user.lockUntil = null;
    user.isActive = true;

    await user.save();

    res.status(200).json({
      success: true,
      message: "Admin unlocked successfully",
      user,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * ✅ DELETE: /api/admin-users/:id
 * Delete admin user (hard delete)
 */
export const deleteAdminUser = async (req, res) => {
  try {
    const user = await AdminUser.findById(req.params.id);
    if (!user)
      return res.status(404).json({ success: false, message: "Admin user not found" });

    await user.deleteOne();

    res.status(200).json({ success: true, message: "Admin user deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ===========================================================
   ✅ ADMIN LOGIN (same file)
   POST /api/admin-auth/login
=========================================================== */

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "7d" });
};

export const adminLogin = async (req, res) => {
  try {
    let { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Username and password required",
      });
    }

    // ✅ normalize username (helps if user types Admin / ADMIN)
    username = username.trim();

    const admin = await AdminUser.findOne({ username }).select("+password");

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password",
      });
    }

    // ✅ disabled check
    if (!admin.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account disabled. Contact superadmin.",
      });
    }

    // ✅ lock check
    if (admin.lockUntil && admin.lockUntil > Date.now()) {
      return res.status(403).json({
        success: false,
        message: "Account locked temporarily due to failed attempts. Try later.",
      });
    }

    // ✅ password match
    const isMatch = await admin.matchPassword(password);

    if (!isMatch) {
      admin.loginAttempts = (admin.loginAttempts || 0) + 1;

      // lock after 5 attempts
      if (admin.loginAttempts >= 5) {
        admin.lockUntil = Date.now() + 2 * 60 * 60 * 1000; // 2 hours
      }

      await admin.save();

      return res.status(401).json({
        success: false,
        message: "Invalid username or password",
      });
    }

    // ✅ success: reset lock
    admin.loginAttempts = 0;
    admin.lockUntil = null;
    admin.lastLogin = new Date();
    await admin.save();

    const token = generateToken(admin._id);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      admin: {
        _id: admin._id,
        username: admin.username,
        email: admin.email,
        role: admin.role,
        fullName: admin.fullName || "",
        permissions: admin.permissions || [],
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
