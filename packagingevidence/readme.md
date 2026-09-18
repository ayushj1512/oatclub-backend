# OATCLUB Packaging Evidence System

## Complete Architecture, Setup, Deployment and Debugging Guide

This document explains the complete OATCLUB Packaging Evidence System developed for the Admin Panel and Vendor Panel.

The system records packaging videos for Forward and RTO orders, stores videos locally on the packing computer, and stores searchable video metadata in the central backend database.

---

# 1. Why This System Exists

Courier-related theft, missing products, incorrect item claims and damaged parcel disputes require proper packaging proof.

This system provides video evidence showing:

- Which order was packed
- Which products were placed inside the parcel
- Forward packing process
- RTO parcel opening process
- AWB number
- Courier partner
- Packing station
- Packing employee
- Recording time
- Local video filename
- Local storage location
- File integrity hash

The actual video remains on the warehouse computer. The backend stores its metadata for searching, reporting and verification.

---

# 2. System Architecture

The system contains four major parts:

1. OATCLUB Backend
2. OATCLUB Admin Panel
3. OATCLUB Vendor Panel
4. OATCLUB Evidence Helper

```text
Webcam
   ↓
Admin Panel or Vendor Panel
   ↓
Browser MediaRecorder
   ↓
Recorded WebM Blob
   ↓
OATCLUB Evidence Helper
   ↓
Local order folder and video file

At the same time:

Admin/Vendor Panel
   ↓
OATCLUB Backend
   ↓
MongoDB PackagingEvidence metadata
```

Important distinction:

```text
Actual Video File → Packing computer
Video Metadata    → MongoDB/backend
```

The backend server does not need direct access to the Windows storage directory.

---

# 3. Main Projects

```text
oatclub-backend
oatclub-admin
oatclub-vendor
OATCLUB-Evidence-Helper
```

---

# 4. Evidence Types

The system supports two evidence types.

## Forward Evidence

Used when a parcel is being packed and sent from the warehouse to the customer.

```text
Warehouse → Customer
```

Value stored in database:

```text
forward
```

Expected filename:

```text
ORDER-AWB-forward.webm
```

Example:

```text
000627-123456789-forward.webm
```

## RTO Evidence

Used when a returned courier parcel reaches the warehouse and is opened.

```text
Courier RTO → Warehouse
```

Value stored in database:

```text
rto
```

Expected filename:

```text
ORDER-AWB-rto.webm
```

Example:

```text
000627-123456789-rto.webm
```

RTO evidence may optionally contain an RMA number, but RMA is not compulsory because courier RTO and customer RMA are different processes.

---

# 5. Storage Structure

The packing computer has one configurable evidence root directory.

Example:

```text
C:\Users\Ayush\Oatclub\oatclub-evidence
```

Every order receives a separate folder.

Example:

```text
oatclub-evidence
├── 000627
│   ├── 000627-123456789-forward.webm
│   └── 000627-123456789-rto.webm
├── 000628
│   └── 000628-987654321-forward.webm
└── 000629
    └── 000629-555666777-forward.webm
```

If the same evidence is saved again, the helper must not overwrite the existing file.

Duplicate-safe filenames should be generated:

```text
000627-123456789-forward.webm
000627-123456789-forward-2.webm
000627-123456789-forward-3.webm
```

This protects already recorded evidence.

---

# 6. Backend Implementation

Backend folder:

```text
oatclub-backend/packagingevidence
```

Recommended structure:

```text
oatclub-backend
├── packagingevidence
│   ├── PackagingEvidence.js
│   ├── packagingEvidenceController.js
│   └── packagingEvidenceRoutes.js
└── Orders
    └── Orders.js
```

## Model Purpose

`PackagingEvidence.js` stores:

- Order reference
- Order number
- Evidence type
- AWB
- Courier
- Optional RMA number
- Station information
- Local storage metadata
- Video technical information
- Recording status
- Recording timestamp
- SHA-256 hash
- Failure reason
- Notes

## Important Model Fields

```text
order
orderNumber
evidenceType
awb
courierPartner
rmaNumber

station.stationName
station.computerName
station.packerName

storage.storageRoot
storage.orderFolder
storage.fileName
storage.relativePath
storage.mimeType
storage.fileSizeBytes
storage.durationSeconds
storage.sha256

video.width
video.height
video.framesPerSecond
video.hasAudio

status
recordedAt
saveVerifiedAt
failureReason
notes
```

## Evidence Status Values

```text
saved
missing
corrupted
failed
```

Meaning:

- `saved`: File was successfully written and verified.
- `missing`: Database record exists but local file could not be found.
- `corrupted`: File exists but cannot be played or verified.
- `failed`: Saving or processing failed.

## Important Database Indexes

Indexes are provided for:

```text
orderNumber + evidenceType + recordedAt
station.stationName + recordedAt
awb + evidenceType
status + createdAt
```

These indexes improve directory search, dashboard statistics and order history queries.

---

