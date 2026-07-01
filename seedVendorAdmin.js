import dotenv from "dotenv";
import mongoose from "mongoose";
import VendorUser from "./VendorUser/VendorUser.js";

dotenv.config();

const createVendorAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    const existing = await VendorUser.findOne({ username: "admin" });

    if (existing) {
      existing.name = "Admin";
      existing.password = "admin";
      existing.phone = "";
      existing.modules = {
        sampling: true,
        pattern: true,
        production: true,
        cuttingList: true,
      };
      existing.isActive = true;

      await existing.save();

      console.log("✅ Existing vendor admin updated");
    } else {
      await VendorUser.create({
        name: "Admin",
        username: "admin",
        password: "admin",
        phone: "",
        modules: {
          sampling: true,
          pattern: true,
          production: true,
          cuttingList: true,
        },
        isActive: true,
      });

      console.log("✅ Vendor admin created");
    }

    console.log("Username: admin");
    console.log("Password: admin");

    process.exit(0);
  } catch (error) {
    console.error("❌ Failed to create vendor admin:", error);
    process.exit(1);
  }
};

createVendorAdmin();