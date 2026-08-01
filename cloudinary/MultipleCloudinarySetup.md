````md
# OATCLUB Admin Media Library

## Overview

The OATCLUB Admin Media Library is the centralized media management system used across the entire admin panel.

It provides one shared system for:

- Uploading images and videos
- Browsing previously uploaded media
- Selecting single or multiple media files
- Reusing media across products, blogs, banners, CMS pages and other modules
- Managing media stored across multiple Cloudinary accounts

No feature should implement its own media uploader or Cloudinary logic.

Always use:

```jsx
import MediaPickerModal from "@/components/media/MediaPickerModal";
````

---

# Core Rule

Any admin feature that needs an image or video must open `MediaPickerModal`.

The parent component should never:

* Upload directly to Cloudinary
* Call `/api/media/upload` directly
* Implement its own drag-and-drop uploader
* Implement its own gallery
* Decide which Cloudinary account should receive an upload
* Delete media directly from Cloudinary

The centralized media system handles all of this internally.

---

# File Structure

```text
oatclub-admin/
└── components/
    └── media/
        ├── MediaPickerModal.jsx
        ├── MediaUploadTab.jsx
        ├── MediaGalleryTab.jsx
        ├── MediaGrid.jsx
        └── README.md
```

Related Zustand store:

```text
oatclub-admin/
└── store/
    └── adminMediaStore.js
```

Related backend files:

```text
oatclub-backend/
├── config/
│   └── cloudinary.js
│
└── cloudinary/
    ├── Media.js
    ├── mediaController.js
    └── mediaRoutes.js
```

---

# Component Responsibilities

## `MediaPickerModal.jsx`

This is the main entry point.

It should be imported directly by pages, forms and modules.

Responsibilities:

* Open and close the media modal
* Switch between Upload and Gallery tabs
* Support single and multiple selection
* Return selected media to the parent component
* Pass the requested folder to the upload system

Example import:

```jsx
import MediaPickerModal from "@/components/media/MediaPickerModal";
```

Do not directly import internal media components into product, blog, banner or CMS forms.

---

## `MediaUploadTab.jsx`

This component handles media uploads internally.

Responsibilities:

* File selection
* Drag and drop
* Clipboard paste
* File preview
* Removing files before upload
* Upload progress state
* Sending files through `adminMediaStore`
* Refreshing the media gallery after upload

New uploads are automatically sent to the active Cloudinary account.

The parent component does not select the Cloudinary account.

---

## `MediaGalleryTab.jsx`

This component displays media already stored in the Media collection.

Responsibilities:

* Fetch media from the backend
* Search media
* Filter by resource type
* Optionally filter by Cloudinary source
* Handle pagination or load-more behaviour
* Pass selected media to the modal
* Trigger manual Cloudinary synchronization when required

The gallery reads from MongoDB, not directly from Cloudinary during every page load.

---

## `MediaGrid.jsx`

This component renders media items safely.

Responsibilities:

* Render image and video previews
* Show selection state
* Handle single and multiple selection
* Display file information
* Display media source when required
* Handle delete actions
* Avoid UI crashes when optional fields are missing

This component should remain defensive because old and new media records may have slightly different metadata.

---

## `adminMediaStore.js`

The Zustand store is the frontend data layer for the Media Library.

Responsibilities:

* Fetch media
* Upload media
* Delete media
* Sync Cloudinary accounts
* Search and filtering state
* Pagination
* Loading states
* Uploading state
* Syncing state
* Per-item deleting state

Pages and features should not call the Media API directly.

---

# Media Picker Props

The public contract of `MediaPickerModal` must remain stable.

```jsx
<MediaPickerModal
  open={boolean}
  onClose={() => {}}
  onSelect={(media) => {}}
  multiple={boolean}
  folder="oatclub/media"
