/** An error with a message that is safe to show to users. */
export class AgentError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message);
  }
}

export function describeError(err: unknown): { status: number; message: string } {
  if (err instanceof AgentError) return { status: err.status, message: err.message };
  return { status: 500, message: 'Something went wrong. Please try again.' };
}
