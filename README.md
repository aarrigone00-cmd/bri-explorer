# BRI Explorer

An interactive, source-cited visualization of China's Belt and Road Initiative (BRI). It shows participating countries, a curated sample of flagship projects, the six economic corridors, and the land and maritime routes.

- **Interactive world map** (Leaflet): zoom, pan, and click countries, projects, routes and corridors
- **AidData finance records**: 1,297 Chinese official loan and grant commitments for infrastructure (2013–2021) from AidData's Global Chinese Development Finance Dataset v3. Each one has its amount, lender, status and dates; outlines appear when you zoom in
- **Latest engagement (2025–2026)** from the Griffith Asia Institute / GFDC BRI investment reports, in the dashboard and in country panels
- **Project markers** for rail, ports, roads, energy and other projects, with distinct icons. Approximate alignments are drawn for linear projects. Hollow markers mean a project was not yet complete in the selected year
- **Country panel** showing GFDC participation status and MoU date, region, projects in the dataset, sectors, corridors and reported financing
- **Project panel** showing location, type, reported cost and what that figure measures, start and completion, status, Chinese organizations, local partners, description and references
- **Layer filters** for rail, ports, roads, energy, other, economic corridors, land routes, maritime routes and country shading
- **Search** for countries or projects; the map flies to the selection
- **Timeline** from 2013 to the latest year in the data, with play/pause. Countries appear by MoU year and projects by start year
- **Dashboard** with every figure computed from the loaded data: participant counts, projects by sector, region and status, and reported financing totals split by what each figure measures
- **Sources & methodology** section
- **Themes**: dark, light and system. Responsive layout for desktop, tablet and phone

- **Email login** (optional, Supabase Auth): sign up, sign in, sign out, forgot/reset password. The site stays fully public; login only adds an account to build features on (`store.get().user`).

No secret keys are used anywhere in the frontend.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

Requires Node 20+ (Netlify is pinned to Node 22 in `netlify.toml`).

### Verifying

`npm run verify` also runs `scripts/verify-auth.mjs`, which tests every login flow against a mocked Supabase Auth API, so it sends no email and creates no users. `npm run verify` builds nothing itself. Run it after `npm run build`. It starts `vite preview` and drives the app in headless Chromium at desktop, tablet and phone sizes in both color schemes. It checks that markers, routes and country shading render, and that search, panels, timeline, filters, dashboard and theme switching work with no console errors. It also checks there is no horizontal overflow. Screenshots go to `./screenshots/`. Set `CHROMIUM_PATH` if Chromium is not at the default path.

## Deploying to Netlify

The repo includes `netlify.toml`:

- Build command: `npm run build`
- Publish directory: `dist`
- Node 22, cache headers for hashed assets, revalidation for `/data/*`

Connect the repository in Netlify (**Add new site → Import an existing project**) and accept the detected settings. No environment variables need to be set in Netlify; the public Supabase values are in `netlify.toml`, and anything you set in the Netlify UI overrides them.

### Environment variables and secrets

