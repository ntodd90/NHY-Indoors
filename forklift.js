export function createPatrol(coordinates, gates = []) {
  if (coordinates.length < 2) throw new Error("The forklift needs a yard route.");
  const points = coordinates.map((coordinate) => coordinate.slice(0, 2));
  if (Math.hypot(points[0][0] - points[points.length - 1][0], points[0][1] - points[points.length - 1][1]) > 0.01) points.push(points[0].slice());
  const segments = [];
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1];
    const end = points[index];
    const distance = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (distance < 0.01) continue;
    segments.push({ start, end, distance, offset: length });
    length += distance;
  }
  if (!length) throw new Error("The forklift route has no length.");
  const stops = [0];
  for (let distance = 35; distance < length; distance += 35) stops.push(distance);
  for (const gate of gates) {
    let nearest = null;
    for (const segment of segments) {
      const deltaX = segment.end[0] - segment.start[0];
      const deltaY = segment.end[1] - segment.start[1];
      const fraction = Math.max(0, Math.min(1, ((gate[0] - segment.start[0]) * deltaX + (gate[1] - segment.start[1]) * deltaY) / segment.distance ** 2));
      const separation = Math.hypot(segment.start[0] + deltaX * fraction - gate[0], segment.start[1] + deltaY * fraction - gate[1]);
      if (!nearest || separation < nearest.separation) nearest = { separation, offset: segment.offset + fraction * segment.distance };
    }
    if (nearest.separation > 2) throw new Error("The yard route does not pass through a mapped gate.");
    stops.push(nearest.offset);
  }
  stops.push(length);
  const orderedStops = stops.sort((first, second) => first - second).filter((distance, index, sorted) => !index || distance - sorted[index - 1] > 0.1);
  const timeline = [];
  let duration = 0;
  orderedStops.forEach((distance, index) => {
    if (index) {
      const previous = orderedStops[index - 1];
      const seconds = (distance - previous) / 1.1;
      timeline.push({ start: duration, duration: seconds, from: previous, to: distance, speed: 1.1 });
      duration += seconds;
    }
    const seconds = index === 0 ? 8 : 10 + index % 3 * 4;
    timeline.push({ start: duration, duration: seconds, from: distance, to: distance, speed: 0 });
    duration += seconds;
  });
  return { segments, timeline, length, duration };
}

export function patrolAt(patrol, elapsed) {
  const time = Math.max(0, elapsed) % patrol.duration;
  const phase = patrol.timeline.find((entry) => time < entry.start + entry.duration) || patrol.timeline[patrol.timeline.length - 1];
  const distance = phase.from + (phase.to - phase.from) * (time - phase.start) / phase.duration;
  const segment = patrol.segments.find((entry) => distance < entry.offset + entry.distance) || patrol.segments[patrol.segments.length - 1];
  const fraction = Math.max(0, Math.min(1, (distance - segment.offset) / segment.distance));
  return {
    x: segment.start[0] + (segment.end[0] - segment.start[0]) * fraction,
    y: segment.start[1] + (segment.end[1] - segment.start[1]) * fraction,
    heading: (Math.atan2(segment.end[0] - segment.start[0], segment.end[1] - segment.start[1]) * 180 / Math.PI + 360) % 360,
    speed: phase.speed
  };
}

