const WKID = 26993;
const GUARD_ID = "SG-NIGHT-01";
const SPEED_MPH = 1.4;
const METRES_PER_SECOND_PER_MPH = 0.44704;
const HISTORY_HOURS = 12;
const SAMPLE_MINUTES = 0.5;

function distance(first, second) {
  return Math.hypot(second[0] - first[0], second[1] - first[1]);
}

function nearestPath(points, start) {
  const remaining = points.map((point) => point.slice());
  const path = [];
  let current = start || remaining.shift();
  if (!current) return path;
  path.push(current.slice());
  while (remaining.length) {
    let nearestIndex = 0;
    for (let index = 1; index < remaining.length; index++) {
      if (distance(current, remaining[index]) < distance(current, remaining[nearestIndex])) nearestIndex = index;
    }
    current = remaining.splice(nearestIndex, 1)[0];
    path.push(current);
  }
  return path;
}

function sampleLine(points, spacing = 18) {
  if (points.length < 2) return points.map((point) => point.slice());
  const sampled = [points[0].slice()];
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1];
    const end = points[index];
    const length = distance(start, end);
    const steps = Math.max(1, Math.ceil(length / spacing));
    for (let step = 1; step <= steps; step++) {
      const fraction = step / steps;
      sampled.push([start[0] + (end[0] - start[0]) * fraction, start[1] + (end[1] - start[1]) * fraction]);
    }
  }
  return sampled;
}

function zoneSweep(zone, Point, containsOperator, spacing = 28) {
  const extent = zone.extent;
  const points = [];
  let row = 0;
  for (let y = extent.ymin + spacing / 2; y < extent.ymax; y += spacing, row++) {
    const current = [];
    for (let x = extent.xmin + spacing / 2; x < extent.xmax; x += spacing) {
      const point = new Point({ x, y, spatialReference: { wkid: WKID } });
      if (containsOperator.execute(zone, point)) current.push([x, y]);
    }
    if (row % 2) current.reverse();
    points.push(...current);
  }
  return points;
}

function assembleRoute(sections) {
  const pending = sections.map((section) => section.filter((point, index) => !index || distance(point, section[index - 1]) > 0.5)).filter((section) => section.length);
  if (!pending.length) throw new Error("The overnight guard route has no patrol points.");
  let path = pending.shift();
  while (pending.length) {
    const end = path[path.length - 1];
    let nearest = { index: 0, reverse: false, distance: Infinity };
    pending.forEach((section, index) => {
      const startDistance = distance(end, section[0]);
      const endDistance = distance(end, section[section.length - 1]);
      if (startDistance < nearest.distance) nearest = { index, reverse: false, distance: startDistance };
      if (endDistance < nearest.distance) nearest = { index, reverse: true, distance: endDistance };
    });
    const section = pending.splice(nearest.index, 1)[0];
    if (nearest.reverse) section.reverse();
    path.push(...section.slice(distance(end, section[0]) < 0.5 ? 1 : 0));
  }
  if (distance(path[0], path[path.length - 1]) > 0.5) path.push(path[0].slice());
  return path;
}

export function createOvernightRoute({ facilities, units, lanes, zones, Point, containsOperator }) {
  const entrance = units.find((feature) => /entrance/i.test(feature.attributes.NAME || ""));
  const unitPoints = units.map((feature) => [feature.geometry.extent.center.x, feature.geometry.extent.center.y]);
  const sections = [nearestPath(unitPoints, entrance && [entrance.geometry.extent.center.x, entrance.geometry.extent.center.y])];
  for (const feature of facilities) {
    const outerRing = feature.geometry.rings?.[0];
    if (outerRing?.length > 2) sections.push(sampleLine(outerRing, 18));
  }
  for (const feature of lanes) {
    for (const path of feature.geometry.paths || []) sections.push(sampleLine(path, 18));
  }
  for (const feature of zones) sections.push(zoneSweep(feature.geometry, Point, containsOperator));
  return assembleRoute(sections);
}

function createRouteMeasure(points) {
  const segments = [];
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1];
    const end = points[index];
    const segmentLength = distance(start, end);
    if (segmentLength < 0.01) continue;
    segments.push({ start, end, length: segmentLength, offset: length });
    length += segmentLength;
  }
  if (!length) throw new Error("The overnight guard route has no length.");
  return { segments, length };
}

export function pointAlongRoute(route, distanceAlong) {
  const measured = typeof route.length === "number" ? route : createRouteMeasure(route);
  const wrapped = ((distanceAlong % measured.length) + measured.length) % measured.length;
  const segment = measured.segments.find((candidate) => wrapped <= candidate.offset + candidate.length) || measured.segments.at(-1);
  const fraction = Math.max(0, Math.min(1, (wrapped - segment.offset) / segment.length));
  return {
    x: segment.start[0] + (segment.end[0] - segment.start[0]) * fraction,
    y: segment.start[1] + (segment.end[1] - segment.start[1]) * fraction
  };
}

