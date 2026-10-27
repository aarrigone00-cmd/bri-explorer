import type { ProjectStatus, ProjectType } from './types';

// Plain labels shared by the browser app and the Netlify agent functions.
// Keep this file free of browser-only APIs (e.g. import.meta.env).

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  operational: 'Operational',
  completed: 'Completed',
  'partially-operational': 'Partially operational',
  'under-construction': 'Under construction',
  planned: 'Planned / agreed',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
};

export const TYPE_PLURALS: Record<ProjectType, string> = {
  rail: 'Railways & metros',
  port: 'Ports',
  road: 'Roads, highways & bridges',
  energy: 'Energy projects',
  other: 'Industrial parks, urban & airports',
};
