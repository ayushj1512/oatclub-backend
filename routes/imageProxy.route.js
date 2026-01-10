import express from "express";
import axios from "axios";

const router = express.Router();

// ✅ GET /api/proxy-image?url=https://mirayfashions.in/....
router.get("/", async (req, res) => {
  try {
    const url = String(req.query.url || "").trim();
    if (!url) return res.status(400).send("Missing url");

    const response = await axios.get(url, {
      responseType: "arraybuffer",
    });

    res.set("Content-Type", response.headers["content-type"] || "image/jpeg");
    res.set("Access-Control-Allow-Origin", "*"); // ✅ allow browser
    res.send(response.data);
  } catch (e) {
    console.error("Proxy image failed:", e.message);
    res.status(500).send("Proxy failed");
  }
});

export default router;
