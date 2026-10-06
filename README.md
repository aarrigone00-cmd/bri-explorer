# BRI Explorer

An interactive, source-cited visualization of China's Belt and Road Initiative (BRI). It shows participating countries, a curated sample of flagship projects, the six economic corridors, and the land and maritime routes.

- **Interactive world map** (Leaflet): zoom, pan, and click countries, projects, routes and corridors
- **Project markers** for rail, ports, roads, energy and other projects, with distinct icons. Approximate alignments are drawn for linear projects. Hollow markers mean a project was not yet complete in the selected year
- **Country panel** showing GFDC participation status and MoU date, region, projects in the dataset, sectors, corridors and reported financing
- **Project panel** showing location, type, reported cost and what that figure measures, start and completion, status, Chinese organizations, local partners, description and references
- **Layer filters** for rail, ports, roads, energy, other, economic corridors, land routes, maritime routes and country shading
- **Search** for countries or projects; the map flies to the selection
- **Timeline** from 2013 to the latest year in the data, with play/pause. Countries appear by MoU year and projects by start year
- **Dashboard** with every figure computed from the loaded data: participant counts, projects by sector, region and status, and reported financing totals split by what each figure measures
- **Sources & methodology** section
- **Themes**: dark, light and system. Responsive layout for desktop, tablet and phone

No API keys or secrets are required.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

Requires Node 20+ (Netlify is pinned to Node 22 in `netlify.toml`).

### Verifying

`npm run verify` builds nothing itself. Run it after `npm run build`. It starts `vite preview` and drives the app in headless Chromium at desktop, tablet and phone sizes in both color schemes. It checks that markers, routes and country shading render, and that search, panels, timeline, filters, dashboard and theme switching work with no console errors. It also checks there is no horizontal overflow. Screenshots go to `./screenshots/`. Set `CHROMIUM_PATH` if Chromium is not at the default path.

## Deploying to Netlify

The repo includes `netlify.toml`:

- Build command: `npm run build`
- Publish directory: `dist`
- Node 22, cache headers for hashed assets, revalidation for `/data/*`

Connect the repository in Netlify (**Add new site → Import an existing project**) and accept the detected settings. No environment variables are needed.

### Environment variables and secrets

