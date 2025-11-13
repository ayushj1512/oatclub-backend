// utils/emailTemplates/baseTemplate.js

export const baseTemplate = (title, bodyContent) => `
  <div style="font-family: 'Arial', sans-serif; background-color: #f9f9f9; padding: 40px;">
    <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
      <!-- Header -->
      <div style="background-color: #222; color: #fff; text-align: center; padding: 20px;">
        <h2 style="margin: 0;">${title}</h2>
      </div>

      <!-- Body -->
      <div style="padding: 30px; color: #333;">
        ${bodyContent}
      </div>

      <!-- Footer -->
      <div style="background-color: #f0f0f0; text-align: center; padding: 15px; font-size: 13px; color: #777;">
        <p style="margin: 0;">© ${new Date().getFullYear()} YourBrand — All Rights Reserved</p>
        <p style="margin: 5px 0 0;">Follow us:
          <a href="https://instagram.com" style="color: #ff6600;">Instagram</a> •
          <a href="https://twitter.com" style="color: #ff6600;">Twitter</a> •
          <a href="https://facebook.com" style="color: #ff6600;">Facebook</a>
        </p>
      </div>
    </div>
  </div>
`;
