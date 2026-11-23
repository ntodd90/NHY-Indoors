const WKID = 26993;
const METRES_PER_SECOND_PER_MPH = 0.44704;
const GUARDS = [
  { id: "SG-01", post: "Lumber yard drive-thru", speed: 1.2, battery: 87, anchor: [0.35, 0.55] },
  { id: "SG-02", post: "Main store / Level 2 overstock", level: "NHY.B1.L2", speed: 1.5, battery: 63, anchor: [0.22, 0.25] },
  { id: "SG-03", post: "Main store / Level 1 front entrance", level: "NHY.B1.L1", speed: 1.8, battery: 42, anchor: [0.88, 0.15] }
];

const badge = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path fill="#163d55" stroke="white" stroke-width="2" d="M16 2 28 7v9c0 6-5 11-12 14C9 27 4 22 4 16V7z"/><path fill="white" d="m16 7 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4-3.9-3.8 5.4-.8z"/></svg>';
const symbol = { type: "picture-marker", url: `data:image/svg+xml,${encodeURIComponent(badge)}`, width: 22, height: 22 };

export function guardPosition(route, speedMph, elapsedSeconds) {
  const { x, y, halfWidth, halfHeight } = route;
  const width = 2 * halfWidth;
  const height = 2 * halfHeight;
  let distance = elapsedSeconds * speedMph * METRES_PER_SECOND_PER_MPH % (2 * (width + height));
  if (distance < width) return { x: x - halfWidth + distance, y: y - halfHeight };
  distance -= width;
  if (distance < height) return { x: x + halfWidth, y: y - halfHeight + distance };
  distance -= height;
  if (distance < width) return { x: x + halfWidth - distance, y: y + halfHeight };
  return { x: x - halfWidth, y: y + halfHeight - (distance - width) };
}

function findRoute(areas, footprint, anchor, Polygon, containsOperator) {
  const { extent } = footprint;
  const targetX = extent.xmin + extent.width * anchor[0];
  const targetY = extent.ymin + extent.height * anchor[1];
  let closest;
  let bestDistance = Infinity;
  for (const area of areas) {
    const bounds = area.extent;
    for (const [halfWidth, halfHeight] of [[5, 2], [2, 1]]) {
      if (bounds.width <= 2 * halfWidth || bounds.height <= 2 * halfHeight) continue;
      const xs = [targetX, bounds.center.x, bounds.xmin + bounds.width / 4, bounds.xmax - bounds.width / 4];
      const ys = [targetY, bounds.center.y, bounds.ymin + bounds.height / 4, bounds.ymax - bounds.height / 4];
      for (const sampleX of xs) {
        for (const sampleY of ys) {
          const x = Math.max(bounds.xmin + halfWidth, Math.min(bounds.xmax - halfWidth, sampleX));
          const y = Math.max(bounds.ymin + halfHeight, Math.min(bounds.ymax - halfHeight, sampleY));
          const distance = Math.hypot(x - targetX, y - targetY);
          if (distance >= bestDistance) continue;
          const ring = [[x - halfWidth, y - halfHeight], [x - halfWidth, y + halfHeight], [x + halfWidth, y + halfHeight], [x + halfWidth, y - halfHeight], [x - halfWidth, y - halfHeight]];
          const rectangle = new Polygon({ rings: [ring], spatialReference: { wkid: WKID } });
          if (containsOperator.execute(area, rectangle)) {
            closest = { x, y, halfWidth, halfHeight };
            bestDistance = distance;
          }
        }
      }
    }
  }
  return closest;
}

export async function initGuards({ view, layers }) {
  const [GraphicsLayer, Graphic, Point, Polygon, containsOperator] = await $arcgis.import([
    "@arcgis/core/layers/GraphicsLayer.js", "@arcgis/core/Graphic.js", "@arcgis/core/geometry/Point.js",
    "@arcgis/core/geometry/Polygon.js", "@arcgis/core/geometry/operators/containsOperator.js"
  ]);
  async function queryAreas(layer, field, ids) {
    const query = layer.createQuery();
    query.where = `(${query.where || "1=1"}) AND ${field} IN (${ids.map((id) => `'${id}'`).join(",")})`;
    query.outFields = [field];
    query.returnGeometry = true;
    query.outSpatialReference = { wkid: WKID };
    return (await layer.queryFeatures(query)).features;
  }
  const [facilities, units] = await Promise.all([
    queryAreas(layers.facilities, "FACILITY_ID", ["NHY.B1", "NHY.B2"]),
    queryAreas(layers.units, "LEVEL_ID", GUARDS.filter((guard) => guard.level).map((guard) => guard.level))
  ]);
  const layer = new GraphicsLayer({ id: "security-guards", title: "Security guards (simulated)", visible: false, popupEnabled: true });
  const patrols = GUARDS.map((guard) => {
    const facilityId = guard.level ? "NHY.B1" : "NHY.B2";
    const footprint = facilities.find((feature) => feature.attributes.FACILITY_ID === facilityId)?.geometry;
    if (!footprint) throw new Error(`Missing patrol footprint for ${guard.post}.`);
    const areas = guard.level ? units.filter((unit) => unit.attributes.LEVEL_ID === guard.level).map((unit) => unit.geometry).filter(Boolean) : [footprint];
    const route = findRoute(areas, footprint, guard.anchor, Polygon, containsOperator);
    if (!route) throw new Error(`No patrol area found for ${guard.post}.`);
    const graphic = new Graphic({
      symbol,
      attributes: { GUARD_ID: guard.id, LEVEL_ID: guard.level || null, BATTERY_PCT: guard.battery, SPEED_MPH: guard.speed },
      popupTemplate: {
        title: `Security guard ${guard.id}`,
        content: `<p>${guard.post}</p><p><strong>Device battery:</strong> ${guard.battery}%<br><strong>Patrol speed:</strong> ${guard.speed.toFixed(1)} mph</p><p>Simulated patrol</p>`
      }
    });
    return { guard, route, graphic };
  });
  layer.addMany(patrols.map(({ graphic }) => graphic));
  view.map.add(layer);
  const started = performance.now();
  function update(now) {
    const elapsed = (now - started) / 1000;
    const floors = view.floors;
    for (const { guard, route, graphic } of patrols) {
      graphic.visible = !guard.level || !floors?.length || floors.includes(guard.level);
      if (elapsed && (!layer.visible || !graphic.visible || document.hidden || view.suspended)) continue;
      const geometry = new Point({ ...guardPosition(route, guard.speed, elapsed), spatialReference: { wkid: WKID } });
      graphic.geometry = geometry;
      if (view.popup?.visible && view.popup.selectedFeature === graphic) view.popup.location = geometry;
    }
  }
  update(started);
  const timer = setInterval(() => update(performance.now()), 100);
  window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
  return layer;
}