# 7. Backend API Routes

Base route:

```text
/api/packaging-evidence
```

Expected routes:

```text
GET    /stats
GET    /session
GET    /lookup/:orderNumber
GET    /order/:orderNumber
GET    /
POST   /
PATCH  /:id/status
GET    /:id
```

Depending on the final controller version, the dashboard endpoint may be:

```text
GET /stats
```

or:

```text
GET /dashboard
```

The frontend store and backend router must use the same endpoint.

If the dashboard shows 404, first check this mismatch:

```text
Frontend calling: /dashboard
Backend exposing: /stats
```

Recommended final contract:

```text
GET /api/packaging-evidence/stats
```

Alternatively, backend can expose both routes to avoid compatibility issues:

```js
router.get("/stats", getPackagingEvidenceStats);
router.get("/dashboard", getPackagingEvidenceStats);
```

## Authentication

The Packaging Evidence routes were intentionally created without authentication middleware.

This was requested because evidence recording needs to work smoothly at packing stations.

Security should therefore be controlled using:

- Internal network access
- Backend CORS
- Restricted deployment URLs
- Packing-PC access
- Firewall rules where required

---

# 8. Order Lookup Flow

Order lookup uses:

```text
GET /api/packaging-evidence/lookup/:orderNumber
```

Example:

```text
GET /api/packaging-evidence/lookup/000627?evidenceType=forward
```

The backend reads the order from:

```text
oatclub-backend/Orders/Orders.js
```

Order lookup should return:

- Order ID
- Order number
- AWB
- Courier
- Customer details if required
- Product items
- Product titles
- Product codes
- Product images
- Selected sizes
- Selected colours
- Quantities
- RMA details when applicable

The operator must confirm every displayed item before sealing the parcel.

---

# 9. AWB Handling

AWB may not always be assigned when the order is fetched.

The UI therefore supports manual AWB entry.

AWB priority:

```text
Order AWB → Manual AWB → Block recording
```

The system must not begin recording without an AWB.

Recommended validation:

```js
if (!effectiveAwb) {
  setError(
    "Enter the AWB number before recording.",
  );
  return;
}
```

The manually entered AWB should be:

- Trimmed
- Converted to uppercase where appropriate
- Included in the local filename
- Saved in backend metadata
- Burned into the recorded video overlay

---

# 10. Admin Panel Implementation

Main folder:

```text
oatclub-admin/app/packaging-evidence
```

Recommended pages:

```text
oatclub-admin/app/packaging-evidence/page.jsx
oatclub-admin/app/packaging-evidence/setup/page.jsx
oatclub-admin/app/packaging-evidence/record/page.jsx
oatclub-admin/app/packaging-evidence/directory/page.jsx
```

Admin store:

```text
oatclub-admin/store/packagingEvidenceStore.js
```

Admin functionality includes:

- Dashboard
- Record Packaging
- RTO Opening
- Evidence Directory
- Station Setup
- Helper connection status
- Camera selection
- Storage directory selection
- Evidence search
- Video playback

---

# 11. Admin Permissions

Permission configuration:

```text
oatclub-admin/src/config/loginConfig.js
```

Domain permission:

```js
packaging_evidence: "managePackagingEvidence",
```

Add the permission to roles that should use the system.

Suggested roles:

```text
superadmin
admin
staff
warehouse
```

Example:

```js
warehouse: [
  "manageProduction",
  "manageOrders",
  "manageBarcode",
  "managePackagingEvidence",
],
```

Sidebar/menu visibility should check:

```text
managePackagingEvidence
```

---

# 12. Vendor Panel Implementation

Vendor store:

```text
oatclub-vendor/src/store/packagingEvidenceStore.js
```

Main page:

```text
oatclub-vendor/src/app/vendor/packaging-evidence/page.jsx
```

Components folder:

```text
oatclub-vendor/src/components/packaging-evidence
```

Recommended components:

```text
PackagingEvidenceTabs.jsx
EvidenceDashboardTab.jsx
RecordEvidenceTab.jsx
EvidenceDirectoryTab.jsx
StationSetupTab.jsx
```

Each tab is kept in a separate component so that the main page does not become excessively large.

---

# 13. Vendor Tab URLs

The Vendor Panel uses URL query parameters for tabs.

Examples:

```text
/vendor/packaging-evidence?tab=dashboard
/vendor/packaging-evidence?tab=record
/vendor/packaging-evidence?tab=directory
/vendor/packaging-evidence?tab=setup
```

Record page may additionally store state in query parameters:

```text
/vendor/packaging-evidence?tab=record&type=forward&order=000627
```

RTO example:

```text
/vendor/packaging-evidence?tab=record&type=rto&order=000627&rma=RMA001
```

Benefits:

- Direct link to any tab
- Browser refresh preserves tab
- Browser back/forward works
- Order number can be shared
- Debugging becomes easier

---

# 14. Vendor Sidebar

Vendor sidebar contains:

```text
Dashboard
Product Lifecycle
Search
Sampling
Pattern
Production
Cutting List
Inventory
Packaging Evidence
Fabrics
Invoices
Reports
```

Packaging Evidence sidebar link:

```js
{
  label: "Packaging Evidence",
  href: "/vendor/packaging-evidence",
  icon: Video,
  moduleKey: "packagingEvidence",
}
```

Ensure `Video` is imported from:

```js
import { Video } from "lucide-react";
```

If React reports:

```text
Element type is invalid: expected a string or class/function but got object
```

Check:

1. Component default vs named export mismatch
2. Incorrect Lucide icon import
3. Empty component file
4. Importing an entire module as a component
5. `EvidenceDashboardTab.jsx` missing its default export

Correct component export:

```js
export default function EvidenceDashboardTab() {
  return <div>...</div>;
}
```

Correct import:

```js
import EvidenceDashboardTab from "./EvidenceDashboardTab";
```

---

# 15. Environment Variables

Admin and Vendor frontends require the helper URL.

```env
NEXT_PUBLIC_EVIDENCE_HELPER_URL=http://127.0.0.1:4782
```

Backend URL example:

```env
NEXT_PUBLIC_API_URL=http://localhost:6001
```

Production backend example:

```env
NEXT_PUBLIC_API_URL=https://api.oatclub.in
```

Important:

```text
NEXT_PUBLIC_EVIDENCE_HELPER_URL
```

must remain:

```text
http://127.0.0.1:4782
```

even after deploying the frontend.

Reason:

- The frontend website may be deployed online.
- The Evidence Helper runs on the local packing computer.
- `127.0.0.1` always refers to the computer currently opening the website.
- Every packing computer runs its own helper.
- Each computer saves videos to its own configured directory.

Do not replace the helper URL with the backend URL.

---

# 16. Evidence Helper

Source folder:

```text
C:\Users\Ayush\Oatclub\OATCLUB-Evidence-Helper
```

Files:

```text
OATCLUB-Evidence-Helper
├── app.py
├── tray_app.py
├── requirements.txt
├── run.ps1
├── build.ps1
└── README.md
```

## Purpose

The browser cannot silently write files into arbitrary Windows directories.

The Evidence Helper provides a local API that can:

- Save recorded videos
- Create order folders
- Select a directory
- Test storage permissions
- List saved videos
- Stream videos
- Open the folder in Windows Explorer
- Store station configuration
- Generate SHA-256 hashes
- Prevent accidental overwrites

## Helper Address

```text
http://127.0.0.1:4782
```

Health check:

```text
http://127.0.0.1:4782/api/health
```

Expected successful response:

```json
{
  "success": true
}
```

---

# 17. Helper API Routes

```text
GET  /api/health
GET  /api/config
PUT  /api/config
POST /api/choose-directory
POST /api/test-storage
POST /api/save-video
GET  /api/videos
GET  /api/stream/:videoId
POST /api/open-folder
```

## Health

```text
GET /api/health
```

Used to determine whether the helper is online.

## Configuration

```text
GET /api/config
PUT /api/config
```

Configuration includes:

```text
stationName
computerName
packerName
storageRoot
cameraId
quality
framesPerSecond
hasAudio
```

## Choose Directory

```text
POST /api/choose-directory
```

Opens a native Windows folder selection dialog.

## Test Storage

```text
POST /api/test-storage
```

Verifies that the selected directory exists and is writable.

## Save Video

```text
POST /api/save-video
```

Receives the recorded video as multipart form data.

## List Videos

```text
GET /api/videos
```

Returns videos stored under the configured evidence root.

## Stream Video

```text
GET /api/stream/:videoId
```

Allows Directory tab playback.

## Open Folder

```text
POST /api/open-folder
```

Opens the selected evidence directory or order folder in Windows Explorer.

---

# 18. Helper Configuration Storage

The helper stores its configuration in the Windows user application-data directory.

The configuration should survive:

- Browser restart
- Frontend restart
- Helper restart
- Computer restart
- EXE upgrade, unless application data is manually deleted

Do not store machine configuration inside the deployed frontend.

Each packing computer has its own:

- Station name
- Computer name
- Packer name
- Evidence directory
- Camera selection
- Video quality
- Audio preference

---

# 19. Running Helper From Source

Open PowerShell inside:

