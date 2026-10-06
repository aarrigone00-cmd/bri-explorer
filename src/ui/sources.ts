import type { Dataset } from '../types';
import { $, escapeHtml, safeUrl } from './dom';

export function initSources(data: Dataset): void {
  const kindLabel: Record<string, string> = {
    dataset: 'Dataset',
    official: 'Official document',
    geodata: 'Geodata',
    secondary: 'Secondary source',
    'further-reading': 'Further reading',
    report: 'Research report',
  };
  $('#sources-body').innerHTML = `
    <div class="cards">
      <article class="card card--wide">
        <h3>How to read this map</h3>
        <ul class="plain-list method">
          <li><strong>Participating countries</strong> come from the Green Finance &amp; Development Center (Fudan University) list of countries that have signed a BRI memorandum of understanding (MoU), as of May 2025. MoU dates are GFDC's "likely" dates. ${escapeHtml(data.participationNote)}</li>
          <li><strong>Projects</strong> are a curated sample of ${data.projects.length} widely reported flagship projects, not a complete inventory. Sources differ on which projects count as "BRI". Some projects began before 2013, or before the host country signed an MoU, and this is noted where relevant.</li>
          <li><strong>AidData finance records</strong> (small dots) are ${data.records.length.toLocaleString('en-US')} Chinese official-sector loan and grant commitments for physical infrastructure (transport, energy, communications, industry and water), committed 2013–2021. They come from AidData's Global Chinese Development Finance Dataset v3 and its geospatial companion. Each dot is one financial commitment, not necessarily one project; amounts are commitments in constant 2021 USD, not disbursements. Types (rail, port, road) are assigned from the record titles. The lender shown is the one named in AidData's title. Outlines appear when you zoom in.</li>
          <li><strong>Latest engagement (2025–2026)</strong> comes from the Griffith Asia Institute / GFDC BRI investment reports by Christoph Nedopil. These measure construction contracts and investments, including private companies, so they can't be added to AidData's official-finance figures. Only figures stated in the report text are used, not values read off charts.</li>
          <li><strong>Costs and financing</strong> are approximate values as reported publicly. Each figure is labelled with what it measures (total cost, loan, acquisition price or contract value). Ranges and non-USD amounts are shown as text and are not counted in totals.</li>
          <li><strong>Routes and corridors</strong> are schematic. ${escapeHtml(data.routesNote)}</li>
          <li><strong>Timeline:</strong> moving the slider shows countries by MoU year, flagship projects by start year and AidData records by commitment year. A project shows as under construction until its completion year.</li>
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
