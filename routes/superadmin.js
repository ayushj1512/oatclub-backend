import express from "express";
import AdminUser from "../models/admin/AdminUser.js";
import bcrypt from "bcryptjs";

const router = express.Router();

// CREATE SUPERADMIN USER (Protected with MASTER SECRET)
router.post("/", async (req, res) => {
try {
  const { fullName, username, email, password, role, phone, permissions, secret } = req.body;

  // 🔐 Validate secret key
  if (secret !== process.env.ADMIN_SETUP_SECRET) {
    return res.status(401).json({ success: false, message: "Invalid Master Secret" });
  }

  // Check existing email or username
  const existing = await AdminUser.findOne({ $or: [{ email }, { username }] });
  if (existing) {
    return res.status(400).json({ success: false, message: "User already exists" });
  }

  // Create admin user
  const user = await AdminUser.create({
    fullName,
    username,
    email,
    password,
    role,
    phone,
    permissions,
  });

  return res.status(201).json({
    success: true,
    message: "Admin user created successfully",
    user,
  });

} catch (error) {
  return res.status(500).json({ success: false, message: error.message });
}
});


// ADMIN LOGIN ROUTE
router.post("/login", async (req, res) => {
try {
  const { username, password } = req.body;

  const user = await AdminUser.findOne({ username }).select("+password");

  if (!user) {
    return res.status(404).json({ message: "Invalid username or password" });
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return res.status(400).json({ message: "Invalid username or password" });
  }

  // Optional: Save last login
  user.lastLogin = new Date();
  await user.save();

  return res.json({
    success: true,
    message: "Login successful",
    user: {
      id: user._id,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
    }
  });

} catch (error) {
  return res.status(500).json({ message: error.message });
}
});

export default router;
