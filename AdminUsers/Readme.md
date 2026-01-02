# MIRAY Backend — Admin Users Module (Production-Grade)

This README documents everything we implemented **today** for the **Admin Users** system in the MIRAY backend.

---

## ✅ What We Built

### AdminUser Model (MongoDB + Mongoose)
- Secure admin user schema with:
  - `username`, `email` (unique)
  - `password` (hashed via bcrypt, excluded by default)
  - roles: `superadmin | admin | staff | influencer | viewer`
  - `permissions` array (optional granular control)
  - `lastLogin`
  - `isActive`
  - brute force protection: `loginAttempts`, `lockUntil`
  - `createdBy` (audit trace)

✅ **Important Fix** (to avoid OverwriteModelError in nodemon/ESM):
```js
export default mongoose.models.AdminUser || mongoose.model("AdminUser", adminUserSchema);
```

---

## 📁 Folder Structure

Recommended structure:

```
miray-backend/
  models/
    AdminUser.js
  controllers/
    adminUserController.js
  routes/
    adminUserRoutes.js
  middlewares/
    protectAdmin.js
  server.js
  .env
```

---

## 🔐 Middleware: `protectAdmin`

File: `middlewares/protectAdmin.js`

Purpose:
- Validates JWT token from request header
- Verifies admin exists in DB
- Blocks inactive admins
- Attaches `req.admin`

Header required:
```
Authorization: Bearer <token>
```

---

## 🧠 Admin User Routes

Base Route:
```
/api/admin-users
```

Routes Included:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/admin-users` | List admin users (pagination/search/filter) |
| POST | `/api/admin-users` | Create new admin user |
| GET | `/api/admin-users/:id` | Get single admin user |
| PATCH | `/api/admin-users/:id` | Update fields (fullName, phone, profileImage, isActive) |
| PATCH | `/api/admin-users/:id/role` | Update role + permissions |
| PATCH | `/api/admin-users/:id/password` | Change password |
| PATCH | `/api/admin-users/:id/unlock` | Reset lockout & login attempts |
| DELETE | `/api/admin-users/:id` | Delete admin user |

✅ Note: For now, **all logged-in admins can see all admin users** ("abhi sabko saara data dikhega").

Later you can add RBAC middleware like:
- `onlySuperAdmin`
- `requirePermission("manageAdmins")`

---

## ⚙️ Add Routes in `server.js`

Example:

```js
import adminUserRoutes from "./routes/adminUserRoutes.js";

app.use("/api/admin-users", adminUserRoutes);
```

---

## 🗑️ Dropping Old Mongo Collection

If you had an old admin model collection and deleted the code, you can drop collection from MongoDB shell:

```js
show collections
db.adminusers.drop()
```

Mongoose usually pluralizes `AdminUser` → `adminusers`.

---

## ✅ Environment Variables

Add to `.env`:

```env
MONGO_URI=your_mongo_connection
JWT_SECRET=your_super_secret_key
PORT=5000
```

---

## ✅ Fix for `OverwriteModelError`

If you get:

```
OverwriteModelError: Cannot overwrite `AdminUser` model once compiled.
```

Fix:
1. Update model export:
```js
export default mongoose.models.AdminUser || mongoose.model("AdminUser", adminUserSchema);
```

2. Ensure you don’t have duplicate AdminUser model definitions (like `models/AdminUser.js` and `AdminUsers/AdminUser.js` both existing).

---

## 🚀 Next Improvements (Optional)
To make it even more enterprise-ready:
- Add **audit logs** for admin actions
- Add **soft delete**
- Add **RBAC permissions middleware**
- Add **session management / logout-all**
- Add **rate-limiting** for password changes & login routes

---

## ✅ Status
Module is **sorted and working** ✅  
Ready for production usage and future RBAC expansion.

---

Made with ❤️ for MIRAY.
