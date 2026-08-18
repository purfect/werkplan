const canvas = document.querySelector('#drawingCanvas');
const drawingLayer = document.querySelector('#drawingLayer');
const previewLayer = document.querySelector('#previewLayer');
const emptyState = document.querySelector('#emptyState');
const statusText = document.querySelector('#statusText');
const propertyPanel = document.querySelector('#propertyPanel');
const fileInput = document.querySelector('#fileInput');
const documentTitle = document.title;

const state = {
  tool: 'select', style: 'solid', strokeWidth: 0.75, strokeColor: '#263238',
  snap: true, grid: true, zoom: 1, scale: 20, projectName: 'Projekt01',
  objects: [], draft: null, history: [], dirty: false
};
state.autoScale = true;
state.drawingNumber = 'TZ-001';
state.drawnBy = '';
state.projectDate = new Date().toISOString().slice(0, 10);
state.dimensionStyle = { endStyle: 'arrow', textSize: 14, defaultOffset: 22, unit: 'auto', decimals: 0 };
state.materials = [];
state.redo = [];
state.sheetFormat = 'A3';
state.sheetOrientation = 'landscape';
state.enabledViews = ['front'];
state.activeView = 'front';
state.viewReferences = {};
state.layers = [
  { id: 'contour', name: 'Kontur', visible: true, locked: false, printable: true },
  { id: 'axis', name: 'Achsen', visible: true, locked: false, printable: true },
  { id: 'dimension', name: 'Bemaßung', visible: true, locked: false, printable: true },
  { id: 'text', name: 'Text', visible: true, locked: false, printable: true },
  { id: 'guide', name: 'Hilfslinien', visible: true, locked: false, printable: false }
];
state.activeLayer = 'contour';
state.viewSettings = {};
let pointerStart = null;
let selectedId = null;
let selectedIds = new Set();
let draggingObject = null;
let draggingObjects = [];
let draggingHandle = null;
let dragMode = 'move';
let dragChanged = false;
let dragHistoryCaptured = false;
let polylinePoints = [];
let clipboard = null;
let clipboardSourceScale = 20;
let currentSnap = null;
let angleReferenceId = null;
let viewBox = { x: 0, y: 0, width: 1200, height: 760 };
let panStart = null;
let spacePressed = false;
let selectionBoxStart = null;
let commandSelectionIndex = 0;

const svgNS = 'http://www.w3.org/2000/svg';
const snapSize = 10;
const sheet = { width: 1200, height: 760, margin: 50, titleHeight: 118 };
const scaleSteps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
const toolNames = { select: 'Auswahl', line: 'Linie', circle: 'Kreis', semicircle: 'Halbkreis', rect: 'Rechteck', dimension: 'Bemaßung', angleDimension: 'Winkelmaß', text: 'Text', polyline: 'Polylinie', ellipse: 'Ellipse', ellipseArc: 'Ellipsenbogen', slot: 'Langloch', polygon: 'Polygon', smartTrim: 'Bis Schnittkante trimmen', smartExtend: 'Bis Schnittkante verlängern' };
const toolOrder = ['select', 'line', 'circle', 'semicircle', 'rect', 'dimension', 'text'];
const viewNames = { front: 'Frontansicht', side: 'Seitenansicht', top: 'Draufsicht', detail: 'Detail' };
const viewOrder = ['front', 'side', 'top', 'detail'];
function ensureViewSetting(view = state.activeView) {
  if (!state.viewSettings[view]) state.viewSettings[view] = { scale: 20, autoScale: true, viewBox: { x: 0, y: 0, width: 1200, height: 760 }, layerVisibility: {}, exportX: null, exportY: null };
  return state.viewSettings[view];
}
function saveActiveViewSettings() {
  const setting = ensureViewSetting(); setting.scale = state.scale; setting.autoScale = state.autoScale; setting.viewBox = { ...viewBox };
  setting.layerVisibility = Object.fromEntries(state.layers.map(layer => [layer.id, layer.visible !== false]));
}
function loadActiveViewSettings() {
  const setting = ensureViewSetting(); state.scale = Number(setting.scale) > 0 ? Number(setting.scale) : 20; state.autoScale = setting.autoScale !== false; viewBox = { ...(setting.viewBox || { x: 0, y: 0, width: 1200, height: 760 }) };
  state.layers.forEach(layer => { layer.visible = setting.layerVisibility?.[layer.id] ?? true; });
  applyViewBox(); syncScaleControls(); renderLayerControls(); syncViewSettingControls();
}
function syncViewSettingControls() {
  const setting = ensureViewSetting(); const x = document.querySelector('#viewExportX'); const y = document.querySelector('#viewExportY');
  if (x) x.value = Number.isFinite(setting.exportX) ? setting.exportX : '';
  if (y) y.value = Number.isFinite(setting.exportY) ? setting.exportY : '';
}
function updateSheetFromState() {
  const landscape = state.sheetOrientation !== 'portrait';
  if (state.sheetFormat === 'A4') { sheet.width = landscape ? 900 : 640; sheet.height = landscape ? 640 : 900; }
  else { sheet.width = landscape ? 1200 : 840; sheet.height = landscape ? 760 : 1200; }
}
function sheetSizeMm() {
  const landscape = state.sheetOrientation !== 'portrait';
  if (state.sheetFormat === 'A4') return landscape ? { w: 297, h: 210 } : { w: 210, h: 297 };
  return landscape ? { w: 420, h: 297 } : { w: 297, h: 420 };
}

function makeSvg(tag, attrs = {}) {
  const element = document.createElementNS(svgNS, tag);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}