```text
C:\Users\Ayush\Oatclub\OATCLUB-Evidence-Helper
```

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\run.ps1
```

Test:

```text
http://127.0.0.1:4782/api/health
```

If it returns JSON, the helper is working.

---

# 20. Building the EXE

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

Expected output:

```text
dist\OATCLUB-Evidence-Helper.exe
```

Install or copy the EXE onto every packing computer.

Every PC needs its own helper because each browser connects to its own:

```text
127.0.0.1:4782
```

The backend does not run this helper for all computers.

---

# 21. Background and Startup Behaviour

The tray application registers itself in Windows Startup for the current user.

Expected behaviour:

1. User signs into Windows.
2. Evidence Helper starts automatically.
3. Helper runs in the background.
4. Tray icon remains available.
5. Packing employee opens Admin or Vendor Panel.
6. Website detects the local helper.
7. Videos save locally without running commands.

For non-technical packing employees, only the EXE should be provided.

They should not need:

- Python
- VS Code
- PowerShell commands
- Source code
- npm
- Backend access

---

# 22. Helper CORS

The Admin/Vendor frontend and local helper are different origins.

Example:

```text
Frontend: http://localhost:4002
Helper:   http://127.0.0.1:4782
```

Therefore the helper must allow the frontend origin using CORS.

Typical development origins:

```text
http://localhost:3000
http://localhost:3001
http://localhost:3002
http://localhost:3003
http://localhost:3004
http://127.0.0.1:3000
http://127.0.0.1:3001
http://127.0.0.1:3002
http://127.0.0.1:3003
http://127.0.0.1:3004
```

Include actual Admin and Vendor production domains.

For example:

```text
https://admin.oatclub.in
https://vendor.oatclub.in
```

If browser Network shows a CORS error:

1. Confirm helper is running.
2. Open `/api/health` directly.
3. Confirm current frontend origin is allowed.
4. Restart the helper after changing origins.
5. Rebuild the EXE if source code changed.
6. Hard refresh the frontend.

A missing helper can sometimes appear like a CORS problem. Always test `/api/health` first.

---

# 23. Station Setup

Station Setup collects:

## Computer Identity

```text
Station name
Computer name
Default packer name
```

Example:

```text
Station name: OATCLUB-PACK-01
Computer name: WAREHOUSE-PC-01
Packer name: Ayush
```

## Evidence Directory

Example:

```text
C:\Users\Ayush\Oatclub\oatclub-evidence
```

## Webcam Configuration

```text
Camera
Video quality
Frame rate
Record audio
```

Recommended defaults:

```text
Quality: 720p
Frame rate: 30 FPS
Audio: Off
```

720p is recommended because packaging videos can become large.

---

# 24. Camera Device-ID Problem

Camera device IDs may differ between browser origins.

Example:

```text
Admin:  localhost:4000
Vendor: localhost:4002
```

A camera ID saved on the Admin origin may not work on the Vendor origin.

Avoid this:

```js
deviceId: {
  exact: stationConfig.cameraId,
}
```

Use this:

```js
deviceId: {
  ideal: stationConfig.cameraId,
}
```

Also implement a fallback to the default camera:

```js
try {
  stream =
    await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: stationConfig.cameraId
          ? {
              ideal:
                stationConfig.cameraId,
            }
          : undefined,
      },
      audio: Boolean(
        stationConfig.hasAudio,
      ),
    });
} catch {
  stream =
    await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false,
    });
}
```

This was the main cause of camera working in one portal but failing in another.

---

# 25. Camera Permissions

Chrome camera permission should show:

```text
Camera: Allowed
```

Localhost is permitted to use `getUserMedia`, even when Chrome shows:

```text
Your connection to this site is not secure
```

That warning is normally not the reason for camera failure on localhost.

If camera does not open:

1. Click the site information icon.
2. Set Camera to Allow.
3. Reload the page.
4. Close Windows Camera.
5. Close Zoom, Meet and Teams.
6. Close another browser tab using the webcam.
7. Detect cameras again.
8. Save Station Configuration again.

Common browser errors:

```text
NotAllowedError
```

Meaning:

```text
Camera permission blocked
```

```text
NotReadableError
```

Meaning:

```text
Camera is already being used or Windows cannot open it
```

```text
NotFoundError
```

Meaning:

```text
No camera detected
```

```text
OverconstrainedError
```

Meaning:

```text
Saved camera ID or video settings are invalid
```

---

# 26. Recording Flow

Complete expected flow:

```text
Select Forward/RTO
        ↓
Enter order number
        ↓
Fetch order
        ↓
Confirm products
        ↓
Enter/confirm AWB
        ↓
Start camera
        ↓
Start recording
        ↓
Pause/Resume if required
        ↓
Stop recording
        ↓
Generate Blob URL
        ↓
Preview recording
        ↓
Save local video
        ↓
Create backend metadata
```

---

# 27. Video Overlay

The recording uses a hidden canvas.

Each camera frame is drawn on the canvas, and order details are painted over it.

The canvas stream is then passed to `MediaRecorder`.

The video overlay contains:

```text
OATCLUB
Forward Packing or RTO Opening
Order number
AWB
Recording timestamp where configured
```

This is important because the information becomes part of the actual video, not merely an HTML label over the webpage.

---

# 28. Recording Controls

Supported controls:

```text
Start Camera
Start Recording
Pause
Resume
Stop Recording
Record Again
Save Evidence
Discard
```

State values:

```text
idle
recording
paused
processing
stopped
```

Expected transitions:

```text
idle → recording
recording → paused
paused → recording
recording/paused → processing
processing → stopped
stopped → idle when discarded
```

---

# 29. Recorded Video Preview

When `MediaRecorder` stops, collected chunks are converted into a Blob.

```js
const blob = new Blob(
  chunksRef.current,
  {
    type:
      recorder.mimeType ||
      mimeType ||
      "video/webm",
  },
);
```

Create a Blob URL:

```js
const url =
  URL.createObjectURL(blob);

