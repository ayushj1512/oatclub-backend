import axios from "axios";
import { DELHIVERY_CONFIG } from "./config.js";

// Common Delhivery API client
export const delhiveryClient = axios.create({
  baseURL: DELHIVERY_CONFIG.baseUrl,
  timeout: 30000,
  headers: {
    Accept: "application/json",
    Authorization: `Token ${DELHIVERY_CONFIG.token}`,
  },
});
