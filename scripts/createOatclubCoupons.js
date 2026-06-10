import "dotenv/config";
import mongoose from "mongoose";
import Coupon from "../Coupon/Coupon.js";

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    console.log("✅ MongoDB connected");

    // delete old code if exists
    await Coupon.deleteOne({ code: "THANKYOU10" });

    // create/update new code
    await Coupon.findOneAndUpdate(
      { code: "THANKU10" },
      {
        $set: {
          code: "THANKU10",
          description: "10% off thank you coupon",
          discountType: "percentage",
          discountValue: 10,
          visibility: "public",
          type: "general",
          isActive: true,
          validTill: new Date(
            new Date().setFullYear(new Date().getFullYear() + 1)
          ),
        },
      },
      {
        upsert: true,
        new: true,
      }
    );

    console.log("✅ THANKYOU10 removed");
    console.log("✅ THANKU10 created");
  } catch (error) {
    console.error(error);
  } finally {
    await mongoose.disconnect();
    console.log("✅ MongoDB disconnected");
  }
}

run();