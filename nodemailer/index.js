import transporter from "./transporter.js";
import { sendEmail } from "./mailer.js";

import {
  onboardingMail,
  orderPlacedMail,
  deliveredMail,
  rmaRequestMail,
  newsSubscriptionMail,
} from "./events.js";

export {
  transporter,
  sendEmail,
  onboardingMail,
  orderPlacedMail,
  deliveredMail,
  rmaRequestMail,
  newsSubscriptionMail,
};