previewUrlRef.current = url;

setRecordedBlob(blob);
setPreviewUrl(url);
setRecordingStatus("stopped");
```

Preview component:

```jsx
<video
  key={previewUrl}
  ref={previewRef}
  src={previewUrl}
  controls
  muted
  playsInline
  preload="metadata"
  onLoadedData={(event) => {
    event.currentTarget.currentTime = 0;

    event.currentTarget
      .play()
      .catch(() => {});
  }}
  className="size-full object-contain"
/>
```

---

# 30. Blob URL Cleanup

Blob URLs must be revoked to avoid memory leaks.

Use a ref:

```js
const previewUrlRef = useRef("");
```

Before creating a new URL:

```js
if (previewUrlRef.current) {
  URL.revokeObjectURL(
    previewUrlRef.current,
  );
}
```

During cleanup:

```js
if (previewUrlRef.current) {
  URL.revokeObjectURL(
    previewUrlRef.current,
  );

  previewUrlRef.current = "";
}
```

Do not revoke the current Blob URL immediately after setting it. Doing so causes a black or broken preview.

---

# 31. Camera Stream Cleanup

Every camera and canvas track must be stopped.

```js
const stopCamera = useCallback(() => {
  stopDrawing();

  sourceStreamRef.current
    ?.getTracks()
    .forEach((track) => {
      track.stop();
    });

  recordingStreamRef.current
    ?.getTracks()
    .forEach((track) => {
      track.stop();
    });

  sourceStreamRef.current = null;
  recordingStreamRef.current = null;

  if (cameraRef.current) {
    cameraRef.current.pause();
    cameraRef.current.srcObject = null;
  }

  setCameraActive(false);
}, [stopDrawing]);
```

A previous bug included an accidental duplicate line:

```js
sourceStreamRef.current
sourceStreamRef.current
  ?.getTracks()
```

It should exist only once.

Failing to stop tracks can cause:

- Camera light staying on
- Camera unavailable on another tab
- `NotReadableError`
- Higher memory usage
- Webcam locked after navigation

---

# 32. Saving Evidence

Save operation is performed in two stages.

## Stage 1: Local Video Save

Frontend sends video to:

```text
POST http://127.0.0.1:4782/api/save-video
```

The helper:

1. Sanitizes order/AWB/type.
2. Creates order folder.
3. Generates duplicate-safe filename.
4. Writes the video.
5. Verifies file size.
6. Generates SHA-256.
7. Returns storage metadata.

## Stage 2: Backend Metadata Save

Frontend sends returned helper metadata to:

```text
POST /api/packaging-evidence
```

Backend stores:

- Order relation
- Order number
- AWB
- Evidence type
- Station
- Filename
- Relative path
- File size
- Duration
- Hash
- Recording configuration

The backend record should only be created after the helper confirms successful local save.

---

# 33. Preventing Double Save

Users may double-click the Save Evidence button.

Use both:

```js
const saveLockRef = useRef(false);
```

and UI loading state:

```js
const [savingVideo, setSavingVideo] =
  useState(false);
```

Guard:

```js
if (saveLockRef.current) return;

saveLockRef.current = true;
setSavingVideo(true);
```

Finally:

```js
finally {
  saveLockRef.current = false;
  setSavingVideo(false);
}
```

Also disable button:

```jsx
disabled={
  savingVideo ||
  savingEvidence ||
  Boolean(savedResult)
}
```

This prevents:

- Duplicate helper uploads
- Duplicate files
- Duplicate backend metadata
- Double click race condition

---

# 34. Directory Tab

The Directory tab reads local videos from:

```text
GET http://127.0.0.1:4782/api/videos
```

Features:

- List videos
- Filter by order
- Filter by AWB
- View filename
- View size
- View save time
- Play video
- Open evidence folder
- Identify missing files

Video playback URL is returned by the helper:

```text
http://127.0.0.1:4782/api/stream/:videoId
```

The browser cannot inspect an arbitrary local folder directly. The helper is required for directory listing and playback.

---

# 35. Dashboard

Dashboard may display:

```text
Total evidence
Forward evidence
RTO evidence
Saved evidence
Missing evidence
Corrupted evidence
Failed evidence
Today’s evidence
Recent recordings
Station-wise recordings
```

Frontend store functions may include:

```text
fetchDashboard
fetchStats
fetchEvidenceList
fetchEvidenceById
fetchOrderEvidence
lookupOrder
createEvidence
updateEvidenceStatus
```

Ensure the dashboard store calls an endpoint actually exposed by the backend.

---

# 36. Zustand Store Response Handling

Backend responses may use:

```json
{
  "success": true,
  "data": {}
}
```

or:

```json
{
  "success": true,
  "data": [],
  "count": 0
}
```

The store should consistently extract:

```js
const getResponseData = (payload) =>
  payload?.data ?? payload;
