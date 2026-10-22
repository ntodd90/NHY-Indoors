// =====================================================================================
// Shared helpers: layer classification (by FIELDS, so renamed layers still work),
// building names, status tones, floor switching.
// =====================================================================================

export const BUILDINGS = {
  "NHY.B1": "Main Store",
  "NHY.B2": "Lumber Drive-Thru",
  "NHY.B3": "Building Materials Warehouse",
  "NHY.B4": "Yard Gate",
  "NHY.B5": "Covered Storage Canopy"
};
export const bname = (fid) => BUILDINGS[fid] || fid || "";

// One palette everywhere (map symbology, pop-ups, app): green / blue / purple / red
const TONES = {
  green: ["Available", "Running", "Clear", "OK", "Normal", "In Stock", "Compliant", "Pass", "Occupied"],
  blue: ["Loading", "Idle", "Low Stock", "Reserved"],
  purple: ["Unloading", "Awaiting Customer", "PM Due", "Due", "Inspection Due", "Misplaced"],
  red: ["Out of Service", "Down", "Blocked", "Alarm", "Offline", "Missing", "Out of Stock", "Gap", "Damaged"]
};
export function tone(status) {
  for (const [t, list] of Object.entries(TONES)) if (list.includes(status)) return t;
  return "grey";
}
export const chip = (status, text) => `<span class="chip t-${tone(status)}">${text ?? status}</span>`;

// Layer categories, detected from each layer's fields (order matters).
const RULES = [
  ["cameraCoverage", (f, layer) => f.has("CAMERA_ID") && layer.geometryType === "polygon"],
  ["cameras", (f) => f.has("CAMERA_ID")],
  ["lockers", (f) => f.has("LOCKER_ID")],
  ["security", (f) => f.has("DEVICE_ID")],
  ["products", (f) => f.has("SKU")],
  ["bays", (f) => f.has("BAY_ID") && f.has("DEMO_PLANOGRAM")],
  ["slots", (f) => f.has("LOCATION_ID") && f.has("RACK_ID")],
  ["racks", (f) => f.has("RACK_ID") && f.has("BAYS")],
  ["equip", (f) => f.has("DEMO_WORK_ORDER")],
  ["safety", (f) => f.has("DEMO_LAST_INSPECTED")],
  ["stalls", (f) => f.has("STALL_ID")],
  ["doors", (f) => f.has("DOOR_ID") && f.has("IS_EXIT")],
  ["utilLine", (f) => f.has("SUBTYPE") && f.has("SYSTEM")],
  ["utilPoint", (f) => f.has("ASSET_TYPE") && f.has("SYSTEM")],
  ["details", (f) => f.has("DETAIL_ID")],
  ["units", (f) => f.has("UNIT_ID")],
  ["levels", (f) => f.has("LEVEL_NUMBER") && f.has("LEVEL_ID")],
  ["zones", (f) => f.has("ZONE_TYPE")],
  ["lanes", (f) => f.has("DIRECTION")],
  ["gates", (f) => f.has("LANE_DIR")],
  ["facilities", (f) => f.has("FACILITY_ID") && f.has("SITE_ID")],
  ["sites", (f) => f.has("SITE_ID")]
];
export function classify(layer) {
  const f = new Set((layer.fields || []).map((x) => x.name.toUpperCase()));
  const hit = RULES.find(([, test]) => test(f, layer));
  return hit ? hit[0] : "other";
}

// "NHY.B1.L2" -> { facility: "NHY.B1", level: "NHY.B1.L2", label: "Main Store · Level 2" }
export function levelInfo(lid) {
  const p = String(lid || "").split(".");
  if (p.length < 3) return null;
  const facility = `${p[0]}.${p[1]}`;
  return { facility, level: lid, label: `${bname(facility)} · Level ${p[2].replace("L", "")}` };
}

// Switch the floor filter (component + view) to a level, or clear it with null.
export function setFloor(view, floorFilterEl, levelId) {
  try {
    const info = levelId ? levelInfo(levelId) : null;
    if (floorFilterEl) {
      floorFilterEl.facility = info ? info.facility : null;
      floorFilterEl.level = info ? info.level : null;
    }
    if (view.floors) {
      view.floors.removeAll();
      if (info) view.floors.add(info.level);
    }
  } catch (e) {
    console.warn("[floor]", e);
  }
}
