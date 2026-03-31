// utils/stateCodeMap.js

const RAW_STATE_CODE_MAP = {
  "JAMMU AND KASHMIR": "01",
  "HIMACHAL PRADESH": "02",
  PUNJAB: "03",
  CHANDIGARH: "04",
  UTTARAKHAND: "05",
  HARYANA: "06",
  DELHI: "07",
  RAJASTHAN: "08",
  "UTTAR PRADESH": "09",
  BIHAR: "10",
  SIKKIM: "11",
  "ARUNACHAL PRADESH": "12",
  NAGALAND: "13",
  MANIPUR: "14",
  MIZORAM: "15",
  TRIPURA: "16",
  MEGHALAYA: "17",
  ASSAM: "18",
  "WEST BENGAL": "19",
  JHARKHAND: "20",

  ODISHA: "21",
  ORISSA: "21",

  CHATTISGARH: "22",
  CHHATTISGARH: "22",

  "MADHYA PRADESH": "23",
  GUJARAT: "24",

  "DADRA AND NAGAR HAVELI AND DAMAN AND DIU (NEWLY MERGED UT)": "26",
  "DADRA AND NAGAR HAVELI AND DAMAN AND DIU": "26",

  MAHARASHTRA: "27",

  "ANDHRA PRADESH (BEFORE DIVISION)": "28",

  KARNATAKA: "29",
  GOA: "30",
  LAKSHADWEEP: "31",

  KERELA: "32",
  KERALA: "32",

  "TAMIL NADU": "33",
  PUDUCHERRY: "34",

  "ANDAMAN AND NICOBAR ISLANDS": "35",
  "ANDAMAN AND NICOBAR": "35",
  "ANDAMAN & NICOBAR": "35",
  "ANDAMAN & NICOBAR ISLANDS": "35",

  TELANGANA: "36",

  "ANDHRA PRADESH (NEWLY ADDED)": "37",
  "ANDHRA PRADESH": "37",

  "LADAKH (NEWLY ADDED)": "38",
  LADAKH: "38",

  "OTHER TERRITORY": "97",
  "CENTRE JURISDICTION": "99",
};

const normalizeStateName = (value = "") =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/&/g, "AND")
    .replace(/[().,-]/g, " ")
    .replace(/\s+/g, " ");

const NORMALIZED_STATE_CODE_MAP = Object.entries(RAW_STATE_CODE_MAP).reduce(
  (acc, [name, code]) => {
    acc[normalizeStateName(name)] = code;
    return acc;
  },
  {}
);

export const getStateCodeFromName = (stateName = "") => {
  const normalized = normalizeStateName(stateName);
  return NORMALIZED_STATE_CODE_MAP[normalized] || "";
};

export const STATE_CODE_LIST = Object.entries(RAW_STATE_CODE_MAP).map(
  ([stateName, stateCode]) => ({
    stateName,
    stateCode,
  })
);

export { normalizeStateName };
export default NORMALIZED_STATE_CODE_MAP;