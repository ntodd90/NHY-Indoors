// =====================================================================================
// Quick views ("bookmarks with brains"). Each view sets layer visibility, filters
// (ANDed onto each layer's own definitionExpression, never replacing it), floor,
// camera, highlight, optional popup, and shows 3 presenter talking points.
// Keys 1–9 jump to the first nine views.
// =====================================================================================
import { classify, setFloor } from "./layers.js";

const INDOOR = ["sites", "facilities", "levels", "units", "details"];
const YARD = ["zones", "stalls", "lanes", "gates"];

export const VIEWS = [
  {
        id: "loss-prevention", title: "Loss Prevention", icon: "lock", desc: "Security devices, cameras and coverage across the store and yard",
        layers: [...INDOOR, ...YARD, "doors", "security", "cameras", "cameraCoverage"], target: { site: true }, floor: null,
        highlight: { cat: "security", where: "DEMO_STATUS <> 'Normal'" },
        notes: ["All security devices and cameras are visible across the store and yard; utilities are off",
          "Select a camera for simulated footage and its illustrative coverage area",
          "Alarms and offline devices are highlighted; cameras are hidden in every other Quick View"]
  },
  {
    id: "find", title: "Find an item", icon: "search", desc: "Products to aisle and bay",
    layers: "default", target: { facility: "NHY.B1", expand: 1.1 }, floor: "NHY.B1.L1",
    highlight: { cat: "products", where: "1=1" },
    notes: ["Every tracked SKU is pinned to an aisle and bay; open the Find panel and type 'stud' or 'PEX'",
            "Lumber items point to the drive-thru bay instead of an aisle",
            "Same data can drive associate wayfinding and customer-facing apps"]
  },
  {
    id: "planogram", title: "Planogram gaps", icon: "grid", desc: "Shelf bays off-planogram or out of stock",
    layers: "default", filters: { bays: "DEMO_PLANOGRAM <> 'Compliant'" }, show: ["bays"],
    target: { facility: "NHY.B1", expand: 1.05 }, floor: "NHY.B1.L1",
    highlight: { cat: "bays", where: "DEMO_PLANOGRAM = 'Gap'" },
    notes: ["Only exceptions are shown: red = gap / out of stock, purple = misplaced",
            "Click a bay for stock level, out-of-stock SKUs and the items that live there",
            "Turns a store walk into a targeted task list per department"]
  },
  {
    id: "pickup", title: "Pickup queue", icon: "box", desc: "Lockers and curbside, waiting customers",
    layers: "default", target: { units: "NAME = 'Order Pickup & Lockers'", expand: 4 }, floor: "NHY.B1.L1",
    highlight: { cat: "lockers", where: "DEMO_STATUS = 'Awaiting Customer'" }, popup: true,
    notes: ["36 lockers by the exit doors, 8 curbside stalls on the east face",
            "Highlighted: orders ready and waiting; anything over 60 minutes gets a follow-up",
            "The Pickup panel shows every locker and stall live"]
  },
  {
    id: "yard", title: "Pro load-out & lumber yard", icon: "car", desc: "Drive-thru route, load-out bays, gate checks",
    layers: "default", show: YARD, target: { facility: "NHY.B3", expand: 5 }, floor: null,
    highlight: { cat: "stalls", where: "STALL_TYPE = 'Pro Load-Out Bay'" },
    notes: ["One-way loop: enter at the east gate lane, load in the drive-thru, exit past the receipt check",
            "4 pro load-out doors on the Building Materials Warehouse, each with a live bay status",
            "The exit gate arm is down right now; that's a maintenance work order"]
  },
  {
    id: "equip", title: "Equipment down / PM due", icon: "wrench", desc: "Everything that needs a technician",
    layers: "default", filters: { equip: "DEMO_STATUS IN ('Down','PM Due')" }, show: ["equip"],
    target: { site: true }, floor: null,
    highlight: { cat: "equip", where: "DEMO_STATUS = 'Down'" },
    notes: ["Rooftop units, paint mixers, dock levelers, self-checkouts, forklifts: one map",
            "Each asset carries its last/next PM and open work order",
            "The freight elevator's state inspection is due; click it for details"]
  },
  {
    id: "racks", title: "Overstock & rack inspections", icon: "layers", desc: "Level 2 overstock racking",
    layers: "default", show: ["racks"], target: { facility: "NHY.B1", expand: 1.05 }, floor: "NHY.B1.L2",
    highlight: { cat: "racks", where: "DEMO_INSPECTION <> 'Pass'" },
    notes: ["Level 2 is overstock and back office; racks are colored by inspection result",
            "Click a rack for utilization by level; damaged uprights get a tag-out callout",
            "In the lumber yard, bay W07 (OSB) has a damaged cantilever rack and OSB is out of stock"]
  },
  {
    id: "egress", title: "Egress & fire protection", icon: "exclamation-mark-triangle", desc: "Exits, extinguishers, sprinklers",
    layers: [...INDOOR, "safety", "doors", "utilLine", "utilPoint"],
    filters: { utilLine: "SYSTEM = 'Fire Protection'", utilPoint: "SYSTEM = 'Fire Protection'", doors: "IS_EXIT = 1" },
    target: { facility: "NHY.B1", expand: 1.15 }, floor: "NHY.B1.L1",
    highlight: { cat: "safety", where: "DEMO_STATUS NOT IN ('OK','Clear')" },
    notes: ["Exit S2 on the south wall is blocked by a pallet of salt: red",
            "Extinguishers flagged missing or overdue, with sprinkler riser and FDC context",
            "This is the pre-inspection walk-through, done from the map"]
  },
  {
    id: "security", title: "After-hours security", icon: "lock", desc: "Alarms, sensors and door contacts",
    layers: [...INDOOR, "security"], target: { facility: "NHY.B1", expand: 1.15 }, floor: "NHY.B1.L1",
    highlight: { cat: "security", where: "DEMO_STATUS <> 'Normal'" },
    notes: ["Garden Center exit door contact in alarm (held open 4 min)",
            "Door contacts, motion sensors and intrusion panels are located by floor",
            "Use Loss Prevention to see cameras and their coverage areas"]
  },
  {
    id: "utilities", title: "Utilities: full stack", icon: "layers", desc: "Power, fiber, water, sewer, fire, HVAC, irrigation",
    layers: ["sites", "facilities", "zones", "utilLine", "utilPoint"], target: { site: true }, floor: null,
    notes: ["City mains along Prior Ave feed every building (alignments assumed, illustrative)",
            "Click any line for size, length and depth below grade, in feet",
            "12 rooftop units, a fire loop around the lumber yard and garden-center irrigation"]
  }
];

