import { setFloor } from "./layers.js";

export const CAMERA_LAYOUT = [
  { id: "CAM-01", name: "Front entrance", facility: "NHY.B1", level: "NHY.B1.L1", position: [0.88, 0.15], heading: 300 },
  { id: "CAM-02", name: "Checkout lanes", facility: "NHY.B1", level: "NHY.B1.L1", position: [0.85, 0.42], heading: 270 },
  { id: "CAM-03", name: "Order pickup", facility: "NHY.B1", level: "NHY.B1.L1", position: [0.85, 0.75], heading: 235 },
  { id: "CAM-04", name: "Tools & hardware", facility: "NHY.B1", level: "NHY.B1.L1", position: [0.18, 0.18], heading: 45 },
  { id: "CAM-05", name: "Paint aisles", facility: "NHY.B1", level: "NHY.B1.L1", position: [0.45, 0.22], heading: 0 },
  { id: "CAM-06", name: "Plumbing aisles", facility: "NHY.B1", level: "NHY.B1.L1", position: [0.18, 0.78], heading: 135 },
  { id: "CAM-07", name: "Overstock racks", facility: "NHY.B1", level: "NHY.B1.L2", position: [0.22, 0.25], heading: 45 },
  { id: "CAM-08", name: "Back office corridor", facility: "NHY.B1", level: "NHY.B1.L2", position: [0.78, 0.78], heading: 225 },
  { id: "CAM-09", name: "Entrance apron", facility: "NHY.B1", position: [1.03, 0.18], heading: 90 },
  { id: "CAM-10", name: "Curbside pickup", facility: "NHY.B1", position: [1.03, 0.72], heading: 90 },
  { id: "CAM-11", name: "Lumber drive-thru entrance", facility: "NHY.B2", position: [0.15, 0.2], heading: 0 },
  { id: "CAM-12", name: "Lumber load-out", facility: "NHY.B2", position: [0.85, 0.8], heading: 180 },
  { id: "CAM-13", name: "Warehouse yard", facility: "NHY.B3", position: [1.03, 0.5], heading: 90 }
].map((camera) => ({ ...camera, range: camera.level ? 24 : 40, fov: camera.level ? 65 : 80 }));

export function coverageRing(point, heading, range, fov) {
  const ring = [[point.x, point.y]];
  for (let step = 0; step <= 32; step++) {
    const angle = (heading - fov / 2 + fov * step / 32) * Math.PI / 180;
    ring.push([point.x + Math.sin(angle) * range, point.y + Math.cos(angle) * range]);
  }
  ring.push([point.x, point.y]);
  return ring;
}

export const CAMERA_MEDIA = {
  indoor: { url: "https://videos.pexels.com/video-files/4294436/4294436-uhd_2560_1440_25fps.mp4", credit: "https://www.pexels.com/video/a-footage-inside-the-warehouse-4294436/", poster: "https://images.pexels.com/videos/4294436/pexels-photo-4294436.jpeg" },
  yard: { url: "https://videos.pexels.com/video-files/31025267/13261503_2560_1440_24fps.mp4", credit: "https://www.pexels.com/video/aerial-drone-view-of-lumber-storage-yard-31025267/", poster: "https://images.pexels.com/videos/31025267/pexels-photo-31025267.jpeg" }
};

