import redis from "../config/redis.js";

export const getCache = async (key) => {
  try {
    if (redis.status !== "ready") return null;

    const value = await redis.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.error(`Redis GET failed [${key}]:`, error.message);
    return null;
  }
};

export const setCache = async (key, value, ttlSeconds = 300) => {
  try {
    if (redis.status !== "ready") return false;

    await redis.set(
      key,
      JSON.stringify(value),
      "EX",
      ttlSeconds
    );

    return true;
  } catch (error) {
    console.error(`Redis SET failed [${key}]:`, error.message);
    return false;
  }
};

export const deleteCache = async (key) => {
  try {
    if (redis.status !== "ready") return false;

    await redis.del(key);
    return true;
  } catch (error) {
    console.error(`Redis DEL failed [${key}]:`, error.message);
    return false;
  }
};

export const deleteCacheByPattern = async (pattern) => {
  try {
    if (redis.status !== "ready") return 0;

    let cursor = "0";
    let deleted = 0;

    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100,
      );

      cursor = nextCursor;

      if (keys.length) {
        deleted += await redis.del(...keys);
      }
    } while (cursor !== "0");

    return deleted;
  } catch (error) {
    console.error(
      `Redis pattern delete failed [${pattern}]:`,
      error.message,
    );

    return 0;
  }
};
