import crypto from "crypto";
import mongoose from "mongoose";
import MarketingCampaign from "./MarketingCampaign.js";

const FRONTEND_URL =
  process.env.FRONTEND_URL || "https://www.mirayfashions.com/";

const generateShortCode = () => crypto.randomBytes(6).toString("hex");

const slugify = (value = "") =>
  String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

const generateUniqueSlug = async (name) => {
  const baseSlug = slugify(name);
  let slug = baseSlug || `campaign-${Date.now()}`;
  let counter = 1;

  while (await MarketingCampaign.exists({ slug })) {
    slug = `${baseSlug}-${counter}`;
    counter += 1;
  }

  return slug;
};

const findCampaign = async (campaignIdOrSlug) => {
  if (!campaignIdOrSlug) return null;

  const bySlug = await MarketingCampaign.findOne({
    slug: campaignIdOrSlug,
  });

  if (bySlug) return bySlug;

  if (mongoose.Types.ObjectId.isValid(campaignIdOrSlug)) {
    return await MarketingCampaign.findById(campaignIdOrSlug);
  }

  return null;
};

const getTrackingUrl = (req, shortCode) => {
  return `${req.protocol}://${req.get(
    "host"
  )}/api/marketing-campaigns/t/${shortCode}`;
};

const buildSafeUrl = (url = "") => {
  const cleanUrl = String(url || "").trim();

  try {
    return new URL(cleanUrl || "/", FRONTEND_URL);
  } catch {
    return new URL("/", FRONTEND_URL);
  }
};

