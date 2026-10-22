// =====================================================================================
// Northline Home & Yard – Store Operations app (v1)
// ArcGIS Maps SDK for JavaScript 5.1 (CDN) + Calcite. Static files, no build step.
// All DEMO_* values in the data are synthetic.
// =====================================================================================
import { bname, chip, tone, classify, levelInfo, setFloor } from "./layers.js";

const CONFIG = {
  portalUrl: "https://esri-cgs.maps.arcgis.com",
  appId: "dB7jc2tJORyj075F",                     // OAuth 2.0 client ID (same app item as the EFY yard app)
  webmapId: "b155c110f0a549bcb0106b830bb0d6b7",  // NHY floor-aware web map
  refreshSeconds: 30
};

const $ = (id) => document.getElementById(id);
function showError(msg, err) {
  console.error(msg, err || "");
  $("errMsg").textContent = msg + (err && err.message ? " – " + err.message : "");
  $("errAlert").open = true;
}
const bootMsg = (t) => ($("bootMsg").textContent = t);

// -------------------------------------------------------------------------------------
// 1. Sign in (OAuth, same-window redirect)
// -------------------------------------------------------------------------------------
const [esriConfig, OAuthInfo, esriId, Portal] = await $arcgis.import([
  "@arcgis/core/config.js",
  "@arcgis/core/identity/OAuthInfo.js",
  "@arcgis/core/identity/IdentityManager.js",
  "@arcgis/core/portal/Portal.js"
]);
esriConfig.portalUrl = CONFIG.portalUrl;
esriId.registerOAuthInfos([new OAuthInfo({ appId: CONFIG.appId, portalUrl: CONFIG.portalUrl, popup: false })]);
const sharingUrl = CONFIG.portalUrl + "/sharing";
try {
  await esriId.checkSignInStatus(sharingUrl);
} catch {
  bootMsg("Redirecting to ArcGIS sign-in…");
  await esriId.getCredential(sharingUrl);
}
try {
  const portal = new Portal({ url: CONFIG.portalUrl, authMode: "immediate" });
  await portal.load();
  $("userChip").fullName = portal.user?.fullName || portal.user?.username || "";
  $("userChip").username = portal.user?.username || "";
} catch (e) {
  showError("Signed in, but could not load your ArcGIS organization.", e);
}
$("signOutBtn").addEventListener("click", () => { esriId.destroyCredentials(); window.location.reload(); });

// -------------------------------------------------------------------------------------
// 2. Map + layers (found by their fields, so renamed layers still work)
// -------------------------------------------------------------------------------------
bootMsg("Loading the store map…");
await customElements.whenDefined("arcgis-map");
const mapEl = $("map");
mapEl.itemId = CONFIG.webmapId;
try {
  await mapEl.viewOnReady();
} catch (e) {
  showError("The web map could not be loaded. Check the item ID and that it is shared with you.", e);
}
const view = mapEl.view;
const floorFilterEl = document.querySelector("arcgis-floor-filter");
const initialViewpoint = view.viewpoint.clone();
$("boot").classList.add("hide");

const flayers = view.map.allLayers.filter((l) => l.type === "feature").toArray();
await Promise.allSettled(flayers.map((l) => l.load()));
const L = {};
flayers.forEach((l) => { const c = classify(l); if (!L[c]) L[c] = l; });
console.info("[app] layers:", flayers.map((l) => `${l.title} → ${classify(l)}`).join(" | "));
["equip", "safety", "security", "lockers", "stalls", "products", "bays", "racks"].forEach((c) => {
  if (!L[c]) console.warn(`[app] no layer found for "${c}". Is it in the web map?`);
});

// -------------------------------------------------------------------------------------
// 3. Panel switching
// -------------------------------------------------------------------------------------
$("actionBar").addEventListener("click", (evt) => {
  const action = evt.target.closest("calcite-action");
  if (!action) return;
  const id = action.dataset.panel;
  document.querySelectorAll("#actionBar calcite-action").forEach((a) => (a.active = a === action));
  document.querySelectorAll("#leftPanel calcite-panel").forEach((p) => (p.hidden = p.dataset.panel !== id));
});

// -------------------------------------------------------------------------------------
// 4. Data
// -------------------------------------------------------------------------------------
const state = { equip: [], safety: [], security: [], lockers: [], stalls: [], products: [], bays: {}, racksBad: [], eqFilter: "issues" };

async function q(layer, where = "1=1", fields = ["*"], geometry = true) {
  if (!layer) return [];
  const query = layer.createQuery();
  query.where = where; query.outFields = fields; query.returnGeometry = geometry;
  return (await layer.queryFeatures(query)).features;
}