```

Empty data is not automatically an API failure.

For example:

```json
{
  "success": true,
  "data": [],
  "count": 0
}
```

means no evidence was found. It does not necessarily mean the order lookup failed.

---

# 37. CORS Layers

There are two independent CORS configurations.

## Backend CORS

Allows Admin/Vendor frontend to call:

```text
oatclub-backend
```

Example:

```text
Vendor → localhost:6001
```

## Helper CORS

Allows Admin/Vendor frontend to call:

```text
127.0.0.1:4782
```

A successful backend request does not prove helper CORS is correct.

A successful helper health request does not prove backend CORS is correct.

Debug both independently.

---

# 38. HTTPS Deployment Consideration

A deployed HTTPS frontend calling:

```text
http://127.0.0.1:4782
```

may face browser mixed-content or Private Network Access restrictions depending on browser policies.

If production blocks the helper:

1. Check Chrome Console.
2. Check whether the request is blocked as mixed content.
3. Check Private Network Access warnings.
4. Add required helper response headers.
5. Consider local HTTPS for the helper if browser enforcement requires it.
6. Test using the final deployed Admin/Vendor domain before warehouse rollout.

Do not assume localhost development behaviour will always match an HTTPS production deployment.

---

# 39. Troubleshooting Guide

## Helper Offline

UI message:

```text
Evidence Helper is not running on this PC.
```

Checks:

```text
http://127.0.0.1:4782/api/health
```

If it does not open:

- Start helper EXE
- Check Task Manager
- Check tray icon
- Check Windows Startup
- Check port 4782
- Check firewall/antivirus
- Restart helper

PowerShell port check:

```powershell
Get-NetTCPConnection -LocalPort 4782
```

## Health Request Returns 404

Confirm the URL includes:

```text
/api/health
```

Correct:

```text
http://127.0.0.1:4782/api/health
```

Incorrect:

```text
http://127.0.0.1:4782/health
```

## Camera Permission Allowed but Camera Does Not Start

Likely causes:

- Stale device ID
- `exact` device constraint
- Camera already in use
- Old stream not stopped
- Selected camera disconnected
- Station Setup saved from a different origin

Fix:

- Use `ideal`
- Add default-camera fallback
- Close other camera applications
- Detect cameras again
- Save configuration again
- Restart browser

## Camera Works in Admin but Not Vendor

Reason:

```text
Camera device IDs may differ across origins.
```

Use:

```js
deviceId: {
  ideal: stationConfig.cameraId,
}
```

Do not require exact match.

## Stop Recording Works but Preview Is Black

Check:

- Blob has non-zero size
- `ondataavailable` is collecting chunks
- Blob URL is not revoked too early
- Preview video uses `key={previewUrl}`
- Preview uses `src={previewUrl}`
- State becomes `stopped`
- Canvas draw loop was running
- Camera track was active during recording

## Preview Does Not Autoplay

Autoplay can be blocked.

The preview still has controls, so manual play should work.

Use:

```jsx
muted
controls
playsInline
```

## Video Is Empty

Check:

```js
if (!blob.size) {
  setError(
    "Recording is empty. Record again.",
  );
}
```

Possible causes:

- Recording stopped immediately
- No canvas frames
- MediaRecorder failed
- Stream ended
- Browser codec issue

## Order Was Not Found

Check Network response.

If response is:

```json
{
  "success": true,
  "data": [],
  "count": 0
}
```

verify whether the frontend is calling the order lookup route or evidence-list route.

Correct lookup route:

```text
/api/packaging-evidence/lookup/000627
```

Do not accidentally use:

```text
/api/packaging-evidence/order/000627
```

The `/order/:orderNumber` route returns evidence records for an order; it does not necessarily fetch the original order for packing.

## AWB Missing

If order AWB is unavailable, show the manual AWB field.

Do not hide the field when:

```text
recordingDetails.awb is empty
```

Recording should remain blocked until manual AWB is entered.

## Save Returns 400

Check request payload for required fields:

```text
order
orderNumber
evidenceType
awb
station.stationName
storage.storageRoot
storage.orderFolder
storage.fileName
storage.relativePath
```

Inspect backend response message rather than only the status code.

## Incorrect Filename

Filename must come from the helper’s confirmed save result.

Do not independently guess the final filename in the frontend because duplicate-safe suffixes may be added.

Correct pattern:

```text
ORDER-AWB-TYPE.webm
```

Do not use:

```text
ORDER-NO-AWB-TYPE
```

unless AWB is genuinely absent and the business intentionally permits it.

Current expected behaviour requires AWB before recording.

## JSON File Appears Beside Video

Earlier versions may have created metadata sidecar files.

The final system should use:

```text
Video file locally
Metadata in MongoDB
```

If sidecar JSON files are no longer required, remove their creation logic from the helper.

Do not delete historical JSON files until confirming they are unused.

## Duplicate Files Created

Possible causes:

- Save button clicked twice
- Save lock missing
- Button not disabled
- Request retried
- Backend responded slowly
- User clicked again

Duplicate-safe naming prevents overwrite, but frontend locking should prevent unintended duplicates.

## Dashboard Returns 404

Check `/stats` versus `/dashboard`.

Recommended backend compatibility:

```js
router.get(
  "/stats",
  getPackagingEvidenceStats,
);

