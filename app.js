const canvas = document.querySelector('#drawingCanvas');
const drawingLayer = document.querySelector('#drawingLayer');
const previewLayer = document.querySelector('#previewLayer');
const emptyState = document.querySelector('#emptyState');
const statusText = document.querySelector('#statusText');
const propertyPanel = document.querySelector('#propertyPanel');
const fileInput = document.querySelector('#fileInput');

const state = {
  tool: 'select', style: 'solid', strokeWidth: 0.75, strokeColor: '#263238',
  snap: true, grid: true, zoom: 1, scale: 20, projectName: 'Projekt01',
  objects: [], draft: null, history: []
};
state.autoScale = true;
state.drawingNumber = 'TZ-001';
state.drawnBy = '';
state.projectDate = new Date().toISOString().slice(0, 10);
state.dimensionStyle = { endStyle: 'arrow', textSize: 14, defaultOffset: 22, unit: 'auto', decimals: 0 };
state.materials = [];
let pointerStart = null;
let selectedId = null;
let draggingObject = null;
let dragMode = 'move';
let dragChanged = false;
let dragHistoryCaptured = false;
let polylinePoints = [];
let clipboard = null;
let currentSnap = null;

const svgNS = 'http://www.w3.org/2000/svg';
const snapSize = 10;
const sheet = { width: 1200, height: 760, margin: 50, titleHeight: 118 };
const scaleSteps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
const toolNames = { select: 'Auswahl', line: 'Linie', polyline: 'Polylinie', rect: 'Rechteck', dimension: 'Bemaßung', text: 'Text' };

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
  defs.append(hatch, cross);
}
function distance(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
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
function addPointCandidate(candidates, rawPoint, snapPointValue, type) {
  candidates.push({ point: snapPointValue, distance: distance(rawPoint, snapPointValue), type });
}
function lineSegments() {
  const segments = [];
  state.objects.forEach(object => {
    if (object.type === 'line') segments.push({ x1: object.x1, y1: object.y1, x2: object.x2, y2: object.y2 });
    if (object.type === 'rect') {
      segments.push({ x1: object.x, y1: object.y, x2: object.x + object.width, y2: object.y });
      segments.push({ x1: object.x + object.width, y1: object.y, x2: object.x + object.width, y2: object.y + object.height });
      segments.push({ x1: object.x + object.width, y1: object.y + object.height, x2: object.x, y2: object.y + object.height });
      segments.push({ x1: object.x, y1: object.y + object.height, x2: object.x, y2: object.y });
    }
    if (object.type === 'polyline') object.points.slice(1).forEach((pointB, index) => {
      const pointA = object.points[index];
      segments.push({ x1: pointA.x, y1: pointA.y, x2: pointB.x, y2: pointB.y });
    });
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
function objectSnapResult(point, origin = null) {
  const candidates = [];
  const segments = lineSegments();
  segments.forEach(segment => {
    addPointCandidate(candidates, point, { x: segment.x1, y: segment.y1 }, 'Endpunkt');
    addPointCandidate(candidates, point, { x: segment.x2, y: segment.y2 }, 'Endpunkt');
    addPointCandidate(candidates, point, { x: (segment.x1 + segment.x2) / 2, y: (segment.y1 + segment.y2) / 2 }, 'Mittelpunkt');
    addSnapCandidate(candidates, point, segment.x1, segment.y1, segment.x2, segment.y2);
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
  const threshold = Math.max(150, state.scale * 12);
  const priority = { Endpunkt: 0, Schnittpunkt: 1, Mittelpunkt: 2, Lotpunkt: 3, Kante: 4 };
  const best = candidates.sort((a, b) => a.distance - b.distance || (priority[a.type] ?? 9) - (priority[b.type] ?? 9))[0];
  return best && best.distance <= threshold ? best : { point, type: null, distance: 0 };
}
function snapPoint(point) { return state.snap ? { x: Math.round(point.x / snapSize) * snapSize, y: Math.round(point.y / snapSize) * snapSize } : point; }
function eventPoint(event, objectSnap = false, snapOrigin = null) {
  const svg = canvas;
  const rect = svg.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width * 1200;
  const y = (event.clientY - rect.top) / rect.height * 760;
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
function canvasValue(value) { return value / state.scale; }
function formatLength(value) { return value >= 1000 ? `${(value / 1000).toFixed(2).replace('.', ',')} m` : `${Math.round(value)} mm`; }
function dimensionStyle() {
  return state.dimensionStyle || { endStyle: 'arrow', textSize: 14, defaultOffset: 22, unit: 'auto', decimals: 0 };
}
function formatDimensionLength(value) {
  const style = dimensionStyle();
  const decimals = Math.max(0, Math.min(3, Number(style.decimals) || 0));
  const unit = style.unit === 'auto' ? (value >= 1000 ? 'm' : 'mm') : style.unit;
  const displayValue = unit === 'm' ? value / 1000 : value;
  return `${displayValue.toFixed(decimals).replace('.', ',')} ${unit}`;
}
function dimensionLabelText(object, measuredLength) {
  return object.labelOverride ? String(object.labelOverride) : formatDimensionLength(measuredLength);
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
function defaultMaterialRow() {
  return { pos: String(state.materials.length + 1), qty: '1', unit: 'St', name: '', partNo: '', material: '', dimensions: '', note: '' };
}
function updateMaterialsFromForm() {
  const list = document.querySelector('#materialList');
  if (!list) return;
  state.materials = [...list.querySelectorAll('.material-row')].map(row => ({
    pos: row.querySelector('[name="pos"]').value.trim(),
    qty: row.querySelector('[name="qty"]').value.trim(),
    unit: row.querySelector('[name="unit"]').value,
    name: row.querySelector('[name="name"]').value.trim(),
    partNo: row.querySelector('[name="partNo"]').value.trim(),
    material: row.querySelector('[name="material"]').value.trim(),
    dimensions: row.querySelector('[name="dimensions"]').value.trim(),
    note: row.querySelector('[name="note"]').value.trim()
  })).filter(item => item.name || item.material || item.partNo || item.dimensions || item.note);
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
    row.innerHTML = `<label>Pos.<input name="pos" value="${escapeHtml(item.pos || String(index + 1))}"></label><label>Menge<input name="qty" value="${escapeHtml(item.qty || '1')}"></label><label>Einheit<select name="unit"><option value="St">St</option><option value="m">m</option><option value="m2">m2</option><option value="m3">m3</option><option value="kg">kg</option><option value="l">l</option></select></label><label>Bezeichnung<input name="name" value="${escapeHtml(item.name || '')}"></label><label class="wide-field">Sach-/Teilenummer<input name="partNo" value="${escapeHtml(item.partNo || '')}"></label><label class="wide-field">Werkstoff / Material<input name="material" value="${escapeHtml(item.material || '')}"></label><label class="wide-field">Abmessung<input name="dimensions" value="${escapeHtml(item.dimensions || '')}"></label><label class="wide-field">Bemerkung<input name="note" value="${escapeHtml(item.note || '')}"></label><button class="remove-material" type="button">Position löschen</button>`;
    row.querySelector('[name="unit"]').value = item.unit || 'St';
    row.querySelectorAll('input,select').forEach(input => input.addEventListener('input', updateMaterialsFromForm));
    row.querySelector('.remove-material').addEventListener('click', () => { updateMaterialsFromForm(); state.materials.splice(index, 1); renderMaterialList(); render(); });
    list.append(row);
  });
}
function objectBounds(object) {
  if (object.type === 'line' || object.type === 'dimension') return { minX: Math.min(object.x1, object.x2), minY: Math.min(object.y1, object.y2), maxX: Math.max(object.x1, object.x2), maxY: Math.max(object.y1, object.y2) };
  if (object.type === 'rect') return { minX: object.x, minY: object.y, maxX: object.x + object.width, maxY: object.y + object.height };
  if (object.type === 'polyline') {
    const xs = object.points.map(point => point.x);
    const ys = object.points.map(point => point.y);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }
  if (object.type === 'text') return { minX: object.x, minY: object.y - 250, maxX: object.x + String(object.value || '').length * 180, maxY: object.y + 80 };
  return null;
}
function drawingBounds(padding = 0) {
  const boxes = state.objects.map(objectBounds).filter(Boolean);
  if (!boxes.length) return null;
  return {
    minX: Math.min(...boxes.map(box => box.minX)) - padding,
    minY: Math.min(...boxes.map(box => box.minY)) - padding,
    maxX: Math.max(...boxes.map(box => box.maxX)) + padding,
    maxY: Math.max(...boxes.map(box => box.maxY)) + padding
  };
}
function calculateAutoScale() {
  const bounds = drawingBounds(500);
  if (!bounds) return state.scale || 20;
  bounds.minX = Math.min(0, bounds.minX);
  bounds.minY = Math.min(0, bounds.minY);
  const usableWidth = sheet.width - sheet.margin * 2;
  const usableHeight = sheet.height - sheet.margin * 2 - sheet.titleHeight;
  const required = Math.max((bounds.maxX - bounds.minX) / usableWidth, (bounds.maxY - bounds.minY) / usableHeight, 1);
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
  document.querySelector('.scale-note').textContent = state.autoScale ? `Der Exportmaßstab wird automatisch als 1:${effectiveScale} errechnet. Die Arbeitsfläche bleibt beim Zeichnen stabil.` : `Ein gezeichnetes Blattmaß von 100 mm entspricht bei 1:${state.scale} einem echten Maß von ${formatLength(100 * state.scale)}.`;
  document.querySelector('#gridStatus').textContent = `Raster ${formatLength(snapSize * state.scale)}`;
}
function setScale(value) {
  const nextScale = Number(value);
  if (!Number.isFinite(nextScale) || nextScale < 1) return;
  state.autoScale = false;
  state.scale = Math.round(nextScale);
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
  if (object.type === 'rect') element = makeSvg('rect', { ...attrs, ...rectFillAttrs(object), x: canvasValue(object.x), y: canvasValue(object.y), width: canvasValue(object.width), height: canvasValue(object.height) });
  if (object.type === 'polyline') element = makeSvg('polyline', { ...attrs, points: object.points.map(point => `${canvasValue(point.x)},${canvasValue(point.y)}`).join(' ') });
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
  if (object.type === 'text') { element = makeSvg('text', { ...attrs, x: canvasValue(object.x), y: canvasValue(object.y), stroke: 'none', fill: object.stroke || state.strokeColor, 'font-size': 16 }); element.textContent = object.value; }
  if (!element) return null;
  element.dataset.id = object.id;
  if (object.id === selectedId) element.classList.add('selected-shape');
  element.addEventListener('pointerdown', event => { if (state.tool === 'select' && layer === drawingLayer) { event.preventDefault(); event.stopPropagation(); canvas.setPointerCapture?.(event.pointerId); startDraggingObject(object, eventPoint(event)); } });
  layer.append(element);
  return element;
}
function render() {
  addFillPatterns(canvas);
  drawingLayer.replaceChildren(); state.objects.forEach(object => renderObject(object));
  emptyState.classList.toggle('hidden', state.objects.length > 0);
  document.querySelector('#objectCount').textContent = state.objects.length;
  document.querySelector('#gridLayer').style.display = state.grid ? '' : 'none';
  document.querySelector('#zoomLabel').textContent = `${Math.round(state.zoom * 100)}%`;
  updateScaleUi();
  canvas.classList.toggle('select-mode', state.tool === 'select');
  if (selectedId) { const selected = state.objects.find(object => object.id === selectedId); if (selected) showProperties(selected); }
}
function newId() { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function pushHistory() { state.history.push(JSON.stringify(state.objects)); if (state.history.length > 30) state.history.shift(); }
function addObject(object) { pushHistory(); state.objects.push({ ...object, id: newId(), style: state.style, strokeWidth: state.strokeWidth, stroke: state.strokeColor }); selectedId = null; render(); setStatus('Objekt hinzugefügt'); }
function selectObject(id) { selectedId = id; render(); const object = state.objects.find(item => item.id === id); if (object) setStatus(`${toolNames[object.type] || 'Objekt'} ausgewählt`); }
function setStatus(message) { statusText.textContent = message; }
function clearPreview() { previewLayer.replaceChildren(); }
function previewLine(a, b) { clearPreview(); renderObject({ type: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, style: state.style, strokeWidth: state.strokeWidth, stroke: state.strokeColor }, previewLayer); }
function drawSnapMarker() {
  if (!currentSnap) return;
  const x = canvasValue(currentSnap.point.x);
  const y = canvasValue(currentSnap.point.y);
  const group = makeSvg('g', { class: 'snap-marker' });
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
function startDraggingObject(object, point) {
  selectedId = object.id;
  draggingObject = object;
  dragMode = object.type === 'dimension' ? 'dimensionOffset' : 'move';
  pointerStart = point;
  dragChanged = false;
  dragHistoryCaptured = false;
  render();
  setStatus(object.type === 'dimension' ? 'Bemaßungsabstand verschieben' : `${toolNames[object.type] || 'Objekt'} zum Verschieben ausgewählt`);
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
function geometryFields(object) {
  if (object.type === 'line' || object.type === 'dimension') return `<label>X1<input name="x1" type="number" step="1" value="${object.x1}"></label><label>Y1<input name="y1" type="number" step="1" value="${object.y1}"></label><label>X2<input name="x2" type="number" step="1" value="${object.x2}"></label><label>Y2<input name="y2" type="number" step="1" value="${object.y2}"></label>${object.type === 'dimension' ? `<label class="wide-field">Maßlinienabstand<input name="offset" type="number" step="1" value="${Number.isFinite(Number(object.offset)) ? object.offset : dimensionStyle().defaultOffset}"></label><label class="wide-field">Maßtext manuell<input name="labelOverride" type="text" placeholder="leer = automatisch" value="${escapeHtml(object.labelOverride || '')}"></label>` : ''}`;
  if (object.type === 'rect') return `<label>X<input name="x" type="number" step="1" value="${object.x}"></label><label>Y<input name="y" type="number" step="1" value="${object.y}"></label><label>Breite<input name="width" type="number" min="1" step="1" value="${object.width}"></label><label>Höhe<input name="height" type="number" min="1" step="1" value="${object.height}"></label><label class="wide-field">Füllung<select name="fillMode"><option value="none" ${!object.fillMode || object.fillMode === 'none' ? 'selected' : ''}>Keine</option><option value="solid" ${object.fillMode === 'solid' ? 'selected' : ''}>Vollfarbe schwarz</option><option value="hatch" ${object.fillMode === 'hatch' ? 'selected' : ''}>Schraffur</option><option value="crosshatch" ${object.fillMode === 'crosshatch' ? 'selected' : ''}>Kreuzschraffur</option></select></label>`;
  if (object.type === 'text') return `<label class="wide-field">Text<input name="value" type="text" value="${escapeHtml(object.value)}"></label><label>X<input name="x" type="number" step="1" value="${object.x}"></label><label>Y<input name="y" type="number" step="1" value="${object.y}"></label>`;
  return '<div class="property-note">Polylinien können derzeit über ihre Punkte neu gezeichnet werden.</div>';
}
function showProperties(object) {
  document.querySelector('#selectionCount').textContent = '1 ausgewählt';
  const measuredLength = object.type === 'line' || object.type === 'dimension' ? distance({ x: object.x1, y: object.y1 }, { x: object.x2, y: object.y2 }) : 0;
  const dimension = object.type === 'dimension' ? dimensionLabelText(object, measuredLength) : object.type === 'line' ? formatLength(measuredLength) : object.type === 'rect' ? `${formatLength(object.width)} x ${formatLength(object.height)}` : 'Mehrpunkt';
  const referenceControl = object.type === 'line' || object.type === 'dimension' ? `<div class="reference-box"><strong>Richtmaß festlegen</strong><span>Diese Linie als bekannte Länge für die gesamte Zeichnung verwenden.</span><div class="reference-row"><input id="referenceLength" type="number" min="1" step="1" value="1800"><span>mm</span><button id="setReference" class="reference-button">Übernehmen</button></div></div>` : '';
  propertyPanel.innerHTML = `<div class="property-form"><label>Typ<input value="${toolNames[object.type] || object.type}" readonly></label><label>Abmessung<input value="${dimension}" readonly></label>${geometryFields(object)}<label>Linienstärke<input name="strokeWidth" type="number" min="0.25" max="2.5" step="0.25" value="${object.strokeWidth}"></label><label>Stil<select name="style"><option value="solid" ${object.style === 'solid' ? 'selected' : ''}>Volllinie</option><option value="dashed" ${object.style === 'dashed' ? 'selected' : ''}>Strichlinie</option><option value="center" ${object.style === 'center' ? 'selected' : ''}>Achse</option></select></label><label>Farbe<input name="stroke" type="color" value="${object.stroke || state.strokeColor}"></label></div>${referenceControl}<button id="applyChanges" class="apply-button">Änderungen übernehmen</button><button id="copyObject" class="copy-button">Kopieren</button><button id="deleteSelected" class="delete-button">Auswahl löschen</button>`;
  document.querySelector('#applyChanges').addEventListener('click', applySelectedChanges);
  document.querySelector('#setReference')?.addEventListener('click', setSelectedAsReference);
  document.querySelector('#copyObject').addEventListener('click', copySelected);
  document.querySelector('#deleteSelected').addEventListener('click', deleteSelected);
}
function scaleObject(object, factor) {
  if (object.type === 'line' || object.type === 'dimension') { object.x1 *= factor; object.y1 *= factor; object.x2 *= factor; object.y2 *= factor; }
  if (object.type === 'rect') { object.x *= factor; object.y *= factor; object.width *= factor; object.height *= factor; }
  if (object.type === 'polyline') object.points.forEach(point => { point.x *= factor; point.y *= factor; });
  if (object.type === 'text') { object.x *= factor; object.y *= factor; }
}
function setSelectedAsReference() {
  const object = state.objects.find(item => item.id === selectedId);
  const targetLength = Number(document.querySelector('#referenceLength')?.value);
  if (!object || !['line', 'dimension'].includes(object.type) || !Number.isFinite(targetLength) || targetLength <= 0) return;
  const currentLength = distance({ x: object.x1, y: object.y1 }, { x: object.x2, y: object.y2 });
  if (currentLength < 0.001) { setStatus('Richtmaß benötigt eine Linie mit Länge'); return; }
  pushHistory();
  const factor = targetLength / currentLength;
  state.objects.forEach(item => scaleObject(item, factor));
  // Modellmaße und Maßstab gemeinsam ändern, damit die Zeichnung sichtbar unverändert bleibt.
  state.scale *= factor;
  syncScaleControls();
  render();
  setStatus(`Richtmaß gesetzt: ${formatLength(targetLength)}`);
}
function applySelectedChanges() {
  const object = state.objects.find(item => item.id === selectedId);
  if (!object) return;
  const form = propertyPanel.querySelector('.property-form');
  const values = Object.fromEntries([...form.querySelectorAll('[name]')].map(input => [input.name, input.value]));
  pushHistory();
  Object.keys(values).forEach(key => { object[key] = ['strokeWidth', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'offset'].includes(key) ? Number(values[key]) : values[key]; });
  if (object.type === 'dimension' && !String(object.labelOverride || '').trim()) delete object.labelOverride;
  if (object.type === 'rect') { object.width = Math.max(1, object.width); object.height = Math.max(1, object.height); }
  if (object.strokeWidth < 0.25 || !Number.isFinite(object.strokeWidth)) object.strokeWidth = 0.75;
  render();
  setStatus('Änderungen übernommen');
}
function deleteSelected() { if (!selectedId) return; pushHistory(); state.objects = state.objects.filter(object => object.id !== selectedId); selectedId = null; propertyPanel.innerHTML = '<div class="property-empty">Objekt anklicken, um seine Eigenschaften zu sehen.</div>'; document.querySelector('#selectionCount').textContent = 'Nichts ausgewählt'; render(); setStatus('Objekt gelöscht'); }
function copySelected() { const object = state.objects.find(item => item.id === selectedId); if (!object) return; clipboard = JSON.parse(JSON.stringify(object)); setStatus('Kopiert – Strg+V zum Einfügen'); }
function pasteClipboard() { if (!clipboard) { setStatus('Nichts zum Einfügen'); return; } pushHistory(); const copy = JSON.parse(JSON.stringify(clipboard)); copy.id = newId(); const offset = 400; if (copy.type === 'line' || copy.type === 'dimension') { copy.x1 += offset; copy.y1 += offset; copy.x2 += offset; copy.y2 += offset; } else if (copy.type === 'rect') { copy.x += offset; copy.y += offset; } else if (copy.type === 'polyline') copy.points.forEach(p => { p.x += offset; p.y += offset; }); else if (copy.type === 'text') { copy.x += offset; copy.y += offset; } state.objects.push(copy); selectedId = copy.id; render(); setStatus('Objekt eingefügt'); }
function handlePointerDown(event) {
  const point = eventPoint(event, state.tool === 'dimension');
  if (state.tool === 'select') {
    const hitObject = state.objects.find(object => {
      const hitThreshold = 400;
      if (object.type === 'line' || object.type === 'dimension') {
        return distanceToLine(point, object.x1, object.y1, object.x2, object.y2) <= hitThreshold;
      }
      if (object.type === 'rect') {
        const px = Math.max(object.x, Math.min(point.x, object.x + object.width));
        const py = Math.max(object.y, Math.min(point.y, object.y + object.height));
        return distance(point, { x: px, y: py }) <= hitThreshold;
      }
      if (object.type === 'polyline') {
        return object.points.some(p => distance(point, p) <= hitThreshold);
      }
      if (object.type === 'text') {
        return distance(point, { x: object.x, y: object.y }) <= hitThreshold;
      }
      return false;
    });
    if (hitObject) {
      canvas.setPointerCapture?.(event.pointerId);
      startDraggingObject(hitObject, point);
    } else {
      selectedId = null;
      draggingObject = null;
      dragChanged = false;
      render();
    }
    return;
  }
  if (state.tool === 'polyline') { if (!polylinePoints.length) polylinePoints = [point]; else { polylinePoints.push(point); if (event.detail >= 2) { addObject({ type: 'polyline', points: polylinePoints }); polylinePoints = []; clearPreview(); } } return; }
  if (state.tool === 'text') { const value = window.prompt('Text eingeben:', 'Hinweis'); if (value) addObject({ type: 'text', x: point.x, y: point.y, value }); return; }
  pointerStart = point;
}
function handlePointerMove(event) {
  const point = eventPoint(event, !draggingObject && state.tool === 'dimension', pointerStart); document.querySelector('#cursorCoords').textContent = `X ${formatLength(point.x)}   Y ${formatLength(point.y)}`;
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
    } else if (draggingObject.type === 'line' || draggingObject.type === 'dimension') {
      draggingObject.x1 += dx; draggingObject.y1 += dy; draggingObject.x2 += dx; draggingObject.y2 += dy;
    }
    if (draggingObject.type === 'rect') { draggingObject.x += dx; draggingObject.y += dy; }
    if (draggingObject.type === 'polyline') draggingObject.points.forEach(p => { p.x += dx; p.y += dy; });
    if (draggingObject.type === 'text') { draggingObject.x += dx; draggingObject.y += dy; }
    dragChanged = true;
    pointerStart = point;
    render();
    return;
  }
  if (!pointerStart) { clearPreview(); if (state.tool === 'dimension') drawSnapMarker(); if (polylinePoints.length) previewLine(polylinePoints[polylinePoints.length - 1], point); return; }
  if (state.tool === 'line' || state.tool === 'dimension') { previewLine(pointerStart, lineEndPoint(pointerStart, point, event)); drawSnapMarker(); }
  if (state.tool === 'rect') { clearPreview(); const end = exactRectEndPoint(pointerStart, point); const x = Math.min(pointerStart.x, end.x); const y = Math.min(pointerStart.y, end.y); renderObject({ type: 'rect', x, y, width: Math.abs(end.x - pointerStart.x), height: Math.abs(end.y - pointerStart.y), style: state.style, strokeWidth: state.strokeWidth, stroke: state.strokeColor }, previewLayer); }
}
function handlePointerUp(event) {
  if (draggingObject) {
    canvas.releasePointerCapture?.(event.pointerId);
    draggingObject = null;
    dragMode = 'move';
    pointerStart = null;
    setStatus(dragChanged ? 'Objekt verschoben' : 'Objekt ausgewählt');
    dragChanged = false;
    dragHistoryCaptured = false;
    return;
  }
  if (!pointerStart) return; const point = eventPoint(event, state.tool === 'dimension', pointerStart); const start = pointerStart; pointerStart = null; clearPreview();
  const endPoint = state.tool === 'rect' ? exactRectEndPoint(start, point) : lineEndPoint(start, point, event);
  if (distance(start, endPoint) < 3) return;
  if (state.tool === 'line') addObject({ type: 'line', x1: start.x, y1: start.y, x2: endPoint.x, y2: endPoint.y });
  if (state.tool === 'dimension') addObject({ type: 'dimension', x1: start.x, y1: start.y, x2: endPoint.x, y2: endPoint.y, offset: dimensionStyle().defaultOffset });
  if (state.tool === 'rect') addObject({ type: 'rect', x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y), fillMode: 'none' });
}
function setTool(tool) { state.tool = tool; document.querySelectorAll('.tool-button').forEach(button => button.classList.toggle('active', button.dataset.tool === tool)); document.querySelector('#toolHint').textContent = `${toolNames[tool]} aktiv`; document.querySelector('#lineLengthPanel').hidden = !['line', 'dimension', 'rect'].includes(tool); clearPreview(); polylinePoints = []; }
function saveProject() { state.projectName = document.querySelector('#projectName').value || 'Projekt01'; const data = { app: 'Werkplan', version: 2, unit: 'mm', projectName: state.projectName, objects: state.objects, settings: { grid: state.grid, snap: state.snap, zoom: state.zoom, scale: state.scale } }; const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${state.projectName.replace(/[^a-z0-9_-]+/gi, '_')}.werkplan`; link.click(); URL.revokeObjectURL(link.href); setStatus('Projekt gespeichert'); }
function loadProject(file) { const reader = new FileReader(); reader.onload = () => { try { const data = JSON.parse(reader.result); pushHistory(); state.objects = Array.isArray(data.objects) ? data.objects : []; state.projectName = data.projectName || 'Projekt01'; document.querySelector('#projectName').value = state.projectName; state.grid = data.settings?.grid ?? true; state.snap = data.settings?.snap ?? true; state.scale = Number(data.settings?.scale) > 0 ? Number(data.settings.scale) : 1; syncScaleControls(); document.querySelector('#gridToggle').checked = state.grid; document.querySelector('#snapToggle').checked = state.snap; selectedId = null; render(); setStatus('Projekt geladen'); } catch { setStatus('Datei konnte nicht gelesen werden'); } }; reader.readAsText(file); }
function exportSvg() { const copy = canvas.cloneNode(true); copy.querySelector('#previewLayer')?.remove(); const source = new XMLSerializer().serializeToString(copy); const blob = new Blob([source], { type: 'image/svg+xml' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${state.projectName || 'werkplan'}.svg`; link.click(); URL.revokeObjectURL(link.href); setStatus('SVG exportiert'); }
function fileBaseName() { updateProjectMetaFromForm(); return (state.projectName || 'werkplan').replace(/[^a-z0-9_-]+/gi, '_'); }
function downloadBlob(blob, filename) { const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); URL.revokeObjectURL(link.href); }
function exportPoint(value, min, scale, offset = sheet.margin) { return offset + (value - min) / scale; }
function renderExportObject(object, layer, bounds, exportScale) {
  const attrs = styleAttrs(object);
  attrs['stroke-width'] = Math.max(0.6, Number(attrs['stroke-width']) || 0.75);
  let element;
  if (object.type === 'line') element = makeSvg('line', { ...attrs, x1: exportPoint(object.x1, bounds.minX, exportScale), y1: exportPoint(object.y1, bounds.minY, exportScale), x2: exportPoint(object.x2, bounds.minX, exportScale), y2: exportPoint(object.y2, bounds.minY, exportScale) });
  if (object.type === 'rect') element = makeSvg('rect', { ...attrs, ...rectFillAttrs(object), x: exportPoint(object.x, bounds.minX, exportScale), y: exportPoint(object.y, bounds.minY, exportScale), width: object.width / exportScale, height: object.height / exportScale });
  if (object.type === 'polyline') element = makeSvg('polyline', { ...attrs, points: object.points.map(point => `${exportPoint(point.x, bounds.minX, exportScale)},${exportPoint(point.y, bounds.minY, exportScale)}`).join(' ') });
  if (object.type === 'dimension') {
    const dx = object.x2 - object.x1; const dy = object.y2 - object.y1; const length = Math.max(1, Math.round(Math.hypot(dx, dy)));
    const style = dimensionStyle();
    const normal = { x: -dy / length, y: dx / length }; const offset = Number.isFinite(Number(object.offset)) ? Number(object.offset) : style.defaultOffset;
    const x1 = exportPoint(object.x1, bounds.minX, exportScale); const y1 = exportPoint(object.y1, bounds.minY, exportScale);
    const x2 = exportPoint(object.x2, bounds.minX, exportScale); const y2 = exportPoint(object.y2, bounds.minY, exportScale);
    const ax = x1 + normal.x * offset; const ay = y1 + normal.y * offset; const bx = x2 + normal.x * offset; const by = y2 + normal.y * offset;
    element = makeSvg('g', {});
    element.append(makeSvg('line', { ...attrs, x1, y1, x2: ax, y2: ay }), makeSvg('line', { ...attrs, x1: x2, y1: y2, x2: bx, y2: by }), makeSvg('line', { ...attrs, x1: ax, y1: ay, x2: bx, y2: by }));
    appendDimensionEnds(element, attrs, ax, ay, bx, by, object.stroke || state.strokeColor);
    const label = makeSvg('text', { x: (ax + bx) / 2, y: (ay + by) / 2 - 7, 'text-anchor': 'middle', class: 'dimension-label', 'font-size': style.textSize });
    label.textContent = dimensionLabelText(object, length); element.append(label);
  }
  if (object.type === 'text') { element = makeSvg('text', { ...attrs, x: exportPoint(object.x, bounds.minX, exportScale), y: exportPoint(object.y, bounds.minY, exportScale), stroke: 'none', fill: object.stroke || state.strokeColor, 'font-size': 16 }); element.textContent = object.value; }
  if (element) layer.append(element);
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
function addMaterialTable(root) {
  updateMaterialsFromForm();
  if (!state.materials.length) return;
  const x = sheet.margin;
  const y = sheet.height - sheet.margin - sheet.titleHeight - 170;
  const width = 640;
  const rowHeight = 22;
  const headers = [
    ['Pos.', 38], ['Menge', 52], ['ME', 38], ['Benennung', 150],
    ['Sach-Nr.', 105], ['Werkstoff', 100], ['Abmessung', 92], ['Bemerkung', 65]
  ];
  const rows = state.materials.slice(0, 6);
  const height = rowHeight * (rows.length + 2);
  root.append(makeSvg('rect', { x, y, width, height, fill: '#fffdf8', stroke: '#263238', 'stroke-width': 1.1 }));
  addTableText(root, x + 8, y + 15, 'Materialliste / Stückliste', { 'font-weight': 700, fill: '#263238' });
  let colX = x;
  headers.forEach(([label, colWidth]) => {
    root.append(makeSvg('rect', { x: colX, y: y + rowHeight, width: colWidth, height: rowHeight, fill: 'none', stroke: '#263238', 'stroke-width': 0.8 }));
    addTableText(root, colX + 4, y + rowHeight + 15, label, { 'font-weight': 700, 'font-size': 9 });
    colX += colWidth;
  });
  rows.forEach((item, rowIndex) => {
    const values = [item.pos || rowIndex + 1, item.qty, item.unit, item.name, item.partNo, item.material, item.dimensions, item.note];
    let cellX = x;
    headers.forEach(([, colWidth], colIndex) => {
      const cellY = y + rowHeight * (rowIndex + 2);
      root.append(makeSvg('rect', { x: cellX, y: cellY, width: colWidth, height: rowHeight, fill: 'none', stroke: '#263238', 'stroke-width': 0.6 }));
      addTableText(root, cellX + 4, cellY + 15, String(values[colIndex] || '').slice(0, colWidth > 90 ? 20 : 8), { 'font-size': 9 });
      cellX += colWidth;
    });
  });
  if (state.materials.length > rows.length) addTableText(root, x + 8, y + height - 5, `+ ${state.materials.length - rows.length} weitere Position(en) im Projekt`, { 'font-size': 8, fill: '#667574' });
}
function buildSheetSvg() {
  updateProjectMetaFromForm();
  const bounds = drawingBounds(500) || { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const exportScale = state.autoScale ? calculateAutoScale() : state.scale;
  const root = makeSvg('svg', { xmlns: svgNS, width: '420mm', height: '297mm', viewBox: `0 0 ${sheet.width} ${sheet.height}` });
  addFillPatterns(root);
  const style = makeSvg('style', {});
  style.textContent = ".dimension-label{font:600 14px Arial,sans-serif;fill:#263238;paint-order:stroke;stroke:#fffdf8;stroke-width:5px;stroke-linejoin:round}.title-block-label{font:700 8px Arial,sans-serif;fill:#667574}.title-block-value{font:600 13px Arial,sans-serif;fill:#263238}.sheet-text{font:500 10px Arial,sans-serif;fill:#566665}";
  root.append(style);
  root.append(makeSvg('rect', { width: sheet.width, height: sheet.height, fill: '#fffdf8' }));
  root.append(makeSvg('rect', { x: 28, y: 28, width: sheet.width - 56, height: sheet.height - 56, fill: 'none', stroke: '#263238', 'stroke-width': 1.4 }));
  root.append(makeSvg('rect', { x: sheet.margin, y: sheet.margin, width: sheet.width - sheet.margin * 2, height: sheet.height - sheet.margin * 2 - sheet.titleHeight, fill: 'none', stroke: '#c8d2d0', 'stroke-width': 0.8, 'stroke-dasharray': '6 6' }));
  const drawing = makeSvg('g', {});
  state.objects.forEach(object => renderExportObject(object, drawing, bounds, exportScale));
  root.append(drawing);
  addMaterialTable(root);
  const titleX = sheet.width - sheet.margin - 540; const titleY = sheet.height - sheet.margin - sheet.titleHeight;
  root.append(makeSvg('rect', { x: titleX, y: titleY, width: 540, height: sheet.titleHeight, fill: '#fffdf8', stroke: '#263238', 'stroke-width': 1.2 }));
  addTitleCell(root, titleX, titleY, 270, 59, 'Projekt', state.projectName);
  addTitleCell(root, titleX + 270, titleY, 135, 59, 'Massstab', `1:${exportScale}`);
  addTitleCell(root, titleX + 405, titleY, 135, 59, 'Einheit', 'mm');
  addTitleCell(root, titleX, titleY + 59, 180, 59, 'Zeichnung', state.drawingNumber);
  addTitleCell(root, titleX + 180, titleY + 59, 150, 59, 'Bearbeiter', state.drawnBy);
  addTitleCell(root, titleX + 330, titleY + 59, 120, 59, 'Datum', state.projectDate);
  addTitleCell(root, titleX + 450, titleY + 59, 90, 59, 'Format', 'A3 quer');
  const note = makeSvg('text', { x: sheet.margin, y: sheet.height - sheet.margin - 12, class: 'sheet-text' }); note.textContent = 'Technische Zeichnung - automatisch skaliert nach verwendeten Massen';
  root.append(note);
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
function buildImagePdf(jpegDataUrl) {
  const pageW = 1190.55; const pageH = 841.89;
  const jpeg = atob(jpegDataUrl.split(',')[1]);
  const objects = [];
  const add = value => { objects.push(value); return objects.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  add(`<< /Type /XObject /Subtype /Image /Width ${sheet.width * 2} /Height ${sheet.height * 2} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n${jpeg}\nendstream`);
  const content = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im0 Do\nQ`;
  add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
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
  const out = await svgToCanvas(buildSheetSvg(), 2);
  const pdf = buildImagePdf(out.toDataURL('image/jpeg', 0.92));
  downloadBlob(pdf, `${fileBaseName()}.pdf`);
  setStatus('PDF exportiert');
}
saveProject = function() {
  updateDimensionStyleFromControls();
  updateProjectMetaFromForm();
  updateMaterialsFromForm();
  const data = {
    app: 'Werkplan',
    version: 3,
    unit: 'mm',
    projectName: state.projectName,
    drawingNumber: state.drawingNumber,
    drawnBy: state.drawnBy,
    projectDate: state.projectDate,
    materials: state.materials,
    objects: state.objects,
    settings: { grid: state.grid, snap: state.snap, zoom: state.zoom, scale: state.scale, autoScale: state.autoScale, dimensionStyle: state.dimensionStyle }
  };
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${fileBaseName()}.werkplan`);
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
      state.dimensionStyle = data.settings?.dimensionStyle || state.dimensionStyle;
      syncDimensionStyleControls();
      state.scale = Number(data.settings?.scale) > 0 ? Number(data.settings.scale) : 20;
      syncScaleControls();
      document.querySelector('#gridToggle').checked = state.grid;
      document.querySelector('#snapToggle').checked = state.snap;
      selectedId = null;
      render();
      setStatus('Projekt geladen');
    } catch {
      setStatus('Datei konnte nicht gelesen werden');
    }
  };
  reader.readAsText(file);
};

document.querySelectorAll('.tool-button').forEach(button => button.addEventListener('click', () => setTool(button.dataset.tool)));
document.querySelectorAll('.style-button').forEach(button => button.addEventListener('click', () => { state.style = button.dataset.style; document.querySelectorAll('.style-button').forEach(item => item.classList.toggle('active', item === button)); }));
document.querySelector('#strokeWidth').addEventListener('input', event => { state.strokeWidth = Number(event.target.value); document.querySelector('#strokeOutput').textContent = `${state.strokeWidth.toFixed(2).replace('.', ',')} mm`; });
document.querySelector('#strokeColor').addEventListener('input', event => state.strokeColor = event.target.value);
['#dimensionEndStyle', '#dimensionTextSize', '#dimensionDefaultOffset', '#dimensionUnit', '#dimensionDecimals'].forEach(selector => {
  document.querySelector(selector)?.addEventListener('input', () => { updateDimensionStyleFromControls(); render(); });
  document.querySelector(selector)?.addEventListener('change', () => { updateDimensionStyleFromControls(); render(); });
});
document.querySelector('#scaleSelect').addEventListener('change', event => { if (event.target.value === 'custom') { document.querySelector('#customScaleWrap').hidden = false; document.querySelector('#customScale').focus(); } else setScale(event.target.value); });
document.querySelector('#scaleSelect').addEventListener('change', event => { if (event.target.value === 'auto') { state.autoScale = true; syncScaleControls(); render(); setStatus('Massstab automatisch berechnet'); } });
document.querySelector('#customScale').addEventListener('change', event => setScale(event.target.value));
document.querySelector('#gridToggle').addEventListener('change', event => { state.grid = event.target.checked; render(); });
document.querySelector('#snapToggle').addEventListener('change', event => state.snap = event.target.checked);
document.querySelector('#addMaterialRow')?.addEventListener('click', () => { updateMaterialsFromForm(); state.materials.push(defaultMaterialRow()); renderMaterialList(); setStatus('Materialposition hinzugefügt'); });
document.querySelector('#newProject').addEventListener('click', () => { if ((state.objects.length || state.materials.length) && !window.confirm('Neue Zeichnung beginnen und aktuelle Arbeit verwerfen?')) return; state.objects = []; state.materials = []; state.projectName = 'Projekt01'; document.querySelector('#projectName').value = state.projectName; renderMaterialList(); selectedId = null; render(); setStatus('Neue Zeichnung'); });
document.querySelector('#saveProject').addEventListener('click', saveProject);
document.querySelector('#openProject').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', event => { if (event.target.files[0]) loadProject(event.target.files[0]); event.target.value = ''; });
document.querySelector('#exportSvg').addEventListener('click', exportSvg);
document.querySelector('#exportSheetSvg').addEventListener('click', exportSheetSvg);
document.querySelector('#exportPng').addEventListener('click', exportPng);
document.querySelector('#exportPdf').addEventListener('click', exportPdf);
document.querySelector('#zoomIn').addEventListener('click', () => { state.zoom = Math.min(2, state.zoom + .1); canvas.style.transform = `scale(${state.zoom})`; render(); });
document.querySelector('#zoomOut').addEventListener('click', () => { state.zoom = Math.max(.5, state.zoom - .1); canvas.style.transform = `scale(${state.zoom})`; render(); });
document.querySelector('#fitView').addEventListener('click', () => { state.zoom = 1; canvas.style.transform = 'scale(1)'; render(); });
canvas.addEventListener('pointerdown', handlePointerDown); canvas.addEventListener('pointermove', handlePointerMove); canvas.addEventListener('pointerup', handlePointerUp); canvas.addEventListener('pointerleave', () => { pointerStart = null; clearPreview(); });
document.addEventListener('keydown', event => { if (event.ctrlKey && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(); } const notEditing = document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA'; if (event.ctrlKey && event.key.toLowerCase() === 'c' && notEditing) { event.preventDefault(); copySelected(); } if (event.ctrlKey && event.key.toLowerCase() === 'v' && notEditing) { event.preventDefault(); pasteClipboard(); } if (notEditing && event.key >= '1' && event.key <= '6') setTool(Object.keys(toolNames)[Number(event.key) - 1]); if (notEditing && event.key === 'Delete') deleteSelected(); if (event.key === 'Escape') { pointerStart = null; polylinePoints = []; clearPreview(); } });
document.querySelector('#projectDate').value = state.projectDate;
syncDimensionStyleControls();
renderMaterialList();
syncScaleControls();
render();
