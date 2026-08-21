const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function extractFunction(name) {
  const start = appSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} must exist`);
  const open = appSource.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = open; index < appSource.length; index += 1) {
    const character = appSource[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return appSource.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

const distance = eval(`(${extractFunction('distance')})`);
const segmentIntersection = eval(`(${extractFunction('segmentIntersection')})`);
const clampDimensionOffset = eval(`(${extractFunction('clampDimensionOffset')})`);
const projectDataFromState = eval(`(${extractFunction('projectDataFromState')})`);

test('distance calculates Euclidean length', () => {
  assert.equal(distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
});

test('segmentIntersection finds a crossing and rejects parallel segments', () => {
  assert.deepEqual(
    segmentIntersection({ x1: 0, y1: 0, x2: 10, y2: 10 }, { x1: 0, y1: 10, x2: 10, y2: 0 }),
    { x: 5, y: 5 }
  );
  assert.equal(segmentIntersection({ x1: 0, y1: 0, x2: 10, y2: 0 }, { x1: 0, y1: 5, x2: 10, y2: 5 }), null);
});

test('dimension offsets stay within the supported range', () => {
  assert.equal(clampDimensionOffset(1000), 500);
  assert.equal(clampDimensionOffset(-1000), -500);
  assert.equal(clampDimensionOffset('invalid'), 22);
});

test('project data survives JSON save/load round trip', () => {
  const state = {
    projectName: 'Test', drawingNumber: 'TZ-002', drawnBy: 'A', projectDate: '2026-08-21',
    materials: [{ objectIds: ['line-1'] }], objects: [{ id: 'line-1', type: 'line' }],
    grid: true, snap: false, snapModes: { endpoint: true }, zoom: 1, scale: 20, autoScale: true,
    dimensionStyle: { defaultOffset: 22 }, sheetFormat: 'A3', sheetOrientation: 'landscape',
    enabledViews: ['front'], activeView: 'front', viewReferences: {}, layers: [], activeLayer: 'contour',
    viewSettings: {}, exportScaleMode: 'auto', exportScale: 10
  };
  const loaded = JSON.parse(JSON.stringify(projectDataFromState(state)));
  assert.equal(loaded.version, 13);
  assert.deepEqual(loaded.objects, state.objects);
  assert.deepEqual(loaded.materials, state.materials);
  assert.deepEqual(loaded.settings.dimensionStyle, state.dimensionStyle);
  assert.deepEqual(loaded.settings.enabledViews, state.enabledViews);
});

test('carpentry automatic dimensions are disabled at the dimension factory', () => {
  assert.match(appSource, /const dimension = .*isCarpentryTool\(\) \? null/);
  assert.match(appSource, /const carpentryToolIds = new Set/);
});

test('only one save and load implementation remains', () => {
  assert.equal((appSource.match(/function saveProject\s*\(/g) || []).length, 0);
  assert.equal((appSource.match(/function loadProject\s*\(/g) || []).length, 0);
  assert.equal((appSource.match(/saveProject\s*=\s*function/g) || []).length, 1);
  assert.equal((appSource.match(/loadProject\s*=\s*function/g) || []).length, 1);
});