router.get(
  "/dashboard",
  getPackagingEvidenceStats,
);
```

## Dashboard Returns 401

Packaging Evidence routes were intended to work without authentication.

Check whether global middleware or route mounting adds authentication.

If authentication is intentionally added later, update Admin and Vendor stores consistently.

## Summary/Notification Requests Show 401

These may belong to other Vendor Panel modules and are not necessarily related to Packaging Evidence.

Filter Network requests and inspect the exact request URL before changing Packaging Evidence code.

---

# 40. Deployment Checklist

## Backend

- [ ] PackagingEvidence model deployed
- [ ] Controller deployed
- [ ] Routes deployed
- [ ] Routes mounted under `/api/packaging-evidence`
- [ ] MongoDB indexes created
- [ ] CORS allows Admin domain
- [ ] CORS allows Vendor domain
- [ ] Order lookup tested
- [ ] Stats endpoint tested
- [ ] Create evidence tested

## Admin Panel

- [ ] Packaging Evidence pages deployed
- [ ] Zustand store deployed
- [ ] Sidebar link added
- [ ] Permission added
- [ ] Backend environment URL set
- [ ] Helper environment URL set
- [ ] Dashboard tested
- [ ] Record page tested
- [ ] Directory tested
- [ ] Station Setup tested

## Vendor Panel

- [ ] Packaging Evidence page deployed
- [ ] Tab components deployed
- [ ] Sidebar link deployed
- [ ] Store deployed
- [ ] Query-param tabs tested
- [ ] Forward recording tested
- [ ] RTO recording tested
- [ ] Preview tested
- [ ] Directory playback tested
- [ ] Station Setup tested

## Evidence Helper

- [ ] Production frontend origins added
- [ ] EXE rebuilt after final source changes
- [ ] EXE copied to packing PC
- [ ] Startup registration tested
- [ ] Tray icon tested
- [ ] Port 4782 tested
- [ ] Storage folder selected
- [ ] Storage write test passed
- [ ] Camera detected
- [ ] Full video save tested
- [ ] Folder creation tested
- [ ] Duplicate naming tested
- [ ] Directory streaming tested

---

# 41. New Packing PC Setup

Use this process for every new packing PC.

1. Copy `OATCLUB-Evidence-Helper.exe`.
2. Run the EXE.
3. Confirm the tray icon.
4. Open:

```text
http://127.0.0.1:4782/api/health
```

5. Open Vendor/Admin Packaging Evidence.
6. Go to Station Setup.
7. Enter station name.
8. Confirm computer name.
9. Enter default packer name.
10. Select evidence directory.
11. Test storage.
12. Detect cameras.
13. Select camera.
14. Select 720p and 30 FPS.
15. Save Station Configuration.
16. Fetch a test order.
17. Record a short test.
18. Stop and preview.
19. Save evidence.
20. Confirm local file.
21. Confirm MongoDB metadata.
22. Restart Windows.
23. Confirm helper starts automatically.

---

# 42. Production Smoke Test

After every deployment:

## Forward Test

```text
Fetch order
→ Confirm AWB
→ Start camera
→ Record
→ Pause
→ Resume
→ Stop
→ Preview
→ Save
```

Verify:

```text
ORDER-AWB-forward.webm
```

## RTO Test

```text
Select RTO
→ Fetch order
→ Enter RMA if applicable
→ Confirm AWB
→ Record parcel opening
→ Stop
→ Preview
→ Save
```

Verify:

```text
ORDER-AWB-rto.webm
```

## Directory Test

- Search order
- Play video
- Open folder
- Confirm file size
- Confirm timestamp
- Confirm duplicate-safe behaviour

## Database Test

Verify:

- Correct order ObjectId
- Correct order number
- Correct AWB
- Correct evidence type
- Correct filename
- Correct relative path
- Correct station
- Status is `saved`
- SHA-256 is present
- File size is greater than zero

---

# 43. Recommended Operational Process

For Forward packing:

1. Place products visibly under the camera.
2. Show each product and its label.
3. Show selected sizes.
4. Place products into the parcel.
5. Show invoice where appropriate.
6. Seal the parcel.
7. Show the AWB label clearly.
8. Stop the recording.
9. Preview the recording.
10. Save evidence.
11. Do not dispatch until save success appears.

For RTO opening:

1. Show the unopened parcel.
2. Show AWB label.
3. Show external parcel damage.
4. Open parcel continuously.
5. Remove each product visibly.
6. Show missing/damaged/wrong items.
7. Stop the recording.
8. Preview and save.
9. Add notes if required.

---

# 44. Data Backup Limitation

Because videos are stored locally, MongoDB backup alone does not back up the videos.

Recommended future backup options:

- Network-attached storage
- Daily Windows backup
- Shared warehouse drive
- Encrypted cloud sync
- S3 upload
- Cloudflare R2
- Mux or Cloudinary for central video storage

Until central storage is introduced, the packing PC drive is the primary video source.

Do not format or replace a packing computer without copying:

```text
oatclub-evidence
```

---

# 45. Future Improvements

Potential future upgrades:

- Automatic cloud backup
- Central streaming dashboard
- Retention policy
- Evidence deletion approval
- File availability reconciliation
- Automatic missing-file scanner
- Webcam health checks
- Multiple camera angles
- Barcode scanner integration
- Auto-fetch order after barcode scan
- AWB OCR
- Packaging checklist
- Supervisor approval
- Watermark timestamp
- Digital signature
- RTO discrepancy workflow
- Courier claim export
- Evidence ZIP download
- NAS storage support
- Station activity reports
- Packer productivity reports

---

# 46. Important Rules for Future Developers

1. Do not upload large video blobs through the main OATCLUB backend unless central storage is intentionally introduced.
2. Do not use an absolute camera device ID across different browser origins.
3. Do not use `deviceId.exact` without fallback.
4. Do not revoke the Blob URL before preview finishes.
5. Do not overwrite an existing evidence file.
6. Do not create backend metadata before local save succeeds.
7. Do not trust a frontend-generated filename when the helper may add a duplicate suffix.
8. Do not allow recording without order and AWB.
9. Do not leave camera tracks running after navigation.
10. Do not remove helper CORS origins when deploying.
11. Do not replace `127.0.0.1:4782` with the backend domain.
12. Do not assume backend evidence records prove that local files still exist.
13. Do not expose unrestricted local-file paths through unsafe APIs.
14. Always sanitize order, AWB and filename components.
15. Always verify file size after saving.
16. Always retain the SHA-256 hash for integrity checks.
17. Always test both Forward and RTO flows.
18. Always test using the actual deployed frontend domain.
19. Always rebuild the helper EXE after changing its source.
20. Always verify Windows Startup behaviour on a real packing PC.

---

# 47. Quick Debug Order

When something stops working, debug in this order:

```text
1. Is the backend online?
2. Is the Evidence Helper online?
3. Does /api/health return 200?
4. Does /api/config return station configuration?
5. Is the correct frontend origin allowed?
6. Can the order lookup endpoint find the order?
7. Is AWB available?
8. Does Chrome have camera permission?
9. Is another application using the webcam?
10. Is the saved camera ID stale?
11. Does default-camera fallback work?
12. Does MediaRecorder create non-empty chunks?
13. Does Blob size exceed zero?
14. Does Blob URL play locally?
15. Does helper /api/save-video return success?
16. Does the physical file exist?
17. Does backend POST create metadata?
18. Does Directory API return the video?
19. Does stream URL play the video?
20. Does MongoDB metadata match the physical file?
```

---

# 48. Final Working Outcome

The completed system provides:

- Multiple packing-computer support
- Per-PC station configuration
- Configurable local evidence directory
- Separate folder per order
- Forward packing evidence
- RTO opening evidence
- Order and product details during recording
- Camera recording
- Pause and resume
- Stop and preview
- Record again
- Local video saving
- Duplicate-safe filenames
- Database metadata
- SHA-256 integrity value
- Evidence directory
- Local video playback
- Admin Panel integration
- Vendor Panel integration
- URL-based Vendor tabs
- Dashboard support
- Background Windows helper
- Startup-enabled EXE
- Multi-PC deployment support

---

# 49. Final Reference Values

```text
Helper host:
127.0.0.1

Helper port:
4782

Helper base URL:
http://127.0.0.1:4782

Health endpoint:
http://127.0.0.1:4782/api/health

Frontend variable:
NEXT_PUBLIC_EVIDENCE_HELPER_URL=http://127.0.0.1:4782

Backend base route:
/api/packaging-evidence

Evidence types:
forward
rto

Default video format:
video/webm

Recommended quality:
720p

Recommended frame rate:
30 FPS

Filename:
ORDER-AWB-TYPE.webm

Order directory:
STORAGE_ROOT/ORDER_NUMBER
```

---

# 50. Ownership

System:

```text
OATCLUB Packaging Evidence
```

Purpose:

```text
Courier dispute protection and warehouse packing proof
```

Primary modules:

```text
OATCLUB Backend
OATCLUB Admin
OATCLUB Vendor
OATCLUB Evidence Helper
```

Last major implementation:

```text
September 2026
```
