import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  connectTimeout: 5000,
  enableReadyCheck: true,
});

redis.on("ready", () => {
  console.log("✅ Redis ready");
});

redis.on("error", (err) => {
  console.error("⚠️ Redis error:", err.message);
});

export const connectRedis = async () => {
  try {
    if (redis.status === "wait") {
      await redis.connect();
    }

    const pong = await redis.ping();
    console.log("✅ Redis:", pong);
  } catch (err) {
    console.error("⚠️ Redis unavailable, continuing with MongoDB:", err.message);
  }
};

export default redis;
