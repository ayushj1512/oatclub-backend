import AdminUser from "./AdminUser.js";
import jwt from "jsonwebtoken";

/* ============================================================
   ✅ Helpers
============================================================ */
const ALLOWED_ROLES = [
  "superadmin",
  "admin",
  "staff",
  "influencer",
  "viewer",
  "customer_care",
];

const normalize = (v) => String(v ?? "").trim();
const normalizeLower = (v) => normalize(v).toLowerCase();

const safePermissions = (p) => {
  if (!Array.isArray(p)) return [];
  return p.map((x) => normalize(x)).filter(Boolean);
};

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "7d" });
};

/* ============================================================
   ✅ GET: /api/admin-users
   List admin users with pagination, search, filters
============================================================ */
export const getAdminUsers = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = "", role = "", isActive = "" } =
      req.query;

    const query = {};

    // 🔍 Search by username/email/fullName/phone
    const s = normalize(search);
    if (s) {
      query.$or = [
        { username: { $regex: s, $options: "i" } },
        { email: { $regex: s, $options: "i" } },
        { fullName: { $regex: s, $options: "i" } },
        { phone: { $regex: s, $options: "i" } },
      ];
    }

    // 🎭 Role filter
    if (role && ALLOWED_ROLES.includes(String(role))) {
      query.role = String(role);
    }

    // ✅ Active filter
    if (isActive !== "") query.isActive = String(isActive) === "true";

    const safeLimit = Math.min(200, Math.max(1, Number(limit)));
    const skip = (Math.max(1, Number(page)) - 1) * safeLimit;

    const [users, total] = await Promise.all([
      AdminUser.find(query)
        .select("-password")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      AdminUser.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      limit: safeLimit,
      totalPages: Math.ceil((total || 0) / safeLimit),
      users: users || [],
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ============================================================
   ✅ GET: /api/admin-users/:id
   Get single admin user
============================================================ */
export const getAdminUserById = async (req, res) => {
  try {
    const user = await AdminUser.findById(req.params.id)
      .select("-password")
      .lean();

    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "Admin user not found" });

    res.status(200).json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ============================================================
   ✅ POST: /api/admin-users
   Create admin user
============================================================ */
export const createAdminUser = async (req, res) => {
  try {
    const payload = req.body || {};

    const username = normalizeLower(payload.username);
    const email = normalizeLower(payload.email);
    const password = normalize(payload.password);

    const role = ALLOWED_ROLES.includes(String(payload.role))
      ? String(payload.role)
      : "admin";

    const fullName = normalize(payload.fullName);
    const phone = normalize(payload.phone);
    const profileImage = normalize(payload.profileImage);
    const permissions = safePermissions(payload.permissions);

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "username, email and password are required",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "password must be at least 6 characters",
      });
    }

    const exists = await AdminUser.findOne({
      $or: [{ username }, { email }],
    }).lean();

    if (exists) {
      return res.status(409).json({
        success: false,
        message: "Username or email already exists",
      });
    }

    const user = await AdminUser.create({
      username,
      email,
      password, // hashed by pre-save
      role,
      fullName,
      phone,
      profileImage,
      permissions,
      createdBy: req.admin?._id || null,
    });

    const createdUser = await AdminUser.findById(user._id)
      .select("-password")
      .lean();

    res.status(201).json({
      success: true,
      message: "Admin user created successfully",
      user: createdUser,
    });
  } catch (error) {
    // ✅ duplicate key
    if (error?.code === 11000) {
      const field = Object.keys(error.keyValue || {})[0] || "field";
      return res.status(409).json({
        success: false,
        message: `${field} already exists`,
      });
    }

    res.status(500).json({ success: false, message: error.message });
  }
};