// -------------------------------------------------------------------------------------
export async function initViews({ view, flayers, floorFilterEl, listEl, notesEl, initialViewpoint = view.viewpoint?.clone(), initialFloor = null }) {
  const cat = new Map(flayers.map((l) => [l, classify(l)]));
  const snap = new Map(flayers.map((l) => [l, { visible: l.visible, def: l.definitionExpression || "" }]));
  const visibilitySnap = new Map(view.map.allLayers.toArray().map((layer) => [layer, layer.visible]));
  const layersOf = (c) => flayers.filter((l) => cat.get(l) === c);
  const securityViews = await Promise.all(layersOf("security").map(async (layer) => {
    const layerView = await view.whenLayerView(layer);
    return { layerView, filter: layerView.filter?.clone() || null };
  }));
  function showSecurityCameras(show) {
    securityViews.forEach(({ layerView, filter }) => {
      layerView.filter = show ? filter : {
        ...(filter?.toJSON() || {}),
        where: `(${filter?.where || "1=1"}) AND (DEVICE_TYPE IS NULL OR DEVICE_TYPE <> 'Camera')`
      };
    });
  }
  showSecurityCameras(false);
  const setVisible = (l, v) => {
    l.visible = v;
    if (v) { let p = l.parent; while (p && p.type === "group") { p.visible = true; p = p.parent; } }
  };
  let hl = null, activeId = null;

  async function apply(v) {
    activeId = v.id;
    hl?.remove(); hl = null;
    view.closePopup?.();

    // 1. visibility + filters
    flayers.forEach((l) => {
      const s = snap.get(l), c = cat.get(l);
      let vis = v.layers === "default" ? s.visible : v.layers.includes(c);
      if (v.show?.includes(c)) vis = true;
      if (c === "cameras" || c === "cameraCoverage") vis = v.id === "loss-prevention";
      setVisible(l, vis);
      const f = v.filters?.[c];
      l.definitionExpression = f ? (s.def ? `(${s.def}) AND (${f})` : f) : s.def;
    });
    showSecurityCameras(v.id === "loss-prevention");

    // 2. floor
    setFloor(view, floorFilterEl, v.floor || null);

    // 3. camera
    try {
      const t = v.target || {};
      let ext = null, feat = null;
      if (t.viewpoint) {
        await view.goTo(t.viewpoint, { duration: 900 });
      } else if (t.site) {
        const s = layersOf("sites")[0];
        if (s) ext = (await s.queryExtent()).extent;
      } else if (t.facility) {
        const f = layersOf("facilities")[0];
        if (f) ext = (await f.queryExtent({ where: `FACILITY_ID = '${t.facility}'` })).extent;
      } else if (t.units) {
        const u = layersOf("units")[0];
        if (u) {
          const r = await u.queryFeatures({ where: t.units, outFields: ["*"], returnGeometry: true });
          if (r.features.length) { feat = r.features[0]; ext = feat.geometry.extent.clone(); }
        }
      }
      if (ext) await view.goTo(ext.clone().expand(t.expand || 1.15), { duration: 1200 });
      if (v.popup && feat) view.openPopup({ location: feat.geometry.centroid, fetchFeatures: true });
    } catch (e) { console.warn("[views] camera", e); }

    // 4. highlight
    try {
      if (v.highlight) {
        const lyr = layersOf(v.highlight.cat)[0];
        if (lyr) {
          const lv = await view.whenLayerView(lyr);
          const ids = await lyr.queryObjectIds({ where: v.highlight.where });
          if (ids?.length) hl = lv.highlight(ids);
        }
      }
    } catch (e) { console.warn("[views] highlight", e); }

    renderList();
    notesEl.innerHTML = `<div class="notes-title">${v.title}</div><ul>${v.notes.map((n) => `<li>${n}</li>`).join("")}</ul>`;
  }

  function renderList() {
    listEl.innerHTML = "";
    VIEWS.forEach((v, i) => {
      const it = document.createElement("calcite-list-item");
      it.label = (i < 9 ? `${i + 1}  ·  ` : "") + v.title;
      it.description = v.desc;
      it.selected = v.id === activeId;
      const ic = document.createElement("calcite-icon");
      ic.slot = "content-start"; ic.icon = v.icon; ic.scale = "m";
      it.appendChild(ic);
      it.addEventListener("click", () => apply(v));
      listEl.appendChild(it);
    });
  }

  window.addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest("input, textarea, calcite-input-text, calcite-input, [contenteditable]")) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 9 && VIEWS[n - 1]) apply(VIEWS[n - 1]);
  });

  renderList();
  notesEl.innerHTML = `<div class="muted">Pick a view, or press 1–9. Talking points appear here.</div>`;
  async function reset() {
    await apply({ id: "initial", title: "Store Overview", layers: "default", floor: initialFloor, target: { viewpoint: initialViewpoint }, notes: [] });
    visibilitySnap.forEach((visible, layer) => { layer.visible = visible; });
    activeId = null;
    renderList();
    notesEl.innerHTML = `<div class="muted">Pick a view, or press 1–9. Talking points appear here.</div>`;
  }
  return { apply, reset, VIEWS };
}