async function loadData() {
  const [equip, safety, security, lockers, stalls, products, racksBad, baysStats, baysGaps] = await Promise.all([
    q(L.equip),
    q(L.safety, "DEMO_STATUS NOT IN ('OK','Clear')"),
    q(L.security, "DEMO_STATUS <> 'Normal'"),
    q(L.lockers),
    q(L.stalls),
    q(L.products),
    q(L.racks, "DEMO_INSPECTION <> 'Pass'"),
    (async () => {
      if (!L.bays) return null;
      const s = L.bays.createQuery();
      s.where = "1=1";
      s.outStatistics = [
        { statisticType: "avg", onStatisticField: "DEMO_STOCK_PCT", outStatisticFieldName: "avgstock" },
        { statisticType: "sum", onStatisticField: "DEMO_OOS_SKUS", outStatisticFieldName: "oos" },
        { statisticType: "count", onStatisticField: "BAY_ID", outStatisticFieldName: "n" }
      ];
      const r = await L.bays.queryFeatures(s);
      return r.features[0]?.attributes || null;
    })(),
    L.bays ? L.bays.queryFeatureCount({ where: "DEMO_PLANOGRAM <> 'Compliant'" }) : 0
  ]);
  const pick = (a, k) => a?.[k] ?? a?.[k.toUpperCase()] ?? 0;
  Object.assign(state, { equip, safety, security, lockers, stalls, products, racksBad });
  state.bays = { avg: Math.round(pick(baysStats, "avgstock")), oos: pick(baysStats, "oos"), n: pick(baysStats, "n"), gaps: baysGaps };
  $("lastUpdated").textContent = "Updated " + new Date().toLocaleTimeString();
}

// -------------------------------------------------------------------------------------
// 5. Map helpers: floor + zoom + popup + pulse highlight
// -------------------------------------------------------------------------------------
let hl = null;
async function goToFeature(graphic, layer, zoom = 21) {
  try {
    const lid = graphic.attributes.LEVEL_ID;
    setFloor(view, floorFilterEl, lid || null);
    await view.goTo({ target: graphic.geometry, zoom }, { duration: 900 });
    hl?.remove();
    if (layer) {
      const lv = await view.whenLayerView(layer);
      hl = lv.highlight(graphic.attributes[layer.objectIdField]);
    }
    view.openPopup({ location: graphic.geometry, fetchFeatures: true });
  } catch (e) { console.warn("[goTo]", e); }
}
function item(label, desc, statusHtml, onClick, icon) {
  const it = document.createElement("calcite-list-item");
  it.label = label; it.description = desc || "";
  if (statusHtml) { const s = document.createElement("span"); s.slot = "content-end"; s.innerHTML = statusHtml; it.appendChild(s); }
  if (icon) { const ic = document.createElement("calcite-icon"); ic.slot = "content-start"; ic.icon = icon; ic.scale = "s"; it.appendChild(ic); }
  if (onClick) it.addEventListener("click", onClick);
  return it;
}
const where = (a) => levelInfo(a.LEVEL_ID)?.label || bname(a.FACILITY_ID);