function addFillPatterns(root) {
  let defs = root.querySelector('defs');
  if (!defs) {
    defs = makeSvg('defs');
    root.prepend(defs);
  }
  if (defs.querySelector('#hatchFill')) return;
  const hatch = makeSvg('pattern', { id: 'hatchFill', width: 10, height: 10, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  hatch.append(makeSvg('line', { x1: 0, y1: 0, x2: 0, y2: 10, stroke: '#263238', 'stroke-width': 1 }));
  const cross = makeSvg('pattern', { id: 'crossHatchFill', width: 10, height: 10, patternUnits: 'userSpaceOnUse' });
  cross.append(makeSvg('path', { d: 'M 0 0 L 10 10 M 10 0 L 0 10', stroke: '#263238', 'stroke-width': 0.9 }));
  const reverse = makeSvg('pattern', { id: 'reverseHatchFill', width: 10, height: 10, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(-45)' });
  reverse.append(makeSvg('line', { x1: 0, y1: 0, x2: 0, y2: 10, stroke: '#263238', 'stroke-width': 1 }));
  const horizontal = makeSvg('pattern', { id: 'horizontalHatchFill', width: 10, height: 10, patternUnits: 'userSpaceOnUse' });
  horizontal.append(makeSvg('line', { x1: 0, y1: 5, x2: 10, y2: 5, stroke: '#263238', 'stroke-width': 1 }));
  const vertical = makeSvg('pattern', { id: 'verticalHatchFill', width: 10, height: 10, patternUnits: 'userSpaceOnUse' });
  vertical.append(makeSvg('line', { x1: 5, y1: 0, x2: 5, y2: 10, stroke: '#263238', 'stroke-width': 1 }));
  const dots = makeSvg('pattern', { id: 'dotHatchFill', width: 10, height: 10, patternUnits: 'userSpaceOnUse' });
  dots.append(makeSvg('circle', { cx: 3, cy: 3, r: 1.2, fill: '#263238' }), makeSvg('circle', { cx: 8, cy: 8, r: 1.2, fill: '#263238' }));
  const brick = makeSvg('pattern', { id: 'brickHatchFill', width: 24, height: 12, patternUnits: 'userSpaceOnUse' });
  brick.append(makeSvg('path', { d: 'M 0 0 H 24 M 0 6 H 24 M 0 12 H 24 M 6 0 V 6 M 18 0 V 6 M 0 6 V 12 M 12 6 V 12 M 24 6 V 12', fill: 'none', stroke: '#263238', 'stroke-width': 0.8 }));
  const concrete = makeSvg('pattern', { id: 'concreteHatchFill', width: 28, height: 22, patternUnits: 'userSpaceOnUse' });
  concrete.append(makeSvg('path', { d: 'M 3 5 l 4 -2 l 3 4 l -5 3 z M 17 4 l 5 1 l -2 5 l -4 -2 z M 10 16 l 4 -3 l 4 4 l -5 2 z M 23 15 l 3 3 l -4 2', fill: 'none', stroke: '#263238', 'stroke-width': 0.8 }));
  defs.append(hatch, cross, reverse, horizontal, vertical, dots, brick, concrete);
}
function distance(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
function polarPoint(center, radius, angle) { return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius }; }
function semicirclePath(object, scale = state.scale, offsetX = 0, offsetY = 0) {
  const radius = object.r / scale;
  const center = { x: object.x / scale + offsetX, y: object.y / scale + offsetY };
  const start = polarPoint(center, radius, object.angle || 0);
  const end = polarPoint(center, radius, (object.angle || 0) + Math.PI);
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 1 ${end.x} ${end.y}`;
}
function ellipseArcPath(object, scale = state.scale, offsetX = 0, offsetY = 0) {
  const cx = object.x / scale + offsetX; const cy = object.y / scale + offsetY;
  const rx = object.rx / scale; const ry = object.ry / scale;
  return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 1 ${cx + rx} ${cy}`;
}
function slotPath(object, scale = state.scale, offsetX = 0, offsetY = 0) {
  const x1 = object.x1 / scale + offsetX; const y1 = object.y1 / scale + offsetY; const x2 = object.x2 / scale + offsetX; const y2 = object.y2 / scale + offsetY;
  const radius = object.width / scale / 2; const angle = Math.atan2(y2 - y1, x2 - x1); const nx = -Math.sin(angle) * radius; const ny = Math.cos(angle) * radius;
  return `M ${x1 + nx} ${y1 + ny} L ${x2 + nx} ${y2 + ny} A ${radius} ${radius} 0 0 1 ${x2 - nx} ${y2 - ny} L ${x1 - nx} ${y1 - ny} A ${radius} ${radius} 0 0 1 ${x1 + nx} ${y1 + ny} Z`;
}
function rectShapePath(object, scale = state.scale, offsetX = 0, offsetY = 0) {
  const x = object.x / scale + offsetX; const y = object.y / scale + offsetY; const width = object.width / scale; const height = object.height / scale;
  const size = Math.min(Number(object.cornerSize) || 0, object.width / 2, object.height / 2) / scale;
  if (object.cornerMode === 'chamfer' && size > 0) return `M ${x + size} ${y} H ${x + width - size} L ${x + width} ${y + size} V ${y + height - size} L ${x + width - size} ${y + height} H ${x + size} L ${x} ${y + height - size} V ${y + size} Z`;
  return null;
}
function distanceToLine(point, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return distance(point, { x: x1, y: y1 });
  let t = ((point.x - x1) * dx + (point.y - y1) * dy) / (len * len);
  t = Math.max(0, Math.min(1, t));
  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;
  return distance(point, { x: closestX, y: closestY });
}
function closestPointOnSegment(point, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  if (len === 0) return { x: x1, y: y1 };
  const t = Math.max(0, Math.min(1, ((point.x - x1) * dx + (point.y - y1) * dy) / len));
  return { x: x1 + t * dx, y: y1 + t * dy };
}
function addSnapCandidate(candidates, point, x1, y1, x2, y2) {
  const snapped = closestPointOnSegment(point, x1, y1, x2, y2);
  candidates.push({ point: snapped, distance: distance(point, snapped), type: 'Kante' });
}
function addPointCandidate(candidates, rawPoint, snapPointValue, type, guide = null) {
  candidates.push({ point: snapPointValue, distance: distance(rawPoint, snapPointValue), type, guide });
}
function rectCorners(object) {
  const center = { x: object.x + object.width / 2, y: object.y + object.height / 2 };
  return [
    { x: object.x, y: object.y }, { x: object.x + object.width, y: object.y },
    { x: object.x + object.width, y: object.y + object.height }, { x: object.x, y: object.y + object.height }
  ].map(point => rotatePoint(point, center, object.rotation || 0));
}
function lineSegments() {
  const segments = [];
  activeViewObjects().forEach(object => {
    if (object.type === 'line') segments.push({ x1: object.x1, y1: object.y1, x2: object.x2, y2: object.y2, objectId: object.id });
    if (object.type === 'rect') {
      const corners = rectCorners(object);
      corners.forEach((point, index) => { const next = corners[(index + 1) % corners.length]; segments.push({ x1: point.x, y1: point.y, x2: next.x, y2: next.y, objectId: object.id }); });
    }
    if (object.type === 'polyline') object.points.slice(1).forEach((pointB, index) => {
      const pointA = object.points[index];
      segments.push({ x1: pointA.x, y1: pointA.y, x2: pointB.x, y2: pointB.y, objectId: object.id });
    });
    if (object.type === 'polygon') object.points.forEach((pointA, index) => { const pointB = object.points[(index + 1) % object.points.length]; segments.push({ x1: pointA.x, y1: pointA.y, x2: pointB.x, y2: pointB.y, objectId: object.id }); });
  });
  return segments;
}
function segmentIntersection(a, b) {
  const dax = a.x2 - a.x1; const day = a.y2 - a.y1;
  const dbx = b.x2 - b.x1; const dby = b.y2 - b.y1;
  const denom = dax * dby - day * dbx;
  if (Math.abs(denom) < 0.001) return null;
  const t = ((b.x1 - a.x1) * dby - (b.y1 - a.y1) * dbx) / denom;
  const u = ((b.x1 - a.x1) * day - (b.y1 - a.y1) * dax) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x1 + t * dax, y: a.y1 + t * day };
}
function infiniteLineSegmentIntersection(line, segment) {
  const dax = line.x2 - line.x1; const day = line.y2 - line.y1; const dbx = segment.x2 - segment.x1; const dby = segment.y2 - segment.y1;
  const denominator = dax * dby - day * dbx; if (Math.abs(denominator) < 0.001) return null;
  const t = ((segment.x1 - line.x1) * dby - (segment.y1 - line.y1) * dbx) / denominator;
  const u = ((segment.x1 - line.x1) * day - (segment.y1 - line.y1) * dax) / denominator;
  return u >= 0 && u <= 1 ? { x: line.x1 + t * dax, y: line.y1 + t * day, t } : null;
}
function smartEditLineAt(point, mode) {
  const threshold = Math.max(12, state.scale * 12);
  const line = activeViewObjects().filter(object => object.type === 'line' && !isObjectLocked(object)).sort((a, b) => distanceToLine(point, a.x1, a.y1, a.x2, a.y2) - distanceToLine(point, b.x1, b.y1, b.x2, b.y2))[0];
  if (!line || distanceToLine(point, line.x1, line.y1, line.x2, line.y2) > threshold) { setStatus('Linie nahe dem gewünschten Ende anklicken'); return; }
  const editStart = distance(point, { x: line.x1, y: line.y1 }) < distance(point, { x: line.x2, y: line.y2 });
  const candidates = lineSegments().filter(segment => segment.objectId !== line.id).map(segment => infiniteLineSegmentIntersection(line, segment)).filter(Boolean).filter(hit => mode === 'trim' ? hit.t > 0.001 && hit.t < 0.999 : editStart ? hit.t < -0.001 : hit.t > 1.001);
  candidates.sort((a, b) => editStart ? Math.abs(a.t) - Math.abs(b.t) : Math.abs(a.t - 1) - Math.abs(b.t - 1));
  const hit = candidates[0]; if (!hit) { setStatus('Keine passende Schnittkante gefunden'); return; }
  pushHistory(); if (editStart) { line.x1 = hit.x; line.y1 = hit.y; } else { line.x2 = hit.x; line.y2 = hit.y; } selectObject(line.id); render(); setStatus(mode === 'trim' ? 'Linie bis Schnittkante getrimmt' : 'Linie bis Schnittkante verlängert');
}
function objectSnapResult(point, origin = null) {
  const candidates = [];
  const segments = lineSegments();
  segments.forEach(segment => {
    addPointCandidate(candidates, point, { x: segment.x1, y: segment.y1 }, 'Endpunkt');
    addPointCandidate(candidates, point, { x: segment.x2, y: segment.y2 }, 'Endpunkt');
    addPointCandidate(candidates, point, { x: (segment.x1 + segment.x2) / 2, y: (segment.y1 + segment.y2) / 2 }, 'Mittelpunkt');
    addSnapCandidate(candidates, point, segment.x1, segment.y1, segment.x2, segment.y2);
    const dx = segment.x2 - segment.x1; const dy = segment.y2 - segment.y1; const segmentLength = Math.hypot(dx, dy) || 1;
    const ux = dx / segmentLength; const uy = dy / segmentLength;
    const infiniteT = (point.x - segment.x1) * ux + (point.y - segment.y1) * uy;
    if (infiniteT < 0 || infiniteT > segmentLength) {
      const extension = { x: segment.x1 + ux * infiniteT, y: segment.y1 + uy * infiniteT };
      addPointCandidate(candidates, point, extension, 'Verlängerung', { x1: segment.x1, y1: segment.y1, x2: extension.x, y2: extension.y });
    }
    if (origin) {
      const parallelT = (point.x - origin.x) * ux + (point.y - origin.y) * uy;
      const parallel = { x: origin.x + ux * parallelT, y: origin.y + uy * parallelT };
      addPointCandidate(candidates, point, parallel, 'Parallel', { x1: origin.x, y1: origin.y, x2: parallel.x, y2: parallel.y });
      const px = -uy; const py = ux; const perpendicularT = (point.x - origin.x) * px + (point.y - origin.y) * py;
      const perpendicular = { x: origin.x + px * perpendicularT, y: origin.y + py * perpendicularT };
      addPointCandidate(candidates, point, perpendicular, 'Senkrecht', { x1: origin.x, y1: origin.y, x2: perpendicular.x, y2: perpendicular.y });
    }
    if (origin) {
      const foot = closestPointOnSegment(origin, segment.x1, segment.y1, segment.x2, segment.y2);
      const atStart = distance(foot, { x: segment.x1, y: segment.y1 }) < 0.001;
      const atEnd = distance(foot, { x: segment.x2, y: segment.y2 }) < 0.001;
      if (!atStart && !atEnd) addPointCandidate(candidates, point, foot, 'Lotpunkt');
    }
    if (origin && Math.abs(segment.x1 - segment.x2) < 0.001) {
      const minY = Math.min(segment.y1, segment.y2);
      const maxY = Math.max(segment.y1, segment.y2);
      if (origin.y >= minY && origin.y <= maxY) addPointCandidate(candidates, point, { x: segment.x1, y: origin.y }, 'Lotpunkt');
    }
    if (origin && Math.abs(segment.y1 - segment.y2) < 0.001) {
      const minX = Math.min(segment.x1, segment.x2);
      const maxX = Math.max(segment.x1, segment.x2);
      if (origin.x >= minX && origin.x <= maxX) addPointCandidate(candidates, point, { x: origin.x, y: segment.y1 }, 'Lotpunkt');
    }
  });
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const intersection = segmentIntersection(segments[i], segments[j]);
      if (intersection) addPointCandidate(candidates, point, intersection, 'Schnittpunkt');
    }
  }
  activeViewObjects().forEach(object => {
    if (object.type === 'circle' || object.type === 'semicircle') {
      [{ x: object.x + object.r, y: object.y }, { x: object.x - object.r, y: object.y }, { x: object.x, y: object.y + object.r }, { x: object.x, y: object.y - object.r }].forEach(quadrant => addPointCandidate(candidates, point, quadrant, 'Quadrant'));
      if (origin) {
        const centerDistance = distance(origin, { x: object.x, y: object.y });
        if (centerDistance > object.r + 0.001) {
          const base = Math.atan2(origin.y - object.y, origin.x - object.x); const offset = Math.acos(object.r / centerDistance);
          [base + offset, base - offset].forEach(angle => { const tangent = polarPoint(object, object.r, angle); addPointCandidate(candidates, point, tangent, 'Tangente', { x1: origin.x, y1: origin.y, x2: tangent.x, y2: tangent.y }); });
        }
      }
    }
    if (object.type === 'ellipse' || object.type === 'ellipseArc') [{ x: object.x + object.rx, y: object.y }, { x: object.x - object.rx, y: object.y }, { x: object.x, y: object.y + object.ry }, { x: object.x, y: object.y - object.ry }].forEach(quadrant => addPointCandidate(candidates, point, quadrant, 'Quadrant'));
  });
  const threshold = Math.max(150, state.scale * 12);
  const priority = { Endpunkt: 0, Schnittpunkt: 1, Quadrant: 2, Tangente: 3, Mittelpunkt: 4, Lotpunkt: 5, Senkrecht: 6, Parallel: 7, Verlängerung: 8, Kante: 9 };
  const best = candidates.sort((a, b) => a.distance - b.distance || (priority[a.type] ?? 9) - (priority[b.type] ?? 9))[0];
  return best && best.distance <= threshold ? best : { point, type: null, distance: 0 };
}
function snapPoint(point) { return state.snap ? { x: Math.round(point.x / snapSize) * snapSize, y: Math.round(point.y / snapSize) * snapSize } : point; }
function eventPoint(event, objectSnap = false, snapOrigin = null) {
  const svg = canvas;
  const rect = svg.getBoundingClientRect();
  const x = viewBox.x + (event.clientX - rect.left) / rect.width * viewBox.width;
  const y = viewBox.y + (event.clientY - rect.top) / rect.height * viewBox.height;
  const snappedX = state.snap ? Math.round(x / snapSize) * snapSize : x;
  const snappedY = state.snap ? Math.round(y / snapSize) * snapSize : y;
  const rawPoint = { x: x * state.scale, y: y * state.scale };
  const gridPoint = { x: snappedX * state.scale, y: snappedY * state.scale };
  currentSnap = null;
  if (!objectSnap) return gridPoint;
  const snapped = objectSnapResult(rawPoint, snapOrigin);
  if (!snapped.type) return gridPoint;
  currentSnap = snapped;
  return snapped.point;
}
function toolUsesObjectSnap() { return ['line', 'dimension', 'polyline', 'rect', 'circle', 'semicircle', 'ellipse', 'ellipseArc', 'slot', 'polygon'].includes(state.tool); }
function constrainedEndPoint(start, current) {
  const len = Number(document.querySelector('#targetLength')?.value);
  if (!len || len <= 0) return current;
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const d = Math.hypot(dx, dy);
  if (d < 1) return { x: start.x + len, y: start.y };
  return { x: start.x + (dx / d) * len, y: start.y + (dy / d) * len };
}
function lineEndPoint(start, current, event) {
  return constrainedEndPoint(start, applyAngleConstraint(start, current, event));
}
function radiusEndPoint(start, current, event) {
  const anglePoint = applyAngleConstraint(start, current, event);
  return constrainedEndPoint(start, anglePoint);
}
function angleDegrees(start, end) {
  const raw = (Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI + 360) % 360;
  return raw > 180 ? 360 - raw : raw;
}
function formatAngle(value) {
  return `${value.toFixed(1).replace('.', ',')}${String.fromCharCode(176)}`;
}
function shortestAngleDelta(startAngle, endAngle) {
  let delta = ((endAngle - startAngle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  return delta;
}
function angleDimensionLabel(object) {
  if (object.labelOverride) return String(object.labelOverride);
  return formatAngle(Math.abs(shortestAngleDelta(object.startAngle || 0, object.endAngle || 0)) * 180 / Math.PI);
}
function angleArcPath(object, scale = state.scale, offsetX = 0, offsetY = 0) {
  const radius = Math.max(1, object.r || 500) / scale;
  const center = { x: object.cx / scale + offsetX, y: object.cy / scale + offsetY };
  const start = polarPoint(center, radius, object.startAngle || 0);
  const delta = shortestAngleDelta(object.startAngle || 0, object.endAngle || 0);
  const end = polarPoint(center, radius, (object.startAngle || 0) + delta);
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 ${delta >= 0 ? 1 : 0} ${end.x} ${end.y}`;
}
function updateLiveAngle(start, end) {
  const output = document.querySelector('#liveAngle');
  if (!output) return;
  output.textContent = start && end ? formatAngle(angleDegrees(start, end)) : '-';
}
function canvasValue(value) { return value / state.scale; }
function formatLength(value) { return value >= 1000 ? `${(value / 1000).toFixed(2).replace('.', ',')} m` : `${Math.round(value)} mm`; }
function dimensionStyle() {
  return state.dimensionStyle || { endStyle: 'arrow', textSize: 14, defaultOffset: 22, unit: 'auto', decimals: 0 };
}
function formatDimensionLength(value, options = {}) {
  const style = dimensionStyle();
  const decimalsSource = options.decimals ?? style.decimals;
  const decimals = Math.max(0, Math.min(3, Number(decimalsSource) || 0));
  const unitSetting = options.unit || style.unit || 'auto';
  const unit = unitSetting === 'auto' ? (value >= 1000 ? 'm' : 'mm') : unitSetting;
  const displayValue = unit === 'm' ? value / 1000 : unit === 'cm' ? value / 10 : value;
  return `${displayValue.toFixed(decimals).replace('.', ',')} ${unit}`;
}
function objectReferenceFactor(object, side = null) {
  if (!object) return 1;
  const directFactor = Number(object.referenceScale?.factor);
  const directSideMatches = !side || !object.referenceScale?.side || object.referenceScale.side === 'length' || object.referenceScale.side === side;
  if (directSideMatches && Number.isFinite(directFactor) && directFactor > 0) return directFactor;
  const sourceId = object.sourceObjectId || object.sourceRectId;
  const source = sourceId ? state.objects.find(item => item.id === sourceId) : null;
  const sourceFactor = Number(source?.referenceScale?.factor);
  const dimensionSide = object.autoRectSide || side;
  const sourceSideMatches = !dimensionSide || !source?.referenceScale?.side || source.referenceScale.side === 'length' || source.referenceScale.side === dimensionSide;
  return sourceSideMatches && Number.isFinite(sourceFactor) && sourceFactor > 0 ? sourceFactor : 1;
}
function calibratedLength(value, object = null, side = null) {
  return value * objectReferenceFactor(object, side);
}
function dimensionLabelText(object, measuredLength) {
  if (object.labelOverride) return String(object.labelOverride);
  const displayLength = calibratedLength(measuredLength, object);
  return `${object.labelPrefix || ''}${formatDimensionLength(displayLength, { unit: object.dimensionUnit, decimals: object.dimensionDecimals })}`;
}
function updateDimensionStyleFromControls() {
  const style = dimensionStyle();
  style.endStyle = document.querySelector('#dimensionEndStyle')?.value || 'arrow';
  style.textSize = Math.max(8, Math.min(32, Number(document.querySelector('#dimensionTextSize')?.value) || 14));
  style.defaultOffset = Math.max(-120, Math.min(120, Number(document.querySelector('#dimensionDefaultOffset')?.value) || 22));
  style.unit = document.querySelector('#dimensionUnit')?.value || 'auto';
  style.decimals = Math.max(0, Math.min(3, Number(document.querySelector('#dimensionDecimals')?.value) || 0));
  state.dimensionStyle = style;
}
function syncDimensionStyleControls() {
  const style = dimensionStyle();
  if (document.querySelector('#dimensionEndStyle')) document.querySelector('#dimensionEndStyle').value = style.endStyle;
  if (document.querySelector('#dimensionTextSize')) document.querySelector('#dimensionTextSize').value = style.textSize;
  if (document.querySelector('#dimensionDefaultOffset')) document.querySelector('#dimensionDefaultOffset').value = style.defaultOffset;
  if (document.querySelector('#dimensionUnit')) document.querySelector('#dimensionUnit').value = style.unit;
  if (document.querySelector('#dimensionDecimals')) document.querySelector('#dimensionDecimals').value = style.decimals;
}
function updateProjectMetaFromForm() {
  state.projectName = document.querySelector('#projectName')?.value || 'Projekt01';
  state.drawingNumber = document.querySelector('#drawingNumber')?.value || '-';
  state.drawnBy = document.querySelector('#drawnBy')?.value || '-';
  state.projectDate = document.querySelector('#projectDate')?.value || new Date().toISOString().slice(0, 10);
}
function objectListLabel(object, index = state.objects.indexOf(object)) {
  return `${index + 1}. ${object.name || toolNames[object.type] || object.type} - ${objectSummary(object)} - ${viewNames[objectView(object)]}`;
}
function linkedObjectText(item) {
  const object = state.objects.find(entry => entry.id === item.objectId);
  if (!object) return item.objectId ? 'Objekt fehlt' : '';
  return objectListLabel(object);
}
function materialDimensionsFromObject(object) {
  if (!object) return '';
  if (object.type === 'line') return formatLength(distance({ x: object.x1, y: object.y1 }, { x: object.x2, y: object.y2 }));
  if (object.type === 'rect') return `${formatLength(object.width)} x ${formatLength(object.height)}`;
  if (object.type === 'circle') return `Ø ${formatLength(object.r * 2)}`;
  if (object.type === 'semicircle') return `R ${formatLength(object.r)}`;
  return objectSummary(object);
}
function trimNumber(value) {
  return Number(value.toFixed(3)).toString().replace('.', ',');
}
function parseMaterialNumber(value, fallback = 0) {
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) ? number : fallback;
}
function calculatedMaterialQuantity(item) {
  const object = state.objects.find(entry => entry.id === item.objectId);
  if (!object) return '';
  const count = 1;
  let value = null;
  if (item.unit === 'St') value = count;
  if (item.unit === 'm') {
    if (object.type === 'line') value = distance({ x: object.x1, y: object.y1 }, { x: object.x2, y: object.y2 }) / 1000 * count;
    if (object.type === 'rect') value = (object.width + object.height) * 2 / 1000 * count;
    if (object.type === 'circle') value = 2 * Math.PI * object.r / 1000 * count;
    if (object.type === 'semicircle') value = (Math.PI * object.r + object.r * 2) / 1000 * count;
  }
  if (item.unit === 'm2') {
    if (object.type === 'rect') value = object.width * object.height / 1000000 * count;
    if (object.type === 'circle') value = Math.PI * object.r * object.r / 1000000 * count;
    if (object.type === 'semicircle') value = Math.PI * object.r * object.r / 2000000 * count;
  }
  return value === null ? '' : trimNumber(value);
}
function materialMarkerPoint(object) {
  if (object.type === 'line' || object.type === 'dimension') return { x: (object.x1 + object.x2) / 2, y: (object.y1 + object.y2) / 2 };
  if (object.type === 'rect') return { x: object.x + object.width / 2, y: object.y + object.height / 2 };
  if (object.type === 'circle' || object.type === 'semicircle') return { x: object.x, y: object.y };
  if (object.type === 'angleDimension') return { x: object.cx, y: object.cy };
  if (object.type === 'text') return { x: object.x, y: object.y };
  return null;
}
function materialMarkersForObject(object) {
  return state.materials.filter(item => item.objectId === object.id).map(item => `Pos. ${item.pos || state.materials.indexOf(item) + 1}`);
}
function defaultMaterialRow() {
  return { pos: String(state.materials.length + 1), qty: '1', unit: 'St', objectQty: '1', objectId: '', name: '', material: '', dimensions: '', note: '' };
}
function materialRowFromObject(object) {
  return {
    pos: String(state.materials.length + 1),
    qty: '1',
    unit: 'St',
    objectQty: '1',
    objectId: object.id,
    name: object.materialName || toolNames[object.type] || 'Teil',
    material: '',
    dimensions: materialDimensionsFromObject(object),
    note: ''
  };
}
function updateMaterialsFromForm() {
  const list = document.querySelector('#materialList');
  if (!list) return;
  state.materials = [...list.querySelectorAll('.material-row')].map(row => ({
    pos: row.querySelector('[name="pos"]').value.trim(),
    qty: row.querySelector('[name="qty"]').value.trim(),
    unit: row.querySelector('[name="unit"]').value,
    objectQty: row.querySelector('[name="objectQty"]')?.value.trim() || '1',
    objectId: row.querySelector('[name="objectId"]')?.value || '',
    name: row.querySelector('[name="name"]').value.trim(),
    material: row.querySelector('[name="material"]').value.trim(),
    dimensions: row.querySelector('[name="dimensions"]').value.trim(),
    note: row.querySelector('[name="note"]').value.trim()
  })).filter(item => item.name || item.material || item.dimensions || item.note || item.objectId);
}
function renderMaterialList() {
  const list = document.querySelector('#materialList');
  if (!list) return;
  list.replaceChildren();
  if (!state.materials.length) {
    const empty = document.createElement('div');
    empty.className = 'property-empty';
    empty.textContent = 'Keine Materialpositionen angelegt.';
    list.append(empty);
    return;
  }
  state.materials.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'material-row';
    row.dataset.index = index;
    const objectExists = state.objects.some(object => object.id === item.objectId);
    const missingOption = item.objectId && !objectExists ? `<option value="${escapeHtml(item.objectId)}">Objekt fehlt: ${escapeHtml(item.objectId)}</option>` : '';
    const objectOptions = ['<option value="">Kein Objekt</option>', missingOption, ...state.objects.map((object, objectIndex) => `<option value="${escapeHtml(object.id)}">${escapeHtml(objectListLabel(object, objectIndex))}</option>`)].join('');
    row.innerHTML = `<label>Pos.<input name="pos" value="${escapeHtml(item.pos || String(index + 1))}"></label><label>Menge<input name="qty" value="${escapeHtml(item.qty || '1')}"></label><label>Einheit<select name="unit"><option value="St">St</option><option value="m">m</option><option value="m2">m²</option><option value="m3">m³</option><option value="kg">kg</option><option value="l">l</option></select></label><label>St./Objekt<input name="objectQty" type="number" min="1" step="1" value="${escapeHtml(item.objectQty || '1')}"></label><label class="wide-field">Verknüpftes Objekt<select name="objectId">${objectOptions}</select></label><label class="wide-field">Bezeichnung<input name="name" value="${escapeHtml(item.name || '')}"></label><label class="wide-field">Werkstoff / Material<input name="material" value="${escapeHtml(item.material || '')}"></label><label class="wide-field">Abmessung<input name="dimensions" value="${escapeHtml(item.dimensions || '')}"></label><label class="wide-field">Bemerkung<input name="note" value="${escapeHtml(item.note || '')}"></label><button class="calc-material" type="button">Optional: Menge berechnen</button><button class="remove-material" type="button">Position löschen</button>`;
    row.querySelector('[name="unit"]').value = item.unit || 'St';
    row.querySelector('[name="objectId"]').value = item.objectId || '';
    row.querySelector('[name="objectId"]').addEventListener('change', event => {
      const object = state.objects.find(entry => entry.id === event.target.value);
      if (!object) return;
      if (!row.querySelector('[name="dimensions"]').value.trim()) row.querySelector('[name="dimensions"]').value = materialDimensionsFromObject(object);
      if (!row.querySelector('[name="name"]').value.trim()) row.querySelector('[name="name"]').value = toolNames[object.type] || 'Teil';
      updateMaterialsFromForm();
      render();
    });
    row.querySelectorAll('input,select').forEach(input => input.addEventListener('input', () => { updateMaterialsFromForm(); setDirty(); renderProjectWarnings(); }));
    row.querySelector('[name="pos"]').addEventListener('change', () => { updateMaterialsFromForm(); render(); });
    row.querySelector('.calc-material').addEventListener('click', () => {
      updateMaterialsFromForm();
      const current = state.materials[index];
      const calculated = calculatedMaterialQuantity(current);
      if (!calculated) { setStatus('Für diese Einheit ist keine Berechnung möglich'); return; }
      state.materials[index].qty = calculated;
      setDirty();
      renderMaterialList();
      setStatus('Menge aus Objekt berechnet');
    });
    row.querySelector('.remove-material').addEventListener('click', () => { updateMaterialsFromForm(); state.materials.splice(index, 1); setDirty(); renderMaterialList(); render(); });
    list.append(row);
  });
}
function objectBounds(object) {
  if (object.type === 'line') return { minX: Math.min(object.x1, object.x2), minY: Math.min(object.y1, object.y2), maxX: Math.max(object.x1, object.x2), maxY: Math.max(object.y1, object.y2) };
  if (object.type === 'dimension') {
    const dx = object.x2 - object.x1; const dy = object.y2 - object.y1; const length = Math.hypot(dx, dy) || 1;
    const offset = (Number.isFinite(Number(object.offset)) ? Number(object.offset) : dimensionStyle().defaultOffset) * state.scale;
    const normal = { x: -dy / length, y: dx / length };
    const points = [
      { x: object.x1, y: object.y1 },
      { x: object.x2, y: object.y2 },
      { x: object.x1 + normal.x * offset, y: object.y1 + normal.y * offset },
      { x: object.x2 + normal.x * offset, y: object.y2 + normal.y * offset }
    ];
    return { minX: Math.min(...points.map(point => point.x)) - 250, minY: Math.min(...points.map(point => point.y)) - 250, maxX: Math.max(...points.map(point => point.x)) + 250, maxY: Math.max(...points.map(point => point.y)) + 250 };
  }
  if (object.type === 'rect') {
    const corners = rectCorners(object);
    return { minX: Math.min(...corners.map(point => point.x)), minY: Math.min(...corners.map(point => point.y)), maxX: Math.max(...corners.map(point => point.x)), maxY: Math.max(...corners.map(point => point.y)) };
  }
  if (object.type === 'circle' || object.type === 'semicircle') return { minX: object.x - object.r, minY: object.y - object.r, maxX: object.x + object.r, maxY: object.y + object.r };
  if (object.type === 'ellipse' || object.type === 'ellipseArc') { const angle = object.rotation || 0; const extentX = Math.sqrt(object.rx ** 2 * Math.cos(angle) ** 2 + object.ry ** 2 * Math.sin(angle) ** 2); const extentY = Math.sqrt(object.rx ** 2 * Math.sin(angle) ** 2 + object.ry ** 2 * Math.cos(angle) ** 2); return { minX: object.x - extentX, minY: object.y - extentY, maxX: object.x + extentX, maxY: object.y + extentY }; }
  if (object.type === 'slot') { const radius = object.width / 2; return { minX: Math.min(object.x1, object.x2) - radius, minY: Math.min(object.y1, object.y2) - radius, maxX: Math.max(object.x1, object.x2) + radius, maxY: Math.max(object.y1, object.y2) + radius }; }
  if (object.type === 'angleDimension') return { minX: object.cx - object.r, minY: object.cy - object.r, maxX: object.cx + object.r, maxY: object.cy + object.r };
  if (object.type === 'polyline' || object.type === 'polygon') {
    const xs = object.points.map(point => point.x);
    const ys = object.points.map(point => point.y);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }
  if (object.type === 'text') return { minX: object.x, minY: object.y - 250, maxX: object.x + String(object.value || '').length * 180, maxY: object.y + 80 };
  return null;
}
function drawingBounds(padding = 0) {
  const boxes = state.objects.filter(object => object.visible !== false).map(objectBounds).filter(Boolean);
  if (!boxes.length) return null;
  return {
    minX: Math.min(...boxes.map(box => box.minX)) - padding,
    minY: Math.min(...boxes.map(box => box.minY)) - padding,
    maxX: Math.max(...boxes.map(box => box.maxX)) + padding,
    maxY: Math.max(...boxes.map(box => box.maxY)) + padding
  };
}
function boundsForObjects(objects, padding = 0) {
  const boxes = objects.map(objectBounds).filter(Boolean);
  if (!boxes.length) return null;
  return {
    minX: Math.min(...boxes.map(box => box.minX)) - padding,
    minY: Math.min(...boxes.map(box => box.minY)) - padding,
    maxX: Math.max(...boxes.map(box => box.maxX)) + padding,
    maxY: Math.max(...boxes.map(box => box.maxY)) + padding
  };
}
function objectView(object) {
  return viewNames[object.view] ? object.view : 'front';
}
function defaultLayerForType(type) {
  if (type === 'dimension' || type === 'angleDimension') return 'dimension';
  if (type === 'text') return 'text';
  return 'contour';
}
function objectLayer(object) { return state.layers.some(layer => layer.id === object.layer) ? object.layer : defaultLayerForType(object.type); }
function layerForObject(object) { return state.layers.find(layer => layer.id === objectLayer(object)) || state.layers[0]; }
function isObjectVisible(object) { return object.visible !== false && layerForObject(object).visible !== false; }
function isObjectLocked(object) { return object.locked === true || layerForObject(object).locked === true; }
function isObjectPrintable(object) {
  const layer = layerForObject(object); const setting = ensureViewSetting(objectView(object));
  const visibleInView = setting.layerVisibility?.[layer.id] ?? layer.visible !== false;
  return object.visible !== false && visibleInView && layer.printable !== false;
}
function renderLayerControls() {
  const select = document.querySelector('#activeLayer'); const list = document.querySelector('#layerList');
  if (!select || !list) return;
  select.innerHTML = state.layers.map(layer => `<option value="${escapeHtml(layer.id)}">${escapeHtml(layer.name)}</option>`).join('');
  if (!state.layers.some(layer => layer.id === state.activeLayer)) state.activeLayer = state.layers[0].id;
  select.value = state.activeLayer;
  document.querySelector('#activeLayerName').textContent = state.layers.find(layer => layer.id === state.activeLayer)?.name || '';
  list.replaceChildren();
  state.layers.forEach(layer => {
    const row = document.createElement('div'); row.className = `layer-row${layer.id === state.activeLayer ? ' active' : ''}`;
    row.innerHTML = `<button type="button" data-action="activate" title="Ebene aktivieren">${escapeHtml(layer.name)}</button><label title="Sichtbar"><input type="checkbox" data-action="visible" ${layer.visible !== false ? 'checked' : ''}>S</label><label title="Gesperrt"><input type="checkbox" data-action="locked" ${layer.locked ? 'checked' : ''}>G</label><label title="Druckbar"><input type="checkbox" data-action="printable" ${layer.printable !== false ? 'checked' : ''}>D</label>`;
    row.querySelector('[data-action="activate"]').addEventListener('click', () => { state.activeLayer = layer.id; setDirty(); renderLayerControls(); });
    row.querySelectorAll('input').forEach(input => input.addEventListener('change', () => { layer[input.dataset.action] = input.checked; if (input.dataset.action === 'visible') ensureViewSetting().layerVisibility[layer.id] = input.checked; setDirty(); render(); renderLayerControls(); }));
    list.append(row);
  });
}
function projectWarnings() {
  updateSheetFromState();
  const warnings = []; const objectIds = new Set(state.objects.map(object => object.id));
  state.objects.forEach(object => {
    const missingSourceId = object.sourceRectId || object.sourceObjectId;
    if (missingSourceId && !objectIds.has(missingSourceId)) warnings.push({ type: 'link', objectId: object.id, message: `${object.name || toolNames[object.type] || 'Bemaßung'} verweist auf ein gelöschtes Objekt.` });
    const layer = layerForObject(object);
    if (layer.locked) warnings.push({ type: 'layer', objectId: object.id, message: `${object.name || toolNames[object.type] || 'Objekt'} liegt auf der gesperrten Ebene „${layer.name}“.` });
    if (layer.printable === false) warnings.push({ type: 'print', objectId: object.id, message: `${object.name || toolNames[object.type] || 'Objekt'} liegt auf der nicht druckbaren Ebene „${layer.name}“.` });
  });
  state.materials.forEach((item, index) => { if (item.objectId && !objectIds.has(item.objectId)) warnings.push({ type: 'material', message: `Materialposition ${item.pos || index + 1} verweist auf ein gelöschtes Objekt.` }); });
  enabledViews().forEach(view => {
    const setting = ensureViewSetting(view); const hasManualPosition = Number.isFinite(setting.exportX) || Number.isFinite(setting.exportY);
    if (!hasManualPosition) return;
    const objects = state.objects.filter(object => objectView(object) === view && isObjectPrintable(object)); const bounds = boundsForObjects(objects);
    if (!bounds) return;
    const exportScale = setting.autoScale !== false ? calculateRequiredExportScale(bounds) : Math.max(1, Number(setting.scale) || 20);
    const x = Number.isFinite(setting.exportX) ? setting.exportX : sheet.margin; const y = Number.isFinite(setting.exportY) ? setting.exportY : sheet.margin;
    const width = (bounds.maxX - bounds.minX) / exportScale; const height = (bounds.maxY - bounds.minY) / exportScale;
    if (x < 28 || y < 28 || x + width > sheet.width - 28 || y + height > sheet.height - 28) warnings.push({ type: 'view', view, message: `${viewNames[view]} liegt teilweise außerhalb des ${state.sheetFormat}-Exportblatts.` });
  });
  return warnings;
}
function renderProjectWarnings() {
  const list = document.querySelector('#warningList'); const count = document.querySelector('#warningCount'); if (!list || !count) return;
  const warnings = projectWarnings(); count.textContent = warnings.length; count.classList.toggle('has-warnings', warnings.length > 0); list.replaceChildren();
  if (!warnings.length) { const clear = document.createElement('div'); clear.className = 'warning-clear'; clear.textContent = 'Keine Probleme gefunden.'; list.append(clear); return; }
  warnings.forEach(warning => { const button = document.createElement('button'); button.type = 'button'; button.className = `warning-item ${warning.type}`; button.textContent = warning.message; button.addEventListener('click', () => { if (warning.objectId) selectObject(warning.objectId); else if (warning.view) setActiveView(warning.view); }); list.append(button); });
}
function enabledViews() {
  const views = Array.isArray(state.enabledViews) ? state.enabledViews.filter(view => viewNames[view]) : [];
  return views.length ? views : ['front'];
}
function activeViewObjects() {
  return state.objects.filter(object => isObjectVisible(object) && objectView(object) === state.activeView);
}
function syncViewControls() {
  const enabled = enabledViews();
  document.querySelectorAll('.view-toggle').forEach(input => { input.checked = enabled.includes(input.value); });
  document.querySelectorAll('.view-button').forEach(button => {
    const active = button.dataset.view === state.activeView;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const label = document.querySelector('#activeViewLabel');
  if (label) label.textContent = viewNames[state.activeView] || viewNames[enabled[0]];
}
function updateViewsFromControls() {
  const selected = [...document.querySelectorAll('.view-toggle:checked')].map(input => input.value).filter(view => viewNames[view]);
  state.enabledViews = selected.length ? selected : ['front'];
  if (!state.enabledViews.includes(state.activeView)) state.activeView = state.enabledViews[0];
  syncViewControls();
}
function setActiveView(view) {
  if (!viewNames[view]) return;
  saveActiveViewSettings();
  state.activeView = view;
  if (!enabledViews().includes(view)) state.enabledViews = [...enabledViews(), view];
  selectedId = null; selectedIds.clear();
  loadActiveViewSettings();
  syncViewControls();
  render();
  setDirty();
  setStatus(`${viewNames[view]} aktiv`);
}
function commandDefinitions() {
  const toolCommands = Object.entries(toolNames).filter(([tool]) => tool !== 'angleDimension').map(([tool, name]) => ({ label: `Werkzeug: ${name}`, keywords: `zeichnen ${tool}`, run: () => setTool(tool) }));
  const viewCommands = Object.entries(viewNames).map(([view, name]) => ({ label: `Ansicht: ${name}`, keywords: 'arbeitsansicht wechseln', run: () => setActiveView(view) }));
  const layerCommands = state.layers.map(layer => ({ label: `Ebene aktivieren: ${layer.name}`, keywords: 'layer ebene', run: () => { state.activeLayer = layer.id; renderLayerControls(); setDirty(); setStatus(`${layer.name} aktiv`); } }));
  return [
    ...toolCommands, ...viewCommands, ...layerCommands,
    { label: 'Datei: Neues Projekt', keywords: 'neu leeren', run: () => document.querySelector('#newProject').click() },
    { label: 'Datei: Projekt laden', keywords: 'öffnen werkplan', run: () => fileInput.click() },
    { label: 'Datei: Projekt speichern', keywords: 'speichern strg s', run: saveProject },
    { label: 'Bearbeiten: Rückgängig', keywords: 'undo', run: undo },
    { label: 'Bearbeiten: Wiederholen', keywords: 'redo', run: redo },
    { label: 'Export: SVG', keywords: 'ausgabe', run: exportSheetSvg },
    { label: 'Export: PNG', keywords: 'bild ausgabe', run: exportPng },
    { label: 'Export: PDF', keywords: 'drucken ausgabe', run: exportPdf },
    { label: 'Ansicht: Alles einpassen', keywords: 'zoom fit', run: fitAllObjects },
    { label: 'Ansicht: Auswahl einpassen', keywords: 'zoom objekt fit', run: fitSelectedObject },
    { label: 'Ansicht: Vergrößern', keywords: 'zoom plus', run: () => setViewportZoom(state.zoom * 1.2) },
    { label: 'Ansicht: Verkleinern', keywords: 'zoom minus', run: () => setViewportZoom(state.zoom / 1.2) },
    { label: 'Raster: Anzeige umschalten', keywords: 'grid sichtbar', run: () => document.querySelector('#gridToggle').click() },
    { label: 'Raster: Einrasten umschalten', keywords: 'snap fangen', run: () => document.querySelector('#snapToggle').click() }
  ];
}
function filteredCommands() {
  const query = (document.querySelector('#commandSearch')?.value || '').trim().toLowerCase();
  return commandDefinitions().filter(command => !query || `${command.label} ${command.keywords || ''}`.toLowerCase().includes(query)).slice(0, 14);
}
function renderCommandResults() {
  const results = document.querySelector('#commandResults'); const commands = filteredCommands();
  commandSelectionIndex = Math.max(0, Math.min(commandSelectionIndex, Math.max(0, commands.length - 1)));
  results.replaceChildren();
  if (!commands.length) { const empty = document.createElement('div'); empty.className = 'command-empty'; empty.textContent = 'Kein passender Befehl'; results.append(empty); return; }
  commands.forEach((command, index) => { const button = document.createElement('button'); button.type = 'button'; button.className = index === commandSelectionIndex ? 'active' : ''; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(index === commandSelectionIndex)); button.textContent = command.label; button.addEventListener('mouseenter', () => { commandSelectionIndex = index; [...results.querySelectorAll('button')].forEach((item, itemIndex) => { item.classList.toggle('active', itemIndex === index); item.setAttribute('aria-selected', String(itemIndex === index)); }); }); button.addEventListener('click', () => executeCommand(index)); results.append(button); });
}
function openCommandPalette() { const palette = document.querySelector('#commandPalette'); palette.hidden = false; document.querySelector('#commandSearch').value = ''; commandSelectionIndex = 0; renderCommandResults(); requestAnimationFrame(() => document.querySelector('#commandSearch').focus()); }
function closeCommandPalette() { document.querySelector('#commandPalette').hidden = true; }
function executeCommand(index = commandSelectionIndex) { const command = filteredCommands()[index]; if (!command) return; closeCommandPalette(); command.run(); }
function exportViewGroups() {
  const visible = state.objects.filter(isObjectPrintable);
  const grouped = new Map();
  visible.forEach(object => {
    const view = objectView(object);
    if (!grouped.has(view)) grouped.set(view, []);
    grouped.get(view).push(object);
  });
  return viewOrder.filter(view => enabledViews().includes(view)).map(view => ({ view, objects: grouped.get(view) || [] })).filter(group => enabledViews().length > 1 || group.objects.length);
}
function materialTableHeight() {
  const rows = Math.min(state.materials.length, 6);
  return state.materials.length ? 22 * (rows + 2) : 0;
}
function exportDrawingAreaHeight() {
  const titleTop = sheet.height - sheet.margin - sheet.titleHeight;
  const reservedMaterial = materialTableHeight() ? materialTableHeight() + 32 : 0;
  return Math.max(120, titleTop - sheet.margin - 16 - reservedMaterial);
}
function calculateRequiredExportScale(bounds, usableWidth = sheet.width - sheet.margin * 2, usableHeight = exportDrawingAreaHeight()) {
  return Math.max((bounds.maxX - bounds.minX) / usableWidth, (bounds.maxY - bounds.minY) / usableHeight, 1);
}
function calculateAutoScale() {
  updateSheetFromState();
  updateMaterialsFromForm();
  const bounds = boundsForObjects(activeViewObjects(), 500);
  if (!bounds) return state.scale || 20;
  const required = calculateRequiredExportScale(bounds);
  return scaleSteps.find(step => step >= required) || Math.ceil(required / 1000) * 1000;
}
function updateAutoScale() {
  if (!state.autoScale) return;
  state.scale = calculateAutoScale();
}
function syncScaleControls() {
  const select = document.querySelector('#scaleSelect');
  const customWrap = document.querySelector('#customScaleWrap');
  if (state.autoScale) {
    select.value = 'auto';
    customWrap.hidden = true;
    document.querySelector('#customScale').value = state.scale;
    return;
  }
  const preset = [...select.options].some(option => option.value === String(state.scale));
  select.value = preset ? String(state.scale) : 'custom';
  customWrap.hidden = preset;
  document.querySelector('#customScale').value = state.scale;
}
function updateScaleUi() {
  const effectiveScale = state.autoScale ? calculateAutoScale() : state.scale;
  document.querySelector('#scaleMeta').textContent = state.autoScale ? `Auto 1:${effectiveScale}` : `1:${state.scale}`;
  document.querySelector('#sheetMeta').textContent = `${state.sheetFormat} ${state.sheetOrientation === 'portrait' ? 'hoch' : 'quer'}`;
  document.querySelector('#viewReferenceStatus').textContent = `${viewNames[state.activeView]}: Richtmaße werden pro Objekt gespeichert`;
  document.querySelector('#scaleDescription').textContent = state.autoScale ? `Der Exportmaßstab wird automatisch als 1:${effectiveScale} errechnet. Die Arbeitsfläche bleibt beim Zeichnen stabil.` : `Ein gezeichnetes Blattmaß von 100 mm entspricht bei 1:${state.scale} einem echten Maß von ${formatLength(100 * state.scale)}.`;
  document.querySelector('#gridStatus').textContent = `Raster ${formatLength(snapSize * state.scale)}`;
}
function setScale(value) {
  const nextScale = Number(value);
  if (!Number.isFinite(nextScale) || nextScale < 1) return;
  state.autoScale = false;
  state.scale = Math.round(nextScale);
  ensureViewSetting().scale = state.scale; ensureViewSetting().autoScale = false;
  setDirty();
  syncScaleControls();
  render();
  setStatus(`Maßstab 1:${state.scale} eingestellt`);
}
function styleAttrs(object) {
  const attrs = { stroke: object.stroke || state.strokeColor, 'stroke-width': object.strokeWidth || state.strokeWidth, fill: 'none', 'vector-effect': 'non-scaling-stroke', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  if (object.style === 'dashed') attrs['stroke-dasharray'] = '12 8';
  if (object.style === 'center') attrs['stroke-dasharray'] = '24 7 4 7';
  return attrs;
}
function rectFillAttrs(object) {
  if (object.fillMode === 'solid') return { fill: '#000000' };
  if (object.fillMode === 'hatch') return { fill: 'url(#hatchFill)' };
  if (object.fillMode === 'crosshatch') return { fill: 'url(#crossHatchFill)' };
  if (object.fillMode === 'reverseHatch') return { fill: 'url(#reverseHatchFill)' };
  if (object.fillMode === 'horizontalHatch') return { fill: 'url(#horizontalHatchFill)' };
  if (object.fillMode === 'verticalHatch') return { fill: 'url(#verticalHatchFill)' };
  if (object.fillMode === 'dots') return { fill: 'url(#dotHatchFill)' };
  if (object.fillMode === 'brick') return { fill: 'url(#brickHatchFill)' };
  if (object.fillMode === 'concrete') return { fill: 'url(#concreteHatchFill)' };
  return { fill: 'none' };
}
function appendDimensionEnds(group, attrs, ax, ay, bx, by, color) {
  const style = dimensionStyle();
  const angle = Math.atan2(by - ay, bx - ax);
  if (style.endStyle === 'slash') {
    const slash = Math.PI / 4;
    const size = 10;
    [[ax, ay], [bx, by]].forEach(([x, y]) => {
      group.append(makeSvg('line', { ...attrs, x1: x - Math.cos(angle + slash) * size, y1: y - Math.sin(angle + slash) * size, x2: x + Math.cos(angle + slash) * size, y2: y + Math.sin(angle + slash) * size }));
    });
    return;
  }
  group.append(makeSvg('path', { ...attrs, d: `M ${ax} ${ay} l 8 -4 l 0 8 z M ${bx} ${by} l -8 -4 l 0 8 z`, fill: color }));
}
function renderObject(object, layer = drawingLayer) {
  let element;
  const attrs = styleAttrs(object);
  if (object.type === 'line') element = makeSvg('line', { ...attrs, x1: canvasValue(object.x1), y1: canvasValue(object.y1), x2: canvasValue(object.x2), y2: canvasValue(object.y2) });
  if (object.type === 'rect') {
    const centerX = canvasValue(object.x + object.width / 2); const centerY = canvasValue(object.y + object.height / 2);
    const path = rectShapePath(object);
    element = path ? makeSvg('path', { ...attrs, ...rectFillAttrs(object), d: path, transform: `rotate(${(object.rotation || 0) * 180 / Math.PI} ${centerX} ${centerY})` }) : makeSvg('rect', { ...attrs, ...rectFillAttrs(object), x: canvasValue(object.x), y: canvasValue(object.y), width: canvasValue(object.width), height: canvasValue(object.height), rx: object.cornerMode === 'round' ? canvasValue(object.cornerSize || 0) : 0, transform: `rotate(${(object.rotation || 0) * 180 / Math.PI} ${centerX} ${centerY})` });
  }
  if (object.type === 'circle') element = makeSvg('circle', { ...attrs, cx: canvasValue(object.x), cy: canvasValue(object.y), r: canvasValue(object.r) });
  if (object.type === 'semicircle') element = makeSvg('path', { ...attrs, d: semicirclePath(object) });
  if (object.type === 'polyline') element = makeSvg('polyline', { ...attrs, points: object.points.map(point => `${canvasValue(point.x)},${canvasValue(point.y)}`).join(' ') });
  if (object.type === 'polygon') element = makeSvg('polygon', { ...attrs, points: object.points.map(point => `${canvasValue(point.x)},${canvasValue(point.y)}`).join(' ') });
  if (object.type === 'ellipse') { const cx = canvasValue(object.x); const cy = canvasValue(object.y); element = makeSvg('ellipse', { ...attrs, cx, cy, rx: canvasValue(object.rx), ry: canvasValue(object.ry), transform: `rotate(${(object.rotation || 0) * 180 / Math.PI} ${cx} ${cy})` }); }
  if (object.type === 'ellipseArc') { const cx = canvasValue(object.x); const cy = canvasValue(object.y); element = makeSvg('path', { ...attrs, d: ellipseArcPath(object), transform: `rotate(${(object.rotation || 0) * 180 / Math.PI} ${cx} ${cy})` }); }
  if (object.type === 'slot') element = makeSvg('path', { ...attrs, d: slotPath(object) });
  if (object.type === 'angleDimension') {
    const style = dimensionStyle();
    const radius = Math.max(1, object.r || 500);
    const center = { x: canvasValue(object.cx), y: canvasValue(object.cy) };
    const start = polarPoint(center, radius / state.scale, object.startAngle || 0);
    const end = polarPoint(center, radius / state.scale, (object.startAngle || 0) + shortestAngleDelta(object.startAngle || 0, object.endAngle || 0));
    const mid = polarPoint(center, (radius + 180) / state.scale, (object.startAngle || 0) + shortestAngleDelta(object.startAngle || 0, object.endAngle || 0) / 2);
    element = makeSvg('g', { class: 'dimension-object' });
    element.append(
      makeSvg('line', { ...attrs, x1: center.x, y1: center.y, x2: start.x, y2: start.y }),
      makeSvg('line', { ...attrs, x1: center.x, y1: center.y, x2: end.x, y2: end.y }),
      makeSvg('path', { ...attrs, d: angleArcPath(object) })
    );
    const label = makeSvg('text', { x: mid.x, y: mid.y, 'text-anchor': 'middle', class: 'dimension-label', 'font-size': style.textSize });
    label.textContent = angleDimensionLabel(object);
    element.append(label);
  }
  if (object.type === 'dimension') {
    const { x1, y1, x2, y2 } = object;
    const dx = x2 - x1; const dy = y2 - y1; const length = Math.max(1, Math.round(Math.hypot(dx, dy)));
    const style = dimensionStyle();
    const offset = Number.isFinite(Number(object.offset)) ? Number(object.offset) : style.defaultOffset; const normal = { x: -dy / (length || 1), y: dx / (length || 1) };
    const ax = canvasValue(x1) + normal.x * offset; const ay = canvasValue(y1) + normal.y * offset; const bx = canvasValue(x2) + normal.x * offset; const by = canvasValue(y2) + normal.y * offset;
    element = makeSvg('g', { class: 'dimension-object' });
    element.append(makeSvg('line', { ...attrs, x1: canvasValue(x1), y1: canvasValue(y1), x2: ax, y2: ay }), makeSvg('line', { ...attrs, x1: canvasValue(x2), y1: canvasValue(y2), x2: bx, y2: by }), makeSvg('line', { ...attrs, x1: ax, y1: ay, x2: bx, y2: by }));
    appendDimensionEnds(element, attrs, ax, ay, bx, by, object.stroke || state.strokeColor);
    const label = makeSvg('text', { x: (ax + bx) / 2, y: (ay + by) / 2 - 7, 'text-anchor': 'middle', class: 'dimension-label', 'font-size': style.textSize });
    label.textContent = dimensionLabelText(object, length); element.append(label);
  }
  if (object.type === 'text') { const x = canvasValue(object.x); const y = canvasValue(object.y); element = makeSvg('text', { ...attrs, x, y, stroke: 'none', fill: object.stroke || state.strokeColor, 'font-size': 16, transform: `rotate(${(object.rotation || 0) * 180 / Math.PI} ${x} ${y})` }); element.textContent = object.value; }
  if (!element) return null;
  element.dataset.id = object.id;
  if (selectedIds.has(object.id) || object.id === selectedId) element.classList.add('selected-shape');
  element.addEventListener('pointerdown', event => { if (state.tool === 'select' && layer === drawingLayer && !isObjectLocked(object)) { event.preventDefault(); event.stopPropagation(); canvas.setPointerCapture?.(event.pointerId); startDraggingObject(object, eventPoint(event), event.shiftKey); } });
  element.addEventListener('contextmenu', event => { if (layer === drawingLayer && state.tool === 'select') { event.preventDefault(); if (!selectedIds.has(object.id)) selectObject(object.id); showContextMenu(event.clientX, event.clientY); } });
  layer.append(element);
  return element;
}
function render() {
  addFillPatterns(canvas);
  drawingLayer.replaceChildren(); activeViewObjects().forEach(object => renderObject(object));
  renderMaterialMarkers();
  emptyState.classList.toggle('hidden', activeViewObjects().length > 0);
  document.querySelector('#objectCount').textContent = state.objects.length;
  document.querySelector('#gridLayer').style.display = state.grid ? '' : 'none';
  document.querySelector('#zoomLabel').textContent = `${Math.round(state.zoom * 100)}%`;
  updateScaleUi();
  canvas.classList.toggle('select-mode', state.tool === 'select');
  if (selectedIds.size > 1) showMultiSelectionProperties();
  else if (selectedId) { const selected = state.objects.find(object => object.id === selectedId); if (selected) showProperties(selected); }
  renderHandles();
  renderObjectList();
  renderProjectWarnings();
  updateHistoryControls();
}
function renderMaterialMarkers() {
  activeViewObjects().forEach(object => {
    const labels = materialMarkersForObject(object);
    const point = labels.length ? materialMarkerPoint(object) : null;
    if (!point) return;
    const group = makeSvg('g', { class: 'material-marker' });
    const x = canvasValue(point.x); const y = canvasValue(point.y);
    group.append(makeSvg('circle', { cx: x, cy: y, r: 13 }));
    const text = makeSvg('text', { x, y: y + 4, 'text-anchor': 'middle' });
    text.textContent = labels.map(label => label.replace('Pos. ', '')).join('/');
    group.append(text);
    drawingLayer.append(group);
  });
}
function newId() { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function snapshotObjects() { return JSON.stringify(state.objects); }
function restoreObjects(snapshot) { state.objects = JSON.parse(snapshot); selectedId = null; selectedIds.clear(); render(); }
function setDirty(dirty = true) {
  state.dirty = dirty;
  document.title = `${dirty ? '* ' : ''}${documentTitle}`;
}
function updateHistoryControls() {
  const undoButton = document.querySelector('#undoAction');
  const redoButton = document.querySelector('#redoAction');
  if (undoButton) undoButton.disabled = !state.history.length;
  if (redoButton) redoButton.disabled = !state.redo.length;
}
function pushHistory() { state.history.push(snapshotObjects()); state.redo = []; if (state.history.length > 30) state.history.shift(); setDirty(); }
function undo() { if (!state.history.length) { setStatus('Nichts zum Rückgängig machen'); return; } state.redo.push(snapshotObjects()); restoreObjects(state.history.pop()); setDirty(); setStatus('Rückgängig'); }
function redo() { if (!state.redo.length) { setStatus('Nichts zum Wiederholen'); return; } state.history.push(snapshotObjects()); restoreObjects(state.redo.pop()); setDirty(); setStatus('Wiederholt'); }
function addObject(object) { pushHistory(); state.objects.push({ ...object, id: newId(), view: object.view || state.activeView, layer: object.layer || state.activeLayer || defaultLayerForType(object.type), style: state.style, strokeWidth: state.strokeWidth, stroke: state.strokeColor }); selectedId = null; selectedIds.clear(); render(); setStatus('Objekt hinzugefügt'); }
function selectedObjects() { return state.objects.filter(object => selectedIds.has(object.id)); }
function selectObject(id, additive = false) {
  if (additive && selectedIds.has(id)) selectedIds.delete(id);
  else { if (!additive) selectedIds.clear(); selectedIds.add(id); }
  selectedId = selectedIds.has(id) ? id : [...selectedIds].at(-1) || null;
  const object = state.objects.find(item => item.id === id);
  if (object) {
    if (state.activeView !== objectView(object)) saveActiveViewSettings();
    state.activeView = objectView(object);
    loadActiveViewSettings();
    if (!enabledViews().includes(state.activeView)) state.enabledViews = [...enabledViews(), state.activeView];
    syncViewControls();
  }
  render();
  if (object) setStatus(selectedIds.size > 1 ? `${selectedIds.size} Objekte ausgewählt` : `${toolNames[object.type] || 'Objekt'} ausgewählt`);
}
function setStatus(message) { statusText.textContent = message; }
function applyViewBox() {
  canvas.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
  state.zoom = 1200 / viewBox.width;
  if (state.viewSettings) ensureViewSetting().viewBox = { ...viewBox };
  document.querySelector('#zoomLabel').textContent = `${Math.round(state.zoom * 100)}%`;
}
function canvasScreenPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: viewBox.x + (event.clientX - rect.left) / rect.width * viewBox.width,
    y: viewBox.y + (event.clientY - rect.top) / rect.height * viewBox.height
  };
}
function setViewportZoom(nextZoom, anchor = { x: viewBox.x + viewBox.width / 2, y: viewBox.y + viewBox.height / 2 }) {
  const zoom = Math.max(0.25, Math.min(8, nextZoom));
  const width = 1200 / zoom;
  const height = 760 / zoom;
  const ratioX = (anchor.x - viewBox.x) / viewBox.width;
  const ratioY = (anchor.y - viewBox.y) / viewBox.height;
  viewBox = { x: anchor.x - width * ratioX, y: anchor.y - height * ratioY, width, height };
  applyViewBox();
}
function fitCanvasBounds(bounds) {
  if (!bounds) {
    viewBox = { x: 0, y: 0, width: 1200, height: 760 };
    applyViewBox();
    return;
  }
  const padding = 45;
  let minX = bounds.minX / state.scale - padding;
  let minY = bounds.minY / state.scale - padding;
  let width = Math.max(20, (bounds.maxX - bounds.minX) / state.scale + padding * 2);
  let height = Math.max(20, (bounds.maxY - bounds.minY) / state.scale + padding * 2);
  const aspect = 1200 / 760;
  if (width / height > aspect) {
    const nextHeight = width / aspect;
    minY -= (nextHeight - height) / 2;
    height = nextHeight;
  } else {
    const nextWidth = height * aspect;
    minX -= (nextWidth - width) / 2;
    width = nextWidth;
  }
  viewBox = { x: minX, y: minY, width, height };
  applyViewBox();
}
function fitAllObjects() { fitCanvasBounds(boundsForObjects(activeViewObjects())); setStatus(activeViewObjects().length ? 'Zeichnung eingepasst' : 'Gesamtansicht'); }
function fitSelectedObject() {
  const object = state.objects.find(item => item.id === selectedId);
  if (!object) { setStatus('Kein Objekt ausgewählt'); return; }
  fitCanvasBounds(objectBounds(object));
  setStatus('Auswahl eingepasst');
}
function objectSummary(object) {
  if (object.type === 'line') return formatLength(distance({ x: object.x1, y: object.y1 }, { x: object.x2, y: object.y2 }));
  if (object.type === 'dimension') return dimensionLabelText(object, distance({ x: object.x1, y: object.y1 }, { x: object.x2, y: object.y2 }));
  if (object.type === 'angleDimension') return angleDimensionLabel(object);
  if (object.type === 'rect') return `${formatLength(object.width)} x ${formatLength(object.height)}`;
  if (object.type === 'circle' || object.type === 'semicircle') return `R ${formatLength(object.r)}`;
  if (object.type === 'ellipse' || object.type === 'ellipseArc') return `${formatLength(object.rx * 2)} x ${formatLength(object.ry * 2)}`;
  if (object.type === 'slot') return `${formatLength(distance({ x: object.x1, y: object.y1 }, { x: object.x2, y: object.y2 }) + object.width)} x ${formatLength(object.width)}`;
  if (object.type === 'polygon') return `${object.points.length}-Eck`;
  if (object.type === 'text') return object.value || 'Text';
  return 'Objekt';
}
function renderObjectList() {
  const list = document.querySelector('#objectList');
  if (!list) return;
  list.replaceChildren();
  if (!state.objects.length) {
    const empty = document.createElement('div');
    empty.className = 'property-empty';
    empty.textContent = 'Keine Objekte.';
    list.append(empty);
    return;
  }
  const search = (document.querySelector('#objectSearch')?.value || '').toLowerCase(); const typeFilter = document.querySelector('#objectTypeFilter')?.value || ''; const viewFilter = document.querySelector('#objectViewFilter')?.value || ''; const layerFilter = document.querySelector('#objectLayerFilter')?.value || '';
  state.objects.forEach((object, index) => {
    const searchable = `${object.name || ''} ${toolNames[object.type] || object.type}`.toLowerCase();
    if ((search && !searchable.includes(search)) || (typeFilter && object.type !== typeFilter) || (viewFilter && objectView(object) !== viewFilter) || (layerFilter && objectLayer(object) !== layerFilter)) return;
    const row = document.createElement('div');
    const linked = state.materials.filter(item => item.objectId === object.id);
    const dimensions = state.objects.filter(item => item.type === 'dimension' && item.sourceRectId === object.id).length;
    const materialSuffix = `${dimensions ? ` | ${dimensions} Maß(e)` : ''}${linked.length ? ` | Material: ${linked.map(item => `${item.name || 'Teil'} x${item.objectQty || 1}`).join(', ')}` : ''}`;
    row.className = `object-row${object.id === selectedId ? ' active' : ''}`;
    row.innerHTML = `<button type="button" title="Sichtbarkeit">${object.visible === false ? '○' : '●'}</button><button type="button" title="Sperre">${isObjectLocked(object) ? '■' : '□'}</button><span title="${escapeHtml(materialSuffix || 'Keine Verknüpfungen')}">${escapeHtml(objectListLabel(object, index) + materialSuffix)}</span><button type="button" title="Auswählen">›</button>`;
    row.querySelector('button:first-child').addEventListener('click', event => { event.stopPropagation(); pushHistory(); object.visible = object.visible === false; render(); });
    row.querySelector('button:nth-child(2)').addEventListener('click', event => { event.stopPropagation(); pushHistory(); object.locked = !object.locked; render(); });
    row.querySelector('button:last-child').addEventListener('click', event => { event.stopPropagation(); selectObject(object.id); });
    row.addEventListener('click', () => selectObject(object.id));
    list.append(row);
  });
}
function clearPreview() { previewLayer.replaceChildren(); }
function previewLine(a, b) { clearPreview(); renderObject({ type: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, style: state.style, strokeWidth: state.strokeWidth, stroke: state.strokeColor }, previewLayer); }
function drawAngleLabel(start, end) {
  if (!start || !end || distance(start, end) < 1) return;
  const x = canvasValue(end.x);
  const y = canvasValue(end.y);
  const label = makeSvg('text', { x: x + 12, y: y - 12, fill: '#075e5a', 'font-size': 13, 'font-weight': 700, 'paint-order': 'stroke', stroke: '#fffdf8', 'stroke-width': 4, 'stroke-linejoin': 'round' });
  label.textContent = formatAngle(angleDegrees(start, end));
  previewLayer.append(label);
}
function addHandle(x, y, kind) {
  const handle = makeSvg('circle', { cx: canvasValue(x), cy: canvasValue(y), r: 6, class: 'handle-point', 'data-handle': kind });
  handle.addEventListener('pointerdown', event => {
    event.preventDefault();
    event.stopPropagation();
    const object = state.objects.find(item => item.id === selectedId);
    if (!object) return;
    pushHistory();
    draggingHandle = { object, kind };
    canvas.setPointerCapture?.(event.pointerId);
  });
  drawingLayer.append(handle);
}
function renderHandles() {
  const object = state.objects.find(item => item.id === selectedId && item.visible !== false && objectView(item) === state.activeView);
  if (!object || state.tool !== 'select') return;
  if (object.type === 'line' || object.type === 'dimension') {
    addHandle(object.x1, object.y1, 'p1');
    addHandle(object.x2, object.y2, 'p2');
  }
  if (object.type === 'rect' && Math.abs(object.rotation || 0) < 0.0001) {
    addHandle(object.x, object.y, 'nw');
    addHandle(object.x + object.width, object.y, 'ne');
    addHandle(object.x + object.width, object.y + object.height, 'se');
    addHandle(object.x, object.y + object.height, 'sw');
  }
  if (object.type === 'circle') addHandle(object.x + object.r, object.y, 'radius');
  if (object.type === 'semicircle') {
    const start = polarPoint(object, object.r, object.angle || 0);
    const end = polarPoint(object, object.r, (object.angle || 0) + Math.PI);
    addHandle(start.x, start.y, 'arcStart');
    addHandle(end.x, end.y, 'arcEnd');
  }
}
function moveHandle(point) {
  if (!draggingHandle) return;
  const { object, kind } = draggingHandle;
  if (kind === 'p1') { object.x1 = point.x; object.y1 = point.y; }
  if (kind === 'p2') { object.x2 = point.x; object.y2 = point.y; }
  if (object.type === 'rect') {
    const right = object.x + object.width; const bottom = object.y + object.height;
    let x1 = object.x; let y1 = object.y; let x2 = right; let y2 = bottom;
    if (kind === 'nw') { x1 = point.x; y1 = point.y; }
    if (kind === 'ne') { x2 = point.x; y1 = point.y; }
    if (kind === 'se') { x2 = point.x; y2 = point.y; }
    if (kind === 'sw') { x1 = point.x; y2 = point.y; }
    object.x = Math.min(x1, x2); object.y = Math.min(y1, y2); object.width = Math.max(1, Math.abs(x2 - x1)); object.height = Math.max(1, Math.abs(y2 - y1));
  }
  if (object.type === 'circle' && kind === 'radius') object.r = Math.max(1, distance({ x: object.x, y: object.y }, point));
  if (object.type === 'semicircle' && (kind === 'arcStart' || kind === 'arcEnd')) {
    object.r = Math.max(1, distance({ x: object.x, y: object.y }, point));
    object.angle = Math.atan2(point.y - object.y, point.x - object.x) - (kind === 'arcEnd' ? Math.PI : 0);
  }
  render();
}
function previewPolyline(currentPoint = null) {
  clearPreview();
  if (!polylinePoints.length) return;
  const points = currentPoint ? [...polylinePoints, currentPoint] : polylinePoints;
  if (points.length > 1) renderObject({ type: 'polyline', points, style: state.style, strokeWidth: state.strokeWidth, stroke: state.strokeColor }, previewLayer);
}
function finishPolyline() {
  if (polylinePoints.length > 1) addObject({ type: 'polyline', points: polylinePoints });
  polylinePoints = [];
  pointerStart = null;
  clearPreview();
}
function drawSnapMarker() {
  if (!currentSnap) return;
  const x = canvasValue(currentSnap.point.x);
  const y = canvasValue(currentSnap.point.y);
  const group = makeSvg('g', { class: 'snap-marker' });
  if (currentSnap.guide) group.append(makeSvg('line', { x1: canvasValue(currentSnap.guide.x1), y1: canvasValue(currentSnap.guide.y1), x2: canvasValue(currentSnap.guide.x2), y2: canvasValue(currentSnap.guide.y2), class: 'snap-guide' }));
  group.append(
    makeSvg('circle', { cx: x, cy: y, r: 7, fill: 'none', stroke: '#f0a52d', 'stroke-width': 1.8, 'vector-effect': 'non-scaling-stroke' }),
    makeSvg('line', { x1: x - 10, y1: y, x2: x + 10, y2: y, stroke: '#f0a52d', 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke' }),
    makeSvg('line', { x1: x, y1: y - 10, x2: x, y2: y + 10, stroke: '#f0a52d', 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke' })
  );
  const label = makeSvg('text', { x: x + 12, y: y - 10, fill: '#9b5b00', 'font-size': 11, 'font-weight': 700 });
  label.textContent = currentSnap.type;
  group.append(label);
  previewLayer.append(group);
}
function applyAngleConstraint(start, current, event) {
  const angleInput = document.querySelector('#targetAngle')?.value;
  const fixedAngle = Number(angleInput);
  const useFixedAngle = angleInput !== '' && Number.isFinite(fixedAngle);
  if (!event?.shiftKey && !useFixedAngle) return current;
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return current;
  const angle = useFixedAngle ? fixedAngle * Math.PI / 180 : Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: start.x + Math.cos(angle) * length, y: start.y + Math.sin(angle) * length };
}
function exactRectEndPoint(start, current) {
  const widthInput = document.querySelector('#targetRectWidth')?.value;
  const heightInput = document.querySelector('#targetRectHeight')?.value;
  const width = Number(widthInput);
  const height = Number(heightInput);
  if (widthInput === '' || heightInput === '') return current;
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return current;
  return { x: start.x + width * (current.x < start.x ? -1 : 1), y: start.y + height * (current.y < start.y ? -1 : 1) };
}
function startDraggingObject(object, point, additive = false) {
  if (additive || !selectedIds.has(object.id)) selectObject(object.id, additive);
  if (object.groupId && !additive) state.objects.filter(item => item.groupId === object.groupId).forEach(item => selectedIds.add(item.id));
  selectedId = object.id;
  draggingObject = object;
  draggingObjects = selectedObjects().filter(item => !isObjectLocked(item));
  dragMode = object.type === 'dimension' ? 'dimensionOffset' : 'move';
  pointerStart = point;
  dragChanged = false;
  dragHistoryCaptured = false;
  render();
  setStatus(object.type === 'dimension' ? 'Bemaßungsabstand verschieben' : `${toolNames[object.type] || 'Objekt'} zum Verschieben ausgewählt`);
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
function unitInput(name, value, unit = 'mm', attrs = '') {
  return `<span class="unit-input"><input name="${name}" type="number" step="1" value="${value}" ${attrs}><span>${unit}</span></span>`;
}
function geometryFields(object) {
  if (object.type === 'line' || object.type === 'dimension') return `<label>X1 ${unitInput('x1', object.x1)}</label><label>Y1 ${unitInput('y1', object.y1)}</label><label>X2 ${unitInput('x2', object.x2)}</label><label>Y2 ${unitInput('y2', object.y2)}</label>${object.type === 'dimension' ? `<label class="wide-field">Maßlinienabstand ${unitInput('offset', Number.isFinite(Number(object.offset)) ? object.offset : dimensionStyle().defaultOffset, 'px')}</label><label>Einheit<select name="dimensionUnit"><option value="">Global</option><option value="auto">Auto</option><option value="m">m</option><option value="cm">cm</option><option value="mm">mm</option></select></label><label>Nachkommastellen<input name="dimensionDecimals" type="number" min="0" max="3" step="1" value="${object.dimensionDecimals ?? ''}" placeholder="${dimensionStyle().decimals}"></label><label class="wide-field">Maßtext manuell<input name="labelOverride" type="text" placeholder="leer = automatisch" value="${escapeHtml(object.labelOverride || '')}"></label>` : ''}`;
  if (object.type === 'circle') return `<label>X Mitte ${unitInput('x', object.x)}</label><label>Y Mitte ${unitInput('y', object.y)}</label><label class="wide-field">Radius ${unitInput('r', object.r, 'mm', 'min="1"')}</label>`;
  if (object.type === 'semicircle') return `<label>X Mitte ${unitInput('x', object.x)}</label><label>Y Mitte ${unitInput('y', object.y)}</label><label>Radius ${unitInput('r', object.r, 'mm', 'min="1"')}</label><label>Winkel ${unitInput('angleDeg', Math.round(((object.angle || 0) * 180 / Math.PI + 360) % 360), '°')}</label>`;
  if (object.type === 'ellipse' || object.type === 'ellipseArc') return `<label>X Mitte ${unitInput('x', object.x)}</label><label>Y Mitte ${unitInput('y', object.y)}</label><label>Radius X ${unitInput('rx', object.rx, 'mm', 'min="1"')}</label><label>Radius Y ${unitInput('ry', object.ry, 'mm', 'min="1"')}</label>`;
  if (object.type === 'slot') return `<label>X1 ${unitInput('x1', object.x1)}</label><label>Y1 ${unitInput('y1', object.y1)}</label><label>X2 ${unitInput('x2', object.x2)}</label><label>Y2 ${unitInput('y2', object.y2)}</label><label class="wide-field">Breite ${unitInput('width', object.width, 'mm', 'min="1"')}</label>`;
  if (object.type === 'angleDimension') return `<label>X Mitte ${unitInput('cx', object.cx)}</label><label>Y Mitte ${unitInput('cy', object.cy)}</label><label>Radius ${unitInput('r', object.r, 'mm', 'min="1"')}</label><label class="wide-field">Winkeltext manuell<input name="labelOverride" type="text" placeholder="leer = automatisch" value="${escapeHtml(object.labelOverride || '')}"></label>`;
  if (object.type === 'rect') return `<label>X ${unitInput('x', object.x)}</label><label>Y ${unitInput('y', object.y)}</label><label>Breite ${unitInput('width', object.width, 'mm', 'min="1"')}</label><label>Höhe ${unitInput('height', object.height, 'mm', 'min="1"')}</label><label>Ecken<select name="cornerMode"><option value="square">Rechtwinklig</option><option value="chamfer">Fase</option><option value="round">Abrundung</option></select></label><label>Eckmaß ${unitInput('cornerSize', object.cornerSize || 0, 'mm', 'min="0"')}</label><label class="wide-field">Füllung<select name="fillMode"><option value="none">Keine</option><option value="solid">Vollfarbe schwarz</option><option value="hatch">Diagonal 45°</option><option value="reverseHatch">Diagonal -45°</option><option value="crosshatch">Kreuzschraffur</option><option value="horizontalHatch">Horizontal</option><option value="verticalHatch">Vertikal</option><option value="dots">Punktraster</option><option value="brick">Mauerwerk / Ziegel</option><option value="concrete">Beton</option></select></label>`;
  if (object.type === 'text') return `<label class="wide-field">Text<input name="value" type="text" value="${escapeHtml(object.value)}"></label><label>X ${unitInput('x', object.x)}</label><label>Y ${unitInput('y', object.y)}</label>`;
  return '<div class="property-note">Dieses Objekt hat derzeit keine zusätzlichen Eigenschaften.</div>';
}
function showProperties(object) {
  document.querySelector('#selectionCount').textContent = '1 ausgewählt';
  const measuredLength = object.type === 'line' || object.type === 'dimension' ? distance({ x: object.x1, y: object.y1 }, { x: object.x2, y: object.y2 }) : 0;
  const dimension = object.type === 'dimension' ? dimensionLabelText(object, measuredLength) : object.type === 'angleDimension' ? angleDimensionLabel(object) : object.type === 'line' ? formatLength(measuredLength) : object.type === 'rect' ? `${formatLength(object.width)} x ${formatLength(object.height)}` : object.type === 'circle' || object.type === 'semicircle' ? `R ${formatLength(object.r)}` : objectSummary(object);
  const rectHasAutoDimensions = object.type === 'rect' && state.objects.some(item => item.type === 'dimension' && item.sourceRectId === object.id);
  const referenceViewName = viewNames[objectView(object)];
  const referenceControl = object.type === 'line' || object.type === 'dimension' ? `<details class="reference-box" open><summary>Richtmaß dieses Objekts</summary><span>Kalibriert nur dieses Objekt und seine verknüpften Bemaßungen. Geometrie und Ansicht bleiben unverändert.</span><div class="reference-row"><input id="referenceLength" type="number" min="1" step="1" value="${Math.round(calibratedLength(measuredLength || 1800, object))}"><span>mm</span><button id="setReference" class="reference-button">Übernehmen</button></div></details>` : object.type === 'rect' ? `<details class="reference-box" open><summary>Richtmaß dieses Objekts</summary><span>Kalibriert nur die ausgewählte Rechteckachse: Höhe oder Breite. Die jeweils andere Achse bleibt unverändert.</span><div class="reference-row reference-row-stack"><select id="referenceRectSide"><option value="height" selected>Höhe</option><option value="width">Breite</option></select><div class="reference-length-line"><input id="referenceLength" type="number" min="1" step="1" value="${Math.round(calibratedLength(object.height || 1800, object, 'height'))}"><span>mm</span></div><button id="setReference" class="reference-button">Übernehmen</button><button id="addRectDimensions" class="reference-button">${rectHasAutoDimensions ? 'Bemaßung entfernen' : 'Breite und Höhe bemaßen'}</button></div></details>` : '';
  const referenceResetControl = object.referenceScale ? '<button id="clearReference" class="copy-button">Richtmaß dieses Objekts entfernen</button>' : '';
  const rectControls = '';
  const circleControls = object.type === 'circle' || object.type === 'semicircle' ? `<button id="addRadiusDimension" class="copy-button">Radius bemaßen</button><button id="addDiameterDimension" class="copy-button">Durchmesser bemaßen</button>` : '';
  const angleControls = object.type === 'line' ? `<button id="rememberAngleLine" class="copy-button">Linie 1 merken</button><button id="addAngleDimension" class="copy-button">Winkel zu Linie 1</button>` : '';
  const transformControls = `<details class="operation-box" open><summary>Transformieren &amp; duplizieren</summary><div class="operation-grid"><label>Δ X ${unitInput('moveX', 0)}</label><label>Δ Y ${unitInput('moveY', 0)}</label><button id="moveExact" type="button">Verschieben</button><button id="duplicateExact" type="button">Duplizieren</button><label class="wide-field">Drehwinkel ${unitInput('rotateAngle', 0, '°')}</label><button id="rotateExact" type="button">Drehen</button><button id="mirrorHorizontal" type="button">Horizontal spiegeln</button><button id="mirrorVertical" type="button">Vertikal spiegeln</button></div><div class="operation-subheading">Rechteckige Wiederholung</div><div class="operation-grid"><label>Anzahl X<input name="arrayX" type="number" min="1" max="50" value="2"></label><label>Anzahl Y<input name="arrayY" type="number" min="1" max="50" value="2"></label><label>Abstand X ${unitInput('arrayDx', 500)}</label><label>Abstand Y ${unitInput('arrayDy', 500)}</label><button id="rectArray" class="wide-field" type="button">Wiederholen</button></div><div class="operation-subheading">Kreisförmige Wiederholung</div><div class="operation-grid"><label>Anzahl<input name="circleCount" type="number" min="2" max="100" value="6"></label><label>Gesamtwinkel ${unitInput('circleAngle', 360, '°')}</label><label>Zentrum X ${unitInput('circleCenterX', 0)}</label><label>Zentrum Y ${unitInput('circleCenterY', 0)}</label><button id="circleArray" class="wide-field" type="button">Wiederholen</button></div></details>`;
  const lineEditControls = object.type === 'line' ? `<details class="operation-box" open><summary>Linie bearbeiten</summary><div class="operation-grid"><label class="wide-field">Länge ${unitInput('lineEditLength', Math.round(measuredLength / 2), 'mm', 'min="1"')}</label><button id="trimStart" type="button">Anfang trimmen</button><button id="trimEnd" type="button">Ende trimmen</button><button id="extendStart" type="button">Anfang verlängern</button><button id="extendEnd" type="button">Ende verlängern</button><button id="splitLine" class="wide-field" type="button">Bei Länge teilen</button></div></details>` : '';
  const layerOptions = state.layers.map(layer => `<option value="${escapeHtml(layer.id)}">${escapeHtml(layer.name)}</option>`).join('');
  propertyPanel.innerHTML = `<div class="property-form"><label class="wide-field">Objektname<input name="name" value="${escapeHtml(object.name || '')}" placeholder="${toolNames[object.type] || object.type}"></label><label>Typ<input value="${toolNames[object.type] || object.type}" readonly></label><label>Abmessung<input value="${dimension}" readonly></label>${geometryFields(object)}<label>Linienstärke<input name="strokeWidth" type="number" min="0.25" max="2.5" step="0.25" value="${object.strokeWidth}"></label><label>Stil<select name="style"><option value="solid" ${object.style === 'solid' ? 'selected' : ''}>Volllinie</option><option value="dashed" ${object.style === 'dashed' ? 'selected' : ''}>Strichlinie</option><option value="center" ${object.style === 'center' ? 'selected' : ''}>Achse</option></select></label><label>Farbe<input name="stroke" type="color" value="${object.stroke || state.strokeColor}"></label><label>Ebene<select name="layer">${layerOptions}</select></label><label>Gesperrt<select name="locked"><option value="false">Nein</option><option value="true">Ja</option></select></label><label class="wide-field">Ansicht<select name="view"><option value="front">Frontansicht</option><option value="side">Seitenansicht</option><option value="top">Draufsicht</option><option value="detail">Detail</option></select></label></div>${referenceControl}${referenceResetControl}${rectControls}${circleControls}${angleControls}${transformControls}${lineEditControls}<button id="addObjectMaterial" class="copy-button">Als Materialposition übernehmen</button><button id="copyObject" class="copy-button">Kopieren</button><button id="deleteSelected" class="delete-button">Auswahl löschen</button>`;
  propertyPanel.querySelector('.property-form').addEventListener('change', applySelectedChanges);
  document.querySelector('[name="view"]').value = objectView(object);
  document.querySelector('[name="layer"]').value = objectLayer(object);
  document.querySelector('[name="locked"]').value = String(object.locked === true);
  if (object.type === 'rect') document.querySelector('[name="cornerMode"]').value = object.cornerMode || 'square';
  if (object.type === 'rect') document.querySelector('[name="fillMode"]').value = object.fillMode || 'none';
  if (object.type === 'dimension' && document.querySelector('[name="dimensionUnit"]')) document.querySelector('[name="dimensionUnit"]').value = object.dimensionUnit || '';
  document.querySelector('#setReference')?.addEventListener('click', setSelectedAsReference);
  document.querySelector('#clearReference')?.addEventListener('click', clearSelectedReference);
  document.querySelector('#referenceRectSide')?.addEventListener('change', event => { document.querySelector('#referenceLength').value = Math.round(calibratedLength(event.target.value === 'width' ? object.width : object.height, object, event.target.value)); });
  document.querySelector('#addRectDimensions')?.addEventListener('click', addRectDimensions);
  document.querySelector('#addRadiusDimension')?.addEventListener('click', addRadiusDimension);
  document.querySelector('#addDiameterDimension')?.addEventListener('click', addDiameterDimension);
  document.querySelector('#rememberAngleLine')?.addEventListener('click', rememberAngleLine);
  document.querySelector('#addAngleDimension')?.addEventListener('click', addAngleDimension);
  document.querySelector('#moveExact')?.addEventListener('click', moveSelectedExact);
  document.querySelector('#duplicateExact')?.addEventListener('click', duplicateSelectedExact);
  document.querySelector('#rotateExact')?.addEventListener('click', rotateSelectedExact);
  document.querySelector('#mirrorHorizontal')?.addEventListener('click', () => mirrorSelected('horizontal'));
  document.querySelector('#mirrorVertical')?.addEventListener('click', () => mirrorSelected('vertical'));
  document.querySelector('#rectArray')?.addEventListener('click', createRectangularArray);
  document.querySelector('#circleArray')?.addEventListener('click', createCircularArray);
  document.querySelector('#trimStart')?.addEventListener('click', () => resizeSelectedLine('start', 'trim'));
  document.querySelector('#trimEnd')?.addEventListener('click', () => resizeSelectedLine('end', 'trim'));
  document.querySelector('#extendStart')?.addEventListener('click', () => resizeSelectedLine('start', 'extend'));
  document.querySelector('#extendEnd')?.addEventListener('click', () => resizeSelectedLine('end', 'extend'));
  document.querySelector('#splitLine')?.addEventListener('click', splitSelectedLine);
  document.querySelector('#addObjectMaterial')?.addEventListener('click', addSelectedToMaterialList);
  document.querySelector('#copyObject').addEventListener('click', copySelected);
  document.querySelector('#deleteSelected').addEventListener('click', deleteSelected);
}
function showMultiSelectionProperties() {
  const objects = selectedObjects();
  document.querySelector('#selectionCount').textContent = `${objects.length} ausgewählt`;
  const grouped = objects.every(object => object.groupId && object.groupId === objects[0].groupId);
  propertyPanel.innerHTML = `<div class="property-note">${objects.length} Objekte ausgewählt.</div><div class="operation-grid multi-actions"><button id="groupSelection" type="button">Gruppieren</button><button id="ungroupSelection" type="button">Gruppierung aufheben</button><button id="copyObject" type="button">Kopieren</button><label class="wide-field">Drehwinkel ${unitInput('rotateAngle', 90, '°')}</label><button id="rotateExact" type="button">Gemeinsam drehen</button><button id="mirrorHorizontal" type="button">Horizontal spiegeln</button><button id="mirrorVertical" type="button">Vertikal spiegeln</button><button id="deleteSelected" type="button">Auswahl löschen</button></div>${grouped ? `<div class="property-note">Gemeinsame Gruppe</div>` : ''}`;
  document.querySelector('#groupSelection').addEventListener('click', groupSelection);
  document.querySelector('#ungroupSelection').addEventListener('click', ungroupSelection);
  document.querySelector('#copyObject').addEventListener('click', copySelected);
  document.querySelector('#rotateExact').addEventListener('click', rotateSelectedExact);
  document.querySelector('#mirrorHorizontal').addEventListener('click', () => mirrorSelected('horizontal'));
  document.querySelector('#mirrorVertical').addEventListener('click', () => mirrorSelected('vertical'));
  document.querySelector('#deleteSelected').addEventListener('click', deleteSelected);
}
function groupSelection() {
  const objects = selectedObjects(); if (objects.length < 2) return;
  pushHistory(); const groupId = `gruppe-${newId()}`; objects.forEach(object => { object.groupId = groupId; }); render(); setStatus(`${objects.length} Objekte gruppiert`);
}
function ungroupSelection() {
  const objects = selectedObjects(); if (!objects.length) return;
  pushHistory(); objects.forEach(object => { delete object.groupId; }); render(); setStatus('Gruppierung aufgehoben');
}
function operationNumber(name, fallback = 0) {
  const value = Number(propertyPanel.querySelector(`[name="${name}"]`)?.value);
  return Number.isFinite(value) ? value : fallback;
}
function rotatePoint(point, center, angle) {
  const cos = Math.cos(angle); const sin = Math.sin(angle); const dx = point.x - center.x; const dy = point.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}
function objectCenter(object) {
  const bounds = objectBounds(object);
  return bounds ? { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 } : { x: 0, y: 0 };
}
function translateObject(object, dx, dy) {
  if (object.type === 'line' || object.type === 'dimension') { object.x1 += dx; object.y1 += dy; object.x2 += dx; object.y2 += dy; }
  if (object.type === 'rect' || object.type === 'circle' || object.type === 'semicircle' || object.type === 'ellipse' || object.type === 'ellipseArc' || object.type === 'text') { object.x += dx; object.y += dy; }
  if (object.type === 'slot') { object.x1 += dx; object.y1 += dy; object.x2 += dx; object.y2 += dy; }
  if (object.type === 'angleDimension') { object.cx += dx; object.cy += dy; }
  if (object.type === 'polyline' || object.type === 'polygon') object.points.forEach(point => { point.x += dx; point.y += dy; });
  syncLinkedDimensions(object);
}
function rotateObject(object, angle, center = objectCenter(object)) {
  if (object.type === 'line' || object.type === 'dimension') {
    const a = rotatePoint({ x: object.x1, y: object.y1 }, center, angle); const b = rotatePoint({ x: object.x2, y: object.y2 }, center, angle);
    object.x1 = a.x; object.y1 = a.y; object.x2 = b.x; object.y2 = b.y;
  }
  if (object.type === 'rect') {
    const currentCenter = { x: object.x + object.width / 2, y: object.y + object.height / 2 };
    const rotatedCenter = rotatePoint(currentCenter, center, angle);
    object.x = rotatedCenter.x - object.width / 2; object.y = rotatedCenter.y - object.height / 2;
    object.rotation = (object.rotation || 0) + angle;
  }
  if (object.type === 'semicircle') object.angle = (object.angle || 0) + angle;
  if (object.type === 'polyline' || object.type === 'polygon') object.points = object.points.map(point => rotatePoint(point, center, angle));
  if (object.type === 'slot') { const a = rotatePoint({ x: object.x1, y: object.y1 }, center, angle); const b = rotatePoint({ x: object.x2, y: object.y2 }, center, angle); Object.assign(object, { x1: a.x, y1: a.y, x2: b.x, y2: b.y }); }
  if (object.type === 'angleDimension') { const point = rotatePoint({ x: object.cx, y: object.cy }, center, angle); object.cx = point.x; object.cy = point.y; object.startAngle += angle; object.endAngle += angle; }
  if (object.type === 'text') { const point = rotatePoint({ x: object.x, y: object.y }, center, angle); object.x = point.x; object.y = point.y; object.rotation = (object.rotation || 0) + angle; }
  if (object.type === 'circle' || object.type === 'ellipse' || object.type === 'ellipseArc') { const point = rotatePoint({ x: object.x, y: object.y }, center, angle); object.x = point.x; object.y = point.y; object.rotation = (object.rotation || 0) + angle; }
  if (object.type === 'semicircle') { const point = rotatePoint({ x: object.x, y: object.y }, center, angle); object.x = point.x; object.y = point.y; }
  syncLinkedDimensions(object);
}
function cloneObject(object) { const copy = JSON.parse(JSON.stringify(object)); copy.id = newId(); delete copy.sourceRectId; delete copy.autoRectSide; return copy; }
function moveSelectedExact() {
  const object = state.objects.find(item => item.id === selectedId); if (!object) return;
  pushHistory(); translateObject(object, operationNumber('moveX'), operationNumber('moveY')); render(); setStatus('Objekt exakt verschoben');
}
function duplicateSelectedExact() {
  const object = state.objects.find(item => item.id === selectedId); if (!object) return;
  pushHistory(); const copy = cloneObject(object); translateObject(copy, operationNumber('moveX'), operationNumber('moveY')); state.objects.push(copy); selectedId = copy.id; render(); setStatus('Exaktes Duplikat erstellt');
}
function rotateSelectedExact() {
  const objects = selectedObjects(); if (!objects.length) return;
  const bounds = boundsForObjects(objects); const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  pushHistory(); const angle = operationNumber('rotateAngle') * Math.PI / 180; objects.forEach(object => rotateObject(object, angle, center)); render(); setStatus(`${objects.length} Objekt(e) gedreht`);
}
function mirrorPoint(point, center, axis) { return axis === 'horizontal' ? { x: point.x, y: center.y * 2 - point.y } : { x: center.x * 2 - point.x, y: point.y }; }
function mirrorSelected(axis) {
  const objects = selectedObjects(); if (!objects.length) return;
  const bounds = boundsForObjects(objects); const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }; pushHistory();
  objects.forEach(object => {
    if (object.type === 'line' || object.type === 'dimension') { const a = mirrorPoint({ x: object.x1, y: object.y1 }, center, axis); const b = mirrorPoint({ x: object.x2, y: object.y2 }, center, axis); Object.assign(object, { x1: a.x, y1: a.y, x2: b.x, y2: b.y }); }
    if (object.type === 'polyline' || object.type === 'polygon') object.points = object.points.map(point => mirrorPoint(point, center, axis));
    if (object.type === 'slot') { const a = mirrorPoint({ x: object.x1, y: object.y1 }, center, axis); const b = mirrorPoint({ x: object.x2, y: object.y2 }, center, axis); Object.assign(object, { x1: a.x, y1: a.y, x2: b.x, y2: b.y }); }
    if (['rect', 'circle', 'semicircle', 'ellipse', 'ellipseArc', 'text'].includes(object.type)) { const oldCenter = objectCenter(object); const nextCenter = mirrorPoint(oldCenter, center, axis); translateObject(object, nextCenter.x - oldCenter.x, nextCenter.y - oldCenter.y); }
    if (object.type === 'rect') object.rotation = axis === 'horizontal' ? -(object.rotation || 0) : Math.PI - (object.rotation || 0);
    if (object.type === 'ellipse' || object.type === 'ellipseArc') object.rotation = axis === 'horizontal' ? -(object.rotation || 0) : Math.PI - (object.rotation || 0);
    if (object.type === 'semicircle') object.angle = axis === 'horizontal' ? -(object.angle || 0) : Math.PI - (object.angle || 0);
    if (object.type === 'angleDimension') { const next = mirrorPoint({ x: object.cx, y: object.cy }, center, axis); object.cx = next.x; object.cy = next.y; object.startAngle = axis === 'horizontal' ? -object.startAngle : Math.PI - object.startAngle; object.endAngle = axis === 'horizontal' ? -object.endAngle : Math.PI - object.endAngle; }
    if (object.type === 'text') object.rotation = axis === 'horizontal' ? -(object.rotation || 0) : Math.PI - (object.rotation || 0);
    syncLinkedDimensions(object);
  });
  render(); setStatus(`${objects.length} Objekt(e) ${axis === 'horizontal' ? 'horizontal' : 'vertikal'} gespiegelt`);
}
function createRectangularArray() {
  const object = state.objects.find(item => item.id === selectedId); if (!object) return;
  const countX = Math.max(1, Math.min(50, Math.round(operationNumber('arrayX', 2)))); const countY = Math.max(1, Math.min(50, Math.round(operationNumber('arrayY', 2))));
  const dx = operationNumber('arrayDx'); const dy = operationNumber('arrayDy'); pushHistory();
  for (let row = 0; row < countY; row++) for (let column = 0; column < countX; column++) if (row || column) { const copy = cloneObject(object); translateObject(copy, column * dx, row * dy); state.objects.push(copy); }
  render(); setStatus(`${countX * countY} Objekte rechteckig angeordnet`);
}
function createCircularArray() {
  const object = state.objects.find(item => item.id === selectedId); if (!object) return;
  const count = Math.max(2, Math.min(100, Math.round(operationNumber('circleCount', 6)))); const total = operationNumber('circleAngle', 360) * Math.PI / 180;
  const center = { x: operationNumber('circleCenterX'), y: operationNumber('circleCenterY') }; const divisor = Math.abs(Math.abs(total) - Math.PI * 2) < 0.0001 ? count : count - 1; pushHistory();
  for (let index = 1; index < count; index++) { const copy = cloneObject(object); rotateObject(copy, total * index / divisor, center); state.objects.push(copy); }
  render(); setStatus(`${count} Objekte kreisförmig angeordnet`);
}
function resizeSelectedLine(end, mode) {
  const object = state.objects.find(item => item.id === selectedId && item.type === 'line'); if (!object) return;
  const amount = Math.max(0, operationNumber('lineEditLength')); const length = distance({ x: object.x1, y: object.y1 }, { x: object.x2, y: object.y2 });
  if (mode === 'trim' && amount >= length - 1) { setStatus('Trimmlänge ist zu groß'); return; }
  const ux = (object.x2 - object.x1) / length; const uy = (object.y2 - object.y1) / length; const direction = mode === 'trim' ? 1 : -1; pushHistory();
  if (end === 'start') { object.x1 += ux * amount * direction; object.y1 += uy * amount * direction; }
  else { object.x2 -= ux * amount * direction; object.y2 -= uy * amount * direction; }
  render(); setStatus(`Linie ${mode === 'trim' ? 'getrimmt' : 'verlängert'}`);
}
function splitSelectedLine() {
  const object = state.objects.find(item => item.id === selectedId && item.type === 'line'); if (!object) return;
  const length = distance({ x: object.x1, y: object.y1 }, { x: object.x2, y: object.y2 }); const split = operationNumber('lineEditLength', length / 2);
  if (split <= 0 || split >= length) { setStatus('Teilpunkt muss innerhalb der Linie liegen'); return; }
  const ratio = split / length; const point = { x: object.x1 + (object.x2 - object.x1) * ratio, y: object.y1 + (object.y2 - object.y1) * ratio }; pushHistory();
  const second = cloneObject(object); second.x1 = point.x; second.y1 = point.y; object.x2 = point.x; object.y2 = point.y; state.objects.push(second); render(); setStatus('Linie geteilt');
}
function scaleObject(object, factor) {
  if (object.type === 'line' || object.type === 'dimension') { object.x1 *= factor; object.y1 *= factor; object.x2 *= factor; object.y2 *= factor; }
  if (object.type === 'rect') { object.x *= factor; object.y *= factor; object.width *= factor; object.height *= factor; }
  if (object.type === 'circle' || object.type === 'semicircle') { object.x *= factor; object.y *= factor; object.r *= factor; }
  if (object.type === 'ellipse' || object.type === 'ellipseArc') { object.x *= factor; object.y *= factor; object.rx *= factor; object.ry *= factor; }
  if (object.type === 'slot') { object.x1 *= factor; object.y1 *= factor; object.x2 *= factor; object.y2 *= factor; object.width *= factor; }
  if (object.type === 'angleDimension') { object.cx *= factor; object.cy *= factor; object.r *= factor; }
  if (object.type === 'polyline' || object.type === 'polygon') object.points.forEach(point => { point.x *= factor; point.y *= factor; });
  if (object.type === 'text') { object.x *= factor; object.y *= factor; }
}
function setSelectedAsReference() {
  const object = state.objects.find(item => item.id === selectedId);
  const targetLength = Number(document.querySelector('#referenceLength')?.value);
  if (!object || !Number.isFinite(targetLength) || targetLength <= 0) return;
  let currentLength = 0;
  if (object.type === 'line' || object.type === 'dimension') currentLength = distance({ x: object.x1, y: object.y1 }, { x: object.x2, y: object.y2 });
  if (object.type === 'rect') currentLength = document.querySelector('#referenceRectSide')?.value === 'width' ? object.width : object.height;
  if (currentLength < 0.001) { setStatus('Richtmaß benötigt eine vorhandene Länge'); return; }
  const factor = targetLength / currentLength;
  const referenceSide = object.type === 'rect' ? document.querySelector('#referenceRectSide')?.value : 'length';
  object.referenceScale = { targetLength, factor, side: referenceSide, updatedAt: new Date().toISOString() };
  setDirty();
  render();
  setStatus(`Richtmaß für ${object.name || toolNames[object.type] || 'Objekt'} auf ${formatLength(targetLength)} gesetzt`);
}
function clearSelectedReference() {
  const object = state.objects.find(item => item.id === selectedId); if (!object?.referenceScale) return;
  delete object.referenceScale; setDirty(); render(); setStatus('Richtmaß dieses Objekts entfernt');
}
function applySelectedChanges() {
  const object = state.objects.find(item => item.id === selectedId);
  if (!object) return;
  const form = propertyPanel.querySelector('.property-form');
  const values = Object.fromEntries([...form.querySelectorAll('[name]')].map(input => [input.name, input.value]));
  pushHistory();
  Object.keys(values).forEach(key => { object[key] = ['strokeWidth', 'x', 'y', 'cx', 'cy', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'offset', 'r', 'rx', 'ry', 'cornerSize', 'angleDeg', 'dimensionDecimals'].includes(key) && values[key] !== '' ? Number(values[key]) : values[key]; });
  object.locked = values.locked === 'true';
  if (object.type === 'semicircle' && Number.isFinite(object.angleDeg)) { object.angle = object.angleDeg * Math.PI / 180; delete object.angleDeg; }
  if ((object.type === 'dimension' || object.type === 'angleDimension') && !String(object.labelOverride || '').trim()) delete object.labelOverride;
  if (object.type === 'dimension' && !object.dimensionUnit) delete object.dimensionUnit;
  if (object.type === 'dimension' && object.dimensionDecimals === '') delete object.dimensionDecimals;
  if (object.type === 'rect') { object.width = Math.max(1, object.width); object.height = Math.max(1, object.height); }
  if ((object.type === 'circle' || object.type === 'semicircle' || object.type === 'angleDimension') && (!Number.isFinite(object.r) || object.r < 1)) object.r = 1;
  if (object.strokeWidth < 0.25 || !Number.isFinite(object.strokeWidth)) object.strokeWidth = 0.75;
  syncLinkedDimensions(object);
  state.activeView = objectView(object);
  if (!enabledViews().includes(state.activeView)) state.enabledViews = [...enabledViews(), state.activeView];
  syncViewControls();
  render();
  setStatus('Änderungen übernommen');
}
function showContextMenu(x, y) { const menu = document.querySelector('#contextMenu'); menu.hidden = false; menu.style.left = `${Math.min(x, innerWidth - 190)}px`; menu.style.top = `${Math.max(6, Math.min(y, innerHeight - menu.offsetHeight - 6))}px`; }
function hideContextMenu() { document.querySelector('#contextMenu').hidden = true; }
function dimensionSelectedFromMenu() {
  const object = state.objects.find(item => item.id === selectedId); if (!object) return;
  if (object.type === 'rect') addRectDimensions();
  else if (object.type === 'circle' || object.type === 'semicircle') addRadiusDimension();
  else if (object.type === 'line') { pushHistory(); state.objects.push({ type: 'dimension', id: newId(), sourceObjectId: object.id, view: objectView(object), layer: 'dimension', x1: object.x1, y1: object.y1, x2: object.x2, y2: object.y2, offset: dimensionStyle().defaultOffset, style: state.style, strokeWidth: state.strokeWidth, stroke: state.strokeColor }); render(); setStatus('Linie bemaßt'); }
  else setStatus('Für diesen Objekttyp ist keine Schnellbemaßung verfügbar');
}
function syncLinkedDimensions(object) {
  if (!object || object.type !== 'rect') return;
  const [topLeft, topRight, bottomRight, bottomLeft] = rectCorners(object);
  state.objects.filter(item => item.type === 'dimension' && item.sourceRectId === object.id).forEach(item => {
    if (item.autoRectSide === 'width') { item.x1 = bottomLeft.x; item.y1 = bottomLeft.y; item.x2 = bottomRight.x; item.y2 = bottomRight.y; }
    if (item.autoRectSide === 'height') { item.x1 = bottomRight.x; item.y1 = bottomRight.y; item.x2 = topRight.x; item.y2 = topRight.y; }
  });
}
function deleteSelected() { if (!selectedIds.size && !selectedId) return; pushHistory(); const ids = selectedIds.size ? new Set(selectedIds) : new Set([selectedId]); state.objects = state.objects.filter(object => !ids.has(object.id)); selectedId = null; selectedIds.clear(); propertyPanel.innerHTML = '<div class="property-empty">Objekt anklicken, um seine Eigenschaften zu sehen.</div>'; document.querySelector('#selectionCount').textContent = 'Nichts ausgewählt'; render(); setStatus(`${ids.size} Objekt(e) gelöscht`); }
function copySelected() {
  const objects = selectedObjects(); if (!objects.length) return;
  const selectedSourceIds = new Set(objects.map(object => object.id));
  const linkedDimensions = state.objects.filter(object => object.type === 'dimension' && !selectedSourceIds.has(object.id) && (selectedSourceIds.has(object.sourceRectId) || selectedSourceIds.has(object.sourceObjectId)));
  const sources = [...objects, ...linkedDimensions];
  clipboard = JSON.parse(JSON.stringify(sources));
  clipboardSourceScale = state.scale;
  setStatus(`${sources.length} Objekt(e) kopiert – Strg+V zum Einfügen`);
}
function pasteClipboardToView(targetView) {
  if (!clipboard || !viewNames[targetView]) { setStatus('Keine gültige Kopie oder Zielansicht'); return; }
  const sources = Array.isArray(clipboard) ? clipboard : [clipboard];
  const targetScale = Math.max(1, Number(ensureViewSetting(targetView).scale) || 20);
  const viewScaleFactor = targetScale / Math.max(1, Number(clipboardSourceScale) || state.scale || 20);
  const idMap = new Map(sources.map(source => [source.id, newId()]));
  const groupMap = new Map();
  pushHistory();
  const copies = sources.map(source => {
    const copy = JSON.parse(JSON.stringify(source));
    copy.id = idMap.get(source.id);
    copy.view = targetView;
    scaleObject(copy, viewScaleFactor);
    if (copy.referenceScale?.factor) copy.referenceScale.factor /= viewScaleFactor;
    else if (copy.type === 'line' || (copy.type === 'dimension' && !copy.sourceRectId && !copy.sourceObjectId)) copy.referenceScale = { factor: 1 / viewScaleFactor, targetLength: distance({ x: source.x1, y: source.y1 }, { x: source.x2, y: source.y2 }), side: 'length', copiedBetweenViews: true };
    if (copy.groupId) {
      if (!groupMap.has(copy.groupId)) groupMap.set(copy.groupId, `gruppe-${newId()}`);
      copy.groupId = groupMap.get(copy.groupId);
    }
    if (copy.sourceRectId) copy.sourceRectId = idMap.get(copy.sourceRectId) || '';
    if (copy.sourceObjectId) copy.sourceObjectId = idMap.get(copy.sourceObjectId) || '';
    if (!copy.sourceRectId) { delete copy.sourceRectId; delete copy.autoRectSide; }
    if (!copy.sourceObjectId) delete copy.sourceObjectId;
    return copy;
  });
  state.objects.push(...copies);
  state.activeView = targetView;
  if (!enabledViews().includes(targetView)) state.enabledViews = [...enabledViews(), targetView];
  selectedIds = new Set(copies.map(copy => copy.id));
  selectedId = copies.at(-1)?.id || null;
  loadActiveViewSettings(); syncViewControls(); render();
  setStatus(`${copies.length} Objekt(e) maßstabsgerecht in ${viewNames[targetView]} eingefügt`);
}
function addSelectedToMaterialList() {
  const object = state.objects.find(item => item.id === selectedId);
  if (!object) return;
  updateMaterialsFromForm();
  const existing = state.materials.find(item => item.objectId === object.id);
  if (existing) {
    existing.objectQty = String(Math.max(1, Number(existing.objectQty) || 1) + 1);
    if (!existing.dimensions) existing.dimensions = materialDimensionsFromObject(object);
    if (!existing.name) existing.name = toolNames[object.type] || 'Teil';
  } else {
    state.materials.push(materialRowFromObject(object));
  }
  setDirty();
  renderMaterialList();
  render();
  setStatus('Objekt mit Materialliste verknüpft');
}
function addRectDimensions() {
  const object = state.objects.find(item => item.id === selectedId);
  if (!object || object.type !== 'rect') return;
  const existing = state.objects.filter(item => item.type === 'dimension' && item.sourceRectId === object.id);
  pushHistory();
  if (existing.length) {
    state.objects = state.objects.filter(item => !(item.type === 'dimension' && item.sourceRectId === object.id));
    render();
    setStatus('Automatische Rechteckbemaßung entfernt');
    return;
  }
  const offset = dimensionStyle().defaultOffset;
  const view = objectView(object);
  state.objects.push(
    { type: 'dimension', id: newId(), sourceRectId: object.id, autoRectSide: 'width', useReferenceScale: false, view, layer: 'dimension', x1: object.x, y1: object.y + object.height, x2: object.x + object.width, y2: object.y + object.height, offset, style: state.style, strokeWidth: state.strokeWidth, stroke: state.strokeColor },
    { type: 'dimension', id: newId(), sourceRectId: object.id, autoRectSide: 'height', useReferenceScale: false, view, layer: 'dimension', x1: object.x + object.width, y1: object.y + object.height, x2: object.x + object.width, y2: object.y, offset, style: state.style, strokeWidth: state.strokeWidth, stroke: state.strokeColor }
  );
  render();
  setStatus('Rechteck automatisch bemaßt');
}
function addRadiusDimension() {
  const object = state.objects.find(item => item.id === selectedId);
  if (!object || !['circle', 'semicircle'].includes(object.type)) return;
  pushHistory();
  const angle = object.angle || 0;
  const end = polarPoint(object, object.r, angle);
  state.objects.push({ type: 'dimension', id: newId(), sourceObjectId: object.id, view: objectView(object), layer: 'dimension', x1: object.x, y1: object.y, x2: end.x, y2: end.y, offset: dimensionStyle().defaultOffset, labelPrefix: 'R ', style: state.style, strokeWidth: state.strokeWidth, stroke: state.strokeColor });
  render();
  setStatus('Radiusbemaßung erstellt');
}
function addDiameterDimension() {
  const object = state.objects.find(item => item.id === selectedId);
  if (!object || !['circle', 'semicircle'].includes(object.type)) return;
  pushHistory();
  const angle = object.angle || 0;
  const a = polarPoint(object, object.r, angle);
  const b = polarPoint(object, object.r, angle + Math.PI);
  state.objects.push({ type: 'dimension', id: newId(), sourceObjectId: object.id, view: objectView(object), layer: 'dimension', x1: a.x, y1: a.y, x2: b.x, y2: b.y, offset: dimensionStyle().defaultOffset, labelPrefix: 'Ø ', style: state.style, strokeWidth: state.strokeWidth, stroke: state.strokeColor });
  render();
  setStatus('Durchmesserbemaßung erstellt');
}
function rememberAngleLine() {
  const object = state.objects.find(item => item.id === selectedId);
  if (!object || object.type !== 'line') return;
  angleReferenceId = object.id;
  setStatus('Linie 1 für Winkelbemaßung gemerkt');
}
function addAngleDimension() {
  const lineA = state.objects.find(item => item.id === angleReferenceId && item.type === 'line');
  const lineB = state.objects.find(item => item.id === selectedId && item.type === 'line');
  if (!lineA || !lineB || lineA.id === lineB.id) { setStatus('Zwei verschiedene Linien nötig'); return; }
  const intersection = segmentIntersection(lineA, lineB) || { x: (lineA.x1 + lineA.x2 + lineB.x1 + lineB.x2) / 4, y: (lineA.y1 + lineA.y2 + lineB.y1 + lineB.y2) / 4 };
  const farA = distance(intersection, { x: lineA.x1, y: lineA.y1 }) > distance(intersection, { x: lineA.x2, y: lineA.y2 }) ? { x: lineA.x1, y: lineA.y1 } : { x: lineA.x2, y: lineA.y2 };
  const farB = distance(intersection, { x: lineB.x1, y: lineB.y1 }) > distance(intersection, { x: lineB.x2, y: lineB.y2 }) ? { x: lineB.x1, y: lineB.y1 } : { x: lineB.x2, y: lineB.y2 };
  const angleA = Math.atan2(farA.y - intersection.y, farA.x - intersection.x);
  const angleB = Math.atan2(farB.y - intersection.y, farB.x - intersection.x);
  pushHistory();
  state.objects.push({ type: 'angleDimension', id: newId(), view: objectView(lineB), cx: intersection.x, cy: intersection.y, r: 500, startAngle: angleA, endAngle: angleB, style: state.style, strokeWidth: state.strokeWidth, stroke: state.strokeColor });
  render();
  setStatus('Winkelbemaßung erstellt');
}
function pasteClipboard() { if (!clipboard) { setStatus('Nichts zum Einfügen'); return; } pushHistory(); const copies = (Array.isArray(clipboard) ? clipboard : [clipboard]).map(source => { const copy = cloneObject(source); translateObject(copy, 400, 400); return copy; }); state.objects.push(...copies); selectedIds = new Set(copies.map(copy => copy.id)); selectedId = copies.at(-1).id; render(); setStatus(`${copies.length} Objekt(e) eingefügt`); }
function handlePointerDown(event) {
  if (event.button === 1 || (spacePressed && event.button === 0)) {
    event.preventDefault();
    panStart = { clientX: event.clientX, clientY: event.clientY, viewX: viewBox.x, viewY: viewBox.y };
    canvas.setPointerCapture?.(event.pointerId);
    canvas.classList.add('panning');
    return;
  }
  const point = eventPoint(event, toolUsesObjectSnap(), polylinePoints.at(-1) || null);
  if (state.tool === 'smartTrim' || state.tool === 'smartExtend') { smartEditLineAt(point, state.tool === 'smartTrim' ? 'trim' : 'extend'); return; }
  if (state.tool === 'select') {
    const hitObject = activeViewObjects().find(object => {
      const hitThreshold = Math.max(12, state.scale * 12);
      if (object.type === 'line' || object.type === 'dimension') {
        return distanceToLine(point, object.x1, object.y1, object.x2, object.y2) <= hitThreshold;
      }
      if (object.type === 'rect') {
        const local = rotatePoint(point, objectCenter(object), -(object.rotation || 0));
        const px = Math.max(object.x, Math.min(local.x, object.x + object.width));
        const py = Math.max(object.y, Math.min(local.y, object.y + object.height));
        return distance(local, { x: px, y: py }) <= hitThreshold;
      }
      if (object.type === 'circle' || object.type === 'semicircle') {
        return Math.abs(distance(point, { x: object.x, y: object.y }) - object.r) <= hitThreshold;
      }
      if (object.type === 'ellipse' || object.type === 'ellipseArc') {
        const value = Math.hypot((point.x - object.x) / object.rx, (point.y - object.y) / object.ry);
        return Math.abs(value - 1) * Math.max(object.rx, object.ry) <= hitThreshold;
      }
      if (object.type === 'slot') return distanceToLine(point, object.x1, object.y1, object.x2, object.y2) <= object.width / 2 + hitThreshold;
      if (object.type === 'angleDimension') {
        return Math.abs(distance(point, { x: object.cx, y: object.cy }) - object.r) <= hitThreshold;
      }
      if (object.type === 'polyline' || object.type === 'polygon') {
        return object.points.some(p => distance(point, p) <= hitThreshold);
      }
      if (object.type === 'text') {
        return distance(point, { x: object.x, y: object.y }) <= hitThreshold;
      }
      return false;
    });
    if (hitObject) {
      canvas.setPointerCapture?.(event.pointerId);
      startDraggingObject(hitObject, point, event.shiftKey);
    } else {
      if (!event.shiftKey) { selectedId = null; selectedIds.clear(); }
      draggingObject = null;
      dragChanged = false;
      selectionBoxStart = point;
      canvas.setPointerCapture?.(event.pointerId);
      render();
    }
    return;
  }
  if (state.tool === 'polyline') {
    polylinePoints.push(point);
    pointerStart = null;
    if (event.detail >= 2) finishPolyline();
    else previewPolyline();
    return;
  }
  if (state.tool === 'text') { const value = window.prompt('Text eingeben:', 'Hinweis'); if (value) addObject({ type: 'text', x: point.x, y: point.y, value }); return; }
  pointerStart = point;
}
function handlePointerMove(event) {
  if (panStart) {
    const rect = canvas.getBoundingClientRect();
    viewBox.x = panStart.viewX - (event.clientX - panStart.clientX) / rect.width * viewBox.width;
    viewBox.y = panStart.viewY - (event.clientY - panStart.clientY) / rect.height * viewBox.height;
    applyViewBox();
    return;
  }
  const snapOrigin = pointerStart || polylinePoints.at(-1) || null;
  const point = eventPoint(event, !draggingObject && toolUsesObjectSnap(), snapOrigin); document.querySelector('#cursorCoords').textContent = `X ${formatLength(point.x)}   Y ${formatLength(point.y)}`;
  if (selectionBoxStart && state.tool === 'select') {
    clearPreview();
    const x = Math.min(selectionBoxStart.x, point.x); const y = Math.min(selectionBoxStart.y, point.y);
    previewLayer.append(makeSvg('rect', { x: canvasValue(x), y: canvasValue(y), width: canvasValue(Math.abs(point.x - selectionBoxStart.x)), height: canvasValue(Math.abs(point.y - selectionBoxStart.y)), class: 'selection-box' }));
    return;
  }
  if (draggingHandle) {
    moveHandle(point);
    return;
  }
  if (draggingObject && pointerStart) {
    const dx = point.x - pointerStart.x;
    const dy = point.y - pointerStart.y;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return;
    if (!dragHistoryCaptured) {
      pushHistory();
      dragHistoryCaptured = true;
    }
    if (draggingObject.type === 'dimension' && dragMode === 'dimensionOffset') {
      const lineDx = draggingObject.x2 - draggingObject.x1;
      const lineDy = draggingObject.y2 - draggingObject.y1;
      const lineLength = Math.hypot(lineDx, lineDy) || 1;
      const normal = { x: -lineDy / lineLength, y: lineDx / lineLength };
      draggingObject.offset = (Number.isFinite(Number(draggingObject.offset)) ? Number(draggingObject.offset) : dimensionStyle().defaultOffset) + (dx / state.scale) * normal.x + (dy / state.scale) * normal.y;
    } else draggingObjects.forEach(object => translateObject(object, dx, dy));
    dragChanged = true;
    pointerStart = point;
    render();
    return;
  }
  if (!pointerStart) { updateLiveAngle(null, null); clearPreview(); if (toolUsesObjectSnap()) drawSnapMarker(); if (state.tool === 'polyline') { previewPolyline(point); drawSnapMarker(); } return; }
  if (state.tool === 'line' || state.tool === 'dimension') { const end = lineEndPoint(pointerStart, point, event); previewLine(pointerStart, end); drawAngleLabel(pointerStart, end); updateLiveAngle(pointerStart, end); drawSnapMarker(); }
  if (state.tool === 'circle' || state.tool === 'semicircle') {
    clearPreview();
    const end = radiusEndPoint(pointerStart, point, event);
    const radius = distance(pointerStart, end);
    const angle = Math.atan2(end.y - pointerStart.y, end.x - pointerStart.x);
    renderObject({ type: state.tool, x: pointerStart.x, y: pointerStart.y, r: radius, angle, style: state.style, strokeWidth: state.strokeWidth, stroke: state.strokeColor }, previewLayer);
    drawAngleLabel(pointerStart, end);
    updateLiveAngle(pointerStart, end);
  }
  if (state.tool === 'ellipse' || state.tool === 'ellipseArc') {
    clearPreview(); const rx = Math.abs(point.x - pointerStart.x); const ry = Math.abs(point.y - pointerStart.y);
    renderObject({ type: state.tool, x: pointerStart.x, y: pointerStart.y, rx, ry, style: state.style, strokeWidth: state.strokeWidth, stroke: state.strokeColor }, previewLayer);
  }
  if (state.tool === 'slot') { clearPreview(); renderObject({ type: 'slot', x1: pointerStart.x, y1: pointerStart.y, x2: point.x, y2: point.y, width: Number(document.querySelector('#targetRectHeight')?.value) || 200, style: state.style, strokeWidth: state.strokeWidth, stroke: state.strokeColor }, previewLayer); }
  if (state.tool === 'polygon') { clearPreview(); const sides = Math.max(3, Math.min(24, Number(document.querySelector('#polygonSides')?.value) || 6)); const radius = distance(pointerStart, point); const angle = Math.atan2(point.y - pointerStart.y, point.x - pointerStart.x); const points = Array.from({ length: sides }, (_, index) => polarPoint(pointerStart, radius, angle + index * Math.PI * 2 / sides)); renderObject({ type: 'polygon', points, style: state.style, strokeWidth: state.strokeWidth, stroke: state.strokeColor }, previewLayer); }
  if (state.tool === 'rect') { clearPreview(); const end = exactRectEndPoint(pointerStart, point); const x = Math.min(pointerStart.x, end.x); const y = Math.min(pointerStart.y, end.y); renderObject({ type: 'rect', x, y, width: Math.abs(end.x - pointerStart.x), height: Math.abs(end.y - pointerStart.y), style: state.style, strokeWidth: state.strokeWidth, stroke: state.strokeColor }, previewLayer); }
}
function handlePointerUp(event) {
  if (selectionBoxStart) {
    const end = eventPoint(event);
    const box = { minX: Math.min(selectionBoxStart.x, end.x), minY: Math.min(selectionBoxStart.y, end.y), maxX: Math.max(selectionBoxStart.x, end.x), maxY: Math.max(selectionBoxStart.y, end.y) };
    activeViewObjects().filter(object => !isObjectLocked(object)).forEach(object => {
      const bounds = objectBounds(object);
      if (bounds && bounds.maxX >= box.minX && bounds.minX <= box.maxX && bounds.maxY >= box.minY && bounds.minY <= box.maxY) selectedIds.add(object.id);
    });
    selectedId = [...selectedIds].at(-1) || null;
    selectionBoxStart = null; clearPreview(); canvas.releasePointerCapture?.(event.pointerId); render(); setStatus(`${selectedIds.size} Objekt(e) ausgewählt`); return;
  }
  if (panStart) {
    canvas.releasePointerCapture?.(event.pointerId);
    panStart = null;
    canvas.classList.remove('panning');
    return;
  }
  if (draggingHandle) {
    canvas.releasePointerCapture?.(event.pointerId);
    draggingHandle = null;
    setStatus('Griff bearbeitet');
    return;
  }
  if (draggingObject) {
    canvas.releasePointerCapture?.(event.pointerId);
    draggingObject = null;
    draggingObjects = [];
    dragMode = 'move';
    pointerStart = null;
    setStatus(dragChanged ? 'Objekt verschoben' : 'Objekt ausgewählt');
    dragChanged = false;
    dragHistoryCaptured = false;
    return;
  }
  if (state.tool === 'polyline') return;
  if (!pointerStart) return; const point = eventPoint(event, toolUsesObjectSnap(), pointerStart); const start = pointerStart; pointerStart = null; clearPreview();
  const endPoint = state.tool === 'rect' ? exactRectEndPoint(start, point) : lineEndPoint(start, point, event);
  updateLiveAngle(null, null);
  if (distance(start, endPoint) < 3) return;
  if (state.tool === 'line') addObject({ type: 'line', x1: start.x, y1: start.y, x2: endPoint.x, y2: endPoint.y });
  if (state.tool === 'circle' || state.tool === 'semicircle') addObject({ type: state.tool, x: start.x, y: start.y, r: distance(start, endPoint), angle: Math.atan2(endPoint.y - start.y, endPoint.x - start.x) });
  if (state.tool === 'ellipse' || state.tool === 'ellipseArc') addObject({ type: state.tool, x: start.x, y: start.y, rx: Math.abs(point.x - start.x), ry: Math.abs(point.y - start.y) });
  if (state.tool === 'slot') addObject({ type: 'slot', x1: start.x, y1: start.y, x2: point.x, y2: point.y, width: Number(document.querySelector('#targetRectHeight')?.value) || 200 });
  if (state.tool === 'polygon') { const sides = Math.max(3, Math.min(24, Number(document.querySelector('#polygonSides')?.value) || 6)); const radius = distance(start, point); const angle = Math.atan2(point.y - start.y, point.x - start.x); addObject({ type: 'polygon', points: Array.from({ length: sides }, (_, index) => polarPoint(start, radius, angle + index * Math.PI * 2 / sides)) }); }
  if (state.tool === 'dimension') addObject({ type: 'dimension', x1: start.x, y1: start.y, x2: endPoint.x, y2: endPoint.y, offset: dimensionStyle().defaultOffset });
  if (state.tool === 'rect') addObject({ type: 'rect', x: Math.min(start.x, endPoint.x), y: Math.min(start.y, endPoint.y), width: Math.abs(endPoint.x - start.x), height: Math.abs(endPoint.y - start.y), fillMode: 'none' });
}
function setTool(tool) { state.tool = tool; document.querySelectorAll('.tool-button').forEach(button => button.classList.toggle('active', button.dataset.tool === tool)); document.querySelector('#toolHint').textContent = `${toolNames[tool]} aktiv`; document.querySelector('#lineLengthPanel').hidden = !['line', 'dimension', 'rect', 'circle', 'semicircle', 'ellipse', 'ellipseArc', 'slot', 'polygon'].includes(tool); updateLiveAngle(null, null); clearPreview(); polylinePoints = []; }
function saveProject() { state.projectName = document.querySelector('#projectName').value || 'Projekt01'; const data = { app: 'Werkplan', version: 2, unit: 'mm', projectName: state.projectName, objects: state.objects, settings: { grid: state.grid, snap: state.snap, zoom: state.zoom, scale: state.scale } }; const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${state.projectName.replace(/[^a-z0-9_-]+/gi, '_')}.werkplan`; link.click(); URL.revokeObjectURL(link.href); setStatus('Projekt gespeichert'); }
function loadProject(file) { const reader = new FileReader(); reader.onload = () => { try { const data = JSON.parse(reader.result); pushHistory(); state.objects = Array.isArray(data.objects) ? data.objects : []; state.projectName = data.projectName || 'Projekt01'; document.querySelector('#projectName').value = state.projectName; state.grid = data.settings?.grid ?? true; state.snap = data.settings?.snap ?? true; state.scale = Number(data.settings?.scale) > 0 ? Number(data.settings.scale) : 1; syncScaleControls(); document.querySelector('#gridToggle').checked = state.grid; document.querySelector('#snapToggle').checked = state.snap; selectedId = null; render(); setStatus('Projekt geladen'); } catch { setStatus('Datei konnte nicht gelesen werden'); } }; reader.readAsText(file); }
function exportSvg() { const copy = canvas.cloneNode(true); copy.querySelector('#previewLayer')?.remove(); const source = new XMLSerializer().serializeToString(copy); const blob = new Blob([source], { type: 'image/svg+xml' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${state.projectName || 'werkplan'}.svg`; link.click(); URL.revokeObjectURL(link.href); setStatus('SVG exportiert'); }
function fileBaseName() { updateProjectMetaFromForm(); return (state.projectName || 'werkplan').replace(/[^a-z0-9_-]+/gi, '_'); }
function downloadBlob(blob, filename) { const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); URL.revokeObjectURL(link.href); }
function exportPoint(value, min, scale, offset = sheet.margin) { return offset + (value - min) / scale; }
function renderExportObject(object, layer, bounds, exportScale, offsetX = sheet.margin, offsetY = sheet.margin) {
  const attrs = styleAttrs(object);
  attrs['stroke-width'] = Math.max(0.6, Number(attrs['stroke-width']) || 0.75);
  let element;
  if (object.type === 'line') element = makeSvg('line', { ...attrs, x1: exportPoint(object.x1, bounds.minX, exportScale, offsetX), y1: exportPoint(object.y1, bounds.minY, exportScale, offsetY), x2: exportPoint(object.x2, bounds.minX, exportScale, offsetX), y2: exportPoint(object.y2, bounds.minY, exportScale, offsetY) });
  if (object.type === 'rect') {
    const x = exportPoint(object.x, bounds.minX, exportScale, offsetX); const y = exportPoint(object.y, bounds.minY, exportScale, offsetY);
    const width = object.width / exportScale; const height = object.height / exportScale;
    const path = rectShapePath(object, exportScale, offsetX - bounds.minX / exportScale, offsetY - bounds.minY / exportScale);
    element = path ? makeSvg('path', { ...attrs, ...rectFillAttrs(object), d: path, transform: `rotate(${(object.rotation || 0) * 180 / Math.PI} ${x + width / 2} ${y + height / 2})` }) : makeSvg('rect', { ...attrs, ...rectFillAttrs(object), x, y, width, height, rx: object.cornerMode === 'round' ? (object.cornerSize || 0) / exportScale : 0, transform: `rotate(${(object.rotation || 0) * 180 / Math.PI} ${x + width / 2} ${y + height / 2})` });
  }
  if (object.type === 'circle') element = makeSvg('circle', { ...attrs, cx: exportPoint(object.x, bounds.minX, exportScale, offsetX), cy: exportPoint(object.y, bounds.minY, exportScale, offsetY), r: object.r / exportScale });
  if (object.type === 'semicircle') element = makeSvg('path', { ...attrs, d: semicirclePath(object, exportScale, offsetX - bounds.minX / exportScale, offsetY - bounds.minY / exportScale) });
  if (object.type === 'polyline') element = makeSvg('polyline', { ...attrs, points: object.points.map(point => `${exportPoint(point.x, bounds.minX, exportScale, offsetX)},${exportPoint(point.y, bounds.minY, exportScale, offsetY)}`).join(' ') });
  if (object.type === 'polygon') element = makeSvg('polygon', { ...attrs, points: object.points.map(point => `${exportPoint(point.x, bounds.minX, exportScale, offsetX)},${exportPoint(point.y, bounds.minY, exportScale, offsetY)}`).join(' ') });
  if (object.type === 'ellipse') { const cx = exportPoint(object.x, bounds.minX, exportScale, offsetX); const cy = exportPoint(object.y, bounds.minY, exportScale, offsetY); element = makeSvg('ellipse', { ...attrs, cx, cy, rx: object.rx / exportScale, ry: object.ry / exportScale, transform: `rotate(${(object.rotation || 0) * 180 / Math.PI} ${cx} ${cy})` }); }
  if (object.type === 'ellipseArc') { const cx = exportPoint(object.x, bounds.minX, exportScale, offsetX); const cy = exportPoint(object.y, bounds.minY, exportScale, offsetY); element = makeSvg('path', { ...attrs, d: ellipseArcPath(object, exportScale, offsetX - bounds.minX / exportScale, offsetY - bounds.minY / exportScale), transform: `rotate(${(object.rotation || 0) * 180 / Math.PI} ${cx} ${cy})` }); }
  if (object.type === 'slot') element = makeSvg('path', { ...attrs, d: slotPath(object, exportScale, offsetX - bounds.minX / exportScale, offsetY - bounds.minY / exportScale) });
  if (object.type === 'angleDimension') {
    const style = dimensionStyle();
    const angleOffsetX = offsetX - bounds.minX / exportScale;
    const angleOffsetY = offsetY - bounds.minY / exportScale;
    const center = { x: object.cx / exportScale + angleOffsetX, y: object.cy / exportScale + angleOffsetY };
    const radius = Math.max(1, object.r || 500) / exportScale;
    const delta = shortestAngleDelta(object.startAngle || 0, object.endAngle || 0);
    const start = polarPoint(center, radius, object.startAngle || 0);
    const end = polarPoint(center, radius, (object.startAngle || 0) + delta);
    const mid = polarPoint(center, radius + 16, (object.startAngle || 0) + delta / 2);
    element = makeSvg('g', {});
    element.append(
      makeSvg('line', { ...attrs, x1: center.x, y1: center.y, x2: start.x, y2: start.y }),
      makeSvg('line', { ...attrs, x1: center.x, y1: center.y, x2: end.x, y2: end.y }),
      makeSvg('path', { ...attrs, d: angleArcPath(object, exportScale, angleOffsetX, angleOffsetY) })
    );
    const label = makeSvg('text', { x: mid.x, y: mid.y, 'text-anchor': 'middle', class: 'dimension-label', 'font-size': style.textSize });
    label.textContent = angleDimensionLabel(object);
    element.append(label);
  }
  if (object.type === 'dimension') {
    const dx = object.x2 - object.x1; const dy = object.y2 - object.y1; const length = Math.max(1, Math.round(Math.hypot(dx, dy)));
    const style = dimensionStyle();
    const normal = { x: -dy / length, y: dx / length }; const offset = Number.isFinite(Number(object.offset)) ? Number(object.offset) : style.defaultOffset;
    const x1 = exportPoint(object.x1, bounds.minX, exportScale, offsetX); const y1 = exportPoint(object.y1, bounds.minY, exportScale, offsetY);
    const x2 = exportPoint(object.x2, bounds.minX, exportScale, offsetX); const y2 = exportPoint(object.y2, bounds.minY, exportScale, offsetY);
    const ax = x1 + normal.x * offset; const ay = y1 + normal.y * offset; const bx = x2 + normal.x * offset; const by = y2 + normal.y * offset;
    element = makeSvg('g', {});
    element.append(makeSvg('line', { ...attrs, x1, y1, x2: ax, y2: ay }), makeSvg('line', { ...attrs, x1: x2, y1: y2, x2: bx, y2: by }), makeSvg('line', { ...attrs, x1: ax, y1: ay, x2: bx, y2: by }));
    appendDimensionEnds(element, attrs, ax, ay, bx, by, object.stroke || state.strokeColor);
    const label = makeSvg('text', { x: (ax + bx) / 2, y: (ay + by) / 2 - 7, 'text-anchor': 'middle', class: 'dimension-label', 'font-size': style.textSize });
    label.textContent = dimensionLabelText(object, length); element.append(label);
  }
  if (object.type === 'text') { const x = exportPoint(object.x, bounds.minX, exportScale, offsetX); const y = exportPoint(object.y, bounds.minY, exportScale, offsetY); element = makeSvg('text', { ...attrs, x, y, stroke: 'none', fill: object.stroke || state.strokeColor, 'font-size': 16, transform: `rotate(${(object.rotation || 0) * 180 / Math.PI} ${x} ${y})` }); element.textContent = object.value; }
  if (element) layer.append(element);
}
function renderExportMaterialMarkers(layer, bounds, exportScale, objects = state.objects.filter(object => object.visible !== false), offsetX = sheet.margin, offsetY = sheet.margin) {
  objects.forEach(object => {
    const labels = materialMarkersForObject(object);
    const point = labels.length ? materialMarkerPoint(object) : null;
    if (!point) return;
    const x = exportPoint(point.x, bounds.minX, exportScale, offsetX);
    const y = exportPoint(point.y, bounds.minY, exportScale, offsetY);
    const group = makeSvg('g', {});
    group.append(makeSvg('circle', { cx: x, cy: y, r: 13, fill: '#fffdf8', stroke: '#263238', 'stroke-width': 1.1 }));
    const text = makeSvg('text', { x, y: y + 4, 'text-anchor': 'middle', class: 'sheet-text', 'font-weight': 700, fill: '#263238' });
    text.textContent = labels.map(label => label.replace('Pos. ', '')).join('/');
    group.append(text);
    layer.append(group);
  });
}
function renderExportViews(root) {
  const groups = exportViewGroups();
  if (!groups.length) return state.autoScale ? calculateAutoScale() : state.scale;
  const drawing = makeSvg('g', {});
  const gap = groups.length > 1 ? 28 : 0;
  const labelHeight = groups.length > 1 ? 24 : 0;
  const totalWidth = sheet.width - sheet.margin * 2;
  const areaHeight = exportDrawingAreaHeight();
  const slotWidth = (totalWidth - gap * (groups.length - 1)) / groups.length;
  const viewLayouts = groups.map((group, index) => {
    const bounds = boundsForObjects(group.objects, 500);
    const setting = ensureViewSetting(group.view);
    const x = Number.isFinite(setting.exportX) ? setting.exportX : sheet.margin + index * (slotWidth + gap);
    const y = Number.isFinite(setting.exportY) ? setting.exportY : sheet.margin + labelHeight;
    const usableHeight = Math.max(120, areaHeight - labelHeight);
    const requiredScale = bounds ? calculateRequiredExportScale(bounds, slotWidth, usableHeight) : 1;
    return { ...group, bounds, x, y, usableHeight, requiredScale, setting };
  });
  const filledLayouts = viewLayouts.filter(layout => layout.bounds);
  const usedScales = [];
  viewLayouts.forEach(group => {
    if (groups.length > 1) {
      addTableText(drawing, group.x, sheet.margin + 15, viewNames[group.view], { 'font-size': 13, 'font-weight': 700, fill: '#263238' });
      drawing.append(makeSvg('rect', { x: group.x, y: group.y, width: slotWidth, height: group.usableHeight, fill: 'none', stroke: '#d6dfdd', 'stroke-width': 0.7, 'stroke-dasharray': '5 5' }));
    }
    if (!group.bounds) return;
    const exportScale = group.setting.autoScale !== false ? (scaleSteps.find(step => step >= group.requiredScale) || Math.ceil(group.requiredScale / 1000) * 1000) : Math.max(1, Number(group.setting.scale) || 20);
    usedScales.push(exportScale);
    group.objects.forEach(object => renderExportObject(object, drawing, group.bounds, exportScale, group.x, group.y));
    renderExportMaterialMarkers(drawing, group.bounds, exportScale, group.objects, group.x, group.y);
  });
  root.append(drawing);
  return [...new Set(usedScales)].join(' / 1:') || state.scale;
}
function addTitleCell(root, x, y, width, height, label, value) {
  root.append(makeSvg('rect', { x, y, width, height, fill: 'none', stroke: '#263238', 'stroke-width': 1 }));
  const labelNode = makeSvg('text', { x: x + 8, y: y + 14, class: 'title-block-label' }); labelNode.textContent = label;
  const valueNode = makeSvg('text', { x: x + 8, y: y + height - 12, class: 'title-block-value' }); valueNode.textContent = value;
  root.append(labelNode, valueNode);
}
function addTableText(root, x, y, value, attrs = {}) {
  const text = makeSvg('text', { x, y, class: 'sheet-text', ...attrs });
  text.textContent = String(value || '');
  root.append(text);
}
function materialExportValues(item, index) {
  const objectInfo = linkedObjectText(item);
  const baseQty = parseMaterialNumber(item.qty, NaN);
  const objectQty = item.objectId ? Math.max(1, parseMaterialNumber(item.objectQty, 1)) : 1;
  const qty = Number.isFinite(baseQty) ? trimNumber(baseQty * objectQty) : item.qty || '';
  const unit = item.unit === 'm2' ? 'm²' : item.unit === 'm3' ? 'm³' : item.unit;
  const objectQtyNote = item.objectId && item.objectQty && Number(item.objectQty) > 1 ? `${item.objectQty} St./Objekt` : '';
  const linkedNote = objectInfo ? `Obj.: ${objectInfo}` : '';
  const note = [item.note || '', objectQtyNote, linkedNote].filter(Boolean).join(' | ');
  return [item.pos || index + 1, qty, unit, item.name, item.material, item.dimensions, note];
}
function addMaterialTable(root) {
  updateMaterialsFromForm();
  if (!state.materials.length) return;
  const x = sheet.margin;
  const baseWidth = 640;
  const width = Math.min(baseWidth, sheet.width - sheet.margin * 2);
  const rowHeight = 22;
  const factor = width / baseWidth;
  const headers = [
    ['Pos.', 38], ['Menge', 58], ['ME', 38], ['Benennung', 170],
    ['Werkstoff', 110], ['Abmessung', 105], ['Bemerkung', 121]
  ].map(([label, colWidth]) => [label, colWidth * factor]);
  const rows = state.materials.slice(0, 6);
  const height = rowHeight * (rows.length + 2);
  const titleTop = sheet.height - sheet.margin - sheet.titleHeight;
  const y = titleTop - height - 16;
  root.append(makeSvg('rect', { x, y, width, height, fill: '#fffdf8', stroke: '#263238', 'stroke-width': 1.1 }));
  addTableText(root, x + 8, y + 15, 'Materialliste / Stückliste', { 'font-weight': 700, fill: '#263238' });
  let colX = x;
  headers.forEach(([label, colWidth]) => {
    root.append(makeSvg('rect', { x: colX, y: y + rowHeight, width: colWidth, height: rowHeight, fill: 'none', stroke: '#263238', 'stroke-width': 0.8 }));
    addTableText(root, colX + 4, y + rowHeight + 15, label, { 'font-weight': 700, 'font-size': 9 });
    colX += colWidth;
  });
  rows.forEach((item, rowIndex) => {
    const values = materialExportValues(item, rowIndex);
    let cellX = x;
    headers.forEach(([, colWidth], colIndex) => {
      const cellY = y + rowHeight * (rowIndex + 2);
      root.append(makeSvg('rect', { x: cellX, y: cellY, width: colWidth, height: rowHeight, fill: 'none', stroke: '#263238', 'stroke-width': 0.6 }));
      addTableText(root, cellX + 4, cellY + 15, String(values[colIndex] || '').slice(0, colWidth > 90 ? 20 : 10), { 'font-size': 9 });
      cellX += colWidth;
    });
  });
  if (state.materials.length > rows.length) addTableText(root, x + 8, y + height - 5, `+ ${state.materials.length - rows.length} weitere Position(en) im Projekt`, { 'font-size': 8, fill: '#667574' });
}
function buildSheetSvg() {
  updateProjectMetaFromForm();
  updateSheetFromState();
  updateMaterialsFromForm();
  const mm = sheetSizeMm();
  const root = makeSvg('svg', { xmlns: svgNS, width: `${mm.w}mm`, height: `${mm.h}mm`, viewBox: `0 0 ${sheet.width} ${sheet.height}` });
  addFillPatterns(root);
  const style = makeSvg('style', {});
  style.textContent = ".dimension-label{font:600 14px Arial,sans-serif;fill:#263238;paint-order:stroke;stroke:#fffdf8;stroke-width:5px;stroke-linejoin:round}.title-block-label{font:700 8px Arial,sans-serif;fill:#667574}.title-block-value{font:600 13px Arial,sans-serif;fill:#263238}.sheet-text{font:500 10px Arial,sans-serif;fill:#566665}";
  root.append(style);
  root.append(makeSvg('rect', { width: sheet.width, height: sheet.height, fill: '#fffdf8' }));
  root.append(makeSvg('rect', { x: 28, y: 28, width: sheet.width - 56, height: sheet.height - 56, fill: 'none', stroke: '#263238', 'stroke-width': 1.4 }));
  root.append(makeSvg('rect', { x: sheet.margin, y: sheet.margin, width: sheet.width - sheet.margin * 2, height: exportDrawingAreaHeight(), fill: 'none', stroke: '#c8d2d0', 'stroke-width': 0.8, 'stroke-dasharray': '6 6' }));
  const exportScale = renderExportViews(root);
  addMaterialTable(root);
  const titleX = sheet.width - sheet.margin - 540; const titleY = sheet.height - sheet.margin - sheet.titleHeight;
  root.append(makeSvg('rect', { x: titleX, y: titleY, width: 540, height: sheet.titleHeight, fill: '#fffdf8', stroke: '#263238', 'stroke-width': 1.2 }));
  addTitleCell(root, titleX, titleY, 270, 59, 'Projekt', state.projectName);
  addTitleCell(root, titleX + 270, titleY, 135, 59, 'Massstab', `1:${exportScale}`);
  addTitleCell(root, titleX + 405, titleY, 135, 59, 'Einheit', 'mm');
  addTitleCell(root, titleX, titleY + 59, 180, 59, 'Zeichnung', state.drawingNumber);
  addTitleCell(root, titleX + 180, titleY + 59, 150, 59, 'Bearbeiter', state.drawnBy);
  addTitleCell(root, titleX + 330, titleY + 59, 120, 59, 'Datum', state.projectDate);
  addTitleCell(root, titleX + 450, titleY + 59, 90, 59, 'Format', `${state.sheetFormat} ${state.sheetOrientation === 'portrait' ? 'hoch' : 'quer'}`);
  return new XMLSerializer().serializeToString(root);
}
function exportSheetSvg() {
  const source = buildSheetSvg();
  downloadBlob(new Blob([source], { type: 'image/svg+xml' }), `${fileBaseName()}.svg`);
  setStatus('SVG exportiert');
}
function svgToCanvas(source, scale = 2) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
    image.onload = () => {
      const out = document.createElement('canvas');
      out.width = sheet.width * scale; out.height = sheet.height * scale;
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#fffdf8'; ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(image, 0, 0, out.width, out.height);
      URL.revokeObjectURL(url);
      resolve(out);
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG konnte nicht gerendert werden')); };
    image.src = url;
  });
}
async function exportPng() {
  const out = await svgToCanvas(buildSheetSvg(), 3);
  out.toBlob(blob => { if (blob) downloadBlob(blob, `${fileBaseName()}.png`); }, 'image/png');
  setStatus('PNG exportiert');
}
function pdfEscape(value) { return String(value).replace(/[\\()]/g, '\\$&'); }
function buildMaterialListSvgPages(items = state.materials.slice(6)) {
  updateSheetFromState();
  const mm = sheetSizeMm();
  const baseHeaders = [['Pos.', 48], ['Menge', 70], ['ME', 44], ['Benennung', 230], ['Werkstoff', 150], ['Abmessung', 150], ['Bemerkung', 307]];
  const fullWidth = sheet.width - sheet.margin * 2;
  const fullFactor = fullWidth / baseHeaders.reduce((sum, [, w]) => sum + w, 0);
  const headers = baseHeaders.map(([label, w]) => [label, w * fullFactor]);
  const rowHeight = 24;
  const rowsPerPage = Math.max(1, Math.floor((sheet.height - sheet.margin * 2 - 82) / rowHeight));
  const chunks = [];
  for (let index = 0; index < items.length; index += rowsPerPage) chunks.push(items.slice(index, index + rowsPerPage));
  return chunks.map((rows, pageIndex) => {
    const root = makeSvg('svg', { xmlns: svgNS, width: `${mm.w}mm`, height: `${mm.h}mm`, viewBox: `0 0 ${sheet.width} ${sheet.height}` });
    const style = makeSvg('style', {});
    style.textContent = ".title-block-label{font:700 8px Arial,sans-serif;fill:#667574}.title-block-value{font:600 13px Arial,sans-serif;fill:#263238}.sheet-text{font:500 10px Arial,sans-serif;fill:#566665}";
    root.append(style);
    root.append(makeSvg('rect', { width: sheet.width, height: sheet.height, fill: '#fffdf8' }));
    root.append(makeSvg('rect', { x: 28, y: 28, width: sheet.width - 56, height: sheet.height - 56, fill: 'none', stroke: '#263238', 'stroke-width': 1.4 }));
    addTableText(root, sheet.margin, sheet.margin + 10, `Materialliste / Stückliste - ${state.projectName}`, { 'font-size': 18, 'font-weight': 700, fill: '#263238' });
    addTableText(root, sheet.width - sheet.margin, sheet.margin + 10, `Seite ${pageIndex + 1} / ${chunks.length}`, { 'font-size': 10, 'text-anchor': 'end', fill: '#566665' });
    let y = sheet.margin + 36; let x = sheet.margin;
    headers.forEach(([label, width]) => { root.append(makeSvg('rect', { x, y, width, height: rowHeight, fill: 'none', stroke: '#263238', 'stroke-width': 0.8 })); addTableText(root, x + 4, y + 16, label, { 'font-weight': 700, 'font-size': 10 }); x += width; });
    rows.forEach((item, rowIndex) => {
      y += rowHeight; x = sheet.margin;
      const absoluteIndex = 6 + pageIndex * rowsPerPage + rowIndex;
      const values = materialExportValues(item, absoluteIndex);
      headers.forEach(([, width], column) => { root.append(makeSvg('rect', { x, y, width, height: rowHeight, fill: 'none', stroke: '#263238', 'stroke-width': 0.55 })); addTableText(root, x + 4, y + 16, String(values[column] || '').slice(0, width > 150 ? 28 : 16), { 'font-size': 9 }); x += width; });
    });
    return new XMLSerializer().serializeToString(root);
  });
}
function buildImagePdf(jpegDataUrls) {
  const mm = sheetSizeMm();
  const pageW = mm.w * 72 / 25.4; const pageH = mm.h * 72 / 25.4;
  const objects = [];
  const add = value => { objects.push(value); return objects.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('');
  const pageIds = [];
  jpegDataUrls.forEach((dataUrl, index) => {
    const imageId = objects.length + 2;
    const contentId = objects.length + 3;
    pageIds.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im${index} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`));
    const jpeg = atob(dataUrl.split(',')[1]);
    add(`<< /Type /XObject /Subtype /Image /Width ${sheet.width * 2} /Height ${sheet.height * 2} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n${jpeg}\nendstream`);
    const content = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im${index} Do\nQ`;
    add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return new Blob([bytes], { type: 'application/pdf' });
}
async function exportPdf() {
  const pages = [buildSheetSvg()];
  updateMaterialsFromForm();
  if (state.materials.length > 6) pages.push(...buildMaterialListSvgPages());
  const canvases = [];
  for (const page of pages) canvases.push(await svgToCanvas(page, 2));
  const pdf = buildImagePdf(canvases.map(out => out.toDataURL('image/jpeg', 0.92)));
  downloadBlob(pdf, `${fileBaseName()}.pdf`);
  setStatus('PDF exportiert');
}
saveProject = function() {
  updateDimensionStyleFromControls();
  updateProjectMetaFromForm();
  updateMaterialsFromForm();
  saveActiveViewSettings();
  const data = {
    app: 'Werkplan',
    version: 9,
    unit: 'mm',
    projectName: state.projectName,
    drawingNumber: state.drawingNumber,
    drawnBy: state.drawnBy,
    projectDate: state.projectDate,
    materials: state.materials,
    objects: state.objects,
    settings: { grid: state.grid, snap: state.snap, zoom: state.zoom, scale: state.scale, autoScale: state.autoScale, dimensionStyle: state.dimensionStyle, sheetFormat: state.sheetFormat, sheetOrientation: state.sheetOrientation, enabledViews: enabledViews(), activeView: state.activeView, viewReferences: state.viewReferences, layers: state.layers, activeLayer: state.activeLayer, viewSettings: state.viewSettings }
  };
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${fileBaseName()}.werkplan`);
  setDirty(false);
  setStatus('Projekt gespeichert');
};
loadProject = function(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      pushHistory();
      state.objects = Array.isArray(data.objects) ? data.objects : [];
      state.materials = Array.isArray(data.materials) ? data.materials : [];
      state.projectName = data.projectName || 'Projekt01';
      state.drawingNumber = data.drawingNumber || 'TZ-001';
      state.drawnBy = data.drawnBy || '';
      state.projectDate = data.projectDate || new Date().toISOString().slice(0, 10);
      document.querySelector('#projectName').value = state.projectName;
      document.querySelector('#drawingNumber').value = state.drawingNumber;
      document.querySelector('#drawnBy').value = state.drawnBy;
      document.querySelector('#projectDate').value = state.projectDate;
      renderMaterialList();
      state.grid = data.settings?.grid ?? true;
      state.snap = data.settings?.snap ?? true;
      state.autoScale = data.settings?.autoScale ?? true;
      state.sheetFormat = data.settings?.sheetFormat || 'A3';
      state.sheetOrientation = data.settings?.sheetOrientation || 'landscape';
      state.enabledViews = Array.isArray(data.settings?.enabledViews) ? data.settings.enabledViews.filter(view => viewNames[view]) : ['front'];
      state.activeView = viewNames[data.settings?.activeView] ? data.settings.activeView : state.enabledViews[0];
      state.viewReferences = data.settings?.viewReferences && typeof data.settings.viewReferences === 'object' ? data.settings.viewReferences : {};
      if (Number(data.version) < 7) Object.values(state.viewReferences).forEach(reference => { reference.factor = 1; });
      if (Number(data.version) < 8) state.viewReferences = {};
      if (Array.isArray(data.settings?.layers)) state.layers = data.settings.layers;
      state.activeLayer = data.settings?.activeLayer || state.layers[0].id;
      state.viewSettings = data.settings?.viewSettings && typeof data.settings.viewSettings === 'object' ? data.settings.viewSettings : {};
      document.querySelector('#sheetFormat').value = state.sheetFormat;
      document.querySelector('#sheetOrientation').value = state.sheetOrientation;
      syncViewControls();
      renderLayerControls();
      state.dimensionStyle = data.settings?.dimensionStyle || state.dimensionStyle;
      syncDimensionStyleControls();
      state.scale = Number(data.settings?.scale) > 0 ? Number(data.settings.scale) : 20;
      const legacyZoom = Number(data.settings?.zoom) > 0 ? Number(data.settings.zoom) : 1;
      if (!state.viewSettings[state.activeView]) state.viewSettings[state.activeView] = { scale: state.scale, autoScale: state.autoScale, viewBox: { x: 0, y: 0, width: 1200 / legacyZoom, height: 760 / legacyZoom }, layerVisibility: {}, exportX: null, exportY: null };
      loadActiveViewSettings();
      syncScaleControls();
      document.querySelector('#gridToggle').checked = state.grid;
      document.querySelector('#snapToggle').checked = state.snap;
      selectedId = null; selectedIds.clear();
      render();
      setDirty(false);
      setStatus('Projekt geladen');
    } catch {
      setStatus('Datei konnte nicht gelesen werden');
    }
  };
  reader.readAsText(file);
};

