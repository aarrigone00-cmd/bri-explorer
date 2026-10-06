// Builds public/data/aiddata-records.json from AidData's Geospatial Global
// Chinese Development Finance Dataset (GeoGCDF v3).
//
// Source repository (ODC-By for AidData's data, ODbL for OSM-derived geometry):
//   https://github.com/aiddata/gcdf-geospatial-data
//
// Usage:
//   git clone --depth 1 https://github.com/aiddata/gcdf-geospatial-data /tmp/gcdf
//   node scripts/build-aiddata.mjs /tmp/gcdf/input_data/gcdf_v3/final_input.csv /tmp/gcdf/latest/geojsons
//
// Selection (edit FILTER below to change it): physical-infrastructure records
// (AidData's "Infrastructure = Yes") in transport, energy, communications,
// industry/mining/construction and water sectors, committed 2013–2021.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [csvPath, geojsonDir] = process.argv.slice(2);
if (!csvPath || !geojsonDir) {
  console.error('Usage: node scripts/build-aiddata.mjs <final_input.csv> <geojsons dir>');
  process.exit(1);
}
const root = new URL('..', import.meta.url).pathname;

const FILTER = {
  sectors: ['TRANSPORT AND STORAGE', 'ENERGY', 'COMMUNICATIONS', 'INDUSTRY, MINING, CONSTRUCTION', 'WATER SUPPLY AND SANITATION'],
  infrastructureOnly: true,
  minCommitmentYear: 2013,
};

// ---- CSV parsing (RFC 4180, quoted fields may contain newlines) -------------
function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

// ---- Classification -----------------------------------------------------------
const RAIL = /\b(rail(way)?s?|railroad|metro|train|locomotives?|tram(way)?|light rail|monorail|sgr|standard gauge)\b/i;
const PORT = /\b(ports?|harbou?rs?|wharf|docks?|jetty|piers?|berths?|seaport|dry port|maritime|terminal|shipyard|ships?|vessels?|ferr(y|ies)|gantry|cranes?|dredg\w*|navigation)\b/i;
const ROAD = /\b(roads?|route|highways?|expressways?|motorways?|freeways?|autopista|carretera|rodovia|bridges?|bypass|interchange|boulevard|streets?|avenue|flyover|overpass|toll|ring road|carriageway|tunnel)\b/i;
const AIR = /\b(airport|terminal building|runway|aviation)\b/i;

function classify(sector, title) {
  if (sector === 'ENERGY') return { type: 'energy', subtype: 'Energy' };
  if (sector === 'TRANSPORT AND STORAGE') {
    // Match on the project part of the title ("... for <project>") to skip lender names.
    const project = title.replace(/^.*?\bfor\b/i, '');
    for (const text of [project, title]) {
      if (RAIL.test(text)) return { type: 'rail', subtype: 'Rail' };
      if (AIR.test(text)) return { type: 'other', subtype: 'Airport' };
      if (ROAD.test(text)) return { type: 'road', subtype: 'Road / bridge' };
      if (PORT.test(text)) return { type: 'port', subtype: 'Port / maritime' };
    }
    return { type: 'other', subtype: 'Transport & storage' };
  }
  const nice = { COMMUNICATIONS: 'Communications', 'INDUSTRY, MINING, CONSTRUCTION': 'Industry, mining & construction', 'WATER SUPPLY AND SANITATION': 'Water supply & sanitation' };
  return { type: 'other', subtype: nice[sector] ?? sector };
}

const STATUS = { Completion: 'completed', Implementation: 'under-construction', 'Pipeline: Commitment': 'planned' };