// -------------------------------------------------------------------------------------
// 6. Overview
// -------------------------------------------------------------------------------------
function kpi(value, label, sub, t) {
  return `<div class="kpi k-${t}"><div class="v">${value}</div><div class="l">${label}</div>${sub ? `<div class="s">${sub}</div>` : ""}</div>`;
}
function renderOverview() {
  const e = state.equip.map((g) => g.attributes);
  const down = e.filter((a) => a.DEMO_STATUS === "Down").length;
  const pm = e.filter((a) => a.DEMO_STATUS === "PM Due").length;
  const waiting = state.lockers.filter((g) => g.attributes.DEMO_STATUS === "Awaiting Customer").length
                + state.stalls.filter((g) => g.attributes.DEMO_STATUS === "Awaiting Customer").length;
  const oosSku = state.products.filter((g) => g.attributes.DEMO_STATUS === "Out of Stock").length;
  $("kpis").innerHTML =
    kpi(`${down}<span class="muted"> / ${e.length}</span>`, "Equipment down", `${pm} PM due`, down ? "red" : "green") +
    kpi(state.safety.length, "Safety items open", state.racksBad.length ? `+ ${state.racksBad.length} racks flagged` : "", state.safety.length ? "red" : "green") +
    kpi(waiting, "Pickups waiting", "lockers + curbside", "purple") +
    kpi(`${state.bays.avg}%`, "Shelf stock level", `${state.bays.gaps} planogram exceptions`, "blue") +
    kpi(oosSku, "Tracked SKUs out", `${state.bays.oos} OOS SKUs on shelves`, oosSku ? "red" : "green") +
    kpi(state.security.length, "Security alerts", "alarm / offline", state.security.length ? "red" : "green");

  const rank = { Down: 0, Blocked: 0, Alarm: 0, Missing: 1, Damaged: 1, Offline: 2, "PM Due": 3, "Inspection Due": 3, Due: 3 };
  const rows = [
    ...state.equip.filter((g) => ["Down", "PM Due"].includes(g.attributes.DEMO_STATUS)).map((g) => ({ g, lyr: L.equip, icon: "wrench" })),
    ...state.safety.map((g) => ({ g, lyr: L.safety, icon: "exclamation-mark-triangle" })),
    ...state.security.map((g) => ({ g, lyr: L.security, icon: "lock" })),
    ...state.racksBad.map((g) => ({ g, lyr: L.racks, icon: "grid", name: `Rack ${g.attributes.RACK_ID}`, st: g.attributes.DEMO_INSPECTION }))
  ].map((r) => ({ ...r, st: r.st || r.g.attributes.DEMO_STATUS, name: r.name || r.g.attributes.NAME }))
   .sort((a, b) => (rank[a.st] ?? 9) - (rank[b.st] ?? 9));
  const list = $("attnList");
  list.innerHTML = "";
  rows.forEach((r) => {
    const a = r.g.attributes;
    const desc = [where(a), a.DEMO_ISSUE || a.DEMO_NOTE].filter(Boolean).join(" · ");
    list.appendChild(item(r.name, desc, chip(r.st), () => goToFeature(r.g, r.lyr), r.icon));
  });
  if (!rows.length) list.innerHTML = `<calcite-notice open kind="success" width="full"><div slot="message">All clear.</div></calcite-notice>`;
}

// -------------------------------------------------------------------------------------
// 7. Find an item
// -------------------------------------------------------------------------------------
function renderFind() {
  const term = ($("findInput").value || "").trim().toLowerCase();
  const list = $("findList");
  list.innerHTML = "";
  state.products
    .filter((g) => !term || `${g.attributes.NAME} ${g.attributes.DEPARTMENT} ${g.attributes.SKU}`.toLowerCase().includes(term))
    .sort((a, b) => a.attributes.NAME.localeCompare(b.attributes.NAME))
    .forEach((g) => {
      const a = g.attributes;
      list.appendChild(item(a.NAME, `${a.LOCATION} · ${a.DEPARTMENT} · $${Number(a.PRICE_USD).toFixed(2)}`,
        chip(a.DEMO_STATUS, a.DEMO_STATUS === "In Stock" ? `${a.DEMO_ON_HAND} on hand` : a.DEMO_STATUS), () => goToFeature(g, L.products, 22)));
    });
}
$("findInput").addEventListener("calciteInputTextInput", renderFind);

// -------------------------------------------------------------------------------------
// 8. Pickup
// -------------------------------------------------------------------------------------
function renderPickup() {
  const lk = state.lockers.map((g) => g).sort((a, b) => a.attributes.LOCKER_ID.localeCompare(b.attributes.LOCKER_ID));
  const cnt = (arr, s) => arr.filter((g) => g.attributes.DEMO_STATUS === s).length;
  const banks = {};
  lk.forEach((g) => (banks[g.attributes.BANK] ||= []).push(g));
  let html = `<div class="section-title">Pickup lockers</div>
    <div class="muted">${cnt(lk, "Awaiting Customer")} awaiting customer · ${cnt(lk, "Loading")} loading · ${cnt(lk, "Available")} free · ${cnt(lk, "Out of Service")} out of service</div>`;
  Object.entries(banks).forEach(([b, cells]) => {
    html += `<div class="bank"><div class="bank-h">${b}</div><div class="cells">${cells.map((g) => {
      const a = g.attributes;
      const tip = `${a.LOCKER_ID} · ${a.DEMO_STATUS}${a.DEMO_ORDER ? " · " + a.DEMO_ORDER : ""}${a.DEMO_WAIT_MIN ? " · " + a.DEMO_WAIT_MIN + " min" : ""}`;
      return `<button class="cell t-${tone(a.DEMO_STATUS)}${a.DEMO_WAIT_MIN >= 60 ? " late" : ""}" title="${tip}" data-id="${a.LOCKER_ID}">${a.SIZE}</button>`;
    }).join("")}</div></div>`;
  });
  const st = state.stalls.map((g) => g.attributes);
  const group = (type, label) => {
    const rows = st.filter((a) => a.STALL_TYPE === type).sort((x, y) => x.STALL_ID.localeCompare(y.STALL_ID));
    if (!rows.length) return "";
    return `<div class="section-title">${label}</div>` + rows.map((a) =>
      `<div class="row" data-stall="${a.STALL_ID}"><span><b>${a.STALL_ID}</b> <span class="muted">${a.DEMO_ORDER || ""}${a.DEMO_WAIT_MIN ? " · waiting " + a.DEMO_WAIT_MIN + " min" : ""}</span></span>${chip(a.DEMO_STATUS)}</div>`).join("");
  };
  html += group("Curbside Pickup Stall", "Curbside pickup") + group("Pro Load-Out Bay", "Pro load-out") + group("Truck Dock Stall", "Receiving docks");
  $("pickupContent").innerHTML = html;
  $("pickupContent").querySelectorAll(".cell").forEach((el) => el.addEventListener("click", () => {
    const g = state.lockers.find((x) => x.attributes.LOCKER_ID === el.dataset.id); if (g) goToFeature(g, L.lockers, 23);
  }));
  $("pickupContent").querySelectorAll(".row").forEach((el) => el.addEventListener("click", () => {
    const g = state.stalls.find((x) => x.attributes.STALL_ID === el.dataset.stall);
    if (g) { setFloor(view, floorFilterEl, null); view.goTo({ target: g.geometry, zoom: 21 }); view.openPopup({ location: g.geometry.centroid, fetchFeatures: true }); }
  }));
}

