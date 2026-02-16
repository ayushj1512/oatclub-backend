// scripts/fixCustomerTickets.js

import mongoose from "mongoose";
import Counter from "../models/Counter.js";
import CustomerTicketModal from "../CustomerTicket/CustomerTicketModal.js";
import "dotenv/config";

const MONGO_URI = process.env.MONGO_URI; // make sure this is set

const pad6 = (n) => String(n).padStart(6, "0");
const makeTicketId = (n) => `T-${pad6(n)}`;

async function run() {
  try {
    if (!MONGO_URI) {
      throw new Error("MONGO_URI missing in environment");
    }

    await mongoose.connect(MONGO_URI);
    console.log("✅ Mongo connected");

    // 1️⃣ Get all tickets oldest first (stable order)
    const tickets = await CustomerTicketModal.find({})
      .sort({ createdAt: 1, _id: 1 })
      .select("_id ticketNo ticketId createdAt");

    console.log(`🔎 Found ${tickets.length} tickets`);

    let seq = 0;

    for (const t of tickets) {
      seq += 1;

      const newNo = seq;
      const newId = makeTicketId(newNo);

      await CustomerTicketModal.updateOne(
        { _id: t._id },
        {
          $set: {
            ticketNo: newNo,
            ticketId: newId,
          },
        }
      );

      if (seq % 200 === 0) {
        console.log(`... updated ${seq}`);
      }
    }

    // 2️⃣ Set counter to latest value
    await Counter.findOneAndUpdate(
      { name: "customer_ticket" },
      { $set: { seq } },
      { new: true, upsert: true }
    );

    console.log(`✅ Migration complete`);
    console.log(`📌 Counter set to seq = ${seq}`);

    await mongoose.disconnect();
    console.log("✅ Done");
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  }
}

run();
