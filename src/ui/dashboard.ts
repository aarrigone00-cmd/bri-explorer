import { COST_BASIS_SHORT, PROJECT_TYPES, STATUS_LABELS } from '../config';
import { computeStats, formatUsdMillions } from '../lib/analytics';
import type { Store } from '../state/store';
import type { Dataset } from '../types';
import { $, escapeHtml } from './dom';

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
          <div class="stat__label">Projects in dataset</div>
          <div class="stat__note">Of ${data.projects.length} curated flagship projects</div>
        </div>
        <div class="stat">
          <div class="stat__value">${s.projectCountries}</div>
          <div class="stat__label">Host countries represented</div>
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
          <h3>Projects by sector</h3>
          ${bars(s.byType, { label: (k) => PROJECT_TYPES[k as keyof typeof PROJECT_TYPES].plural, colorClass: (k) => `fill--${k}` })}
        </article>
        <article class="card">
          <h3>Projects by region</h3>
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
          <h3>Reported investment &amp; financing</h3>
          <div class="stats stats--compact">${financeTiles}</div>
          <p class="card__note">
            These figures come from the ${s.projectsWithFigure} projects in this dataset that have a single widely reported USD figure.
            ${s.projectsWithoutFigure} project${s.projectsWithoutFigure === 1 ? ' has' : 's have'} no figure counted, because none was reported, the figure is a range, or it is in another currency.
            Total costs, loan amounts and acquisition prices measure different things, so they are shown separately and are not added together.
            They describe this sample only and are <strong>not</strong> an estimate of total BRI investment.
          </p>
        </article>
      </div>
    `;
  }

  render();
  store.subscribe((s, prev) => {
    if (s.year !== prev.year) render();
  });
}
