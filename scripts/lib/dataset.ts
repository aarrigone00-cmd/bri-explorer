// Loads the published datasets from public/data/ into the same Dataset shape
// the browser builds (src/data/loader.ts), for offline tests.
import { readFileSync } from 'node:fs';
import { feature } from 'topojson-client';
import type { Dataset } from '../../src/types';

const read = (f: string) => JSON.parse(readFileSync(new URL(`../../public/data/${f}`, import.meta.url), 'utf8'));

export function loadDatasetFromDisk(): Dataset {
  const projects = read('projects.json');
  const participation = read('participation.json');
  const corridors = read('corridors.json');
  const routes = read('routes.json');
  const topo = read('world-50m.json');
  const records = read('aiddata-records.json');
  return {
    projects: projects.projects,
    projectsMeta: projects.meta,
    participation: participation.countries,
    participationNote: participation.note,
    corridors: corridors.corridors,
    corridorsNote: corridors.meta.note,
    routes: routes.routes,
    routesNote: routes.meta.note,
    sources: read('sources.json').sources,
    records: records.records,
    recordsNote: records.meta.note,
    engagement: read('bri-engagement.json'),
    world: feature(topo, topo.objects.countries) as unknown as Dataset['world'],
  };
}
