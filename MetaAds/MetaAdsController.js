import axios from "axios";

const META_API_VERSION = process.env.META_API_VERSION || "v25.0";
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || "";
const META_AD_ACCOUNT_ID = String(process.env.META_AD_ACCOUNT_ID || "").replace(
  /^act_/,
  ""
);

const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const safeArr = (v) => (Array.isArray(v) ? v : []);

const PURCHASE_ACTION_TYPES = [
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
  "onsite_web_purchase",
  "web_in_store_purchase",
];

const sumActionValues = (rows = [], key = "actions", acceptedTypes = []) => {
  return safeArr(rows).reduce((sum, row) => {
    const values = safeArr(row?.[key]);

    const rowSum = values.reduce((acc, item) => {
      const type = String(item?.action_type || "").trim();
      if (!acceptedTypes.includes(type)) return acc;
      return acc + toNum(item?.value, 0);
    }, 0);

    return sum + rowSum;
  }, 0);
};

const formatSummary = (rows = []) => {
  const adSpend = safeArr(rows).reduce(
    (sum, row) => sum + toNum(row?.spend, 0),
    0
  );

  const ordersGeneratedFromAds = sumActionValues(
    rows,
    "actions",
    PURCHASE_ACTION_TYPES
  );

  const revenueGeneratedFromAds = sumActionValues(
    rows,
    "action_values",
    PURCHASE_ACTION_TYPES
  );

  const roas = adSpend > 0 ? revenueGeneratedFromAds / adSpend : 0;
  const costPerOrder =
    ordersGeneratedFromAds > 0 ? adSpend / ordersGeneratedFromAds : 0;

  return {
    adSpend: Number(adSpend.toFixed(2)),
    ordersGeneratedFromAds: Number(ordersGeneratedFromAds.toFixed(2)),
    revenueGeneratedFromAds: Number(revenueGeneratedFromAds.toFixed(2)),
    roas: Number(roas.toFixed(2)),
    costPerOrder: Number(costPerOrder.toFixed(2)),
  };
};

const formatDaily = (rows = []) => {
  return safeArr(rows).map((row) => {
    const adSpend = toNum(row?.spend, 0);

    const ordersGeneratedFromAds = sumActionValues(
      [row],
      "actions",
      PURCHASE_ACTION_TYPES
    );

    const revenueGeneratedFromAds = sumActionValues(
      [row],
      "action_values",
      PURCHASE_ACTION_TYPES
    );

    const roas = adSpend > 0 ? revenueGeneratedFromAds / adSpend : 0;
    const costPerOrder =
      ordersGeneratedFromAds > 0 ? adSpend / ordersGeneratedFromAds : 0;

    return {
      date: row?.date_start || "",
      dateStop: row?.date_stop || "",
      name: row?.campaign_name || row?.adset_name || row?.ad_name || "",
      adSpend: Number(adSpend.toFixed(2)),
      ordersGeneratedFromAds: Number(ordersGeneratedFromAds.toFixed(2)),
      revenueGeneratedFromAds: Number(revenueGeneratedFromAds.toFixed(2)),
      roas: Number(roas.toFixed(2)),
      costPerOrder: Number(costPerOrder.toFixed(2)),
      rawActions: safeArr(row?.actions),
      rawActionValues: safeArr(row?.action_values),
    };
  });
};