- The app has **no hard-coded keys**. The optional place-name labels use free CARTO basemap tiles, which need no key. Check CARTO's attribution and usage terms if you expect heavy traffic. You can turn labels off in the Layers panel or point them elsewhere with `VITE_TILE_URL` (see `.env.example`).
- Any variable prefixed `VITE_` is **embedded in the public bundle**, so never put secrets there.
- For future features that need secrets (news APIs, AI providers), add a [Netlify Function](https://docs.netlify.com/functions/overview/) under `netlify/functions/`. Read the key from `process.env` in the function, set it in **Site settings → Environment variables**, and call the function from the frontend.

## Email login (Supabase)

Login uses [Supabase Auth](https://supabase.com/docs/guides/auth) with email + password. Supabase project: `wfgcnwsfftjsgqtcwlyd`.

- Configured by `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, set in `netlify.toml` for deploys and in `.env.local` for local dev (copy `.env.example`). These are the **publishable** values, which Supabase designs to be public; they ship to every browser regardless of where they are set. Never use the secret / `service_role` key in a `VITE_` variable.
- If either variable is missing, the Sign in button is hidden and the site works as before.
- `supabase-js` is loaded as a separate chunk so it doesn't slow the map's first load.
- Code: `src/auth/supabase.ts` (client) and `src/ui/auth.ts` (header button + dialog). The signed-in user is available as `store.get().user` for future features, e.g. saved views protected by Row Level Security.

### Profiles

Signed-in users get a **profile** (click your name or initials in the header):

- Editable display name, organization or school, region of interest and a short "about you" (500 characters)
- **Saved on the map**: a ☆ Save button on every country, flagship project and AidData record panel. Saved items are listed in the profile, and clicking one opens it on the map
- Email address and "member since" date from Supabase Auth

Data lives in the `public.profiles` table (`supabase/migrations/20261013190102_create_profiles.sql`):

- One row per user, created automatically by a trigger when someone signs up. The app also creates it if missing.
- **Row Level Security**: users can only select, insert and update their own row. Anonymous visitors have no access, and rows are deleted with the user account.
- Length limits and the saved-items format are enforced by database constraints, not just the form.

Code: `src/auth/profile.ts` (data access) and `src/ui/profile.ts` (profile dialog). The detail panel adds the Save button.

### One-time Supabase dashboard settings

These can't be changed through the database, so they're done in the dashboard (**Authentication → URL Configuration**):

1. **Site URL**: your Netlify URL, e.g. `https://your-site.netlify.app`. Confirmation and reset emails link here.
2. **Redirect URLs**: add `https://your-site.netlify.app/**` and `http://localhost:5173/**`.

**Email delivery:** Supabase's built-in email sender only delivers to members of your Supabase organization's team, and only a few emails per hour. To let anyone sign up, add a custom SMTP provider (e.g. Resend, Postmark, SendGrid) under **Authentication → Emails → SMTP Settings**. Alternatively, turn off **Confirm email** under **Authentication → Sign In / Providers → Email** so sign-ups don't need an email; password reset still sends one.

## AI agents

Four agents built on the Claude API (`claude-opus-5-5` by default) run as **Netlify Functions**, so API keys stay on the server.

| Agent | Who uses it | What it does | Runs |
| --- | --- | --- | --- |
| **Ask the Map** | Signed-in users (✦ button on the map) | Answers questions from the site's own data through tools (search, country profile, AidData queries, overview), cites the dataset, and can zoom the map, move the timeline or switch layers | On demand, max 30 per user per day |
| **Project Watcher** | Admins (profile → "Project updates to review") | Searches recent news on each unfinished flagship project (plus 4 others in rotation) and files **suggested** status updates with sources. Nothing is published until an admin approves; approved updates appear on the project panel | Mondays 07:00 UTC, or "Run Project Watcher" |
| **My Briefing** | Signed-in users (profile → "My briefing") | A one-page briefing from the user's region of interest, saved items, the site's data and the latest news digest | On demand, max 3 per day |
| **China & the World** | Everyone (News section) | Researches the week's China foreign-policy news with web search and publishes a neutral, cited digest. Story links must come from the agent's own search results; invented links are dropped | Daily 06:00 UTC, or "Run the news agent now" (admins) |

### Setup (Netlify → Site configuration → Environment variables)

| Variable | Value | Secret? |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | From console.anthropic.com → API keys | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API keys → **secret** (or legacy `service_role`) key. Used only by the functions to save agent results and check sign-ins | Yes, never put it in a `VITE_` variable |
| `AGENT_MODEL` (optional) | Model id, default `claude-opus-5-5`; e.g. `claude-sonnet-5-5` costs about half | No |
| `AGENT_ASK_DAILY_LIMIT`, `AGENT_BRIEFING_DAILY_LIMIT` (optional) | Per-user daily limits (defaults 30 and 3) | No |

Redeploy after adding them. Until both secrets are set, the agents say they aren't switched on and the rest of the site works normally. `/api/agents/status` reports which keys are present (true/false only).

### Cost control

- Set a **monthly spend limit** in the Anthropic Console.
- The interactive agents need sign-in and have per-user daily limits (`agent_usage` table).
- Rough running costs at Opus 5.5 prices: a few cents per question or briefing. The daily news digest (up to 8 web searches) and the weekly Project Watcher (up to 3 searches per project) together typically cost on the order of US$10–25 a month. To cut that, switch `AGENT_MODEL`, or change the schedules in `netlify/functions/agent-*-schedule.mts`.

### How it fits together

- `netlify/lib/` holds the shared code:
  - `loop.ts`: the agent loop, with time and round budgets sized to Netlify's limits (60 s, or 15 min for background functions)
  - `site-tools.ts`: the data tools
  - `web.ts`: checks cited links against the agent's search results
  - `agents/*.ts`: one file per agent
- `netlify/functions/agent-*.mts` are the HTTP endpoints. The scheduled functions (30 s limit) only trigger the background functions that do the work.
- Requests use the server-side refusal fallback (`fallbacks: "default"`) and prompt caching.
- Supabase tables (`supabase/migrations/20261027170000_create_agents.sql`):
  - `news_digests`, `project_update_suggestions`, `project_watch_log`, `user_briefings`, `agent_usage`, `agent_runs`, `app_admins`
  - Row Level Security: anyone can read published digests and approved updates; users read their own briefings and usage; only admins see suggestions and run logs and can approve or reject. All writes go through the functions.
- **Admins** are listed in `app_admins`. Add one in the Supabase SQL editor: `insert into app_admins (user_id) select id from auth.users where email = '…';`
- Tests: `npm run test:agents` runs all four agents against a scripted fake of the Claude API (no key or network needed); `npm run verify` covers the UI.

## Data

All data lives in `public/data/` as plain JSON, so you can update it without touching code.

| File | Contents | Source |
| --- | --- | --- |
| `participation.json` | 152 countries with likely MoU date, exit date, region and income group (generated) | Nedopil (2025), *Countries of the Belt and Road Initiative*, Green Finance & Development Center, Fudan University. Values as of May 2025 |
| `projects.json` | 45 flagship projects | Widely reported public information. Each project links to a reference |
| `corridors.json` | The six economic corridors (schematic) | NDRC/MFA/MOFCOM *Vision and Actions* (2015) |
| `routes.json` | Land and maritime routes (schematic) | Same as above |
| `aiddata-records.json` | 1,297 AidData finance records (generated, see below) | AidData GCDF v3 (ODC-By) and GeoGCDF v3, geometry from OpenStreetMap (ODbL) |
| `bri-engagement.json` | Headline 2025 / 2026 H1 engagement figures | Nedopil (2026), *China BRI Investment Report 2025*; GFDC *2026 H1* update; MOFCOM as cited there |
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

### Rebuilding the AidData layer

`public/data/aiddata-records.json` is generated from AidData's public GitHub repository:

```bash
git clone --depth 1 https://github.com/aiddata/gcdf-geospatial-data /tmp/gcdf
node scripts/build-aiddata.mjs /tmp/gcdf/input_data/gcdf_v3/final_input.csv /tmp/gcdf/latest/geojsons
```

The filter at the top of `scripts/build-aiddata.mjs` selects records flagged by AidData as physical infrastructure, in the transport, energy, communications, industry/mining/construction and water sectors, committed 2013–2021. Rail, port and road types are assigned from keywords in the record titles. The lender is taken from AidData's title ("China Eximbank provides…"). Geometry is simplified to about 1 km.

**Licences:** AidData's data is ODC-By, so credit AidData (done in the map attribution, panels and Sources). The geometry is derived from OpenStreetMap under ODbL, so credit OSM and keep the derived file openly available. It is, as a public file in this repo and site.

### Updating the latest engagement figures

Edit `public/data/bri-engagement.json` when GFDC / Griffith publish a new report, and use only figures stated in the report text. The per-year values are only shown as charts, so don't estimate them from the images.

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
  auth/supabase.ts      lazily created Supabase client (email login)
  ui/                   auth dialog, detail panel, filters, search, timeline, legend, dashboard, sources, theme
  styles/main.css       design tokens (dark/light) and layout
```

### Extending

Each feature is an `initX(data, store)` module that subscribes to the shared store, so new features plug in without changing the existing ones:

- **Country comparison**: add `compare: string[]` to `AppState`, a `ui/compare.ts` module, and use `computeStats`-style helpers in `lib/analytics.ts`.
- **Additional datasets**: add the JSON to `public/data/`, load it in `data/loader.ts`, and extend `Dataset`.
- **More agents**: add a file in `netlify/lib/agents/`, an endpoint in `netlify/functions/`, and a `ui/` module that calls it with `callAgent()` from `src/agents/client.ts` (see *AI agents*).
- **Advanced analytics**: add pure functions to `lib/analytics.ts` and render them in the dashboard.

## Neutrality and accuracy

The site aims to be neutral and educational. Participation, project classification and cost figures differ between sources. The app labels where each figure comes from, marks figures as approximate, and notes cases that are often misclassified, such as projects that began before 2013 or EU-financed works built by Chinese contractors. Statuses were last reviewed in October 2026. Corrections via issues or pull requests are welcome. Please include a source.

## License

Code: MIT. Data remains subject to the terms of its original sources (see `public/data/sources.json`).
