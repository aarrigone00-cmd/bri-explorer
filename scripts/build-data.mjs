// Build-time data preparation. Run with `npm run data` after editing the
// source CSV, then commit the generated files in public/data/.
//
// 1. Converts the GFDC (Fudan University) BRI country list CSV into
//    public/data/participation.json.
// 2. Annotates the Natural Earth 1:50m country boundaries (via world-atlas)
//    with ISO 3166-1 alpha-3 codes and writes public/data/world-50m.json.
// 3. Adds a label point (centroid of each country's largest polygon) to every
//    participation record so countries can be located from search.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { feature } from 'topojson-client';
import countries from 'i18n-iso-countries';

const require = createRequire(import.meta.url);
const root = new URL('..', import.meta.url).pathname;

// --- country boundaries -----------------------------------------------------
const topo = JSON.parse(readFileSync(require.resolve('world-atlas/countries-50m.json'), 'utf8'));
for (const g of topo.objects.countries.geometries) {
  const iso3 = g.id ? countries.numericToAlpha3(g.id) : undefined;
  g.properties = { name: g.properties?.name ?? '', iso3: iso3 ?? null };
}
writeFileSync(`${root}public/data/world-50m.json`, JSON.stringify(topo));

// Largest-ring centroid per ISO3 code.
function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a / 2;
}
function ringCentroid(ring) {
  let x = 0, y = 0, a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    x += (ring[j][0] + ring[i][0]) * f;
    y += (ring[j][1] + ring[i][1]) * f;
    a += f;
  }
  if (a === 0) return ring[0];
  return [x / (3 * a), y / (3 * a)];
}
const centroids = {};
for (const f of feature(topo, topo.objects.countries).features) {
  const iso3 = f.properties.iso3;
  if (!iso3) continue;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  let best = null, bestArea = -1;
  for (const p of polys) {
    const area = Math.abs(ringArea(p[0]));
    if (area > bestArea) { bestArea = area; best = p[0]; }
  }
  if (best) {
    const [lon, lat] = ringCentroid(best);
    centroids[iso3] = [Math.round(lat * 100) / 100, Math.round(lon * 100) / 100];
  }
}

// --- participation list -----------------------------------------------------
function parseCsv(text) {
  const rows = [];
  for (const line of text.trim().split(/\r?\n/)) {
    const cells = [];
    let cur = '', q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    rows.push(cells);
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const csv = parseCsv(readFileSync(`${root}scripts/gfdc-bri-countries-2025-05.csv`, 'utf8'));
const missing = [];
const participation = csv.map((r) => {
  const point = centroids[r.iso3] ?? null;
  if (!point) missing.push(r.iso3);
  return {
    iso3: r.iso3,
    name: r.name,
    region: r.region,
    incomeGroup: r.income,
    mouDate: r.mou || null,
    exitDate: r.exit || null,
    labelPoint: point,
  };
});

const out = {
  source: 'gfdc-countries-2025',
  note: 'Likely MoU signing and exit dates as compiled by the Green Finance & Development Center (GFDC), Fudan University. Countries without a date are those for which GFDC could not find independent confirmation of an MoU.',
  countries: participation,
};
writeFileSync(`${root}public/data/participation.json`, JSON.stringify(out, null, 2) + '\n');
console.log(`participation: ${participation.length} countries; without boundary polygon: ${missing.join(', ') || 'none'}`);
