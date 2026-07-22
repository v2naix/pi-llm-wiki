import { join } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Api, Model } from "@mariozechner/pi-ai";
import { Type } from "typebox";
import type { Static } from "typebox";
import { readBundleRevision, readControlledKnowledgeBundle } from "./okf-mutation.js";
import { executePiWriteOperation } from "./pi-write-adapter.js";
import { runSubAgent } from "./subagent.js";
import type { VaultPaths } from "./utils.js";

/**
 * Background ingest synthesis (issue #65, part of epic #63).
 *
 * Moves the work the main agent used to do during `wiki_ingest` — reading a
 * captured source's extracted text and writing the source page + entity /
 * concept pages — onto a background sub-agent, so capturing/ingesting never
 * stalls the user.
 *
 * Design: the sub-agent produces ONE structured `commit_synthesis` call; the
 * persistence (`commitSynthesis`) is fully deterministic and unit-testable
 * without an LLM. This mirrors pi-observational-memory's single-structured-tool
 * pattern and keeps the file-writing logic verifiable in isolation.
 */

// ── structured synthesis schema ───────────────────────────
export const CommitSynthesisSchema = Type.Object({
  summary: Type.String({
    minLength: 1,
    description: "2-3 paragraph summary of the source's key content.",
  }),
  key_takeaways: Type.Array(Type.String({ minLength: 1 }), {
    description: "The most important points, one per item.",
  }),
  entities: Type.Array(
    Type.Object({
      title: Type.String({
        minLength: 1,
        description: "Entity name (person, org, tool, product).",
      }),
      description: Type.String({ description: "One-line description of the entity." }),
    }),
    { description: "Named entities mentioned in the source." },
  ),
  concepts: Type.Array(
    Type.Object({
      title: Type.String({ minLength: 1, description: "Concept name (idea, pattern, framework)." }),
      definition: Type.String({ description: "One-line definition of the concept." }),
    }),
    { description: "Concepts discussed in the source." },
  ),
  quotes: Type.Optional(
    Type.Array(
      Type.Object({
        text: Type.String({ minLength: 1 }),
        attribution: Type.Optional(Type.String()),
      }),
      { description: "Notable verbatim quotes." },
    ),
  ),
  contradictions: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), {
      description: "Tensions/contradictions with existing wiki content, if any.",
    }),
  ),
});

export type SynthesisData = Static<typeof CommitSynthesisSchema>;

export interface CommitResult {
  sourceId: string;
  sourcePage: string;
  entitiesCreated: string[];
  conceptsCreated: string[];
  entitiesLinked: string[];
  conceptsLinked: string[];
  contradictions: number;
}

// ── deterministic persistence (no LLM) ────────────────────

