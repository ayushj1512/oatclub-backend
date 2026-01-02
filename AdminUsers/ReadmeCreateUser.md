# MIRAY Admin Portal — Quick Setup: Create Admin User (Superadmin)

This README is a **copy‑paste guide** to quickly create an **AdminUser** in MongoDB for the Miray Admin Panel.

> ✅ Use this whenever you need to create an admin again.  
> ✅ Works with our current backend (bcrypt password + JWT auth).  
> ✅ Designed so future ChatGPT can do it fast.

---

## 1) Confirm Environment Variables

### Backend `.env`
Make sure your backend has:

```env
MONGO_URI=your_mongo_connection_string
JWT_SECRET=your_secret_key
```

### Frontend `.env.local` (Next.js)
```env
NEXT_PUBLIC_BACKEND_URL=http://localhost:5000
```

---

## 2) Your Admin Model / Collection

Model: `AdminUser`  
Mongo Collection (default): `adminusers`

To confirm collection name in Mongo Shell:

```js
show collections
```

You should see `adminusers`.

---

## 3) Create Admin User (MongoDB Shell)

### ✅ Step A: Generate bcrypt hash for password (1 command)

Run this in terminal (Node installed):

```bash
node -e "import bcrypt from 'bcryptjs'; bcrypt.hash('Miray@admin', 10).then(console.log)"
```

It prints a hash like:

```text
$2b$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Copy that hash.

---

### ✅ Step B: Insert user in Mongo Shell

Open Mongo Shell and run:

```js
db.adminusers.insertOne({
  username: "admin",
  email: "admin@miray.com",
  password: "<PASTE_BCRYPT_HASH_HERE>",
  role: "superadmin",
  fullName: "Miray Super Admin",
  profileImage: "",
  phone: "",
  permissions: ["*"],
  lastLogin: null,
  isActive: true,
  loginAttempts: 0,
  lockUntil: null,
  createdAt: new Date(),
  updatedAt: new Date()
});
```

✅ Done. Now login with:

- **username:** `admin`
- **password:** `Miray@admin`

---

## 4) Verify Insert (Mongo Shell)

```js
db.adminusers.findOne({ username: "admin" }, { password: 0 })
```

---

## 5) If Admin Already Exists (Update Password)

### ✅ Step A: Generate new hash

```bash
node -e "import bcrypt from 'bcryptjs'; bcrypt.hash('NEW_PASSWORD_HERE', 10).then(console.log)"
```

### ✅ Step B: Update Mongo user password

```js
db.adminusers.updateOne(
  { username: "admin" },
  { $set: { password: "<NEW_HASH_HERE>", updatedAt: new Date() } }
);
```

---

## 6) Backend Login Endpoint (Current)

Because we kept login inside the same `adminUserRoutes.js` file:

✅ Login request:

```http
POST /api/admin-users/login
Content-Type: application/json

{
  "username": "admin",
  "password": "Miray@admin"
}
```

---

## 7) Common Errors & Fixes

### ❌ `404 Not Found /api/admin-auth/login`
✅ Fix: Use the correct endpoint:

- `/api/admin-users/login`

### ❌ `Invalid credentials`
✅ Check:
- password hash inserted correctly
- correct collection name `adminusers`
- correct username

### ❌ JWT errors
✅ Ensure `.env` has:

```env
JWT_SECRET=someStrongSecret
```

---

## 8) Optional — Drop Old Collection

⚠️ This will delete all admin users.

```js
db.adminusers.drop()
```

---

## ✅ Quick Copy Reference

### Create superadmin:
- username: `admin`
- password: `Miray@admin`
- role: `superadmin`

---

If you need: **Seed script**, **reset password route**, or **profile update security** (only self edit), ask ChatGPT to implement.
