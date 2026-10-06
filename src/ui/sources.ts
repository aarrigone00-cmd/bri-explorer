import type { Dataset } from '../types';
import { $, escapeHtml, safeUrl } from './dom';

export function initSources(data: Dataset): void {
  const kindLabel: Record<string, string> = {
    dataset: 'Dataset',
    official: 'Official document',
    geodata: 'Geodata',
    secondary: 'Secondary source',
    'further-reading': 'Further reading',
  };
  $('#sources-body').innerHTML = `
    <div class="cards">
      <article class="card card--wide">
        <h3>How to read this map</h3>
        <ul class="plain-list method">
          <li><strong>Participating countries</strong> come from the Green Finance &amp; Development Center (Fudan University) list of countries that have signed a BRI memorandum of understanding (MoU), as of May 2025. MoU dates are GFDC's "likely" dates. ${escapeHtml(data.participationNote)}</li>
          <li><strong>Projects</strong> are a curated sample of ${data.projects.length} widely reported flagship projects, not a complete inventory. Sources differ on which projects count as "BRI". Some projects began before 2013, or before the host country signed an MoU, and this is noted where relevant.</li>
          <li><strong>Costs and financing</strong> are approximate values as reported publicly. Each figure is labelled with what it measures (total cost, loan, acquisition price or contract value). Ranges and non-USD amounts are shown as text and are not counted in totals.</li>
          <li><strong>Routes and corridors</strong> are schematic. ${escapeHtml(data.routesNote)}</li>
          <li><strong>Timeline:</strong> moving the slider shows countries by MoU year and projects by start year. A project shows as under construction until its completion year.</li>
          <li>Statuses were last reviewed in ${escapeHtml(data.projectsMeta.asOf)} and may have changed since. Corrections are welcome.</li>
        </ul>
      </article>
      ${data.sources
        .map(
          (s) => `<article class="card source">
            <div class="source__kind">${escapeHtml(kindLabel[s.kind] ?? s.kind)}</div>
            <h3><a href="${safeUrl(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a></h3>
            <p class="muted">${escapeHtml(s.publisher)}</p>
            <p>${escapeHtml(s.usedFor)}</p>
            ${s.license ? `<p class="card__note">${escapeHtml(s.license)}</p>` : ''}
          </article>`,
        )
        .join('')}
    </div>`;
}
