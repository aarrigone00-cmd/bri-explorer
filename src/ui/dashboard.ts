import { COST_BASIS_SHORT, PROJECT_TYPES, STATUS_LABELS } from '../config';
import { computeRecordStats, computeStats, formatUsd, formatUsdMillions } from '../lib/analytics';
import type { Store } from '../state/store';
import type { Dataset } from '../types';
import { $, escapeHtml, safeUrl } from './dom';

function bars(rows: [string, number][], opts: { colorClass?: (key: string) => string; label?: (key: string) => string } = {}) {
  if (!rows.length) return '<p class="muted">No data for this year.</p>';
  const max = Math.max(...rows.map((r) => r[1]));
  return `<ul class="bars">${rows
    .map(([k, v]) => {
      const label = opts.label ? opts.label(k) : k;
      return `<li class="bars__row">
        <span class="bars__label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
        <span class="bars__track"><span class="bars__fill ${opts.colorClass?.(k) ?? ''}" style="width:${(v / max) * 100}%"></span></span>
        <span class="bars__value">${v}</span></li>`;
    })
    .join('')}</ul>`;
}

export function initDashboard(data: Dataset, store: Store): void {
  const body = $('#dashboard-body');
  const subtitle = $('#dashboard-subtitle');

  function render() {
    const { year } = store.get();
    const s = computeStats(data, year);
    subtitle.innerHTML = `As of the end of <strong>${year}</strong> (follows the map timeline). All numbers are computed from the data loaded on this page.`;

    const financeTiles = s.finance.length
      ? s.finance
          .map(
            (f) => `<div class="stat stat--finance">
              <div class="stat__value">≈ ${formatUsdMillions(f.totalUsdMillions)}</div>
              <div class="stat__label">${COST_BASIS_SHORT[f.basis]}</div>
              <div class="stat__note">Sum of ${f.count} reported figure${f.count === 1 ? '' : 's'}</div></div>`,
          )
          .join('')
      : '<p class="muted">No reported figures for this year.</p>';

    body.innerHTML = `
      <div class="stats">
        <div class="stat">
          <div class="stat__value">${s.participants}</div>
          <div class="stat__label">Countries with a BRI MoU</div>
          <div class="stat__note">Incl. China · ${s.unconfirmed} more listed without a confirmed date${s.exited ? ` · ${s.exited} exited` : ''}</div>
        </div>
        <div class="stat">
          <div class="stat__value">${s.projectCount}</div>
          <div class="stat__label">Flagship projects</div>
          <div class="stat__note">Of ${data.projects.length} curated flagship projects</div>
        </div>
        <div class="stat">
          <div class="stat__value">${s.projectCountries}</div>
          <div class="stat__label">Flagship host countries</div>
          <div class="stat__note">Countries (excluding China) with at least one project</div>
        </div>
        <div class="stat">
          <div class="stat__value">${data.corridors.length}</div>
          <div class="stat__label">Economic corridors</div>
          <div class="stat__note">As defined in official BRI documents</div>
        </div>
      </div>

      <div class="cards">
        <article class="card">
          <h3>Flagship projects by sector</h3>
          ${bars(s.byType, { label: (k) => PROJECT_TYPES[k as keyof typeof PROJECT_TYPES].plural, colorClass: (k) => `fill--${k}` })}
        </article>
        <article class="card">
          <h3>Flagship projects by region</h3>
          ${bars(s.byRegion)}
          <p class="card__note">World Bank regions as used by GFDC. Cross-border projects count once per region.</p>
        </article>
        <article class="card">
          <h3>Project status in ${year}</h3>
          ${bars(s.byStatus, { label: (k) => STATUS_LABELS[k as keyof typeof STATUS_LABELS], colorClass: (k) => `fill--status-${k}` })}
        </article>
        <article class="card">
          <h3>Participating countries by region</h3>
          ${bars(s.participantsByRegion, { colorClass: () => 'fill--participant' })}
        </article>
        <article class="card card--wide">
          <h3>Flagship projects: reported investment &amp; financing</h3>
          <div class="stats stats--compact">${financeTiles}</div>
          <p class="card__note">
            These figures come from the ${s.projectsWithFigure} projects in this dataset that have a single widely reported USD figure.
            ${s.projectsWithoutFigure} project${s.projectsWithoutFigure === 1 ? ' has' : 's have'} no figure counted, because none was reported, the figure is a range, or it is in another currency.
            Total costs, loan amounts and acquisition prices measure different things, so they are shown separately and are not added together.
            They describe this sample only and are <strong>not</strong> an estimate of total BRI investment.
          </p>
        </article>
      </div>
      ${renderAidData(year)}
      ${renderEngagement()}
    `;
  }

  const countryName = new Map(data.participation.map((c) => [c.iso3, c.name]));
  const sourceById = new Map(data.sources.map((s) => [s.id, s]));
  const cite = (id: string) => {
    const s = sourceById.get(id);
    return s ? `<a href="${safeUrl(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a>` : '';
  };
  const bn = (v: number) => (v >= 1000 ? `US$${(v / 1000).toFixed(3).replace(/0+$/, '')} trillion` : `US$${v} bn`);

  function renderAidData(year: number) {
    const r = computeRecordStats(data.records, year);
    const shownYear = Math.min(year, 2021);
    const yearsNote = year > 2021 ? ' AidData records end in 2021.' : '';
    return `
      <h3 class="dashboard__subhead">Chinese official finance for infrastructure: AidData, 2013–${shownYear}</h3>
      <p class="muted dashboard__lede">Loan and grant commitments from Chinese government and state-owned lenders for physical infrastructure, as recorded by AidData (GCDF v3). Follows the timeline.${yearsNote}</p>
      <div class="stats">
        <div class="stat"><div class="stat__value">${r.count.toLocaleString('en-US')}</div><div class="stat__label">Finance records</div><div class="stat__note">Commitments mapped, of ${data.records.length.toLocaleString('en-US')} in this extract</div></div>
        <div class="stat"><div class="stat__value">${r.countries}</div><div class="stat__label">Recipient countries</div><div class="stat__note">With at least one record</div></div>
        <div class="stat stat--finance"><div class="stat__value">≈ ${formatUsd(r.totalUsd)}</div><div class="stat__label">Committed (constant 2021 USD)</div><div class="stat__note">Sum of ${r.withAmount.toLocaleString('en-US')} records with an amount</div></div>
      </div>
      <div class="cards">
        <article class="card">
          <h3>Commitments by year</h3>
          ${bars(r.amountByYear.map(([y, v]) => [y, Math.round(v / 1e8) / 10]), { colorClass: () => 'fill--aiddata' })}
          <p class="card__note">US$ billions (constant 2021), by year of commitment.</p>
        </article>
        <article class="card">
          <h3>Commitments by sector</h3>
          ${bars(r.amountByType.map(([t, v]) => [t, Math.round(v / 1e8) / 10]), { label: (k) => PROJECT_TYPES[k as keyof typeof PROJECT_TYPES].plural, colorClass: (k) => `fill--${k}` })}
          <p class="card__note">US$ billions. "Other" includes industry, communications, water and airports.</p>
        </article>
        <article class="card">
          <h3>Largest recipients</h3>
          ${bars(r.topCountries.map(([c, v]) => [countryName.get(c) ?? c, Math.round(v / 1e8) / 10]), { colorClass: () => 'fill--aiddata' })}
          <p class="card__note">US$ billions committed.</p>
        </article>
        <article class="card">
          <h3>Most frequent lenders</h3>
          ${bars(r.topLenders, { colorClass: () => 'fill--aiddata' })}
          <p class="card__note">Number of records, by the lender named in each record title.</p>
        </article>
      </div>
      <p class="card__note">Source: ${cite('aiddata-gcdf-v3')} (ODC-By). ${escapeHtml(data.recordsNote)} This extract covers infrastructure records that AidData could geolocate, so it is a subset of AidData's full 2013–2021 total.</p>`;
  }

  function renderEngagement() {
    const e = data.engagement;
    return `
      <h3 class="dashboard__subhead">Latest BRI engagement: 2025 and 2026</h3>
      <p class="muted dashboard__lede">Chinese construction contracts and investments in the 150 BRI countries, from independent research. These are headline figures as stated in the reports, preliminary and in current USD. They don't change with the timeline.</p>
      <div class="cards">
        ${e.periods
          .map(
            (p) => `<article class="card">
              <h3>${escapeHtml(p.period)}</h3>
              <div class="stat__value">≈ US$${p.total} bn</div>
              <ul class="plain-list">
                <li>Construction contracts: <strong>US$${p.construction} bn</strong></li>
                <li>Investments: <strong>US$${p.investment} bn</strong></li>
                <li>Deals: ${escapeHtml(p.deals)}</li>
              </ul>
              <p class="card__note">${escapeHtml(p.change)}. Source: ${cite(p.sourceId)}.</p>
            </article>`,
          )
          .join('')}
        <article class="card">
          <h3>Cumulative since 2013</h3>
          <ul class="plain-list">${e.cumulative
            .map((c) => `<li>${escapeHtml(c.asOf)}: <strong>${bn(c.total)}</strong> <span class="muted">(construction ${bn(c.construction)}, investment ${bn(c.investment)})</span></li>`)
            .join('')}</ul>
          <p class="card__note">Source: ${cite('gfdc-bri-2025')}; ${cite('gfdc-bri-2026h1')}.</p>
        </article>
        <article class="card">
          <h3>2025 highlights</h3>
          ${bars(e.highlights2025.map((h) => [h.label, h.value]), { colorClass: () => 'fill--engagement' })}
          <p class="card__note">US$ billions. ${e.highlights2025.map((h) => `${escapeHtml(h.label)}: ${escapeHtml(h.note)}`).join('; ')}.</p>
        </article>
        <article class="card card--wide">
          <h3>Official figures: ${escapeHtml(e.official.label)}</h3>
          <ul class="plain-list">${e.official.items.map((i) => `<li>${escapeHtml(i.label)}: <strong>US$${i.value} bn</strong> <span class="muted">(${escapeHtml(i.note)} year on year)</span></li>`).join('')}</ul>
          <p class="card__note">${escapeHtml(e.official.note)} Source: ${cite(e.official.sourceId)}.</p>
        </article>
      </div>
      <p class="card__note">${escapeHtml(e.meta.note)}</p>`;
  }

  render();
  store.subscribe((s, prev) => {
    if (s.year !== prev.year) render();
  });
}