// -------------------------------------------------------------------------------------
// 9. Maintenance
// -------------------------------------------------------------------------------------
function renderMaint() {
  const f = state.eqFilter;
  const keep = (s) => f === "all" || (f === "issues" ? ["Down", "PM Due"].includes(s) : s === f);
  const byB = {};
  state.equip.forEach((g) => { if (keep(g.attributes.DEMO_STATUS)) (byB[g.attributes.FACILITY_ID] ||= []).push(g); });
  const list = $("eqList");
  list.innerHTML = "";
  Object.keys(byB).sort().forEach((fid) => {
    const grp = document.createElement("calcite-list-item-group");
    grp.heading = `${bname(fid)} (${byB[fid].length})`;
    byB[fid].sort((a, b) => a.attributes.NAME.localeCompare(b.attributes.NAME, undefined, { numeric: true })).forEach((g) => {
      const a = g.attributes;
      grp.appendChild(item(a.NAME, [a.ASSET_TYPE, a.DEMO_WORK_ORDER, a.DEMO_ISSUE].filter(Boolean).join(" · "), chip(a.DEMO_STATUS), () => goToFeature(g, L.equip)));
    });
    list.appendChild(grp);
  });
  if (!list.children.length) list.innerHTML = `<calcite-notice open kind="success" width="full"><div slot="message">Nothing matches this filter.</div></calcite-notice>`;
}
$("eqFilter").addEventListener("calciteSegmentedControlChange", (e) => { state.eqFilter = e.target.value; renderMaint(); });

// -------------------------------------------------------------------------------------
// 10. Refresh loop
// -------------------------------------------------------------------------------------
async function refresh() {
  try {
    await loadData();
    renderOverview(); renderFind(); renderPickup(); renderMaint();
  } catch (e) {
    showError("Could not load store data.", e);
  }
}
$("refreshBtn").addEventListener("click", refresh);
await refresh();
setInterval(refresh, CONFIG.refreshSeconds * 1000);

// -------------------------------------------------------------------------------------
// 11. Quick views
// -------------------------------------------------------------------------------------
try {
  const { initCameras } = await import("./cameras.js");
  const { cameraLayer, coverageLayer } = await initCameras({ view, layers: L, floorFilterEl });
  flayers.push(cameraLayer, coverageLayer);
} catch (e) {
  $("cameraSummary").textContent = "Cameras unavailable. Reload to retry.";
  showError("Security cameras failed to load.", e);
}

try {
  const { initForklift } = await import("./forklift.js");
  await initForklift({ view, layers: L });
} catch (e) {
  showError("The yard forklift simulation failed to load.", e);
}

try {
  const { initViews } = await import("./views.js");
  const initialFloor = floorFilterEl?.level || view.floors?.getItemAt(0) || null;
  const { reset } = await initViews({ view, flayers, floorFilterEl, initialViewpoint, initialFloor, listEl: $("viewList"), notesEl: $("viewNotes") });
  $("overviewHome").disabled = false;
  $("overviewHome").addEventListener("click", async () => {
    hl?.remove(); hl = null;
    try { await reset(); }
    catch (e) { showError("Could not restore the initial map view.", e); }
  });
} catch (e) {
  showError("Quick views failed to load.", e);
}
