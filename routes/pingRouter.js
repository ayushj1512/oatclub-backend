// routes/pingRoutes.js
import express from "express";
import os from "os";
const router = express.Router();

// Fun server messages with emojis
const funMessages = [
  "🚀 Server blasting off!",
  "🛒 E-commerce magic running!",
  "⚡ Server charged up!",
  "💻 Code ninjas at work!",
  "🌐 Ping received, all systems go!",
  "🔥 Hot server, cool response!",
  "🎉 Server party mode ON!",
  "🤖 AI helpers reporting in!",
  "🟢 Everything’s green and alive!",
  "✨ Sparkles of uptime everywhere!",
];

// GET /api/ping
router.get("/", (req, res) => {
  const memoryUsage = process.memoryUsage();
  const uptimeSeconds = process.uptime();
  const uptimeHours = (uptimeSeconds / 3600).toFixed(2);

  // Pick a random fun message
  const randomMessage = funMessages[Math.floor(Math.random() * funMessages.length)];

  res.status(200).json({
    success: true,
    message: randomMessage,
    timestamp: new Date().toISOString(),
    uptime: `${uptimeSeconds.toFixed(2)} seconds (~${uptimeHours} hours)`,
    memory: {
      rss: `${(memoryUsage.rss / 1024 / 1024).toFixed(2)} MB`,
      heapTotal: `${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
      heapUsed: `${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      external: `${(memoryUsage.external / 1024 / 1024).toFixed(2)} MB`,
    },
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    cpuCores: os.cpus().length,
    host: os.hostname(),
  });
});

export default router;
