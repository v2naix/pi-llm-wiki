/**
 * System-prompt context injection primitives (issue #87).
 *
 * The `before_agent_start` hook augments the chained system prompt with a
 * visible wiki-status footer. This module isolates that append so it can be
 * unit-tested for idempotency — a turn that aborts (network error / ESC) and is
 * retried can carry the prior injection forward, and a naive append stacks the
 * footer 2x, 3x, ...
 */

/** The always-injected wiki-status footer (sans surrounding whitespace). */
export const WIKI_STATUS_BLOCK =
  "<wiki_status>LLM Wiki active — use wiki_recall for deeper search, wiki_observe to record observations, wiki_retro to save insights.</wiki_status>";

/**
 * Append the wiki-status footer to a system prompt.
 *
 * KNOWN BUG (#87): this is NOT idempotent. It re-appends on every call, so when
 * an aborted/retried agent start carries the prior injection forward, the footer
 * stacks (2x, 3x, ...). The fix is to skip appending when the block is already
 * present. See test/inject-idempotent.test.ts.
 */
export function appendWikiStatus(systemPrompt: string): string {
  return `${systemPrompt}\n\n${WIKI_STATUS_BLOCK}`;
}