export function overnightPositionAtAge({ ageMinutes, storeRoute, parkingRoute, yardRoute, canopyRoute, warehouseGateRoute, propertyRoute, restroomPoint }) {
  const restroomStops = [[150, 180], [330, 360], [570, 615]];
  if (restroomStops.some(([start, end]) => ageMinutes >= start && ageMinutes < end)) return { x: restroomPoint[0], y: restroomPoint[1], restroomStop: true };
  if (ageMinutes <= 120) return { ...pointAlongRoute(storeRoute, (120 - ageMinutes) * 60 * SPEED_MPH * METRES_PER_SECOND_PER_MPH), restroomStop: false };
  if (ageMinutes <= 240) return { ...pointAlongRoute(parkingRoute, (ageMinutes - 120) * 60 * SPEED_MPH * METRES_PER_SECOND_PER_MPH), restroomStop: false };
  if (ageMinutes <= 480) return { ...pointAlongRoute(yardRoute, (ageMinutes - 240) * 60 * SPEED_MPH * METRES_PER_SECOND_PER_MPH), restroomStop: false };
  if (ageMinutes <= 540) return { ...pointAlongRoute(canopyRoute, (ageMinutes - 480) * 60 * SPEED_MPH * METRES_PER_SECOND_PER_MPH), restroomStop: false };
  if (ageMinutes <= 600) return { ...pointAlongRoute(warehouseGateRoute, (ageMinutes - 540) * 60 * SPEED_MPH * METRES_PER_SECOND_PER_MPH), restroomStop: false };
  return { ...pointAlongRoute(propertyRoute, (ageMinutes - 600) * 60 * SPEED_MPH * METRES_PER_SECOND_PER_MPH), restroomStop: false };
}

