import mongoose from "mongoose";
import Customer from "./Customer.js";

const clean = (value) => String(value ?? "").trim();

const normalizeEmail = (email) => clean(email).toLowerCase();

const normalizePhone = (phone) => {
  const digits = clean(phone).replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
};

export const checkIsBlacklistedCustomer = async ({
  customerId,
  email,
  phone,
  session = null,
}) => {
  const conditions = [];

  if (
    customerId &&
    mongoose.Types.ObjectId.isValid(String(customerId))
  ) {
    conditions.push({
      _id: new mongoose.Types.ObjectId(String(customerId)),
    });
  }

  const normalizedEmail = normalizeEmail(email);

  if (normalizedEmail) {
    conditions.push({
      email: normalizedEmail,
    });
  }

  const normalizedPhone = normalizePhone(phone);

  if (normalizedPhone) {
    conditions.push({
      phone: {
        $in: [
          normalizedPhone,
          `91${normalizedPhone}`,
          `+91${normalizedPhone}`,
          `0${normalizedPhone}`,
        ],
      },
    });
  }

  if (!conditions.length) {
    return null;
  }

  const query = Customer.findOne({
    isBlacklisted: true,
    $or: conditions,
  })
    .select("_id name email phone isBlacklisted")
    .lean();

  if (session) {
    query.session(session);
  }

  return query;
};