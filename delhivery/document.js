import { delhiveryClient } from "./client.js";
import { ENDPOINTS } from "./constants.js";

export const downloadDocument = async ({
  waybill,
  docType,
}) => {
  const wbn = String(waybill || "").trim();
  const type = String(docType || "").trim();

  if (!wbn) {
    throw new Error("Waybill is required.");
  }

  if (!type) {
    throw new Error("Document type is required.");
  }

  const { data } = await delhiveryClient.get(
    ENDPOINTS.DOCUMENT,
    {
      params: {
        waybill: wbn,
        doc_type: type,
      },
      timeout: 20000,
    }
  );

  return data;
};