export async function initOvernightPatrol({ view, layers }) {
  const [FeatureLayer, GraphicsLayer, Graphic, Point, containsOperator] = await $arcgis.import([
    "@arcgis/core/layers/FeatureLayer.js", "@arcgis/core/layers/GraphicsLayer.js", "@arcgis/core/Graphic.js",
    "@arcgis/core/geometry/Point.js", "@arcgis/core/geometry/operators/containsOperator.js"
  ]);
  async function query(layer, condition) {
    if (!layer) throw new Error("The overnight guard needs the store and yard layers.");
    const parameters = layer.createQuery();
    parameters.where = `(${parameters.where || "1=1"}) AND (${condition})`;
    parameters.outFields = ["*"];
    parameters.returnGeometry = true;
    parameters.outSpatialReference = { wkid: WKID };
    return (await layer.queryFeatures(parameters)).features;
  }
  const [facilities, units, lanes, zones] = await Promise.all([
    query(layers.facilities, "FACILITY_ID IN ('NHY.B1','NHY.B2','NHY.B3','NHY.B4','NHY.B5')"),
    query(layers.units, "LEVEL_ID IN ('NHY.B1.L1','NHY.B1.L2')"),
    query(layers.lanes, "DIRECTION IN ('One-way N','One-way S','Two-way')"),
    query(layers.zones, "ZONE_TYPE IN ('Site','Parking','Lumber Yard','Truck Court')")
  ]);
  const measure = (route) => createRouteMeasure(route);
  const unitPoints = units
    .filter((feature) => feature.attributes.LEVEL_ID?.startsWith("NHY.B1."))
    .map((feature) => [feature.geometry.extent.center.x, feature.geometry.extent.center.y]);
  const entrance = units.find((feature) => feature.attributes.LEVEL_ID === "NHY.B1.L1" && /entrance/i.test(feature.attributes.NAME || ""));
  const entrancePoint = entrance && [entrance.geometry.extent.center.x, entrance.geometry.extent.center.y];
  const storeRoute = measure(assembleRoute([nearestPath(unitPoints, entrancePoint)]));
  const parkingZone = zones.find((feature) => feature.attributes.ZONE_TYPE === "Parking");
  const lumberZone = zones.find((feature) => feature.attributes.ZONE_TYPE === "Lumber Yard");
  const parkingRoute = measure(assembleRoute([[...(entrancePoint ? [entrancePoint] : [])], zoneSweep(parkingZone.geometry, Point, containsOperator)]));
  const yardSections = lanes.filter((feature) => feature.attributes.DIRECTION === "One-way N" || feature.attributes.DIRECTION === "One-way S")
    .flatMap((feature) => feature.geometry.paths.map((path) => sampleLine(path, 18)));
  yardSections.push(zoneSweep(lumberZone.geometry, Point, containsOperator));
  const yardRoute = measure(assembleRoute(yardSections));
  const patrolRoute = measure(createOvernightRoute({ facilities, units, lanes, zones, Point, containsOperator }));
  const siteZone = zones.find((feature) => feature.attributes.ZONE_TYPE === "Site");
  const coverageSections = [zoneSweep(siteZone.geometry, Point, containsOperator, 20)];
  for (const facility of facilities) {
    coverageSections.push(zoneSweep(facility.geometry, Point, containsOperator, 12));
    for (const ring of facility.geometry.rings || []) coverageSections.push(sampleLine(ring, 10));
  }
  const propertyRoute = measure(assembleRoute(coverageSections));
  const facilityRoute = (ids) => measure(assembleRoute(facilities.filter((feature) => ids.includes(feature.attributes.FACILITY_ID)).flatMap((feature) => [
    zoneSweep(feature.geometry, Point, containsOperator, 8),
    ...(feature.geometry.rings || []).map((ring) => sampleLine(ring, 8))
  ])));
  const canopyRoute = facilityRoute(["NHY.B5"]);
  const warehouseGateRoute = facilityRoute(["NHY.B3", "NHY.B4"]);
  const restroom = units.find((feature) => feature.attributes.LEVEL_ID === "NHY.B1.L1" && feature.attributes.NAME === "Restroom - Men (Staff)")
    || units.find((feature) => feature.attributes.LEVEL_ID === "NHY.B1.L1" && feature.attributes.USE_TYPE === "Restroom");
  if (!parkingZone || !lumberZone || !restroom) throw new Error("The overnight route needs parking, lumber yard and staff restroom features.");
  const restroomPoint = [restroom.geometry.extent.center.x, restroom.geometry.extent.center.y];
  const metresPerSecond = SPEED_MPH * METRES_PER_SECOND_PER_MPH;
  const heatGraphics = [];
  const lastSample = HISTORY_HOURS * 60;
  for (let minuteAgo = lastSample, objectId = 1; minuteAgo >= 0; minuteAgo -= SAMPLE_MINUTES, objectId++) {
    const position = overnightPositionAtAge({ ageMinutes: minuteAgo, storeRoute, parkingRoute, yardRoute, canopyRoute, warehouseGateRoute, propertyRoute, restroomPoint });
    heatGraphics.push(new Graphic({
      geometry: new Point({ ...position, spatialReference: { wkid: WKID } }),
      attributes: { OBJECTID: objectId, GUARD_ID, HOURS_AGO: minuteAgo / 60, RESTROOM_STOP: position.restroomStop ? 1 : 0, HEAT_WEIGHT: position.restroomStop ? 1.5 : 3 }
    }));
  }
  const heatLayer = new FeatureLayer({
    id: "overnight-heat",
    title: "Overnight guard heatmap (simulated)",
    source: heatGraphics,
    objectIdField: "OBJECTID",
    geometryType: "point",
    spatialReference: { wkid: WKID },
    fields: [
      { name: "OBJECTID", type: "oid" },
      { name: "GUARD_ID", type: "string" },
      { name: "HOURS_AGO", type: "double" },
      { name: "RESTROOM_STOP", type: "integer" },
      { name: "HEAT_WEIGHT", type: "double" }
    ],
    renderer: {
      type: "heatmap",
      field: "HEAT_WEIGHT",
      radius: 24,
      minDensity: 0,
      maxDensity: 0.09,
      colorStops: [
        { ratio: 0, color: [20, 118, 128, 0] },
        { ratio: 0.2, color: [20, 118, 128, 190] },
        { ratio: 0.55, color: [237, 191, 74, 220] },
        { ratio: 1, color: [204, 65, 53, 235] }
      ],
      legendOptions: { title: "Guard patrol activity" }
    },
    popupEnabled: false,
    visible: false
  });
  const shield = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path fill="#163d55" stroke="white" stroke-width="2" d="M16 2 28 7v9c0 6-5 11-12 14C9 27 4 22 4 16V7z"/><path fill="white" d="m16 7 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4-3.9-3.8 5.4-.8z"/></svg>';
  const markerSymbol = { type: "picture-marker", url: `data:image/svg+xml,${encodeURIComponent(shield)}`, width: 22, height: 22 };
  const guardLayer = new GraphicsLayer({ id: "overnight-guard", title: "Overnight security guard (simulated)", visible: false, popupEnabled: true });
  const guardGraphic = new Graphic({
    geometry: new Point({ ...pointAlongRoute(patrolRoute, 0), spatialReference: { wkid: WKID } }),
    symbol: markerSymbol,
    attributes: { GUARD_ID, SPEED_MPH, DEMO_STATUS: "Patrolling" },
    popupTemplate: { title: `Security guard ${GUARD_ID}`, content: `<p>Simulated overnight patrol</p><p><strong>Patrol speed:</strong> ${SPEED_MPH.toFixed(1)} mph</p>` }
  });
  guardLayer.add(guardGraphic);
  view.map.addMany([heatLayer, guardLayer]);
  let elapsed = 0;
  let previous = performance.now();
  function update(now) {
    const delta = Math.max(0, Math.min(0.5, (now - previous) / 1000));
    previous = now;
    if (!document.hidden && guardLayer.visible && !view.suspended) elapsed += delta;
    const geometry = new Point({ ...pointAlongRoute(patrolRoute, elapsed * metresPerSecond), spatialReference: { wkid: WKID } });
    guardGraphic.geometry = geometry;
    guardGraphic.attributes = { ...guardGraphic.attributes, HOURS_ON_PATROL: elapsed / 3600 };
    if (view.popup?.visible && view.popup.selectedFeature === guardGraphic) view.popup.location = geometry;
  }
  update(previous);
  const timer = setInterval(() => update(performance.now()), 200);
  window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
  return { guardLayer, heatLayer, guardGraphic, route: patrolRoute, restroomPoint, heatPointCount: heatGraphics.length };
}