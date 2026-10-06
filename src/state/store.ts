import type { LayerKey, Selection, ThemePreference } from '../types';

export interface AppState {
  layers: Record<LayerKey, boolean>;
  /** Timeline year: show participation and projects as of the end of this year. */
  year: number;
  selection: Selection;
  theme: ThemePreference;
  /** Effective theme after resolving "system". */
  resolvedTheme: 'light' | 'dark';
  showLabels: boolean;
}

type Listener = (state: AppState, prev: AppState) => void;

/**
 * Minimal observable store. Feature modules subscribe and react to the parts
 * of state they care about; new features (comparison, news, ...) can add
 * fields here without touching existing modules.
 */
export class Store {
  private state: AppState;
  private listeners = new Set<Listener>();

  constructor(initial: AppState) {
    this.state = initial;
  }

  get(): AppState {
    return this.state;
  }

  set(patch: Partial<AppState>): void {
    const prev = this.state;
    this.state = { ...prev, ...patch };
    for (const l of this.listeners) l(this.state, prev);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
