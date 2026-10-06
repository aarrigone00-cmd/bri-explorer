import type { Store } from '../state/store';
import { $ } from './dom';

export function initTimeline(store: Store, range: { min: number; max: number }): void {
  const input = $('#timeline-range') as HTMLInputElement;
  const out = $('#timeline-year');
  const play = $('#timeline-play');
  const ticks = $('#timeline-ticks');

  input.min = String(range.min);
  input.max = String(range.max);
  input.value = String(store.get().year);

  const span = range.max - range.min;
  ticks.innerHTML = Array.from({ length: span + 1 }, (_, i) => {
    const y = range.min + i;
    const show = i === 0 || i === span || y % 2 === 1;
    return `<span style="left:${(i / span) * 100}%">${show ? `’${String(y).slice(2)}` : ''}</span>`;
  }).join('');

  const sync = () => {
    const y = store.get().year;
    input.value = String(y);
    out.textContent = String(y);
    input.style.setProperty('--progress', `${((y - range.min) / span) * 100}%`);
    input.setAttribute('aria-valuetext', `End of ${y}`);
  };
  sync();
  store.subscribe((s, prev) => {
    if (s.year !== prev.year) sync();
  });

  input.addEventListener('input', () => {
    stop();
    store.set({ year: Number(input.value) });
  });

  let timer: number | undefined;
  const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  const pauseIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>';
  function stop() {
    if (timer === undefined) return;
    clearInterval(timer);
    timer = undefined;
    play.innerHTML = playIcon;
    play.setAttribute('aria-label', 'Play timeline');
  }
  play.addEventListener('click', () => {
    if (timer !== undefined) return stop();
    if (store.get().year >= range.max) store.set({ year: range.min });
    play.innerHTML = pauseIcon;
    play.setAttribute('aria-label', 'Pause timeline');
    timer = window.setInterval(() => {
      const y = store.get().year;
      if (y >= range.max) return stop();
      store.set({ year: y + 1 });
    }, 900);
  });
}
