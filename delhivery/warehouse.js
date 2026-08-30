import { delhiveryClient } from "./client.js";
import { ENDPOINTS } from "./constants.js";

export const createWarehouse = async (
  warehouse
) => {
  if (!warehouse?.name) {
    throw new Error(
      "Warehouse name is required."
    );
  }

  const { data } = await delhiveryClient.post(
    ENDPOINTS.WAREHOUSE,
    warehouse,
    {
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  return data;
};

export const updateWarehouse = async (
  warehouse
) => {
  if (!warehouse?.name) {
    throw new Error(
      "Warehouse name is required."
    );
  }

  const { data } = await delhiveryClient.post(
    ENDPOINTS.UPDATE_WAREHOUSE,
    warehouse,
    {
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  return data;
};
