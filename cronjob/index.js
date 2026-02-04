import cron from "node-cron";

export function startCrons() {
  // 😎 jugad: always run crons
  const RUN_CRONS = true;

  if (!RUN_CRONS) {
    console.log("⏭️ Crons disabled");
    return;
  }

  // ✅ EVERY 15 MINUTES
  cron.schedule("*/15 * * * *", async () => {
    try {
      console.log("⏱️ Shiprocket cron tick (every 15 min)");
      const { runShiprocketSync } = await import(
        "./shiprocket/shiprocketSync.js"
      );
      await runShiprocketSync();
    } catch (e) {
      console.error("❌ Shiprocket cron failed:", e?.message || e);
    }
  });

  console.log("✅ Crons started (every 15 minutes)");
}