/>
```

## Prop Reference

### `open`

```ts
boolean
```

Controls whether the modal is visible.

---

### `onClose`

```ts
() => void
```

Called when the modal should close.

---

### `onSelect`

```ts
(media: MediaObject | MediaObject[]) => void
```

Returns selected media to the parent component.

For single selection, it returns one media object.

For multiple selection, it returns an array.

---

### `multiple`

```ts
boolean
```

Optional.

Default behaviour is single selection.

Set it to `true` when selecting product galleries, sliders or multiple banner images.

---

### `folder`

```ts
string
```

Optional Cloudinary folder used for new uploads.

Examples:

```text
oatclub/products
oatclub/products/gallery
oatclub/blogs
oatclub/banners
oatclub/cms
oatclub/categories
```

The folder determines organization inside Cloudinary.

It does not determine which Cloudinary account receives the upload.

---

# Returned Media Object

A selected media item can contain:

```js
{
  _id: "mongodb-media-id",

  url: "https://res.cloudinary.com/...",

  publicId: "oatclub/media/example",

  resourceType: "image",

  format: "webp",

  bytes: 145220,

  width: 1200,

  height: 1500,

  folder: "oatclub/media",

  originalName: "example-image.webp",

  cloudinarySource: "cloudinary_2",

  cloudName: "active-cloud-name",

  uploadedAt: "2026-08-01T10:30:00.000Z",

  createdAt: "2026-08-01T10:30:01.000Z",

  updatedAt: "2026-08-01T10:30:01.000Z"
}
```

Possible resource types:

```js
"image"
"video"
"raw"
```

Possible Cloudinary source values:

```js
"cloudinary_1"
"cloudinary_2"
```

---

# Recommended Data Storage

For basic image usage, store:

```js
{
  url: media.url,
  publicId: media.publicId
}
```

For better long-term media tracking, store:

```js
{
  mediaId: media._id,
  url: media.url,
  publicId: media.publicId,
  cloudinarySource: media.cloudinarySource
}
```

Do not store Cloudinary API keys, secrets or credentials in frontend records.

---

# Usage Examples

## Single Image Selection

Use for:

* Product thumbnail
* Blog cover
* Category image
* CMS hero image

```jsx
"use client";

import { useState } from "react";
import MediaPickerModal from "@/components/media/MediaPickerModal";

export default function ProductThumbnailField() {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [image, setImage] = useState(null);

  return (
    <>
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
      >
        Select Image
      </button>

      {image?.url ? (
        <img
          src={image.url}
          alt={image.originalName || "Selected media"}
        />
      ) : null}

      <MediaPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        folder="oatclub/products"
        onSelect={(media) => {
          setImage(media);
          setPickerOpen(false);
        }}
      />
    </>
  );
}
```

---

## Multiple Image Selection

Use for:

* Product gallery
* Homepage slider
* Lookbook
* Blog gallery

```jsx
"use client";

import { useState } from "react";
import MediaPickerModal from "@/components/media/MediaPickerModal";

export default function ProductGalleryField() {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [gallery, setGallery] = useState([]);

  return (
    <>
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
      >
        Select Gallery Images
      </button>

      <MediaPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        multiple
        folder="oatclub/products/gallery"
        onSelect={(mediaList) => {
          setGallery(Array.isArray(mediaList) ? mediaList : []);
          setPickerOpen(false);
        }}
      />
    </>
  );
}
```

---

# Dual Cloudinary Architecture

The Media Library supports more than one Cloudinary account.

This is designed to:

* Keep existing media working
* Send all new uploads to a new Cloudinary account
* Read media from both accounts
* Sort all media by upload date
* Delete media from the correct account
* Allow more Cloudinary accounts to be added later

---

## Cloudinary 1

Cloudinary 1 is the existing legacy account.

Environment variables:

```env
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
CLOUDINARY_URL=
```

Responsibilities:

* Existing images and videos remain available
* Existing URLs continue working
* Legacy assets can be selected from the Media Library
* Legacy assets can be deleted through the centralized Media system
* New uploads should not be sent here

Database source value:

```js
cloudinarySource: "cloudinary_1"
```

---

## Cloudinary 2

Cloudinary 2 is the active account for new uploads.

Environment variables:

```env
CLOUDINARY_2_CLOUD_NAME=
CLOUDINARY_2_API_KEY=
CLOUDINARY_2_API_SECRET=

CLOUDINARY_2_LABEL=Cloudinary 2
CLOUDINARY_2_UPLOAD_ENABLED=true
```

Responsibilities:

* Receive all new media uploads
* Store new product, blog, banner and CMS media
* Support media selection
* Support deletion through the centralized Media system

Database source value:

```js
cloudinarySource: "cloudinary_2"
```

---

# Upload Behaviour

All new uploads follow this flow:

```text
Feature or Form
    ↓
MediaPickerModal
    ↓
MediaUploadTab
    ↓
adminMediaStore.uploadMedia()
    ↓
POST /api/media/upload
    ↓
Backend uploadToCloudinary()
    ↓
Cloudinary 2
    ↓
Media document created in MongoDB
```

The frontend does not send a Cloudinary source.

The backend decides the active upload account.

---

# Gallery Behaviour

Media gallery flow:

```text
MediaPickerModal
    ↓
MediaGalleryTab
    ↓
adminMediaStore.fetchMedia()
    ↓
GET /api/media
    ↓
MongoDB Media collection
    ↓
Cloudinary 1 and Cloudinary 2 records
    ↓
