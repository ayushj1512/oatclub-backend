import dotenv from "dotenv";
import mongoose from "mongoose";
import AdminUser from "../AdminUsers/AdminUser.js";

dotenv.config();

const users = ["maitri"];

const buildEmail = (username) => `${username}@oatclub.in`;

async function seedOatclubAdmins() {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI missing in .env");
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB connected");

    for (const username of users) {
      const password = `Oatclub@${username}`;

      const payload = {
        username,
        email: buildEmail(username),
        password,
        role: "admin",
        fullName: username.charAt(0).toUpperCase() + username.slice(1),
        profileImage: "",
        phone: "",
        permissions: ["*"],
        isActive: true,
        loginAttempts: 0,
        lockUntil: null,
        sessionVersion: 0,
        forceLoggedOutAt: null,
      };

      const existing = await AdminUser.findOne({ username });

      if (existing) {
        existing.email = payload.email;
        existing.password = payload.password;
        existing.role = payload.role;
        existing.fullName = payload.fullName;
        existing.permissions = payload.permissions;
        existing.isActive = true;
        existing.loginAttempts = 0;
        existing.lockUntil = null;
        existing.sessionVersion = (existing.sessionVersion || 0) + 1;
        existing.forceLoggedOutAt = new Date();

        await existing.save();
        console.log(`🔁 Updated: ${username}`);
      } else {
        await AdminUser.create(payload);
        console.log(`✅ Created: ${username}`);
      }

      console.log(`   Login: ${username} / ${password}`);
    }

    console.log("\n🎉 Oatclub admin users seeded successfully");
    process.exit(0);
  } catch (error) {
    console.error("❌ Seed failed:", error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

seedOatclubAdmins();