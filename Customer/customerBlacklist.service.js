import mongoose from "mongoose";
import Customer from "./Customer.js";

const clean = (value) => String(value ?? "").trim();

export const normalizeBlacklistEmail = (value) =>
  clean(value).toLowerCase();

export const normalizeBlacklistPhone = (value) => {
  const digits = clean(value).replace(/\D/g, "");

  // Store/compare Indian mobile number using final 10 digits
  return digits.length >= 10 ? digits.slice(-10) : digits;
};

const buildPhoneCandidates = (phone) => {
  const normalizedPhone = normalizeBlacklistPhone(phone);

  if (!normalizedPhone) return [];

  return [
    normalizedPhone,
    `91${normalizedPhone}`,
    `+91${normalizedPhone}`,
    `0${normalizedPhone}`,
  ];
};

/**
 * Checks whether a customer is blacklisted through:
 * 1. Customer MongoDB _id
 * 2. Customer email
 * 3. Customer phone
 *
 * A match through any identity blocks the order.
 */
export const checkIsBlacklistedCustomer = async ({
  customerId = null,
  email = "",
  phone = "",
  session = null,
} = {}) => {
  const normalizedEmail = normalizeBlacklistEmail(email);
  const normalizedPhone = normalizeBlacklistPhone(phone);
  const phoneCandidates = buildPhoneCandidates(phone);

  const identityConditions = [];

  if (
    customerId &&
    mongoose.Types.ObjectId.isValid(String(customerId))
  ) {
    identityConditions.push({
      _id: new mongoose.Types.ObjectId(String(customerId)),
    });
  }

  if (normalizedEmail) {
    identityConditions.push({
      email: normalizedEmail,
    });
  }

  if (phoneCandidates.length) {
    identityConditions.push({
      phone: { $in: phoneCandidates },
    });
  }

  if (!identityConditions.length) {
    return {
      isBlacklisted: false,
      customer: null,
      matchedBy: [],
      normalizedEmail,
      normalizedPhone,
    };
  }

  const query = Customer.findOne({
    isBlacklisted: true,
    $or: identityConditions,
  })
    .select("_id customerId name email phone isBlacklisted")
    .lean();

  if (session) {
    query.session(session);
  }

  const customer = await query;

  if (!customer) {
    return {
      isBlacklisted: false,
      customer: null,
      matchedBy: [],
      normalizedEmail,
      normalizedPhone,
    };
  }

  const matchedBy = [];

  if (
    customerId &&
    String(customer._id) === String(customerId)
  ) {
    matchedBy.push("customerId");
  }

  if (
    normalizedEmail &&
    normalizeBlacklistEmail(customer.email) === normalizedEmail
  ) {
    matchedBy.push("email");
  }

  if (
    normalizedPhone &&
    normalizeBlacklistPhone(customer.phone) === normalizedPhone
  ) {
    matchedBy.push("phone");
  }

  return {
    isBlacklisted: true,
    customer,
    matchedBy,
    normalizedEmail,
    normalizedPhone,
  };
};