/* ============================================================
   ✅ PATCH: /api/admin-users/:id
   Update profile fields (not password/role)
============================================================ */
export const updateAdminUser = async (req, res) => {
  try {
    const payload = req.body || {};
    const { fullName, phone, profileImage, isActive } = payload;

    const user = await AdminUser.findById(req.params.id).select("-password");
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "Admin user not found" });

    if (fullName !== undefined) user.fullName = normalize(fullName);
    if (phone !== undefined) user.phone = normalize(phone);
    if (profileImage !== undefined) user.profileImage = normalize(profileImage);
    if (isActive !== undefined) user.isActive = !!isActive;

    await user.save();

    const safeUser = await AdminUser.findById(user._id)
      .select("-password")
      .lean();

    res.status(200).json({
      success: true,
      message: "Admin user updated successfully",
      user: safeUser,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ============================================================
   ✅ PATCH: /api/admin-users/:id/role
   Update role + permissions
============================================================ */
export const updateAdminRoleAndPermissions = async (req, res) => {
  try {
    const { role, permissions } = req.body || {};

    const user = await AdminUser.findById(req.params.id).select("-password");
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "Admin user not found" });

    if (role !== undefined) {
      const nextRole = String(role);
      if (!ALLOWED_ROLES.includes(nextRole)) {
        return res.status(400).json({
          success: false,
          message: "Invalid role",
        });
      }
      user.role = nextRole;
    }

    if (permissions !== undefined) {
      user.permissions = safePermissions(permissions);
    }

    await user.save();

    const safeUser = await AdminUser.findById(user._id)
      .select("-password")
      .lean();

    res.status(200).json({
      success: true,
      message: "Role/permissions updated successfully",
      user: safeUser,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ============================================================
   ✅ PATCH: /api/admin-users/:id/password
   Change password securely
============================================================ */
export const changeAdminPassword = async (req, res) => {
  try {
    const { newPassword } = req.body || {};
    const nextPass = normalize(newPassword);

    if (!nextPass || nextPass.length < 6) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 6 chars",
      });
    }

    const user = await AdminUser.findById(req.params.id).select("+password");
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "Admin user not found" });

    user.password = nextPass; // hashed via pre-save
    await user.save();

    res
      .status(200)
      .json({ success: true, message: "Password updated successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ============================================================
   ✅ PATCH: /api/admin-users/:id/unlock
   Reset login attempts & lockUntil
============================================================ */
export const unlockAdminUser = async (req, res) => {
  try {
    const user = await AdminUser.findById(req.params.id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "Admin user not found" });

    user.loginAttempts = 0;
    user.lockUntil = null;
    user.isActive = true;

    await user.save();

    const safeUser = await AdminUser.findById(user._id)
      .select("-password")
      .lean();

    res.status(200).json({
      success: true,
      message: "Admin unlocked successfully",
      user: safeUser,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ============================================================
   ✅ DELETE: /api/admin-users/:id
   Delete admin user (hard delete)
============================================================ */
export const deleteAdminUser = async (req, res) => {
  try {
    const user = await AdminUser.findById(req.params.id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "Admin user not found" });

    await user.deleteOne();

    res
      .status(200)
      .json({ success: true, message: "Admin user deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ===========================================================
   ✅ ADMIN LOGIN
   POST /api/admin-auth/login
   - username OR email allowed
=========================================================== */
export const adminLogin = async (req, res) => {
  try {
    let { username, password } = req.body || {};

    username = normalizeLower(username);
    password = normalize(password);

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Username/email and password required",
      });
    }

    // ✅ allow login using username OR email
    const admin = await AdminUser.findOne({
      $or: [{ username }, { email: username }],
    }).select("+password");

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Invalid username/email or password",
      });
    }

    // ✅ disabled check
    if (!admin.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account disabled. Contact superadmin.",
      });
    }

    // ✅ lock check (using schema method)
    if (admin.isLocked && admin.isLocked()) {
      return res.status(403).json({
        success: false,
        message: "Account locked temporarily due to failed attempts. Try later.",
      });
    }

    // ✅ password match
    const isMatch = await admin.matchPassword(password);

    if (!isMatch) {
      if (admin.incrementLoginAttempts) await admin.incrementLoginAttempts();

      return res.status(401).json({
        success: false,
        message: "Invalid username/email or password",
      });
    }

    // ✅ success: reset lock
    if (admin.resetLoginAttempts) await admin.resetLoginAttempts();

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
        isActive: admin.isActive,
        lastLogin: admin.lastLogin,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