/** "China Eximbank provides $X loan for ..." → "China Eximbank". */
function lenderFromTitle(title) {
  const m = title.replace(/^\[[^\]]*\]\s*/, '').match(/^(.{3,120}?)\s+(?:provides?|contributes?|funds?|grants?|issues?|lends?|finances?|commits?|pledges?|extends?|donates?)\b/);
  if (!m) return null;
  const name = m[1].trim();
  return LENDER_NAMES[name] ?? LENDER_NAMES[name.toLowerCase()] ?? name;
}
const LENDER_NAMES = {
  CDB: 'China Development Bank (CDB)',
  'China Development Bank': 'China Development Bank (CDB)',
  ICBC: 'Industrial and Commercial Bank of China (ICBC)',
  'Industrial and Commercial Bank of China': 'Industrial and Commercial Bank of China (ICBC)',
  'China Eximbank': 'Export-Import Bank of China (China Eximbank)',
  'chinese government': 'Chinese Government',
  MOFCOM: 'Ministry of Commerce of China (MOFCOM)',
  CMEC: 'China Machinery Engineering Corporation (CMEC)',
};

// ---- Geometry helpers ---------------------------------------------------------
// ~1 km: plenty for the map's zoom range, and keeps the file small.
const SHAPE_TOLERANCE = 0.01;
const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