/** Commit source synthesis through the same application operation used by public adapters. */
export async function commitSynthesis(
  paths: VaultPaths,
  sourceId: string,
  _manifest: Record<string, unknown>,
  data: SynthesisData,
  options: { mutationId?: string; expectedRevision?: number; committedAt?: string } = {},
): Promise<CommitResult> {
  const before = await readControlledKnowledgeBundle(paths.root);
  const source = before.concepts.find(
    ({ metadata }) => metadata?.llm_wiki_raw_source_id === sourceId,
  );
  if (!source)
    throw new Error(`No controlled Source Concept owns Raw Source Identifier ${sourceId}.`);
  const entityPaths = data.entities.map(({ title }) => `entities/${slug(title)}.md`);
  const conceptPaths = data.concepts.map(({ title }) => `concepts/${slug(title)}.md`);
  const contradictions = data.contradictions?.length ?? 0;
  const summary = [
    data.summary.trim(),
    ...(contradictions
      ? ["", "## Contradictions", "", ...data.contradictions!.map((item) => `- ${item.trim()}`)]
      : []),
  ].join("\n");
  await executePiWriteOperation(paths.root, {
    kind: "synthesize-source",
    mutationId: options.mutationId ?? `ingest-${sourceId}`,
    expectedRevision: options.expectedRevision ?? (await readBundleRevision(paths.root)),
    committedAt: options.committedAt,
    rawSourceId: sourceId,
    sourceDescription: firstSentence(data.summary),
    summary,
    keyTakeaways: data.key_takeaways,
    entities: data.entities,
    topics: data.concepts.map(({ title, definition }) => ({ title, description: definition })),
    quotes: data.quotes,
  });
  return {
    sourceId,
    sourcePage: join(paths.wiki, source.path),
    entitiesCreated: slugs(entityPaths),
    conceptsCreated: slugs(conceptPaths),
    entitiesLinked: [],
    conceptsLinked: [],
    contradictions,
  };
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function slugs(paths: string[]): string[] {
  return paths.map((path) => path.split("/").at(-1)!.slice(0, -3));
}

function firstSentence(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return (text.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || text).slice(0, 240);
}

// ── sub-agent synthesis (LLM) ─────────────────────────────

export const INGEST_SYSTEM = `You are the LLM Wiki ingestion synthesizer. You turn a single captured source's extracted text into structured wiki knowledge.

Read the source content, then call \`commit_synthesis\` EXACTLY ONCE with:
- summary: a faithful 2-3 paragraph summary (no fabrication).
- key_takeaways: the most important points.
- entities: named people, organizations, tools, products actually mentioned.
- concepts: ideas, patterns, frameworks actually discussed.
- quotes: notable verbatim quotes (optional).
- contradictions: tensions with general knowledge or noted in the text (optional).

Rules:
- Never fabricate. Only include entities/concepts present in the source.
- Keep descriptions to one line.
- After calling commit_synthesis once, reply with a one-line confirmation and stop.`;

export interface RunIngestSynthesisArgs {
  model: Model<Api>;
  apiKey: string;
  headers?: Record<string, string>;
  paths: VaultPaths;
  sourceId: string;
  manifest: Record<string, unknown>;
  extracted: string;
  /** Cap on extracted chars fed to the model (avoid huge prompts). Default 24k. */
  maxChars?: number;
  signal?: AbortSignal;
}

/**
 * Run the synthesis sub-agent for a single source, then commit + rebuild
 * metadata. Returns the commit result, or undefined if the model produced no
 * synthesis.
 */
export async function runIngestSynthesis(
  args: RunIngestSynthesisArgs,
): Promise<CommitResult | undefined> {
  const { model, apiKey, headers, paths, sourceId, manifest, extracted, maxChars, signal } = args;
  const content = extracted.slice(0, maxChars ?? 24_000);
  if (!content.trim()) return undefined;

  let committed: CommitResult | undefined;

  const commitTool: AgentTool<typeof CommitSynthesisSchema> = {
    name: "commit_synthesis",
    label: "Commit synthesis",
    description:
      "Persist the structured synthesis of this source into wiki pages. Call exactly once.",
    parameters: CommitSynthesisSchema,
    execute: async (_id, params) => {
      committed = await commitSynthesis(paths, sourceId, manifest, params, { mutationId: _id });
      const ack = `Committed: source page + ${committed.entitiesCreated.length} new entit${
        committed.entitiesCreated.length === 1 ? "y" : "ies"
      }, ${committed.conceptsCreated.length} new concept${
        committed.conceptsCreated.length === 1 ? "" : "s"
      }. Reply with a one-line confirmation and stop.`;
      return { content: [{ type: "text", text: ack }], details: { sourceId } };
    },
  };

  const title = String(manifest.title || sourceId);
  const userPrompt = `Synthesize this captured source into wiki knowledge by calling commit_synthesis once.\n\nSOURCE: ${title} (${sourceId})\n\nEXTRACTED CONTENT:\n${content}`;

  await runSubAgent({
    model,
    apiKey,
    headers,
    systemPrompt: INGEST_SYSTEM,
    userPrompt,
    tools: [commitTool as AgentTool],
    signal,
  });

  return committed;
}
