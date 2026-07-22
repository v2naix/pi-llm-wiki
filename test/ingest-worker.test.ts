import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureControlledSource } from "../extensions/llm-wiki/lib/controlled-source.js";
import { type SynthesisData, commitSynthesis } from "../extensions/llm-wiki/lib/ingest-worker.js";
import {
  initializeKnowledgeBundle,
  readControlledKnowledgeBundle,
} from "../extensions/llm-wiki/lib/okf-mutation.js";
import { privateProjectionFreshSync } from "../extensions/llm-wiki/lib/private-projections.js";
import { ensureVaultStructure, getVaultPaths } from "../extensions/llm-wiki/lib/utils.js";

const DATA: SynthesisData = {
  summary:
    "A paper introducing the Transformer architecture. It replaces recurrence with attention.",
  key_takeaways: ["Self-attention scales well", "No recurrence needed"],
  entities: [
    { title: "Google Brain", description: "Research lab" },
    { title: "Ashish Vaswani", description: "Lead author" },
  ],
  concepts: [
    { title: "Self-Attention", definition: "Tokens attend to each other" },
    { title: "Transformer", definition: "Attention-based sequence model" },
  ],
  quotes: [{ text: "Attention is all you need", attribution: "Vaswani et al." }],
  contradictions: ["Earlier work claimed recurrence was essential"],
};

describe("commitSynthesis", () => {
  let tmpDir: string;
  let wikiDir: string;

  beforeEach(async () => {
    tmpDir = join(
      import.meta.dirname,
      "..",
      "tmp",
      `ingest-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    wikiDir = join(tmpDir, "vault");
    await mkdir(wikiDir, { recursive: true });
    ensureVaultStructure(getVaultPaths(wikiDir));
    await initializeKnowledgeBundle({
      vaultRoot: wikiDir,
      mutationId: "init",
      expectedRevision: 0,
      committedAt: "2026-06-06T08:00:00Z",
    });
  });
  afterEach(async () => rm(tmpDir, { recursive: true, force: true }));

  async function capturedSource(): Promise<string> {
    const captured = await captureControlledSource({
      vaultRoot: wikiDir,
      mutationId: "capture",
      expectedRevision: 1,
      committedAt: "2026-06-06T09:00:00Z",
      captureTimestamp: "2026-06-06T08:30:00Z",
      input: { kind: "text", text: "Attention research", title: "Attention Is All You Need" },
    });
    return captured.rawSourceId;
  }

  it("commits source, entity, and topic knowledge as one canonical Bundle Mutation", async () => {
    const paths = getVaultPaths(wikiDir);
    const rawSourceId = await capturedSource();
    const res = await commitSynthesis(paths, rawSourceId, {}, DATA, {
      mutationId: "synthesize",
      committedAt: "2026-06-06T10:00:00Z",
    });
    const bundle = await readControlledKnowledgeBundle(wikiDir);
    const source = bundle.concepts.find(
      ({ metadata }) => metadata?.llm_wiki_raw_source_id === rawSourceId,
    );

    expect(source?.metadata).toMatchObject({ llm_wiki_source_curation_state: "synthesized" });
    expect(source?.body).toContain("[Transformer](../concepts/transformer.md)");
    expect(source?.body).not.toContain("raw/sources/");
    expect(res.entitiesCreated.sort()).toEqual(["ashish-vaswani", "google-brain"]);
    expect(res.conceptsCreated.sort()).toEqual(["self-attention", "transformer"]);
    expect(res.contradictions).toBe(1);
    expect(bundle.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: source?.id, target: "concepts/transformer" }),
      ]),
    );
    expect(privateProjectionFreshSync(paths)).toBe(true);
    expect(await readFile(join(paths.wiki, "sources/index.md"), "utf8")).toContain(
      "Attention Is All You Need",
    );
  });

  it("returns the same result for an idempotent retry", async () => {
    const paths = getVaultPaths(wikiDir);
    const rawSourceId = await capturedSource();
    const options = {
      mutationId: "synthesize",
      expectedRevision: 2,
      committedAt: "2026-06-06T10:00:00Z",
    };

    const first = await commitSynthesis(paths, rawSourceId, {}, DATA, options);
    const second = await commitSynthesis(paths, rawSourceId, {}, DATA, options);

    expect(second).toEqual(first);
  });
});
