import AdminUser from "../../models/admin/AdminUser.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// 🔹 Create new admin user
export const createAdminUser = async (req, res) => {
  try {
    const { username, email, password, role, fullName, phone, profileImage } = req.body;

    const existingUser = await AdminUser.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "Email already exists" });

    const adminUser = await AdminUser.create({
      username,
      email,
      password,
      role,
      fullName,
      phone,
      profileImage,
    });

    res.status(201).json(adminUser);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 🔹 Get all admin users
export const getAllAdminUsers = async (req, res) => {
  try {
    const users = await AdminUser.find().select("-password");
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 🔹 Get single admin user by ID
export const getAdminUserById = async (req, res) => {
  try {
    const user = await AdminUser.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ message: "Admin user not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 🔹 Update admin user
export const updateAdminUser = async (req, res) => {
  try {
    const { username, email, role, fullName, phone, profileImage, isActive, permissions } = req.body;
    const user = await AdminUser.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "Admin user not found" });

    user.username = username ?? user.username;
    user.email = email ?? user.email;
    user.role = role ?? user.role;
    user.fullName = fullName ?? user.fullName;
    user.phone = phone ?? user.phone;
    user.profileImage = profileImage ?? user.profileImage;
    user.isActive = isActive ?? user.isActive;
    user.permissions = permissions ?? user.permissions;

    await user.save();
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 🔹 Delete admin user
export const deleteAdminUser = async (req, res) => {
  try {
    const user = await AdminUser.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: "Admin user not found" });
    res.json({ message: "Admin user deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 🔹 Admin login
export const loginAdminUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await AdminUser.findOne({ email }).select("+password");
    if (!user) return res.status(401).json({ message: "Invalid email or password" });

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      await user.incrementLoginAttempts();
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Reset login attempts on successful login
    user.loginAttempts = 0;
    user.lockUntil = null;
    user.lastLogin = new Date();
    await user.save();

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { id: user._id, username: user.username, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 🔹 Change password
export const changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const user = await AdminUser.findById(req.params.id).select("+password");
    if (!user) return res.status(404).json({ message: "Admin user not found" });

    const isMatch = await user.matchPassword(oldPassword);
    if (!isMatch) return res.status(400).json({ message: "Old password is incorrect" });

    user.password = newPassword;
    await user.save();
    res.json({ message: "Password updated successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