Sorted by uploadedAt descending
```

The normal gallery request does not call Cloudinary directly.

This reduces Admin API usage and keeps the gallery fast.

---

# Media Synchronization

Cloudinary synchronization imports media metadata into MongoDB.

Endpoint:

```http
POST /api/media/sync?max=100
```

The synchronization process:

```text
Cloudinary 1 assets
        +
Cloudinary 2 assets
        ↓
Normalize metadata
        ↓
Upsert into MongoDB
        ↓
Sort by original Cloudinary upload date
```

Synchronization should be used for:

* Initial migration setup
* Importing existing Cloudinary assets
* Recovering missing Media database records
* Manually refreshing legacy assets

Synchronization should not run every time the Media modal opens.

Cloudinary search and Admin APIs may be rate-limited.

---

# Date Sorting

Media should be sorted using:

```js
{
  uploadedAt: -1,
  createdAt: -1
}
```

`uploadedAt` represents the original Cloudinary upload date.

`createdAt` represents when the MongoDB Media document was created.

This prevents old Cloudinary assets from appearing as newly uploaded simply because they were synced recently.

---

# Delete Behaviour

Delete flow:

```text
MediaGrid
    ↓
adminMediaStore.deleteMedia(mediaId)
    ↓
DELETE /api/media/:id
    ↓
Backend loads Media document
    ↓
Checks cloudinarySource
    ↓
Deletes from Cloudinary 1 or Cloudinary 2
    ↓
Deletes MongoDB Media document
```

Fallback behaviour:

```js
media.cloudinarySource || "cloudinary_1"
```

This ensures old records created before dual-account support are treated as Cloudinary 1 assets.

Features should never delete using only `publicId`.

Deletion must go through the Media document `_id`.

---

# Backend API Contract

## Fetch Media

```http
GET /api/media
```

Supported query parameters:

```text
page
limit
q
type
source
```

Example:

```http
GET /api/media?page=1&limit=48&type=image&source=cloudinary_2
```

Example response:

```js
{
  items: [],
  total: 0,
  page: 1,
  limit: 48,
  pages: 1
}
```

---

## Upload Media

```http
POST /api/media/upload
```

Request format:

```text
multipart/form-data
```

Fields:

```text
files
folder
```

`files` may contain multiple files.

All new files are uploaded to Cloudinary 2.

Example response:

```js
{
  message: "Media uploaded successfully",
  uploadedTo: "cloudinary_2",
  cloudName: "active-cloud-name",
  count: 2,
  media: []
}
```

---

## Delete Media

```http
DELETE /api/media/:id
```

`:id` is the MongoDB Media document ID.

Example response:

```js
{
  message: "Media deleted successfully",
  deletedFrom: "cloudinary_2",
  publicId: "oatclub/media/example"
}
```

---

## Sync Media

```http
POST /api/media/sync?max=100
```

This imports metadata from both Cloudinary accounts.

Example response:

```js
{
  message: "Cloudinary accounts synced successfully",

  accounts: {
    cloudinary_1: {
      source: "cloudinary_1",
      cloudName: "legacy-cloud-name",
      totalFound: 100,
      nextCursor: null,
      error: null
    },

    cloudinary_2: {
      source: "cloudinary_2",
      cloudName: "active-cloud-name",
      totalFound: 25,
      nextCursor: null,
      error: null
    }
  },

  totalFound: 125,

  database: {
    matchedCount: 0,
    modifiedCount: 0,
    upsertedCount: 125
  },

  items: []
}
```

---

# Media Database Model

Required fields:

```js
{
  url: String,

  publicId: String,

  cloudinarySource: {
    type: String,
    enum: [
      "cloudinary_1",
      "cloudinary_2"
    ]
  },

  cloudName: String,

  resourceType: {
    type: String,
    enum: [
      "image",
      "video",
      "raw"
    ]
  },

  format: String,

  bytes: Number,

  width: Number,

  height: Number,

  folder: String,

  originalName: String,

  uploadedAt: Date,

  createdAt: Date,

  updatedAt: Date
}
```

Recommended compound unique index:

```js
mediaSchema.index(
  {
    cloudinarySource: 1,
    publicId: 1
  },
  {
    unique: true
  }
);
```

Do not use `publicId` as a globally unique field by itself.

The same `publicId` may exist in different Cloudinary accounts.

---

# Source Filters

The gallery may offer these filters:

```js
[
  {
    label: "All Accounts",
    value: ""
  },
  {
    label: "Cloudinary 1 — Old",
    value: "cloudinary_1"
  },
  {
    label: "Cloudinary 2 — New",
    value: "cloudinary_2"
  }
]
```

Source filtering is optional for normal users but useful for debugging and media management.

---

# Required Next.js Configuration

Cloudinary delivery URLs must be allowed in Next.js.

```js
// next.config.js

const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
        pathname: "/**"
      }
    ]
  }
};

