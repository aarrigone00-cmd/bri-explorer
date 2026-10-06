import { COST_BASIS_SHORT, PROJECT_TYPES, STATUS_LABELS } from '../config';
import { formatUsdMillions, participationAt, projectStatusAt, projectVisibleAt } from '../lib/analytics';
import type { Store } from '../state/store';
import type { Dataset, Project } from '../types';
import { $, escapeHtml, safeUrl } from './dom';

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', timeZone: 'UTC' });

const list = (items: string[], empty = 'Not specified in this dataset') =>
  items.length ? `<ul class="plain-list">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : `<p class="muted">${empty}</p>`;

export function initDetailPanel(data: Dataset, store: Store): void {
  const panel = $('#detail-panel');
  const body = $('#detail-body');
  const byIso = new Map(data.participation.map((c) => [c.iso3, c]));
  const worldName = new Map(data.world.features.filter((f) => f.properties.iso3).map((f) => [f.properties.iso3!, f.properties.name]));
  const sourceById = new Map(data.sources.map((s) => [s.id, s]));
  const corridorById = new Map(data.corridors.map((c) => [c.id, c]));

  panel.querySelector('[data-close-detail]')!.addEventListener('click', () => store.set({ selection: null }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && store.get().selection) store.set({ selection: null });
  });

  body.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-select-project],[data-select-country]');
    if (!t) return;
    if (t.dataset.selectProject) store.set({ selection: { kind: 'project', id: t.dataset.selectProject } });
    if (t.dataset.selectCountry) store.set({ selection: { kind: 'country', iso3: t.dataset.selectCountry } });
  });

  function sourceLine(ids: string[]) {
    return ids
      .map((id) => sourceById.get(id))
      .filter(Boolean)
      .map((s) => `<a href="${safeUrl(s!.url)}" target="_blank" rel="noopener">${escapeHtml(s!.publisher)}</a>`)
      .join('; ');
  }

  function renderCountry(iso3: string, year: number) {
    const c = byIso.get(iso3);
    const name = c?.name ?? worldName.get(iso3) ?? iso3;
    const status = participationAt(c, year);
    const projects = data.projects.filter((p) => p.countries.includes(iso3));
    const corridors = data.corridors.filter((k) => k.countries.includes(iso3));
    const sectors = [...new Set(projects.map((p) => PROJECT_TYPES[p.type].plural))];
    const figures = projects.filter((p) => p.cost.amountUsdMillions !== null);

    const statusText: Record<string, string> = {
      participant: 'BRI participant',
      exited: 'Exited the BRI',
      unconfirmed: 'Listed, MoU date unconfirmed',
      'not-yet': `Joined after ${year}`,
      none: 'Not on the GFDC participant list',
    };

    let membership: string;
    if (!c) {
      membership = `<p>${escapeHtml(name)} does not appear on the GFDC list of countries that have signed a BRI memorandum of understanding. It may still host projects or trade along BRI routes.</p>`;
    } else if (iso3 === 'CHN') {
      membership = '<p>China launched the Belt and Road Initiative in 2013.</p>';
    } else {
      membership = `<dl class="facts">
        <div><dt>Likely MoU signed</dt><dd>${c.mouDate ? fmtDate(c.mouDate) : '<span class="muted">No independently confirmed date</span>'}</dd></div>
        ${c.exitDate ? `<div><dt>Exited</dt><dd>${fmtDate(c.exitDate)}</dd></div>` : ''}
        <div><dt>Income group</dt><dd>${escapeHtml(c.incomeGroup)}</dd></div>
      </dl>`;
    }

    body.innerHTML = `
      <div class="detail__kicker">Country</div>
      <h2 class="detail__title">${escapeHtml(name)}</h2>
      <div class="badges">
        ${c ? `<span class="badge">${escapeHtml(c.region)}</span>` : ''}
        <span class="badge badge--status badge--${status}">${statusText[status]}</span>
      </div>
      ${membership}

      <h3>Projects in this dataset (${projects.length})</h3>
      ${
        projects.length
          ? `<ul class="link-list">${projects
              .map(
                (p) => `<li><button type="button" class="link-row" data-select-project="${p.id}">
                  <span class="dot dot--${p.type}"></span><span>${escapeHtml(p.name)}</span>
                  <span class="muted">${p.startYear ?? ''}${projectVisibleAt(p, year) ? '' : ' · after timeline year'}</span></button></li>`,
              )
              .join('')}</ul>`
          : '<p class="muted">No projects for this country in the current dataset, which is a curated sample rather than a full inventory.</p>'
      }

      <h3>Sectors involved</h3>
      ${list(sectors, 'No projects in this dataset')}

      <h3>Economic corridors</h3>
      ${list(corridors.map((k) => k.name), 'Not part of one of the six official corridors')}

      <h3>Investment &amp; financing</h3>
      ${
        figures.length
          ? `<p>Reported figures for projects in this dataset (approximate, from different bases, so not strictly additive):</p>
             <ul class="plain-list">${figures
               .map((p) => `<li>${escapeHtml(p.name)}: <strong>${formatUsdMillions(p.cost.amountUsdMillions!)}</strong> <span class="muted">(${COST_BASIS_SHORT[p.cost.basis].toLowerCase()})</span></li>`)
               .join('')}</ul>`
          : '<p class="muted">No single reported USD figure available in this dataset.</p>'
      }
      <p class="source-note">Participation: ${sourceLine(['gfdc-countries-2025'])}. Projects: see the individual project references.</p>
    `;
  }

  function renderProject(p: Project, year: number) {
    const statusAtYear = projectStatusAt(p, year);
    const corridorNames = p.corridors.map((id) => corridorById.get(id)?.name).filter(Boolean) as string[];
    const countryLinks = p.countries
      .map((iso) => `<button type="button" class="inline-link" data-select-country="${iso}">${escapeHtml(byIso.get(iso)?.name ?? worldName.get(iso) ?? iso)}</button>`)
      .join(', ');

    body.innerHTML = `
      <div class="detail__kicker"><span class="dot dot--${p.type}"></span>${escapeHtml(PROJECT_TYPES[p.type].label)} project · ${escapeHtml(p.subtype)}</div>
      <h2 class="detail__title">${escapeHtml(p.name)}</h2>
      <div class="badges">
        <span class="badge badge--project-${p.status}">${escapeHtml(STATUS_LABELS[p.status])}</span>
        ${statusAtYear !== p.status ? `<span class="badge">In ${year}: ${escapeHtml(STATUS_LABELS[statusAtYear])}</span>` : ''}
      </div>
      <p>${escapeHtml(p.description)}</p>
      ${p.statusNote ? `<p class="callout">${escapeHtml(p.statusNote)}</p>` : ''}
      <dl class="facts">
        <div><dt>Location</dt><dd>${escapeHtml(p.location)}</dd></div>
        <div><dt>Country</dt><dd>${countryLinks}</dd></div>
        <div><dt>Start</dt><dd>${p.startYear ?? '<span class="muted">Unknown</span>'}</dd></div>
        <div><dt>Completion</dt><dd>${p.completionYear ?? `<span class="muted">${p.status === 'operational' ? 'Ongoing' : 'Not yet completed'}</span>`}</dd></div>
        <div class="facts__wide"><dt>Estimated cost / financing</dt><dd>${escapeHtml(p.cost.display)}
          ${p.cost.amountUsdMillions !== null ? `<div class="muted small">Counted in dashboard as ${formatUsdMillions(p.cost.amountUsdMillions)} (${COST_BASIS_SHORT[p.cost.basis].toLowerCase()}, approximate)</div>` : ''}</dd></div>
        ${corridorNames.length ? `<div class="facts__wide"><dt>Economic corridor</dt><dd>${corridorNames.map(escapeHtml).join(', ')}</dd></div>` : ''}
      </dl>
      <h3>Chinese organizations involved</h3>
      ${list(p.chineseEntities, 'Not known')}
      <h3>Local partners</h3>
      ${list(p.localPartners, 'Not known')}
      <h3>References</h3>
      <ul class="plain-list">${p.references.map((r) => `<li><a href="${safeUrl(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.label)}</a></li>`).join('')}</ul>
      <p class="source-note">Figures are approximate as reported in public sources, and different sources may give different numbers. Compiled from: ${sourceLine(p.sourceIds)}. Dataset as of ${escapeHtml(data.projectsMeta.asOf)}.</p>
    `;
  }

  function render() {
    const { selection, year } = store.get();
    if (!selection) {
      panel.hidden = true;
      document.body.classList.remove('has-detail');
      return;
    }
    if (selection.kind === 'country') renderCountry(selection.iso3, year);
    else {
      const p = data.projects.find((x) => x.id === selection.id);
      if (!p) return;
      renderProject(p, year);
    }
    panel.hidden = false;
    document.body.classList.add('has-detail');
    body.scrollTop = 0;
  }

  store.subscribe((s, prev) => {
    if (s.selection !== prev.selection || (s.selection && s.year !== prev.year)) render();
  });
}