document.querySelectorAll('.tool-button').forEach(button => button.addEventListener('click', () => setTool(button.dataset.tool)));
document.querySelectorAll('.style-button').forEach(button => button.addEventListener('click', () => { state.style = button.dataset.style; setDirty(); document.querySelectorAll('.style-button').forEach(item => item.classList.toggle('active', item === button)); }));
document.querySelector('#strokeWidth').addEventListener('input', event => { state.strokeWidth = Number(event.target.value); setDirty(); document.querySelector('#strokeOutput').textContent = `${state.strokeWidth.toFixed(2).replace('.', ',')} mm`; });
document.querySelector('#strokeColor').addEventListener('input', event => { state.strokeColor = event.target.value; setDirty(); });
['#dimensionEndStyle', '#dimensionTextSize', '#dimensionDefaultOffset', '#dimensionUnit', '#dimensionDecimals'].forEach(selector => {
  document.querySelector(selector)?.addEventListener('input', () => { updateDimensionStyleFromControls(); setDirty(); render(); });
  document.querySelector(selector)?.addEventListener('change', () => { updateDimensionStyleFromControls(); render(); });
});
document.querySelector('#scaleSelect').addEventListener('change', event => { if (event.target.value === 'custom') { document.querySelector('#customScaleWrap').hidden = false; document.querySelector('#customScale').focus(); } else setScale(event.target.value); });
document.querySelector('#scaleSelect').addEventListener('change', event => { if (event.target.value === 'auto') { state.autoScale = true; ensureViewSetting().autoScale = true; setDirty(); syncScaleControls(); render(); setStatus('Massstab automatisch berechnet'); } });
document.querySelector('#customScale').addEventListener('change', event => setScale(event.target.value));
document.querySelector('#sheetFormat')?.addEventListener('change', event => { state.sheetFormat = event.target.value; setDirty(); render(); setStatus('Blattformat geändert'); });
document.querySelector('#sheetOrientation')?.addEventListener('change', event => { state.sheetOrientation = event.target.value; setDirty(); render(); setStatus('Blattausrichtung geändert'); });
document.querySelectorAll('.view-toggle').forEach(input => input.addEventListener('change', () => { updateViewsFromControls(); setDirty(); render(); setStatus('Exportansichten geändert'); }));
document.querySelectorAll('.view-button').forEach(button => button.addEventListener('click', () => setActiveView(button.dataset.view)));
document.querySelector('#commandSearch').addEventListener('input', () => { commandSelectionIndex = 0; renderCommandResults(); });
document.querySelector('#commandSearch').addEventListener('keydown', event => { const count = filteredCommands().length; if (event.key === 'ArrowDown') { event.preventDefault(); commandSelectionIndex = Math.min(count - 1, commandSelectionIndex + 1); renderCommandResults(); } if (event.key === 'ArrowUp') { event.preventDefault(); commandSelectionIndex = Math.max(0, commandSelectionIndex - 1); renderCommandResults(); } if (event.key === 'Enter') { event.preventDefault(); executeCommand(); } if (event.key === 'Escape') { event.preventDefault(); closeCommandPalette(); } });
document.querySelector('#commandPalette').addEventListener('pointerdown', event => { if (event.target.id === 'commandPalette') closeCommandPalette(); });
['#objectSearch', '#objectTypeFilter', '#objectViewFilter', '#objectLayerFilter'].forEach(selector => document.querySelector(selector)?.addEventListener('input', renderObjectList));
document.querySelector('#objectTypeFilter').innerHTML += Object.entries(toolNames).filter(([type]) => !['select','smartTrim','smartExtend'].includes(type)).map(([type, name]) => `<option value="${type}">${name}</option>`).join('');
document.querySelector('#objectLayerFilter').innerHTML += state.layers.map(layer => `<option value="${layer.id}">${layer.name}</option>`).join('');
document.querySelector('#contextMenu').addEventListener('click', event => { const action = event.target.dataset.action; if (!action) return; if (action === 'copy') copySelected(); if (action === 'copyToView') { copySelected(); pasteClipboardToView(event.target.dataset.view); } if (action === 'rotate') { const field = propertyPanel.querySelector('[name="rotateAngle"]'); if (field) field.value = 90; rotateSelectedExact(); } if (action === 'mirrorH') mirrorSelected('horizontal'); if (action === 'mirrorV') mirrorSelected('vertical'); if (action === 'dimension') dimensionSelectedFromMenu(); if (action === 'material') addSelectedToMaterialList(); if (action === 'delete') deleteSelected(); hideContextMenu(); });
document.addEventListener('pointerdown', event => { if (!event.target.closest('#contextMenu')) hideContextMenu(); });
document.querySelector('#gridToggle').addEventListener('change', event => { state.grid = event.target.checked; setDirty(); render(); });
document.querySelector('#snapToggle').addEventListener('change', event => { state.snap = event.target.checked; setDirty(); });
document.querySelector('#addMaterialRow')?.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); updateMaterialsFromForm(); state.materials.push(defaultMaterialRow()); setDirty(); renderMaterialList(); setStatus('Materialposition hinzugefügt'); });
document.querySelector('#activeLayer')?.addEventListener('change', event => { state.activeLayer = event.target.value; setDirty(); renderLayerControls(); });
['#viewExportX', '#viewExportY'].forEach((selector, index) => document.querySelector(selector)?.addEventListener('change', event => { const value = event.target.value === '' ? null : Number(event.target.value); ensureViewSetting()[index === 0 ? 'exportX' : 'exportY'] = Number.isFinite(value) ? value : null; setDirty(); renderProjectWarnings(); }));
document.querySelector('#newProject').addEventListener('click', () => { if ((state.objects.length || state.materials.length) && !window.confirm('Neue Zeichnung beginnen und aktuelle Arbeit verwerfen?')) return; state.objects = []; state.materials = []; state.history = []; state.redo = []; state.projectName = 'Projekt01'; state.enabledViews = ['front']; state.activeView = 'front'; state.viewReferences = {}; state.viewSettings = {}; state.layers.forEach(layer => { layer.visible = true; layer.locked = false; layer.printable = layer.id !== 'guide'; }); state.activeLayer = 'contour'; document.querySelector('#projectName').value = state.projectName; loadActiveViewSettings(); syncViewControls(); renderLayerControls(); renderMaterialList(); selectedId = null; selectedIds.clear(); render(); setDirty(false); setStatus('Neue Zeichnung'); });
document.querySelector('#saveProject').addEventListener('click', saveProject);
document.querySelector('#openProject').addEventListener('click', () => fileInput.click());
document.querySelector('#undoAction')?.addEventListener('click', undo);
document.querySelector('#redoAction')?.addEventListener('click', redo);
fileInput.addEventListener('change', event => { if (event.target.files[0]) loadProject(event.target.files[0]); event.target.value = ''; });
document.querySelector('#exportSvg').addEventListener('click', exportSvg);
document.querySelector('#exportSheetSvg').addEventListener('click', exportSheetSvg);
document.querySelector('#exportPng').addEventListener('click', exportPng);
document.querySelector('#exportPdf').addEventListener('click', exportPdf);
document.querySelector('#zoomIn').addEventListener('click', () => setViewportZoom(state.zoom * 1.2));
document.querySelector('#zoomOut').addEventListener('click', () => setViewportZoom(state.zoom / 1.2));
document.querySelector('#fitView').addEventListener('click', fitAllObjects);
document.querySelector('#fitSelection').addEventListener('click', fitSelectedObject);
canvas.addEventListener('wheel', event => { event.preventDefault(); setViewportZoom(state.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), canvasScreenPoint(event)); }, { passive: false });
canvas.addEventListener('pointerdown', handlePointerDown); canvas.addEventListener('pointermove', handlePointerMove); canvas.addEventListener('pointerup', handlePointerUp); canvas.addEventListener('pointerleave', () => { if (!panStart) { pointerStart = null; draggingHandle = null; updateLiveAngle(null, null); clearPreview(); } });
document.addEventListener('keyup', event => { if (event.code === 'Space') { spacePressed = false; canvas.classList.remove('pan-ready'); } });
document.addEventListener('keydown', event => { if (event.code === 'Space' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') { event.preventDefault(); spacePressed = true; canvas.classList.add('pan-ready'); } if (event.ctrlKey && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(); } const notEditing = document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA'; if (event.ctrlKey && event.key.toLowerCase() === 'c' && notEditing) { event.preventDefault(); copySelected(); } if (event.ctrlKey && event.key.toLowerCase() === 'v' && notEditing) { event.preventDefault(); pasteClipboard(); } if (event.ctrlKey && event.key.toLowerCase() === 'z' && notEditing) { event.preventDefault(); undo(); } if (event.ctrlKey && event.key.toLowerCase() === 'y' && notEditing) { event.preventDefault(); redo(); } if (notEditing && event.key >= '1' && event.key <= '7') setTool(toolOrder[Number(event.key) - 1]); if (notEditing && event.key === 'Delete') deleteSelected(); if (event.key === 'Escape') { pointerStart = null; draggingHandle = null; panStart = null; canvas.classList.remove('panning'); polylinePoints = []; updateLiveAngle(null, null); clearPreview(); } });
document.addEventListener('keydown', event => { if (event.ctrlKey && event.key.toLowerCase() === 'k') { event.preventDefault(); openCommandPalette(); } });
document.querySelector('#projectDate').value = state.projectDate;
document.querySelector('#sheetFormat').value = state.sheetFormat;
document.querySelector('#sheetOrientation').value = state.sheetOrientation;
['#projectName', '#drawingNumber', '#drawnBy', '#projectDate'].forEach(selector => document.querySelector(selector)?.addEventListener('input', () => setDirty()));
syncViewControls();
renderLayerControls();
syncViewSettingControls();
syncDimensionStyleControls();
renderMaterialList();
syncScaleControls();
applyViewBox();
render();

