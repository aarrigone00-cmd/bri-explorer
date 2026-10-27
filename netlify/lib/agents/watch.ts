import type Anthropic from '@anthropic-ai/sdk';
import { STATUS_LABELS } from '../../../src/labels';
import type { Project, ProjectStatus } from '../../../src/types';
import type { MessagesClient } from '../anthropic';
import { countryName, projects } from '../data';
import { runToolLoop } from '../loop';
import { clip, recordingClient, verifiedSources, webSearchTool, type SourceRef } from '../web';

// "Project Watcher": checks recent news for flagship projects and proposes
// status updates. Nothing is published until an admin approves it.

const STATUSES = Object.keys(STATUS_LABELS) as ProjectStatus[];
const FINAL_STATUSES: ProjectStatus[] = ['operational', 'completed', 'cancelled'];

export interface Finding {
  project_id: string;
  changed: boolean;
  current_status: ProjectStatus;
  suggested_status: ProjectStatus;
  status_note: string;
  summary: string;
  as_of: string;
  sources: SourceRef[];
}

const REPORT_TOOL: Anthropic.Beta.BetaTool = {
  name: 'report_finding',
  description: 'Report what you found about the project. Call exactly once, after searching.',
  input_schema: {
    type: 'object',
    properties: {
      changed: {
        type: 'boolean',
        description: 'True only if credible recent reporting shows the stored status or status note is now out of date.',
      },
      suggested_status: { type: 'string', enum: STATUSES, description: 'The status the evidence supports (same as current if unchanged).' },
      status_note: { type: 'string', description: 'One or two neutral sentences describing the current state, for the project panel. Empty if unchanged.' },
      summary: { type: 'string', description: 'For the reviewer: what you found and how confident you are, citing dates.' },
      as_of: { type: 'string', description: 'Date of the most recent relevant report, YYYY-MM-DD.' },
      sources: {
        type: 'array',
        maxItems: 4,
        items: {
          type: 'object',
          properties: { url: { type: 'string' }, title: { type: 'string' }, publisher: { type: 'string' } },
          required: ['url', 'title', 'publisher'],
        },
      },
    },
    required: ['changed', 'suggested_status', 'status_note', 'summary', 'as_of', 'sources'],
  },
};

function systemPrompt(today: string) {
  return `You keep the project data of BRI Explorer, an educational map of China's Belt and Road Initiative, accurate. Today is ${today}.

For the project you are given, use web search to find the most recent credible reporting on its status (construction progress, opening, suspension, cancellation, renegotiation). Prefer established news organisations, the operators or governments involved, and official announcements.

Rules:
- Set changed to true only when sources clearly show the stored status or note is out of date. Rumours, opinion pieces and plans without a decision are not changes.
- Write neutrally and attribute claims. Never invent dates, figures or sources; every source URL must come from your search results.
- Call report_finding exactly once.`;
}

function projectBrief(p: Project) {
  return [
    `Project: ${p.name} (id: ${p.id})`,
    `Countries: ${p.countries.map(countryName).join(', ')}`,
    `Location: ${p.location}`,
    `Stored status: ${p.status} (${STATUS_LABELS[p.status]})`,
    p.statusNote ? `Stored status note: ${p.statusNote}` : '',
    `Start year: ${p.startYear ?? 'unknown'}; completion year: ${p.completionYear ?? 'not completed'}`,
    `Description: ${p.description}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function checkProject(inner: MessagesClient, p: Project, today: string): Promise<Finding | null> {
  const { client, seen } = recordingClient(inner);
  let finding: Finding | null = null as Finding | null;
  await runToolLoop(client, {
    system: systemPrompt(today),
    messages: [{ role: 'user', content: `Check this project for status changes.\n\n${projectBrief(p)}` }],
    tools: [webSearchTool(3), REPORT_TOOL],
    effort: 'low',
    maxTokens: 8000,
    maxRounds: 6,
    timeBudgetMs: 4 * 60_000,
    runTool: (name, input) => {
      if (name !== 'report_finding') return { error: `Unknown tool ${name}` };
      const suggested = STATUSES.includes(input.suggested_status as ProjectStatus) ? (input.suggested_status as ProjectStatus) : p.status;
      const sources = verifiedSources(input.sources, seen);
      const changed = input.changed === true && sources.length > 0;
      if (input.changed === true && !sources.length) {
        return { error: 'A change needs at least one source URL from your web search results. Fix the sources and call report_finding again.' };
      }
      finding = {
        project_id: p.id,
        changed,
        current_status: p.status,
        suggested_status: suggested,
        status_note: clip(input.status_note, 500),
        summary: clip(input.summary, 1000),
        as_of: /^\d{4}-\d{2}-\d{2}$/.test(String(input.as_of)) ? String(input.as_of) : today,
        sources,
      };
      return { ok: true, note: 'Recorded. You are done.' };
    },
  });
  return finding;
}

/**
 * Projects to check this run: every project whose status can still change,
 * plus the `rotate` finished projects checked longest ago.
 */
export function pickProjects(lastChecked: Map<string, string>, rotate = 4): Project[] {
  const open = projects.filter((p) => !FINAL_STATUSES.includes(p.status));
  const finished = projects
    .filter((p) => FINAL_STATUSES.includes(p.status))
    .sort((a, b) => (lastChecked.get(a.id) ?? '').localeCompare(lastChecked.get(b.id) ?? ''))
    .slice(0, rotate);
  return [...open, ...finished];
}

/** Runs checks with limited parallelism so the run fits in a background function. */
export async function runWatch(
  client: MessagesClient,
  list: Project[],
  today = new Date().toISOString().slice(0, 10),
  concurrency = 3,
): Promise<{ findings: Finding[]; failed: { id: string; error: string }[] }> {
  const findings: Finding[] = [];
  const failed: { id: string; error: string }[] = [];
  const queue = [...list];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (let p = queue.shift(); p; p = queue.shift()) {
        try {
          const f = await checkProject(client, p, today);
          if (f) findings.push(f);
          else failed.push({ id: p.id, error: 'No finding reported' });
        } catch (err) {
          failed.push({ id: p.id, error: (err as Error).message.slice(0, 200) });
        }
      }
    }),
  );
  return { findings, failed };
}