export async function initForklift({ view, layers }) {
  const [GraphicsLayer, Graphic, Point] = await $arcgis.import([
    "@arcgis/core/layers/GraphicsLayer.js",
    "@arcgis/core/Graphic.js",
    "@arcgis/core/geometry/Point.js"
  ]);
  if (!layers.lanes || !layers.gates) throw new Error("The forklift needs the yard lanes and gates.");
  async function queryFeatures(layer, condition) {
    const query = layer.createQuery();
    query.where = `(${query.where || "1=1"}) AND (${condition})`;
    query.outFields = ["*"];
    query.returnGeometry = true;
    query.outSpatialReference = { wkid: 26993 };
    return (await layer.queryFeatures(query)).features;
  }
  const [lanes, gates] = await Promise.all([
    queryFeatures(layers.lanes, "DIRECTION IN ('One-way N','One-way S')"),
    queryFeatures(layers.gates, "LANE_DIR IN ('In','Out')")
  ]);
  const inbound = lanes.find((feature) => feature.attributes.DIRECTION === "One-way N");
  const outbound = lanes.find((feature) => feature.attributes.DIRECTION === "One-way S");
  if (!inbound || !outbound || gates.length < 2) throw new Error("The forklift needs both drive-thru routes and entry/exit gates.");
  if (inbound.geometry.paths.length !== 1 || outbound.geometry.paths.length !== 1) throw new Error("The forklift route must use continuous yard lanes.");
  const coordinates = [...inbound.geometry.paths[0], ...outbound.geometry.paths[0]];
  const entry = gates.find((feature) => feature.attributes.LANE_DIR === "In");
  const entryIndex = entry ? coordinates.findIndex((coordinate) => Math.hypot(coordinate[0] - entry.geometry.x, coordinate[1] - entry.geometry.y) < 1) : -1;
  const route = entryIndex >= 0 ? [...coordinates.slice(entryIndex), ...coordinates.slice(0, entryIndex)] : coordinates;
  const patrol = createPatrol(route, gates.map((feature) => [feature.geometry.x, feature.geometry.y]));
  const panel = document.createElement("div");
  panel.className = "forklift-popup";
  panel.style.minWidth = "180px";
  const notice = document.createElement("p");
  notice.className = "muted";
  notice.style.cssText = "color: #526058; font-size: 12px;";
  notice.textContent = "Simulated yard telemetry";
  panel.appendChild(notice);
  const batteryLabel = document.createElement("label");
  batteryLabel.className = "forklift-battery-label";
  batteryLabel.style.display = "block";
  batteryLabel.append("Battery charge ");
  const batteryText = document.createElement("strong");
  batteryText.style.cssFloat = "right";
  batteryLabel.appendChild(batteryText);
  const meter = document.createElement("meter");
  meter.className = "forklift-battery";
  meter.style.cssText = "display: block; width: 100%; height: 16px; margin-top: 4px; accent-color: #2e7d4f;";
  meter.min = 0; meter.max = 100; meter.low = 20; meter.high = 100; meter.optimum = 100;
  meter.setAttribute("aria-label", "Battery charge");
  batteryLabel.appendChild(meter);
  panel.appendChild(batteryLabel);
  const details = document.createElement("dl");
  details.style.cssText = "display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px 16px; margin-bottom: 0;";
  const values = {};
  for (const label of ["Moving speed", "Status", "Last operator"]) {
    const term = document.createElement("dt");
    term.style.color = "#526058";
    term.textContent = label;
    const value = document.createElement("dd");
    value.style.cssText = "margin: 0; text-align: right; overflow-wrap: anywhere;";
    values[label] = value;
    details.append(term, value);
  }
  values["Last operator"].textContent = "Jordan Lee (demo)";
  panel.appendChild(details);
  const layer = new GraphicsLayer({ title: "Yard forklift (simulated)", popupEnabled: true });
  const symbol = { type: "picture-marker", url: "https://cdn.jsdelivr.net/npm/lucide-static@0.468.0/icons/forklift.svg", width: 16, height: 16 };
  const graphic = new Graphic({
    symbol,
    attributes: { ASSET_ID: "NHY-FL-01", LAST_OPERATOR: "Jordan Lee (demo)" },
    popupTemplate: { title: "Forklift NHY-FL-01", content: () => panel }
  });
  layer.add(graphic);
  view.map.add(layer);
  let elapsed = 0;
  let previous = performance.now();
  function update(now) {
    const delta = Math.max(0, Math.min(0.5, (now - previous) / 1000));
    previous = now;
    if (!document.hidden && layer.visible && !view.suspended) elapsed += delta;
    const position = patrolAt(patrol, elapsed);
    const battery = Math.max(15, 82 - elapsed / 1200);
    const speed = position.speed * 2.236936;
    const geometry = new Point({ x: position.x, y: position.y, spatialReference: { wkid: 26993 } });
    graphic.geometry = geometry;
    graphic.symbol = { ...symbol, angle: position.heading - 90 };
    graphic.attributes = { ...graphic.attributes, BATTERY_PCT: battery, SPEED_MPH: speed, DEMO_STATUS: speed ? "Moving" : "Stopped" };
    batteryText.textContent = `${Math.round(battery)}%`;
    meter.value = battery;
    meter.textContent = `${Math.round(battery)}%`;
    values["Moving speed"].textContent = `${speed.toFixed(1)} mph`;
    values.Status.textContent = speed ? "Moving" : "Stopped";
    if (view.popup?.visible && view.popup.selectedFeature === graphic) view.popup.location = geometry;
  }
  update(previous);
  const timer = setInterval(() => update(performance.now()), 100);
  window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
  return { layer, graphic, patrol };
}