function simplify(points, tol) {
  // Iterative Douglas–Peucker on [lng, lat] arrays (rings can be very long).
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s0, e0] = stack.pop();
    const a = points[s0], b = points[e0];
    const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy || 1e-12;
    let maxD = -1, idx = -1;
    for (let i = s0 + 1; i < e0; i++) {
      const p = points[i];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
      const ex = a[0] + t * dx - p[0], ey = a[1] + t * dy - p[1];
      const d = ex * ex + ey * ey;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx > 0 && Math.sqrt(maxD) > tol) {
      keep[idx] = 1;
      stack.push([s0, idx], [idx, e0]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const lineLength = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

function collect(geom, out) {
  if (!geom) return;
  switch (geom.type) {
    case 'Point': out.points.push(geom.coordinates); break;
    case 'MultiPoint': out.points.push(...geom.coordinates); break;
    case 'LineString': out.lines.push(geom.coordinates); break;
    case 'MultiLineString': out.lines.push(...geom.coordinates); break;
    case 'Polygon': out.polys.push(geom.coordinates[0]); break;
    case 'MultiPolygon': for (const p of geom.coordinates) out.polys.push(p[0]); break;
    case 'GeometryCollection': for (const g of geom.geometries) collect(g, out); break;
  }
}

function bboxCenter(pts) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { center: [(x0 + x1) / 2, (y0 + y1) / 2], area: (x1 - x0) * (y1 - y0), diag: Math.hypot(x1 - x0, y1 - y0) };
}

function geometryFor(id) {
  const file = join(geojsonDir, `${id}.geojson`);
  if (!existsSync(file)) return null;
  const fc = JSON.parse(readFileSync(file, 'utf8'));
  const g = { points: [], lines: [], polys: [] };
  const precisions = [];
  for (const f of fc.features ?? []) {
    collect(f.geometry, g);
    if (f.properties?.osm_precision_list) precisions.push(...String(f.properties.osm_precision_list).split(','));
  }
  // AidData buffers linear features (roads, railways, power lines) into thin
  // polygons, so treat long, thin polygons as alignments worth drawing.
  const polys = g.polys.map((ring) => ({ ring, ...bboxCenter(ring) }));
  const longPolys = polys.filter((p) => p.diag > 0.05).sort((a, b) => b.diag - a.diag);
  const shapes = longPolys
    .slice(0, 6)
    .map((p) => simplify(p.ring, SHAPE_TOLERANCE).map(([x, y]) => [round(y, 2), round(x, 2)]))
    .filter((r) => r.length > 3);
  const lines = g.lines.filter((l) => l.length > 1).sort((a, b) => lineLength(b) - lineLength(a));
  const keptLines = lines
    .filter((l) => lineLength(l) > 0.02)
    .slice(0, 6)
    .map((l) => simplify(l, SHAPE_TOLERANCE).map(([x, y]) => [round(y, 2), round(x, 2)]))
    .filter((l) => l.length > 1);

  // Marker: on the main feature itself (nearest vertex to its bbox centre), so
  // it never floats off a curved road.
  const nearestVertex = (pts, c) => pts.reduce((best, p) => (Math.hypot(p[0] - c[0], p[1] - c[1]) < Math.hypot(best[0] - c[0], best[1] - c[1]) ? p : best), pts[0]);
  let point = null;
  if (lines.length && lineLength(lines[0]) > 0.02) point = lines[0][Math.floor(lines[0].length / 2)];
  else if (longPolys.length) point = nearestVertex(longPolys[0].ring, longPolys[0].center);
  else if (polys.length) point = polys.sort((a, b) => b.area - a.area)[0].center;
  else if (g.points.length) point = g.points[0];
  else if (lines.length) point = lines[0][0];
  if (!point) return null;
  const precise = precisions.length > 0 && precisions.every((p) => p.trim().toLowerCase() === 'precise');
  return { point: [round(point[1]), round(point[0])], lines: keptLines, shapes, precise };
}

// ---- Build --------------------------------------------------------------------
const rows = parseCsv(readFileSync(csvPath, 'utf8'));
const selected = rows.filter(
  (r) =>
    FILTER.sectors.includes(r['Sector.Name']) &&
    (!FILTER.infrastructureOnly || r['Infrastructure'] === 'Yes') &&
    Number(r['Commitment.Year']) >= FILTER.minCommitmentYear,
);

const num = (v) => (v === '' || v === 'NA' || v == null ? null : Number(v));
const year = (v) => (num(v) ? Math.trunc(num(v)) : null);
const missingGeo = [];
const records = [];
for (const r of selected) {
  const id = Number(r['AidData.Record.ID']);
  const geo = geometryFor(id);
  if (!geo) { missingGeo.push(id); continue; }
  const title = r['Title'].trim().replace(/\s+/g, ' ');
  const { type, subtype } = classify(r['Sector.Name'], title);
  const amount = num(r['Amount.(Constant.USD.2021)']);
  const osm = r['OSM.link'].split(/[\s,]+/).filter((u) => u.startsWith('https://www.openstreetmap.org/'));
  records.push({
    id,
    title,
    iso3: r['Recipient.ISO-3'],
    sector: r['Sector.Name'],
    type,
    subtype,
    status: STATUS[r['Status']] ?? 'completed',
    amountUsd2021: amount === null ? null : Math.round(amount),
    commitmentYear: year(r['Commitment.Year']),
    startYear: year(r['Implementation.Start.Year']),
    completionYear: year(r['Completion.Year']),
    lender: lenderFromTitle(title),
    precise: geo.precise,
    osm: osm[0] ?? null,
    coordinates: geo.point,
    ...(geo.lines.length ? { paths: geo.lines } : {}),
    ...(geo.shapes.length ? { shapes: geo.shapes } : {}),
  });
}
records.sort((a, b) => a.id - b.id);

const out = {
  meta: {
    sourceIds: ['aiddata-gcdf-v3', 'aiddata-geogcdf-v3', 'osm'],
    generated: new Date().toISOString().slice(0, 10),
    filter: FILTER,
    note:
      'Each record is one Chinese official-sector financial commitment (loan or grant) as recorded by AidData. Several records can belong to the same physical project (e.g. separate loan tranches). Amounts are commitments in constant 2021 US dollars, not disbursements or final costs.',
  },
  records,
};
writeFileSync(`${root}public/data/aiddata-records.json`, JSON.stringify(out));
const byType = records.reduce((m, r) => ((m[r.type] = (m[r.type] ?? 0) + 1), m), {});
console.log(`selected ${selected.length}, written ${records.length} (no geometry: ${missingGeo.join(', ') || 'none'})`, byType);
console.log(`with lender parsed: ${records.filter((r) => r.lender).length}; with amount: ${records.filter((r) => r.amountUsd2021 !== null).length}; with lines: ${records.filter((r) => r.paths).length}; with shapes: ${records.filter((r) => r.shapes).length}`);