export const getMetaDashboardSummary = async (req, res) => {
  try {
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    const level = String(req.query.level || "account").trim();
    const usePresetToday = String(req.query.today || "").trim() === "1";

    if (!usePresetToday && (!from || !to)) {
      return res.status(400).json({
        success: false,
        message: "from and to are required in YYYY-MM-DD format",
      });
    }

    if (!META_ACCESS_TOKEN || !META_AD_ACCOUNT_ID) {
      return res.status(500).json({
        success: false,
        message:
          "Missing Meta configuration. Please set META_ACCESS_TOKEN and META_AD_ACCOUNT_ID",
      });
    }

    const baseUrl = `https://graph.facebook.com/${META_API_VERSION}/act_${META_AD_ACCOUNT_ID}/insights`;

    const fields = [
      "date_start",
      "date_stop",
      "spend",
      "actions",
      "action_values",
      "campaign_name",
      "adset_name",
      "ad_name",
    ].join(",");

    const params = {
      access_token: META_ACCESS_TOKEN,
      level,
      time_increment: 1,
      limit: 500,
      fields,
    };

    if (usePresetToday) {
      params.date_preset = "today";
    } else {
      params.time_range = JSON.stringify({
        since: from,
        until: to,
      });
    }

    console.log("========== META ADS DEBUG START ==========");
    console.log("META_API_VERSION:", META_API_VERSION);
    console.log("META_AD_ACCOUNT_ID:", META_AD_ACCOUNT_ID);
    console.log("REQUEST_URL:", baseUrl);
    console.log("REQUEST_PARAMS:", JSON.stringify(params, null, 2));

    let allRows = [];
    let nextUrl = baseUrl;
    let nextParams = { ...params };
    let page = 1;

    while (nextUrl) {
      console.log(`--- META PAGE ${page} REQUEST ---`);
      console.log("NEXT_URL:", nextUrl);
      console.log("NEXT_PARAMS:", JSON.stringify(nextParams, null, 2));

      const response = await axios.get(nextUrl, { params: nextParams });
      const data = response?.data || {};

      console.log(`--- META PAGE ${page} RAW RESPONSE ---`);
      console.log(JSON.stringify(data, null, 2));

      const rows = safeArr(data?.data);
      console.log(`--- META PAGE ${page} ROW COUNT:`, rows.length);

      allRows = allRows.concat(rows);

      nextUrl = data?.paging?.next || null;
      nextParams = {};
      page += 1;
    }

    const summary = formatSummary(allRows);
    const daily = formatDaily(allRows);

    console.log("--- META SUMMARY ---");
    console.log(JSON.stringify(summary, null, 2));
    console.log("--- META DAILY ---");
    console.log(JSON.stringify(daily, null, 2));
    console.log("========== META ADS DEBUG END ==========");

    return res.status(200).json({
      success: true,
      filters: {
        from: usePresetToday ? null : from,
        to: usePresetToday ? null : to,
        today: usePresetToday,
        level,
      },
      summary,
      daily,
      rawCount: allRows.length,
      meta: {
        accountId: `act_${META_AD_ACCOUNT_ID}`,
      },
    });
  } catch (error) {
    const metaError = error?.response?.data?.error;

    console.log("========== META ADS ERROR ==========");
    console.log("ERROR_MESSAGE:", error?.message);
    console.log(
      "ERROR_RESPONSE:",
      JSON.stringify(error?.response?.data || {}, null, 2)
    );
    console.log("========== META ADS ERROR END ==========");

    return res.status(500).json({
      success: false,
      message:
        metaError?.message ||
        error?.message ||
        "Failed to fetch Meta ads dashboard data",
      error: metaError || null,
    });
  }
};

export const testMetaSpendRaw = async (req, res) => {
  try {
    if (!META_ACCESS_TOKEN || !META_AD_ACCOUNT_ID) {
      return res.status(500).json({
        success: false,
        message:
          "Missing Meta configuration. Please set META_ACCESS_TOKEN and META_AD_ACCOUNT_ID",
      });
    }

    const url = `https://graph.facebook.com/${META_API_VERSION}/act_${META_AD_ACCOUNT_ID}/insights`;

    const params = {
      access_token: META_ACCESS_TOKEN,
      fields: "spend,date_start,date_stop,campaign_name",
      date_preset: "maximum",
      level: "campaign",
      limit: 500,
    };

    console.log("========== META RAW SPEND TEST START ==========");
    console.log("RAW_TEST_URL:", url);
    console.log("RAW_TEST_PARAMS:", JSON.stringify(params, null, 2));

    const { data } = await axios.get(url, { params });

    console.log("RAW_META_SPEND_TEST_RESPONSE:");
    console.log(JSON.stringify(data, null, 2));
    console.log("========== META RAW SPEND TEST END ==========");

    return res.status(200).json({
      success: true,
      raw: data,
    });
  } catch (error) {
    const metaError = error?.response?.data?.error;

    console.log("========== META RAW SPEND TEST ERROR ==========");
    console.log("ERROR_MESSAGE:", error?.message);
    console.log(
      "ERROR_RESPONSE:",
      JSON.stringify(error?.response?.data || {}, null, 2)
    );
    console.log("========== META RAW SPEND TEST ERROR END ==========");

    return res.status(500).json({
      success: false,
      message:
        metaError?.message ||
        error?.message ||
        "Failed to fetch raw Meta spend data",
      error: metaError || null,
    });
  }
};