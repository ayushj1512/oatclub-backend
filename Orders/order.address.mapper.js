export function buildAddressSnapshot(address) {
  if (!address) throw new Error("Address missing");

  return {
    fullName: address.fullName,
    phone: address.phone,
    email: address.email,

    line1: address.addressLine1,
    line2: address.addressLine2,
    city: address.city,
    state: address.state,
    country: address.country || "India",
    pincode: address.postalCode,
  };
}
