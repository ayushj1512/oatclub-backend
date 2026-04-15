export const cleanPhone = (value = "") =>
  String(value).replace(/\D/g, "");

export const nowIST = () =>
  new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "Asia/Kolkata",
    })
  );