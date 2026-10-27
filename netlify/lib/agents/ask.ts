import type Anthropic from '@anthropic-ai/sdk';
import { AgentError, textOf, type MessagesClient } from '../anthropic';
import { runToolLoop } from '../loop';
import { DATA_TOOLS, MAP_TOOL, runDataTool, toMapAction, type MapAction } from '../site-tools';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM = `You are "Ask the Map", the research assistant on BRI Explorer, an educational website that maps China's Belt and Road Initiative (BRI).

How to answer:
- Answer from the site's data, which you reach through the tools. Look things up before stating any figure, date, status or list; never estimate or recall numbers from memory. If the data doesn't cover something, say so plainly and suggest where it could be found.
- Name the source for figures in a short parenthesis, e.g. "(AidData GCDF v3)", "(GFDC country list, May 2025)", "(Nedopil 2026, preliminary)", "(flagship project data, reported estimate)".
- The datasets measure different things, so never add them together: AidData records are Chinese official loan/grant commitments for infrastructure, 2013–2021, in constant 2021 USD; flagship project costs are reported estimates on mixed bases; the 2025–2026 figures are construction contracts plus investments from independent research.
- Stay neutral and educational. Present facts and, where views differ, the main perspectives fairly, without taking political sides.
- Use the update_map tool to show the user what you're describing (a country, a project, a record, a year or a set of layers) when that helps. Don't describe the map change in detail; a short "I've zoomed the map to Kenya." is enough.
- Keep answers short and scannable: a direct answer first, then a few bullet points. Use **bold** sparingly. No tables or headings.
- If a question is unrelated to the BRI, China's overseas development finance or this site, briefly say what you can help with instead.`;

const MAX_TURNS = 12;
const MAX_CHARS = 2000;

export function sanitizeHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) throw new AgentError('messages must be an array.', 400);
  const turns = raw
    .filter((m): m is ChatTurn => !!m && typeof m === 'object' && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, MAX_CHARS) }))
    .filter((m) => m.content)
    .slice(-MAX_TURNS);
  // The API requires the conversation to start with a user turn and end with one.
  while (turns.length && turns[0].role !== 'user') turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== 'user') throw new AgentError('Please type a question.', 400);
  return turns;
}

export async function runAsk(client: MessagesClient, history: ChatTurn[]): Promise<{ reply: string; actions: MapAction[]; truncated: boolean }> {
  const actions: MapAction[] = [];
  const result = await runToolLoop(client, {
    system: SYSTEM,
    messages: history.map((t): Anthropic.Beta.BetaMessageParam => ({ role: t.role, content: t.content })),
    tools: [...DATA_TOOLS, MAP_TOOL],
    effort: 'medium',
    maxTokens: 4000,
    maxRounds: 8,
    timeBudgetMs: 40_000,
    runTool: (name, input) => {
      if (name === 'update_map') {
        const action = toMapAction(input);
        if ('error' in action) return action;
        if (actions.length < 5) actions.push(action);
        return { ok: true, note: 'The map will update when your answer is shown.' };
      }
      return runDataTool(name, input);
    },
  });
  const reply = textOf(result.final) || 'Sorry, I could not put an answer together. Please try asking in a different way.';
  return { reply, actions, truncated: result.truncated };
}