export const createCampaign = async (req, res) => {
  try {
    const { name, description, status } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Campaign name is required",
      });
    }

    const slug = await generateUniqueSlug(name);

    const campaign = await MarketingCampaign.create({
      name: name.trim(),
      slug,
      description: description || "",
      status: status || "draft",
    });

    res.status(201).json({
      success: true,
      campaign,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const createTrackingLink = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const {
      destinationUrl = "/",
      customerId,
      phone,
      name,
    } = req.body;

    const campaign = await findCampaign(campaignId);

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    const shortCode = generateShortCode();

    const link = {
      shortCode,
      destinationUrl: destinationUrl || "/",
      customerId: customerId || undefined,
      phone,
      name,
      sentAt: new Date(),
    };

    campaign.links.push(link);
    campaign.totalLinks = Number(campaign.totalLinks || 0) + 1;

    await campaign.save();

    const savedLink = campaign.links[campaign.links.length - 1];

    res.status(201).json({
      success: true,
      trackingUrl: getTrackingUrl(req, shortCode),
      shortCode,
      link: savedLink,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const trackClickAndRedirect = async (req, res) => {
  try {
    const { shortCode } = req.params;

    const campaign = await MarketingCampaign.findOne({
      "links.shortCode": shortCode,
    });

    if (!campaign) return res.redirect(FRONTEND_URL);

    const link = campaign.links.find((l) => l.shortCode === shortCode);

    if (!link) return res.redirect(FRONTEND_URL);

    const now = new Date();

    const clickData = {
      clickedAt: now,
      ip: req.ip,
      userAgent: req.get("user-agent"),
      referrer: req.get("referer"),
      device: req.get("sec-ch-ua-platform") || "",
    };

    const isFirstClick = !link.firstClickedAt;

    link.clickCount = Number(link.clickCount || 0) + 1;
    link.lastClickedAt = now;
    link.clicks.push(clickData);

    campaign.totalClicks = Number(campaign.totalClicks || 0) + 1;

    if (isFirstClick) {
      link.firstClickedAt = now;
      link.uniqueClickCount = 1;
      campaign.uniqueClicks = Number(campaign.uniqueClicks || 0) + 1;
    }

    link.journey.push({
      event: "landing",
      pageUrl: link.destinationUrl || "/",
      occurredAt: now,
      ip: req.ip,
      userAgent: req.get("user-agent"),
    });

    await campaign.save();

    const redirectUrl = buildSafeUrl(link.destinationUrl || "/");

    redirectUrl.searchParams.set("utm_source", "marketing");
    redirectUrl.searchParams.set("utm_medium", "campaign");
    redirectUrl.searchParams.set(
      "utm_campaign",
      campaign.slug || campaign._id.toString()
    );
    redirectUrl.searchParams.set("campaignId", campaign._id.toString());
    redirectUrl.searchParams.set("mlid", link._id.toString());
    redirectUrl.searchParams.set("mcode", shortCode);

    return res.redirect(redirectUrl.toString());
  } catch (error) {
    console.error("TRACK CLICK REDIRECT ERROR:", error);
    return res.redirect(FRONTEND_URL);
  }
};

export const trackJourneyEvent = async (req, res) => {
  try {
    const {
      campaignId,
      marketingLinkId,
      shortCode,
      event,
      pageUrl,
      productId,
      productName,
      cartValue,
      orderId,
      orderNumber,
      revenue,
    } = req.body;

    if (!event) {
      return res.status(400).json({
        success: false,
        message: "Event is required",
      });
    }

    let campaign = null;

    if (campaignId) {
      campaign = await findCampaign(campaignId);
    } else if (shortCode) {
      campaign = await MarketingCampaign.findOne({
        "links.shortCode": shortCode,
      });
    }

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    const link = campaign.links.find((l) => {
      if (marketingLinkId) return l._id.toString() === marketingLinkId;
      return l.shortCode === shortCode;
    });

    if (!link) {
      return res.status(404).json({
        success: false,
        message: "Tracking link not found",
      });
    }

    link.journey.push({
      event,
      pageUrl,
      productId,
      productName,
      cartValue: Number(cartValue || 0),
      orderId,
      orderNumber,
      revenue: Number(revenue || 0),
      ip: req.ip,
      userAgent: req.get("user-agent"),
    });

    await campaign.save();

    res.json({
      success: true,
      message: "Journey event tracked successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const markConversion = async (req, res) => {
  try {
    const {
      campaignId,
      marketingLinkId,
      shortCode,
      orderId,
      orderNumber,
      revenue,
    } = req.body;

    let campaign = null;

    if (campaignId) {
      campaign = await findCampaign(campaignId);
    } else if (shortCode) {
      campaign = await MarketingCampaign.findOne({
        "links.shortCode": shortCode,
      });
    }

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    const link = campaign.links.find((l) => {
      if (marketingLinkId) return l._id.toString() === marketingLinkId;
      return l.shortCode === shortCode;
    });

    if (!link) {
      return res.status(404).json({
        success: false,
        message: "Tracking link not found",
      });
    }

    if (!link.converted) {
      const amount = Number(revenue || 0);

      link.converted = true;
      link.convertedAt = new Date();
      link.orderId = orderId;
      link.orderNumber = orderNumber;
      link.revenue = amount;

      link.journey.push({
        event: "order_created",
        orderId,
        orderNumber,
        revenue: amount,
        occurredAt: new Date(),
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      campaign.totalOrders = Number(campaign.totalOrders || 0) + 1;
      campaign.totalRevenue = Number(campaign.totalRevenue || 0) + amount;
    }

    await campaign.save();

    res.json({
      success: true,
      message: "Conversion tracked successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getCampaigns = async (req, res) => {
  try {
    const campaigns = await MarketingCampaign.find()
      .sort({ createdAt: -1 })
      .select("-links.clicks -links.journey");

    res.json({
      success: true,
      campaigns,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getCampaignDetails = async (req, res) => {
  try {
    const { campaignId } = req.params;

    const campaign = await findCampaign(campaignId);

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    const totalLinks = campaign.totalLinks || campaign.links.length || 0;
    const clicks = Number(campaign.uniqueClicks || 0);
    const orders = Number(campaign.totalOrders || 0);
    const revenue = Number(campaign.totalRevenue || 0);

    const stats = {
      totalLinks,
      totalClicks: campaign.totalClicks || 0,
      uniqueClicks: campaign.uniqueClicks || 0,
      totalOrders: campaign.totalOrders || 0,
      totalRevenue: campaign.totalRevenue || 0,

      ctr: totalLinks
        ? Number(((clicks / totalLinks) * 100).toFixed(2))
        : 0,

      conversionRate: clicks
        ? Number(((orders / clicks) * 100).toFixed(2))
        : 0,

      revenuePerClick: clicks ? Number((revenue / clicks).toFixed(2)) : 0,
    };

    res.json({
      success: true,
      campaign,
      stats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};