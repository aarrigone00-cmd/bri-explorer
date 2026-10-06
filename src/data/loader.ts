import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Corridor, Dataset, ParticipationCountry, Project, Route, Source } from '../types';

const base = `${import.meta.env.BASE_URL}data/`;

async function getJson<T>(file: string): Promise<T> {
  const res = await fetch(base + file);
  if (!res.ok) throw new Error(`Failed to load ${file} (${res.status})`);
  return res.json() as Promise<T>;
}

/**
 * Loads every dataset the app uses. Add new datasets here (and to the
 * Dataset type) so every feature module receives them through one object.
 */
export async function loadDataset(): Promise<Dataset> {
  const [projects, participation, corridors, routes, sources, topo] = await Promise.all([
    getJson<{ meta: Dataset['projectsMeta']; projects: Project[] }>('projects.json'),
    getJson<{ note: string; countries: ParticipationCountry[] }>('participation.json'),
    getJson<{ meta: { note: string }; corridors: Corridor[] }>('corridors.json'),
    getJson<{ meta: { note: string }; routes: Route[] }>('routes.json'),
    getJson<{ sources: Source[] }>('sources.json'),
    getJson<Topology<{ countries: GeometryCollection<{ name: string; iso3: string | null }> }>>('world-50m.json'),
  ]);

  const world = feature(topo, topo.objects.countries) as unknown as Dataset['world'];

  return {
    projects: projects.projects,
    projectsMeta: projects.meta,
    participation: participation.countries,
    participationNote: participation.note,
    corridors: corridors.corridors,
    corridorsNote: corridors.meta.note,
    routes: routes.routes,
    routesNote: routes.meta.note,
    sources: sources.sources,
    world,
  };
}
