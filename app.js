const canvas = document.querySelector('#drawingCanvas');
const drawingLayer = document.querySelector('#drawingLayer');
const previewLayer = document.querySelector('#previewLayer');
const emptyState = document.querySelector('#emptyState');
const statusText = document.querySelector('#statusText');
const propertyPanel = document.querySelector('#propertyPanel');
const fileInput = document.querySelector('#fileInput');

const state = {
  tool: 'select', style: 'solid', strokeWidth: 0.75, strokeColor: '#263238',
  snap: true, grid: true, zoom: 1, scale: 20, projectName: 'Bushäuschen - Entwurf 01',
  objects: [], draft: null, history: []
};
let pointerStart = null;
let selectedId = null;
let draggingObject = null;
let polylinePoints = [];
let clipboard = null;

const svgNS = 'http://www.w3.org/2000/svg';
const snapSize = 10;
const toolNames = { select: 'Auswahl', line: 'Linie', polyline: 'Polylinie', rect: 'Rechteck', dimension: 'Bemaßung', text: 'Text' };

function makeSvg(tag, attrs = {}) {
  const element = document.createElementNS(svgNS, tag);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
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
function snapPoint(point) { return state.snap ? { x: Math.round(point.x / snapSize) * snapSize, y: Math.round(point.y / snapSize) * snapSize } : point; }
function eventPoint(event) {
  const svg = canvas;
  const rect = svg.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width * 1200;
  const y = (event.clientY - rect.top) / rect.height * 760;
  const snappedX = state.snap ? Math.round(x / snapSize) * snapSize : x;
  const snappedY = state.snap ? Math.round(y / snapSize) * snapSize : y;
  return { x: snappedX * state.scale, y: snappedY * state.scale };
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
function canvasValue(value) { return value / state.scale; }
function formatLength(value) { return value >= 1000 ? `${(value / 1000).toFixed(2).replace('.', ',')} m` : `${Math.round(value)} mm`; }
function syncScaleControls() {
  const select = document.querySelector('#scaleSelect');
  const customWrap = document.querySelector('#customScaleWrap');
  const preset = [...select.options].some(option => option.value === String(state.scale));
  select.value = preset ? String(state.scale) : 'custom';
  customWrap.hidden = preset;
  document.querySelector('#customScale').value = state.scale;
}
function updateScaleUi() {
  document.querySelector('#scaleMeta').textContent = `1:${state.scale}`;
  document.querySelector('.scale-note').textContent = `Ein gezeichnetes Blattmaß von 100 mm entspricht bei 1:${state.scale} einem echten Maß von ${formatLength(100 * state.scale)}.`;
  document.querySelector('#gridStatus').textContent = `Raster ${formatLength(snapSize * state.scale)}`;
}
function setScale(value) {
  const nextScale = Number(value);
  if (!Number.isFinite(nextScale) || nextScale < 1) return;
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
function renderObject(object, layer = drawingLayer) {
  let element;
  const attrs = styleAttrs(object);
  if (object.type === 'line') element = makeSvg('line', { ...attrs, x1: canvasValue(object.x1), y1: canvasValue(object.y1), x2: canvasValue(object.x2), y2: canvasValue(object.y2) });
  if (object.type === 'rect') element = makeSvg('rect', { ...attrs, x: canvasValue(object.x), y: canvasValue(object.y), width: canvasValue(object.width), height: canvasValue(object.height) });
  if (object.type === 'polyline') element = makeSvg('polyline', { ...attrs, points: object.points.map(point => `${canvasValue(point.x)},${canvasValue(point.y)}`).join(' ') });
  if (object.type === 'dimension') {
    const { x1, y1, x2, y2 } = object;
    const dx = x2 - x1; const dy = y2 - y1; const length = Math.max(1, Math.round(Math.hypot(dx, dy)));
    const offset = 22; const normal = { x: -dy / (length || 1), y: dx / (length || 1) };
    const ax = canvasValue(x1) + normal.x * offset; const ay = canvasValue(y1) + normal.y * offset; const bx = canvasValue(x2) + normal.x * offset; const by = canvasValue(y2) + normal.y * offset;
    element = makeSvg('g', { class: 'dimension-object' });
    element.append(makeSvg('line', { ...attrs, x1: canvasValue(x1), y1: canvasValue(y1), x2: ax, y2: ay }), makeSvg('line', { ...attrs, x1: canvasValue(x2), y1: canvasValue(y2), x2: bx, y2: by }), makeSvg('line', { ...attrs, x1: ax, y1: ay, x2: bx, y2: by }), makeSvg('path', { ...attrs, d: `M ${ax} ${ay} l 8 -4 l 0 8 z M ${bx} ${by} l -8 -4 l 0 8 z`, fill: object.stroke || state.strokeColor }));
    const label = makeSvg('text', { x: (ax + bx) / 2, y: (ay + by) / 2 - 7, 'text-anchor': 'middle', class: 'dimension-label' });
    label.textContent = formatLength(length); element.append(label);
  }
  if (object.type === 'text') { element = makeSvg('text', { ...attrs, x: canvasValue(object.x), y: canvasValue(object.y), stroke: 'none', fill: object.stroke || state.strokeColor, 'font-size': 16 }); element.textContent = object.value; }
  if (!element) return null;
  element.dataset.id = object.id;
  if (object.id === selectedId) element.classList.add('selected-shape');
  element.addEventListener('pointerdown', event => { if (state.tool === 'select') { event.stopPropagation(); selectObject(object.id); } });
  layer.append(element);
  return element;
}
function render() {
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
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
function geometryFields(object) {
  if (object.type === 'line' || object.type === 'dimension') return `<label>X1<input name="x1" type="number" step="1" value="${object.x1}"></label><label>Y1<input name="y1" type="number" step="1" value="${object.y1}"></label><label>X2<input name="x2" type="number" step="1" value="${object.x2}"></label><label>Y2<input name="y2" type="number" step="1" value="${object.y2}"></label>`;
  if (object.type === 'rect') return `<label>X<input name="x" type="number" step="1" value="${object.x}"></label><label>Y<input name="y" type="number" step="1" value="${object.y}"></label><label>Breite<input name="width" type="number" min="1" step="1" value="${object.width}"></label><label>Höhe<input name="height" type="number" min="1" step="1" value="${object.height}"></label>`;
  if (object.type === 'text') return `<label class="wide-field">Text<input name="value" type="text" value="${escapeHtml(object.value)}"></label><label>X<input name="x" type="number" step="1" value="${object.x}"></label><label>Y<input name="y" type="number" step="1" value="${object.y}"></label>`;
  return '<div class="property-note">Polylinien können derzeit über ihre Punkte neu gezeichnet werden.</div>';
}
function showProperties(object) {
  document.querySelector('#selectionCount').textContent = '1 ausgewählt';
  const dimension = object.type === 'line' || object.type === 'dimension' ? formatLength(distance({ x: object.x1, y: object.y1 }, { x: object.x2, y: object.y2 })) : object.type === 'rect' ? `${formatLength(object.width)} x ${formatLength(object.height)}` : 'Mehrpunkt';
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
  Object.keys(values).forEach(key => { object[key] = ['strokeWidth', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height'].includes(key) ? Number(values[key]) : values[key]; });
  if (object.type === 'rect') { object.width = Math.max(1, object.width); object.height = Math.max(1, object.height); }
  if (object.strokeWidth < 0.25 || !Number.isFinite(object.strokeWidth)) object.strokeWidth = 0.75;
  render();
  setStatus('Änderungen übernommen');
}
function deleteSelected() { if (!selectedId) return; pushHistory(); state.objects = state.objects.filter(object => object.id !== selectedId); selectedId = null; propertyPanel.innerHTML = '<div class="property-empty">Objekt anklicken, um seine Eigenschaften zu sehen.</div>'; document.querySelector('#selectionCount').textContent = 'Nichts ausgewählt'; render(); setStatus('Objekt gelöscht'); }
function copySelected() { const object = state.objects.find(item => item.id === selectedId); if (!object) return; clipboard = JSON.parse(JSON.stringify(object)); setStatus('Kopiert – Strg+V zum Einfügen'); }
function pasteClipboard() { if (!clipboard) { setStatus('Nichts zum Einfügen'); return; } pushHistory(); const copy = JSON.parse(JSON.stringify(clipboard)); copy.id = newId(); const offset = 400; if (copy.type === 'line' || copy.type === 'dimension') { copy.x1 += offset; copy.y1 += offset; copy.x2 += offset; copy.y2 += offset; } else if (copy.type === 'rect') { copy.x += offset; copy.y += offset; } else if (copy.type === 'polyline') copy.points.forEach(p => { p.x += offset; p.y += offset; }); else if (copy.type === 'text') { copy.x += offset; copy.y += offset; } state.objects.push(copy); selectedId = copy.id; render(); setStatus('Objekt eingefügt'); }
function handlePointerDown(event) {
  const point = eventPoint(event);
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
      selectedId = hitObject.id;
      draggingObject = hitObject;
      pointerStart = point;
      render();
      setStatus(`${toolNames[hitObject.type] || 'Objekt'} zum Verschieben ausgewählt`);
    } else {
      selectedId = null;
      draggingObject = null;
      render();
    }
    return;
  }
  if (state.tool === 'polyline') { if (!polylinePoints.length) polylinePoints = [point]; else { polylinePoints.push(point); if (event.detail >= 2) { addObject({ type: 'polyline', points: polylinePoints }); polylinePoints = []; clearPreview(); } } return; }
  if (state.tool === 'text') { const value = window.prompt('Text eingeben:', 'Hinweis'); if (value) addObject({ type: 'text', x: point.x, y: point.y, value }); return; }
  pointerStart = point;
}
function handlePointerMove(event) {
  const point = eventPoint(event); document.querySelector('#cursorCoords').textContent = `X ${formatLength(point.x)}   Y ${formatLength(point.y)}`;
  if (draggingObject && pointerStart) {
    const dx = point.x - pointerStart.x;
    const dy = point.y - pointerStart.y;
    if (draggingObject.type === 'line' || draggingObject.type === 'dimension') {
      draggingObject.x1 += dx; draggingObject.y1 += dy; draggingObject.x2 += dx; draggingObject.y2 += dy;
    }
    if (draggingObject.type === 'rect') { draggingObject.x += dx; draggingObject.y += dy; }
    if (draggingObject.type === 'polyline') draggingObject.points.forEach(p => { p.x += dx; p.y += dy; });
    if (draggingObject.type === 'text') { draggingObject.x += dx; draggingObject.y += dy; }
    pointerStart = point;
    render();
    return;
  }
  if (!pointerStart) { if (polylinePoints.length) previewLine(polylinePoints[polylinePoints.length - 1], point); return; }
  if (state.tool === 'line' || state.tool === 'dimension') previewLine(pointerStart, constrainedEndPoint(pointerStart, point));
  if (state.tool === 'rect') { clearPreview(); const x = Math.min(pointerStart.x, point.x); const y = Math.min(pointerStart.y, point.y); renderObject({ type: 'rect', x, y, width: Math.abs(point.x - pointerStart.x), height: Math.abs(point.y - pointerStart.y), style: state.style, strokeWidth: state.strokeWidth, stroke: state.strokeColor }, previewLayer); }
}
function handlePointerUp(event) {
  if (draggingObject) {
    draggingObject = null;
    pointerStart = null;
    pushHistory();
    setStatus('Objekt verschoben');
    return;
  }
  if (!pointerStart) return; const point = eventPoint(event); const start = pointerStart; pointerStart = null; clearPreview();
  const endPoint = constrainedEndPoint(start, point);
  if (distance(start, endPoint) < 3) return;
  if (state.tool === 'line') addObject({ type: 'line', x1: start.x, y1: start.y, x2: endPoint.x, y2: endPoint.y });
  if (state.tool === 'dimension') addObject({ type: 'dimension', x1: start.x, y1: start.y, x2: endPoint.x, y2: endPoint.y });
  if (state.tool === 'rect') addObject({ type: 'rect', x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) });
}
function setTool(tool) { state.tool = tool; document.querySelectorAll('.tool-button').forEach(button => button.classList.toggle('active', button.dataset.tool === tool)); document.querySelector('#toolHint').textContent = `${toolNames[tool]} aktiv`; document.querySelector('#lineLengthPanel').hidden = !['line', 'dimension'].includes(tool); clearPreview(); polylinePoints = []; }
function saveProject() { state.projectName = document.querySelector('#projectName').value || 'Werkplan'; const data = { app: 'Werkplan', version: 2, unit: 'mm', projectName: state.projectName, objects: state.objects, settings: { grid: state.grid, snap: state.snap, zoom: state.zoom, scale: state.scale } }; const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${state.projectName.replace(/[^a-z0-9_-]+/gi, '_')}.werkplan`; link.click(); URL.revokeObjectURL(link.href); setStatus('Projekt gespeichert'); }
function loadProject(file) { const reader = new FileReader(); reader.onload = () => { try { const data = JSON.parse(reader.result); pushHistory(); state.objects = Array.isArray(data.objects) ? data.objects : []; state.projectName = data.projectName || 'Werkplan'; document.querySelector('#projectName').value = state.projectName; state.grid = data.settings?.grid ?? true; state.snap = data.settings?.snap ?? true; state.scale = Number(data.settings?.scale) > 0 ? Number(data.settings.scale) : 1; syncScaleControls(); document.querySelector('#gridToggle').checked = state.grid; document.querySelector('#snapToggle').checked = state.snap; selectedId = null; render(); setStatus('Projekt geladen'); } catch { setStatus('Datei konnte nicht gelesen werden'); } }; reader.readAsText(file); }
function exportSvg() { const copy = canvas.cloneNode(true); copy.querySelector('#previewLayer')?.remove(); const source = new XMLSerializer().serializeToString(copy); const blob = new Blob([source], { type: 'image/svg+xml' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${state.projectName || 'werkplan'}.svg`; link.click(); URL.revokeObjectURL(link.href); setStatus('SVG exportiert'); }

document.querySelectorAll('.tool-button').forEach(button => button.addEventListener('click', () => setTool(button.dataset.tool)));
document.querySelectorAll('.style-button').forEach(button => button.addEventListener('click', () => { state.style = button.dataset.style; document.querySelectorAll('.style-button').forEach(item => item.classList.toggle('active', item === button)); }));
document.querySelector('#strokeWidth').addEventListener('input', event => { state.strokeWidth = Number(event.target.value); document.querySelector('#strokeOutput').textContent = `${state.strokeWidth.toFixed(2).replace('.', ',')} mm`; });
document.querySelector('#strokeColor').addEventListener('input', event => state.strokeColor = event.target.value);
document.querySelector('#scaleSelect').addEventListener('change', event => { if (event.target.value === 'custom') { document.querySelector('#customScaleWrap').hidden = false; document.querySelector('#customScale').focus(); } else setScale(event.target.value); });
document.querySelector('#customScale').addEventListener('change', event => setScale(event.target.value));
document.querySelector('#gridToggle').addEventListener('change', event => { state.grid = event.target.checked; render(); });
document.querySelector('#snapToggle').addEventListener('change', event => state.snap = event.target.checked);
document.querySelector('#newProject').addEventListener('click', () => { if (state.objects.length && !window.confirm('Neue Zeichnung beginnen und aktuelle Arbeit verwerfen?')) return; state.objects = []; selectedId = null; render(); setStatus('Neue Zeichnung'); });
document.querySelector('#saveProject').addEventListener('click', saveProject);
document.querySelector('#openProject').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', event => { if (event.target.files[0]) loadProject(event.target.files[0]); event.target.value = ''; });
document.querySelector('#exportSvg').addEventListener('click', exportSvg);
document.querySelector('#zoomIn').addEventListener('click', () => { state.zoom = Math.min(2, state.zoom + .1); canvas.style.transform = `scale(${state.zoom})`; render(); });
document.querySelector('#zoomOut').addEventListener('click', () => { state.zoom = Math.max(.5, state.zoom - .1); canvas.style.transform = `scale(${state.zoom})`; render(); });
document.querySelector('#fitView').addEventListener('click', () => { state.zoom = 1; canvas.style.transform = 'scale(1)'; render(); });
canvas.addEventListener('pointerdown', handlePointerDown); canvas.addEventListener('pointermove', handlePointerMove); canvas.addEventListener('pointerup', handlePointerUp); canvas.addEventListener('pointerleave', () => { pointerStart = null; clearPreview(); });
document.addEventListener('keydown', event => { if (event.ctrlKey && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(); } const notEditing = document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA'; if (event.ctrlKey && event.key.toLowerCase() === 'c' && notEditing) { event.preventDefault(); copySelected(); } if (event.ctrlKey && event.key.toLowerCase() === 'v' && notEditing) { event.preventDefault(); pasteClipboard(); } if (notEditing && event.key >= '1' && event.key <= '6') setTool(Object.keys(toolNames)[Number(event.key) - 1]); if (notEditing && event.key === 'Delete') deleteSelected(); if (event.key === 'Escape') { pointerStart = null; polylinePoints = []; clearPreview(); } });
syncScaleControls();
render();
