# Tree Mapper

> A mobile offline tool for field tree data viewing, verification, and editing.

[**简体中文**](README_CN.md)

---

## Platform

- **Web** — open `index.html` in any browser
- **Android** — packaged as an APK via Capacitor, fully offline

---

## Data Format

Import CSV files (UTF-8 or GBK encoding) with the following fields:

| Field | Required | Description |
|-------|:--------:|-------------|
| `lidar_id` / `id` | ✅ | Unique tree identifier |
| `x` | ✅ | X coordinate (m) |
| `y` | ✅ | Y coordinate (m) |
| `dbh` | | Diameter at breast height (cm) |
| `height` | | Tree height (m) |
| `branch_height` | | Height to first branch (m) |
| `window` | | Growth window |
| `real_id` | | Field survey ID |
| `notes` | | Remarks |

A field-mapping dialog handles mismatched column names automatically.

---

## Workflow

```
LiDAR Scan → Single-tree Segmentation → CSV Export
                      ↓
              Import into TreeMapper
                      ↓
         Field Verification on Phone/Tablet
                      ↓
              Export Completed CSV
```

1. **LiDAR Scanning + Segmentation** — acquire plot point cloud via terrestrial/backpack/UAV LiDAR, then run single-tree segmentation to generate seed points (`lidar_id, x, y`).
2. **Import into TreeMapper** — load the seed point CSV with one tap; trees appear instantly on the 2D canvas.
3. **Field Verification** — take your phone/tablet into the plot, match each tree against the canvas, and record DBH, height, notes, etc.
4. **Export** — export the completed CSV with both original and rotation-adjusted coordinates.

---

## Features

### Data Management

- **CSV Import** — auto-detects field mapping, supports UTF-8 / GBK encoding, optional unit conversion
- **CSV Export** — exports rotated coordinates + all attributes, BOM header for Excel compatibility
- **Auto-save** — edits persist automatically in IndexedDB; close and reopen without data loss
- **Operation History** — every add/edit/delete is logged; full undo/redo and rollback to any point
- **Clear All** — reset all trees and boundary points, with confirmation when data exists

### Canvas Interaction

- **Pan** — single-finger drag
- **Zoom** — two-finger pinch, locks anchor point without drift
- **Rotate** — bottom slider adjusts rotation angle (0–360°), with lock option
- **Labels** — toggle Tree ID / DBH / Real ID labels independently
- **DBH Scale** — slider adjusts tree marker size

### Tree Colors

| Source | Fill | Border |
|--------|------|--------|
| Imported | 🟢 Green | Dark green |
| Added | 🟡 Yellow | Dark yellow |
| Selected | 🔴 Red | Dark red |

### Data Table

- Tap the 📊 tree-count badge to open
- Click any column header to sort ascending → descending → default
- ⊕ button centers the tree on the canvas
- Click a row to open the edit panel
- Panel edits refresh the table in real time

### Plot Boundary

- Import boundary point file via 📍 button (supports `Index,X,Y,Z,...` format)
- Displayed as small black dots on the canvas
- Rotates in sync with the main canvas
- Persisted automatically across sessions
- Not included in tree save/export operations

### Other

- **Undo / Redo** — ↩ / ↪ buttons and keyboard shortcuts (`Ctrl+Z` / `Ctrl+Shift+Z`)
- **Operation Log** — expandable bottom panel
- **Language** — toggle between 中文 / EN in the toolbar
- **Keyboard shortcuts** — `Ctrl+Z` undo, `Ctrl+Shift+Z` redo

---

## Architecture

```
index.html              → Main page
css/style.css           → Styles
js/
  app.js                → Entry point, wires all modules
  canvas.js             → Canvas rendering engine + touch interaction
  csv.js                → CSV import/export (PapaParse)
  store.js              → IndexedDB wrapper
  history.js            → Operation history (undo/redo)
  panel.js              → Edit panel
  utils.js              → Utilities (rotation, coordinate transforms)
lib/
  papaparse.min.js      → CSV parsing library
```

The Android build exposes native file-picker access via `MainActivity.java` through `ImportHelper` / `ExportHelper` helpers.

---

## Test Data

- `sample_data.csv` — 15 sample trees