- The app has **no hard-coded keys**. The optional place-name labels use free CARTO basemap tiles, which need no key. Check CARTO's attribution and usage terms if you expect heavy traffic. You can turn labels off in the Layers panel or point them elsewhere with `VITE_TILE_URL` (see `.env.example`).
- Any variable prefixed `VITE_` is **embedded in the public bundle**, so never put secrets there.
- For future features that need secrets (news APIs, AI providers), add a [Netlify Function](https://docs.netlify.com/functions/overview/) under `netlify/functions/`. Read the key from `process.env` in the function, set it in **Site settings → Environment variables**, and call the function from the frontend.

## Data

All data lives in `public/data/` as plain JSON, so you can update it without touching code.

| File | Contents | Source |
| --- | --- | --- |
| `participation.json` | 152 countries with likely MoU date, exit date, region and income group (generated) | Nedopil (2025), *Countries of the Belt and Road Initiative*, Green Finance & Development Center, Fudan University. Values as of May 2025 |
| `projects.json` | 45 flagship projects | Widely reported public information. Each project links to a reference |
| `corridors.json` | The six economic corridors (schematic) | NDRC/MFA/MOFCOM *Vision and Actions* (2015) |
| `routes.json` | Land and maritime routes (schematic) | Same as above |
| `sources.json` | Source registry shown in the Sources section | — |
| `world-50m.json` | Country boundaries in TopoJSON, annotated with ISO3 codes (generated) | Natural Earth via `world-atlas` |

### Data principles

- **Nothing is invented.** If a value is unknown, leave it `null` or empty and the UI says "not known" or "no figure".
- `cost.display` is the human-readable figure **with qualifiers** ("≈", "reported", ranges, original currency).
- `cost.amountUsdMillions` is set **only** when there is a single widely reported USD figure. Ranges, non-USD amounts and unbuilt projects stay `null` and are not counted in totals.
- `cost.basis` records what the number measures: `total-cost`, `financing`, `acquisition` or `contract`. The dashboard never adds different bases together.
- The project list is a **sample**, not an inventory. For comprehensive financing data, see AidData's Global Chinese Development Finance Dataset, Boston University's Global Development Policy Center databases, or AEI's China Global Investment Tracker.

### Adding a project

Add an object to `public/data/projects.json` following the `Project` type in `src/types.ts`:

```jsonc
{
  "id": "unique-kebab-id",
  "name": "Project name",
  "type": "rail",                       // rail | port | road | energy | other
  "subtype": "Standard gauge railway",
  "countries": ["KEN"],                 // ISO 3166-1 alpha-3
  "location": "City / region, Country",
  "coordinates": [lat, lng],            // marker position
  "path": [[lat, lng], ...],            // optional approximate alignment
  "status": "operational",              // operational | partially-operational | under-construction | planned | suspended | cancelled
  "statusNote": "Optional context",
  "startYear": 2018,                    // or null
  "completionYear": 2022,               // or null
  "cost": { "display": "≈ US$1.2 billion (reported)", "amountUsdMillions": 1200, "basis": "total-cost" },
  "chineseEntities": ["..."],
  "localPartners": ["..."],
  "corridors": ["cpec"],                // ids from corridors.json
  "description": "Neutral, factual summary.",
  "references": [{ "label": "...", "url": "https://..." }],
  "sourceIds": ["wikipedia"]            // ids from sources.json
}
```

### Updating the participation list

Edit `scripts/gfdc-bri-countries-2025-05.csv`, or replace it with a newer GFDC export, then run:

```bash
npm run data   # regenerates public/data/participation.json and world-50m.json
```

## Project structure

```
index.html              page shell (header, map overlays, dashboard, sources)
netlify.toml            Netlify build + headers
public/data/            all datasets (JSON)
scripts/build-data.mjs  regenerates participation + boundary files
scripts/verify.mjs      headless browser smoke test
src/
  main.ts               bootstraps store, data and feature modules
  config.ts             layer, type and status definitions, icons, tile config
  types.ts              data model
  data/loader.ts        loads every dataset into one Dataset object
  state/store.ts        tiny observable store (layers, year, selection, theme)
  lib/analytics.ts      pure stats and timeline functions (dashboard, map)
  map/map.ts            Leaflet map, layers and focus helpers
  ui/                   detail panel, filters, search, timeline, legend, dashboard, sources, theme
  styles/main.css       design tokens (dark/light) and layout
```

### Extending

Each feature is an `initX(data, store)` module that subscribes to the shared store, so new features plug in without changing the existing ones:

- **Country comparison**: add `compare: string[]` to `AppState`, a `ui/compare.ts` module, and use `computeStats`-style helpers in `lib/analytics.ts`.
- **Additional datasets**: add the JSON to `public/data/`, load it in `data/loader.ts`, and extend `Dataset`.
- **Live news / AI questions**: add a Netlify Function that holds the API key, and a `ui/news.ts` or `ui/ask.ts` module that calls `/.netlify/functions/...`.
- **Advanced analytics**: add pure functions to `lib/analytics.ts` and render them in the dashboard.

## Neutrality and accuracy

The site aims to be neutral and educational. Participation, project classification and cost figures differ between sources. The app labels where each figure comes from, marks figures as approximate, and notes cases that are often misclassified, such as projects that began before 2013 or EU-financed works built by Chinese contractors. Statuses were last reviewed in October 2026. Corrections via issues or pull requests are welcome. Please include a source.

## License

Code: MIT. Data remains subject to the terms of its original sources (see `public/data/sources.json`).
