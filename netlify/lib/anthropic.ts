import Anthropic from '@anthropic-ai/sdk';
import { MODEL } from './config';

/**
 * The subset of the SDK the agents use. Agents receive this interface so tests
 * can inject a scripted fake instead of calling the real API.
 */
export interface MessagesClient {
  create(params: Anthropic.Beta.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.BetaMessage>;
}

export function createClaudeClient(): MessagesClient {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  return { create: (params) => client.beta.messages.create(params) };
}

/** Server-side refusal fallback: routes a declined request to another model. */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Common request fields shared by every agent. */
export function baseParams(effort: 'low' | 'medium' | 'high') {
  return {
    model: MODEL,
    betas: [FALLBACK_BETA],
    fallbacks: 'default' as const,
    output_config: { effort },
    // Cache the stable prefix (tools + system prompt) across requests.
    cache_control: { type: 'ephemeral' as const },
  };
}

export function textOf(message: Anthropic.Beta.BetaMessage): string {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

export { MODEL };

export class AgentError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message);
  }
}

/** Maps SDK errors to user-safe messages without leaking details. */
export function describeError(err: unknown): { status: number; message: string } {
  if (err instanceof AgentError) return { status: err.status, message: err.message };
  if (err instanceof Anthropic.AuthenticationError) return { status: 500, message: 'The AI service is not configured correctly (API key).' };
  if (err instanceof Anthropic.RateLimitError) return { status: 429, message: 'The AI service is busy. Please try again in a minute.' };
  if (err instanceof Anthropic.BadRequestError) return { status: 500, message: 'The AI request was rejected. Please try again.' };
  if (err instanceof Anthropic.APIError) return { status: 502, message: 'The AI service had a problem. Please try again.' };
  return { status: 500, message: 'Something went wrong. Please try again.' };
}
