import { delhiveryClient } from "./client.js";
import { ENDPOINTS } from "./constants.js";

// Register pickup warehouse
export const createWarehouse = async (warehouse) => {
  const { data } = await delhiveryClient.post(
    ENDPOINTS.WAREHOUSE,
    warehouse
  );

  return data;
};