export async function initCameras({ view, layers, floorFilterEl }) {
  const [FeatureLayer, Graphic, Point, Polygon, containsOperator, intersectionOperator] = await $arcgis.import([
    "@arcgis/core/layers/FeatureLayer.js", "@arcgis/core/Graphic.js",
    "@arcgis/core/geometry/Point.js", "@arcgis/core/geometry/Polygon.js",
    "@arcgis/core/geometry/operators/containsOperator.js",
    "@arcgis/core/geometry/operators/intersectionOperator.js"
  ]);
  const element = (id) => document.getElementById(id);
  if (!layers.facilities) throw new Error("Camera placement needs the Facilities layer.");
  const query = layers.facilities.createQuery();
  query.where = `(${query.where || "1=1"}) AND FACILITY_ID IN ('NHY.B1','NHY.B2','NHY.B3')`;
  query.outFields = ["FACILITY_ID"];
  query.returnGeometry = true;
  query.outSpatialReference = { wkid: 26993 };
  const result = await layers.facilities.queryFeatures(query);
  const footprints = new Map(result.features.map((feature) => [feature.attributes.FACILITY_ID, feature.geometry]));
  const cameras = CAMERA_LAYOUT.map((camera, index) => {
    const footprint = footprints.get(camera.facility);
    if (!footprint) throw new Error(`Missing footprint for ${camera.facility}.`);
    const extent = footprint.extent;
    let point = new Point({ x: extent.xmin + extent.width * camera.position[0], y: extent.ymin + extent.height * camera.position[1], spatialReference: extent.spatialReference });
    if (camera.level && !containsOperator.execute(footprint, point)) {
      const candidates = [];
      for (let column = 1; column < 20; column++) {
        for (let row = 1; row < 20; row++) {
          const candidate = new Point({ x: extent.xmin + extent.width * column / 20, y: extent.ymin + extent.height * row / 20, spatialReference: extent.spatialReference });
          if (containsOperator.execute(footprint, candidate)) candidates.push(candidate);
        }
      }
      candidates.sort((first, second) => Math.hypot(first.x - point.x, first.y - point.y) - Math.hypot(second.x - point.x, second.y - point.y));
      if (!candidates.length) throw new Error(`No indoor camera position found for ${camera.id}.`);
      point = candidates[0];
    }
    const wedge = new Polygon({ rings: [coverageRing(point, camera.heading, camera.range, camera.fov)], spatialReference: point.spatialReference });
    const coverage = camera.level ? intersectionOperator.execute(wedge, footprint) : wedge;
    if (!coverage) throw new Error(`No coverage area found for ${camera.id}.`);
    const attributes = { OBJECTID: index + 1, CAMERA_ID: camera.id, NAME: camera.name, LEVEL_ID: camera.level || null };
    return { ...camera, point, coverage, attributes };
  });
  const fields = [{ name: "OBJECTID", type: "oid" }, ...["CAMERA_ID", "NAME", "LEVEL_ID"].map((name) => ({ name, type: "string" }))];
  const common = { fields, objectIdField: "OBJECTID", spatialReference: { wkid: 26993 }, floorInfo: { levelField: "LEVEL_ID" }, popupEnabled: false, outFields: ["*"], visible: false };
  const coverageLayer = new FeatureLayer({ ...common, title: "Camera fields of view (illustrative)", geometryType: "polygon",
    source: cameras.map((camera) => new Graphic({ geometry: camera.coverage, attributes: camera.attributes })),
    renderer: { type: "simple", symbol: { type: "simple-fill", color: [46, 125, 79, 0.16], outline: null } }
  });
  const cameraLayer = new FeatureLayer({ ...common, title: "Demo security cameras", geometryType: "point",
    source: cameras.map((camera) => new Graphic({ geometry: camera.point, attributes: camera.attributes })),
    renderer: { type: "simple", symbol: { type: "picture-marker", url: "https://cdn.jsdelivr.net/npm/lucide-static@0.468.0/icons/cctv.svg", width: 10, height: 10 } },
    labelingInfo: [{ labelExpressionInfo: { expression: "$feature.CAMERA_ID" }, symbol: { type: "text", color: "#163d28", haloColor: "white", haloSize: 1.5, font: { size: 9, weight: "bold" } }, labelPlacement: "above-center" }]
  });
  await Promise.all([coverageLayer.load(), cameraLayer.load()]);
  view.map.addMany([coverageLayer, cameraLayer]);
  const video = element("cameraVideo");
  const dialog = element("cameraDialog");
  let selected = null;
  let clock = null;
  let focusReturn = null;
  const setStatus = (message) => { element("cameraFeedStatus").textContent = message; };
  const tick = () => { element("cameraClock").textContent = new Date().toLocaleString("en-US", { timeZone: "America/Chicago", timeZoneName: "short" }); };
  const stop = () => {
    clearInterval(clock);
    clock = null;
    video.pause();
    video.removeAttribute("src");
    video.load();
    focusReturn?.focus();
  };
  async function openCamera(camera, navigate = true) {
    selected = camera;
    if (!dialog.open) focusReturn = document.activeElement;
    view.closePopup();
    cameraLayer.visible = true;
    coverageLayer.visible = element("cameraCoverage").checked;
    setFloor(view, floorFilterEl, camera.level || null);
    element("cameraTitle").textContent = `${camera.id} | ${camera.name}`;
    element("cameraLocation").textContent = `${camera.level ? (camera.level.endsWith("L2") ? "Main Store - Level 2" : "Main Store - Level 1") : "Exterior / lumber yard"} | ${camera.fov} degree FOV | ${Math.round(camera.range * 3.28084)} ft range`;
    element("cameraOsd").textContent = `NHY MIDWAY / ${camera.id}`;
    const media = CAMERA_MEDIA[camera.level ? "indoor" : "yard"];
    element("cameraCredit").href = media.credit;
    video.muted = true;
    video.poster = media.poster;
    video.src = media.url;
    video.load();
    setStatus("Connecting to demo playback...");
    if (!dialog.open) dialog.showModal();
    clearInterval(clock);
    tick();
    clock = setInterval(tick, 1000);
    video.play().catch(() => { if (dialog.open && video.hasAttribute("src")) setStatus("Playback paused. Use the video play control."); });
    if (navigate) {
      try { await view.goTo(camera.coverage.extent.clone().expand(2), { duration: 700 }); }
      catch (error) { if (error.name !== "AbortError") console.warn("[cameras] navigation", error); }
    }
  }
  video.addEventListener("playing", () => setStatus("Simulated live | prerecorded stock footage"));
  video.addEventListener("waiting", () => setStatus("Buffering demo footage..."));
  video.addEventListener("error", () => { if (video.hasAttribute("src")) setStatus("Demo footage unavailable. Check your connection, then retry."); });
  video.addEventListener("pause", () => { if (dialog.open && !video.error) setStatus("Demo playback paused"); });
  element("cameraClose").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { if (!dialog.open) stop(); });
  element("cameraRetry").addEventListener("click", () => { if (selected) openCamera(selected, false); });
  element("cameraCoverage").addEventListener("calciteCheckboxChange", (event) => { coverageLayer.visible = event.target.checked; });
  const list = element("cameraList");
  for (const indoor of [true, false]) {
    const group = document.createElement("calcite-list-item-group");
    group.heading = indoor ? "Main Store (8)" : "Exterior & lumber yard (5)";
    cameras.filter((camera) => Boolean(camera.level) === indoor).forEach((camera) => {
      const row = document.createElement("calcite-list-item");
      row.label = `${camera.id} | ${camera.name}`;
      row.description = camera.level ? (camera.level.endsWith("L2") ? "Level 2" : "Level 1") : "Exterior / yard";
      const icon = document.createElement("calcite-icon");
      icon.icon = "video"; icon.slot = "content-start"; icon.scale = "s";
      row.appendChild(icon);
      row.addEventListener("click", () => openCamera(camera));
      group.appendChild(row);
    });
    list.appendChild(group);
  }
  view.on("click", async (event) => {
    try {
      const hit = await view.hitTest(event, { include: [cameraLayer] });
      const cameraHit = hit.results.find((entry) => entry.type === "graphic");
      const camera = cameras.find((entry) => entry.id === cameraHit?.graphic.attributes.CAMERA_ID);
      if (camera) await openCamera(camera, false);
    } catch (error) { console.warn("[cameras] selection", error); }
  });
  element("cameraSummary").textContent = "13 cameras | 8 indoor / 5 exterior";
  return { cameraLayer, coverageLayer };
}