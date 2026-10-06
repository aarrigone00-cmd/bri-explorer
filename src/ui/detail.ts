import { COST_BASIS_SHORT, PROJECT_TYPES, STATUS_LABELS } from '../config';
import { formatUsd, formatUsdMillions, participationAt, projectStatusAt, projectVisibleAt, recordStatusAt, recordVisibleAt } from '../lib/analytics';
import type { Store } from '../state/store';
import type { Dataset, FinanceRecord, Project } from '../types';
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
  const recordById = new Map(data.records.map((r) => [r.id, r]));
  const engagement = data.engagement;

  panel.querySelector('[data-close-detail]')!.addEventListener('click', () => store.set({ selection: null }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && store.get().selection) store.set({ selection: null });
  });

  body.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-select-project],[data-select-country],[data-select-record]');
    if (!t) return;
    if (t.dataset.selectProject) store.set({ selection: { kind: 'project', id: t.dataset.selectProject } });
    if (t.dataset.selectCountry) store.set({ selection: { kind: 'country', iso3: t.dataset.selectCountry } });
    if (t.dataset.selectRecord) store.set({ selection: { kind: 'record', id: Number(t.dataset.selectRecord) } });
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
      ${countryRecords(iso3, year)}
      ${countryEngagement(iso3)}
      <p class="source-note">Participation: ${sourceLine(['gfdc-countries-2025'])}. Flagship projects: see the individual project references. Finance records: ${sourceLine(['aiddata-gcdf-v3'])}.</p>
    `;
  }

  function countryRecords(iso3: string, year: number): string {
    const all = data.records.filter((r) => r.iso3 === iso3);
    if (!all.length) {
      return `<h3>AidData finance records (2013–2021)</h3><p class="muted">No physical-infrastructure records in the AidData extract used here.</p>`;
    }
    const visible = all.filter((r) => recordVisibleAt(r, year));
    const withAmt = visible.filter((r) => r.amountUsd2021 !== null);
    const total = withAmt.reduce((s, r) => s + r.amountUsd2021!, 0);
    const byType = new Map<string, number>();
    for (const r of visible) byType.set(PROJECT_TYPES[r.type].plural, (byType.get(PROJECT_TYPES[r.type].plural) ?? 0) + 1);
    const largest = [...withAmt].sort((a, b) => b.amountUsd2021! - a.amountUsd2021!).slice(0, 6);
    return `
      <h3>AidData finance records (2013–${Math.min(year, 2021)})</h3>
      <p><strong>${visible.length}</strong> Chinese official loan or grant commitment${visible.length === 1 ? '' : 's'} for infrastructure${
        withAmt.length ? `, totalling <strong>≈ ${formatUsd(total)}</strong> (constant 2021 USD, ${withAmt.length} with a recorded amount)` : ''
      }.</p>
      ${byType.size ? `<p class="muted small">${[...byType.entries()].map(([k, v]) => `${escapeHtml(k)}: ${v}`).join(' · ')}</p>` : ''}
      ${
        largest.length
          ? `<ul class="link-list">${largest
              .map(
                (r) => `<li><button type="button" class="link-row" data-select-record="${r.id}">
                  <span class="dot dot--${r.type}"></span><span class="link-row__text">${escapeHtml(shortTitle(r))}</span>
                  <span class="muted">${formatUsd(r.amountUsd2021!)}</span></button></li>`,
              )
              .join('')}</ul>`
          : ''
      }
      <p class="muted small">Commitments are not disbursements, and several records can belong to one project.</p>`;
  }

  function countryEngagement(iso3: string): string {
    const v = engagement.countries2025.values[iso3];
    if (v === undefined) return '';
    return `<h3>Recent engagement (2025)</h3>
      <p>${escapeHtml(engagement.countries2025.measure)}: <strong>≈ US$${v >= 1 ? `${v} bn` : `${Math.round(v * 1000)} m`}</strong> (preliminary).</p>
      <p class="muted small">Source: ${sourceLine([engagement.countries2025.sourceId])}.</p>`;
  }

  /** AidData titles read "Lender provides $X for <project>"; show the project part. */
  function shortTitle(r: FinanceRecord): string {
    const m = r.title.match(/\bfor (?:the )?(.+)$/i);
    const t = (m ? m[1] : r.title).replace(/\s*\((?:linked|Linked)[^)]*\)?\s*$/, '');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function renderRecord(r: FinanceRecord, year: number) {
    const statusAtYear = recordStatusAt(r, year);
    const country = byIso.get(r.iso3)?.name ?? worldName.get(r.iso3) ?? r.iso3;
    const STATUS_TEXT: Record<FinanceRecord['status'], string> = {
      completed: 'Completed',
      'under-construction': 'In implementation',
      planned: 'Committed, not yet implemented',
    };
    body.innerHTML = `
      <div class="detail__kicker"><span class="dot dot--${r.type}"></span>AidData record #${r.id} · ${escapeHtml(r.subtype)}</div>
      <h2 class="detail__title">${escapeHtml(shortTitle(r))}</h2>
      <div class="badges">
        <span class="badge badge--project-${r.status === 'completed' ? 'operational' : r.status}">${STATUS_TEXT[r.status]}</span>
        ${statusAtYear !== (r.status as string) ? `<span class="badge">In ${year}: ${escapeHtml(STATUS_LABELS[statusAtYear])}</span>` : ''}
        <span class="badge">${r.precise ? 'Precisely located' : 'Approximate location'}</span>
      </div>
      <p class="callout">“${escapeHtml(r.title)}”<br><span class="muted small">Record title as published by AidData</span></p>
      <dl class="facts">
        <div><dt>Country</dt><dd><button type="button" class="inline-link" data-select-country="${r.iso3}">${escapeHtml(country)}</button></dd></div>
        <div><dt>AidData sector</dt><dd>${escapeHtml(r.sector.charAt(0) + r.sector.slice(1).toLowerCase())}</dd></div>
        <div><dt>Committed</dt><dd>${r.commitmentYear ?? '<span class="muted">Unknown</span>'}</dd></div>
        <div><dt>Implementation</dt><dd>${r.startYear ?? '?'} – ${r.completionYear ?? (r.status === 'completed' ? '?' : 'ongoing')}</dd></div>
        <div class="facts__wide"><dt>Commitment amount</dt><dd>${
          r.amountUsd2021 !== null
            ? `${formatUsd(r.amountUsd2021)} <span class="muted small">(constant 2021 USD, as recorded by AidData)</span>`
            : '<span class="muted">No amount recorded</span>'
        }</dd></div>
        <div class="facts__wide"><dt>Chinese financier</dt><dd>${r.lender ? escapeHtml(r.lender) : '<span class="muted">Not stated in the record title</span>'}</dd></div>
      </dl>
      <p class="muted small">Implementing agencies and local counterparts are recorded in the full AidData GCDF v3 dataset, which isn't included in this extract.</p>
      <h3>References</h3>
      <ul class="plain-list">
        <li><a href="${safeUrl(sourceById.get('aiddata-gcdf-v3')!.url)}" target="_blank" rel="noopener">AidData GCDF v3 dataset (Record ID ${r.id})</a></li>
        ${r.osm ? `<li><a href="${safeUrl(r.osm)}" target="_blank" rel="noopener">Location on OpenStreetMap</a></li>` : ''}
      </ul>
      <p class="source-note">${escapeHtml(data.recordsNote)} Source: ${sourceLine(['aiddata-gcdf-v3', 'aiddata-geogcdf-v3'])}; geometry © OpenStreetMap contributors (ODbL).</p>
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
    else if (selection.kind === 'record') {
      const rec = recordById.get(selection.id);
      if (!rec) return;
      renderRecord(rec, year);
    } else {
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
