import type Anthropic from '@anthropic-ai/sdk';
import { AgentError, baseParams, type MessagesClient } from './anthropic';

export interface LoopOptions {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools: Anthropic.Beta.BetaToolUnion[];
  effort: 'low' | 'medium' | 'high';
  maxTokens?: number;
  /** Max model requests in this loop (tool rounds + server-tool resumes). */
  maxRounds?: number;
  /** Stop starting new rounds after this many ms (functions have time limits). */
  timeBudgetMs?: number;
  /** Runs one client-side tool call and returns its result (any JSON value). */
  runTool: (name: string, input: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface LoopResult {
  final: Anthropic.Beta.BetaMessage;
  /** Every response, in order (server-tool results such as web searches live here). */
  responses: Anthropic.Beta.BetaMessage[];
  rounds: number;
  /** True when the loop had to stop early (round or time budget). */
  truncated: boolean;
}

/**
 * Manual agentic loop: we own it (rather than the SDK tool runner) to enforce
 * a time budget that fits Netlify's function limits.
 */
export async function runToolLoop(client: MessagesClient, opts: LoopOptions): Promise<LoopResult> {
  const started = Date.now();
  const maxRounds = opts.maxRounds ?? 8;
  const budget = opts.timeBudgetMs ?? 45_000;
  const messages = [...opts.messages];
  const responses: Anthropic.Beta.BetaMessage[] = [];

  for (let round = 1; ; round++) {
    const response = await client.create({
      ...baseParams(opts.effort),
      max_tokens: opts.maxTokens ?? 16000,
      system: opts.system,
      tools: opts.tools,
      messages,
    });
    responses.push(response);

    if (response.stop_reason === 'refusal') {
      throw new AgentError("The AI declined to answer this request. Try rephrasing it.", 422);
    }
    const outOfBudget = round >= maxRounds || Date.now() - started > budget;

    if (response.stop_reason === 'pause_turn') {
      // A long server-side tool turn (e.g. web search): send it back to resume.
      if (outOfBudget) return { final: response, responses, rounds: round, truncated: true };
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }
    if (response.stop_reason !== 'tool_use') {
      return { final: response, responses, rounds: round, truncated: response.stop_reason === 'max_tokens' };
    }

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');

    messages.push({ role: 'assistant', content: response.content });
    // All results go back in a single user message.
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      try {
        const input = use.input && typeof use.input === 'object' ? (use.input as Record<string, unknown>) : {};
        const out = await opts.runTool(use.name, input);
        const isError = Boolean(out && typeof out === 'object' && 'error' in out);
        results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(out), is_error: isError });
      } catch (err) {
        results.push({ type: 'tool_result', tool_use_id: use.id, content: `Tool failed: ${(err as Error).message}`, is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });

    if (outOfBudget) {
      // Out of rounds or time: ask for a final answer from what we have, with tools off.
      const wrapUp = await client.create({
        ...baseParams(opts.effort),
        max_tokens: opts.maxTokens ?? 16000,
        system: opts.system,
        tools: opts.tools,
        tool_choice: { type: 'none' },
        messages,
      });
      responses.push(wrapUp);
      if (wrapUp.stop_reason === 'refusal') throw new AgentError('The AI declined to answer this request. Try rephrasing it.', 422);
      return { final: wrapUp, responses, rounds: round + 1, truncated: true };
    }
  }
}