export default nextConfig;
```

Restart the Next.js development server after changing this file.

---

# File Upload Limits

Current backend Multer configuration may allow:

```js
uploadAny.array("files", 25)
```

Recommended limits:

```text
Maximum files per upload: 25
Maximum file size: 50 MB
```

The image-only uploader may use a lower limit.

Allowed image MIME types:

```text
image/jpeg
image/jpg
image/png
image/webp
```

`uploadAny` may also support videos and raw files.

File validation should remain centralized in the backend.

---

# Error Handling Rules

All Media components should:

* Show user-friendly toast messages
* Log full errors in the browser console
* Avoid clearing existing appended media after a load-more failure
* Disable duplicate upload actions while uploading
* Disable duplicate sync actions while syncing
* Disable duplicate delete actions per media item
* Handle non-JSON backend responses safely
* Handle missing optional media fields safely

The Media modal should not crash because an old asset has missing width, height, format or folder information.

---

# Security Rules

Never expose these values in frontend code:

```env
CLOUDINARY_API_SECRET
CLOUDINARY_2_API_SECRET
```

Cloudinary API secrets must exist only in backend environment variables.

Do not add secrets to:

* `NEXT_PUBLIC_*` variables
* Client components
* Zustand stores
* API request payloads
* Git commits
* Screenshots
* Documentation

When a secret has been publicly shared, rotate it from the Cloudinary dashboard.

---

# Rules for New Features

When adding a new feature requiring media:

1. Import `MediaPickerModal`.
2. Open it from the parent component.
3. Provide an appropriate folder.
4. Receive the selected media through `onSelect`.
5. Store the required media reference.
6. Do not implement upload logic in the feature.

Correct:

```jsx
<MediaPickerModal
  open={pickerOpen}
  onClose={() => setPickerOpen(false)}
  folder="oatclub/banners"
  onSelect={handleMediaSelect}
/>
```

Incorrect:

```js
cloudinary.uploader.upload(...)
```

Incorrect:

```js
fetch("/api/media/upload", ...)
```

Incorrect:

```jsx
<input type="file" onChange={customUploadHandler} />
```

---

# Extending to Cloudinary 3 and Beyond

The architecture should remain source-based.

Future source values may include:

```js
cloudinary_3
cloudinary_4
cloudinary_5
```

A new account should require:

* New environment variables
* New backend account configuration
* New source registration
* Sync support
* Correct deletion routing

Parent features and `MediaPickerModal` should not require changes.

Future example:

```env
CLOUDINARY_3_CLOUD_NAME=
CLOUDINARY_3_API_KEY=
CLOUDINARY_3_API_SECRET=
CLOUDINARY_3_LABEL=Cloudinary 3
CLOUDINARY_3_UPLOAD_ENABLED=false
```

The active upload destination should remain a backend responsibility.

---

# Development Checklist

Before marking Media Library changes complete, verify:

* [ ] Existing Cloudinary 1 media appears in the gallery
* [ ] Cloudinary 2 media appears in the gallery
* [ ] New uploads go only to Cloudinary 2
* [ ] Uploaded media creates a MongoDB Media document
* [ ] Gallery sorts by original upload date
* [ ] Search works across original name, public ID and folder
* [ ] Image filter works
* [ ] Video filter works
* [ ] Source filter works
* [ ] Single selection works
* [ ] Multiple selection works
* [ ] Delete works for Cloudinary 1
* [ ] Delete works for Cloudinary 2
* [ ] Sync imports assets from both accounts
* [ ] Upload folder reaches the backend
* [ ] Product image selection still works
* [ ] Blog cover selection still works
* [ ] Banner selection still works
* [ ] No feature contains duplicate upload logic
* [ ] No API secrets are exposed to the frontend

---

# Final Architecture

```text
Products
Blogs
Banners
CMS
Categories
Collections
Other Admin Modules
          │
          ▼
MediaPickerModal
          │
          ├───────────────┐
          ▼               ▼
MediaUploadTab      MediaGalleryTab
          │               │
          └───────┬───────┘
                  ▼
         adminMediaStore
                  │
                  ▼
          Backend Media API
                  │
          ┌───────┴────────┐
          ▼                ▼
       MongoDB         Cloudinary
                          │
                 ┌────────┴────────┐
                 ▼                 ▼
        Cloudinary 1       Cloudinary 2
        Legacy Media       New Uploads
```

---

# Final Rule

The Media Library is a shared infrastructure module.

Do not create separate uploaders for products, blogs, banners, CMS pages or any future feature.

Always use:

```jsx
<MediaPickerModal />
```

All Cloudinary account selection, upload routing, synchronization and deletion logic must remain inside the centralized Media system.

```
```
