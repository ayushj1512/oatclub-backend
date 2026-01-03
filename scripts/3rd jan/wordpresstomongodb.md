# WooCommerce CSV → MongoDB (Parent Products) Migration

This README explains how to run the **parent-only** migration script that imports WooCommerce exported products into your MongoDB using your existing product model.  
✅ **Only parent products are created**  
✅ **Variants are auto-generated** using your existing `generateVariants()` utility (same logic as backend)

---

## 1) Files & Paths

You should have these two files:

- CSV export:
  - `scripts/3rd jan/wc-product-export-3-1-2026-1767450524719.csv`
- Migration script:
  - `scripts/3rd jan/importParentsFromWC.js`

> Folder name has a space (`3rd jan`), so always use quotes in terminal commands.

---

## 2) Prerequisites

- Node.js **v20+** (you used v22 ✅)
- Backend dependencies installed:
  ```bash
  npm install
  ```

---

## 3) Environment Variables (.env)

Make sure your backend root has a `.env` file with at least:

- `MONGO_URI=...`

> **Security Note:** Never paste `.env` secrets publicly. If secrets leak, rotate them immediately.

---

## 4) Confirm CSV path inside the script

Open:
`"scripts/3rd jan/importParentsFromWC.js"`

Ensure this line exists and points to the correct file:

```js
const filePath = "scripts/3rd jan/wc-product-export-3-1-2026-1767450524719.csv";
```

---

## 5) Run the migration

From backend root folder:

### ✅ Recommended (loads env automatically)
```bash
node --env-file=.env "scripts/3rd jan/importParentsFromWC.js"
```

---

## 6) Expected Output

You should see logs like:

- ✅ Connected MongoDB
- 📦 Total Rows: ...
- ✅ Parent Rows: ...
- ✅ Created X products...
- 🎉 IMPORT DONE

---

## 7) Common Errors & Fixes

### ❌ Error: File does not exist at ./wc-product-export...
✅ Fix: Update CSV path in the script:
```js
const filePath = "scripts/3rd jan/wc-product-export-3-1-2026-1767450524719.csv";
```

---

### ⚠️ Mongoose Duplicate Index Warning
Example:
```
[MONGOOSE] Warning: Duplicate schema index on {"sku":1}
```
✅ Safe to ignore for migration.  
✅ Later cleanup: remove either `index: true` or `schema.index()` duplicates.

---

### ❌ MONGO_URI undefined
✅ Fix:
Use `--env-file=.env` OR add this at top of the script:
```js
import "dotenv/config";
```

---

## 8) What the script imports (Mapping)

| Woo CSV Column | Mongo Field |
|---|---|
| Name | title |
| (auto) | slug |
| Regular price | price |
| Sale price | compareAtPrice |
| Categories | categories[] |
| Tags | tags[] (lowercase) |
| Images | images[] |
| first image | thumbnail |
| Stock / In stock? | stock / isInStock |
| Attribute 1/2 | attributes + variants auto-generated |

---

## 9) Safety Checklist (Recommended)

Before running in production:

1. ✅ Take DB backup  
2. ✅ Run migration on staging first  
3. ✅ Verify product counts  
4. ✅ Validate: `slug`, `sku`, `productCode` uniqueness  
5. ✅ Keep logs

---

## 10) Notes

- This import creates only parent products.
- Variants are created automatically using:
  ```js
  generateVariants({ productAttributes, variantKeys: ["size", "color"] })
  ```
- SKU and productCode are auto-handled by your model hooks.

---

✅ You're good to run this anytime you export a fresh WooCommerce CSV.
