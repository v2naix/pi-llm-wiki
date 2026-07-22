import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  blockControlledSource,
  captureControlledSource,
  deleteControlledSource,
  moveControlledSource,
  restoreControlledSource,
  synthesizeControlledSource,
} from "../extensions/llm-wiki/lib/controlled-source.js";
import {
  BundleMutationError,
  initializeKnowledgeBundle,
  readControlledKnowledgeBundle,
} from "../extensions/llm-wiki/lib/okf-mutation.js";
import { mockPi } from "./helpers.js";

const roots: string[] = [];

async function vault(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "controlled-source-"));
  roots.push(root);
  await initializeKnowledgeBundle({
    vaultRoot: root,
    mutationId: "init",
    expectedRevision: 0,
    committedAt: "2026-08-01T09:00:00Z",
  });
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("controlled Source Concept lifecycle", () => {
  it("captures pasted text into one complete packet before committing an honest Source Concept", async () => {
    const root = await vault();
    const result = await captureControlledSource({
      vaultRoot: root,
      mutationId: "capture-note",
      expectedRevision: 1,
      committedAt: "2026-08-01T10:00:00Z",
      captureTimestamp: "2026-08-01T09:59:00Z",
      input: { kind: "text", text: "Evidence about attention.", title: "Attention note" },
    });

    expect(result).toMatchObject({
      status: "committed",
      revision: 2,
      conceptPath: "sources/attention-note.md",
    });
    expect(result.rawSourceId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
    expect(result).not.toHaveProperty("packetPath");

    const packetRoot = join(root, ".llm-wiki/raw/sources", result.rawSourceId);
    const manifest = JSON.parse(await readFile(join(packetRoot, "manifest.json"), "utf8"));
    expect(manifest).toMatchObject({ complete: true, capture_timestamp: "2026-08-01T09:59:00Z" });
    expect(await readFile(join(packetRoot, "extracted.md"), "utf8")).toBe(
      "Evidence about attention.",
    );

    const page = await readFile(join(root, ".llm-wiki/wiki/sources/attention-note.md"), "utf8");
    expect(page).toContain("type: source");
    expect(page).toContain("description: Captured source “Attention note”; synthesis is pending.");
    expect(page).toContain("llm_wiki_source_curation_state: captured");
    expect(page).toContain("**Curation state:** `captured`");
    expect(page).toContain("**Captured:** 2026-08-01T09:59:00Z");
    expect(page).toContain("outside this Canonical Knowledge Bundle");
    expect(page).not.toContain("raw/sources");
  });

  it("uses the same lifecycle for URL and file captures while omitting unsafe resources", async () => {
    const root = await vault();
    const localPath = join(root, "private notes.md");
    await writeFile(localPath, "Local evidence", "utf8");

    const url = await captureControlledSource({
      vaultRoot: root,
      mutationId: "capture-url",
      expectedRevision: 1,
      committedAt: "2026-08-01T10:00:00Z",
      captureTimestamp: "2026-08-01T09:58:00Z",
      input: { kind: "url", url: "https://example.com/article", pi: mockPi() as never },
    });
    const file = await captureControlledSource({
      vaultRoot: root,
      mutationId: "capture-file",
      expectedRevision: 2,
      committedAt: "2026-08-01T10:01:00Z",
      captureTimestamp: "2026-08-01T09:59:00Z",
      input: { kind: "file", filePath: localPath, pi: mockPi() as never },
    });

    const urlPage = await readFile(join(root, ".llm-wiki/wiki", url.conceptPath), "utf8");
    const filePage = await readFile(join(root, ".llm-wiki/wiki", file.conceptPath), "utf8");
    expect(urlPage).toContain("resource: https://example.com/article");
    expect(urlPage).toContain(
      "**Upstream resource:** [https://example.com/article](https://example.com/article)",
    );
    expect(filePage).not.toContain(localPath);
    expect(filePage).not.toContain("resource:");
  });

  it("omits uncertain, private-network, secret-bearing, redirected, and tracking URI details", async () => {
    const unsafe = [
      "http://127.0.0.1/admin",
      "https://user:secret@example.com/a",
      "https://intranet.local/a",
      "https://example.com/a?utm_source=private",
      "https://example.com/a#redirected",
    ];
    for (const [index, resource] of unsafe.entries()) {
      const root = await vault();
      const result = await captureControlledSource({
        vaultRoot: root,
        mutationId: `unsafe-${index}`,
        expectedRevision: 1,
        committedAt: "2026-08-01T10:00:00Z",
        captureTimestamp: "2026-08-01T09:59:00Z",
        input: { kind: "url", url: resource, pi: mockPi() as never },
      });
      const page = await readFile(join(root, ".llm-wiki/wiki", result.conceptPath), "utf8");
      expect(page).not.toContain("resource:");
      expect(page).not.toContain("Upstream resource");
    }
  });

  it("retains and resumes one packet under the same Mutation Identity after Concept commit failure", async () => {
    const root = await vault();
    const rootIndex = join(root, ".llm-wiki/wiki/index.md");
    const trusted = await readFile(rootIndex, "utf8");
    await writeFile(rootIndex, "external edit", "utf8");
    const request = {
      vaultRoot: root,
      mutationId: "recover-capture",
      expectedRevision: 1,
      committedAt: "2026-08-01T10:00:00Z",
      captureTimestamp: "2026-08-01T09:59:00Z",
      input: { kind: "text" as const, text: "Retained evidence", title: "Recovery" },
    };

    await expect(captureControlledSource(request)).rejects.toMatchObject({
      code: "reserved-document-conflict",
    });
    expect(await readdir(join(root, ".llm-wiki/raw/sources"))).toHaveLength(1);
    await writeFile(rootIndex, trusted, "utf8");

    const result = await captureControlledSource(request);
    expect(result.status).toBe("committed");
    expect(await readdir(join(root, ".llm-wiki/raw/sources"))).toEqual([result.rawSourceId]);
    await expect(captureControlledSource(request)).resolves.toEqual(result);
  });

  it("does not commit a packet or Concept when packet completion fails", async () => {
    const root = await vault();
    const noOriginal = mockPi(undefined, false);

    await expect(
      captureControlledSource({
        vaultRoot: root,
        mutationId: "failed-packet",
        expectedRevision: 1,
        committedAt: "2026-08-01T10:00:00Z",
        captureTimestamp: "2026-08-01T09:59:00Z",
        input: { kind: "url", url: "https://example.com/missing", pi: noOriginal as never },
      }),
    ).rejects.toMatchObject({ code: "incomplete-raw-source-packet" });

    expect(await readdir(join(root, ".llm-wiki/raw/sources"))).toEqual([]);
    const bundle = await readControlledKnowledgeBundle(root);
    expect(bundle.concepts).toEqual([]);
  });

  it("records extraction intervention as blocked knowledge without runtime states", async () => {
    const root = await vault();
    const binary = join(root, "archive.bin");
    await writeFile(binary, Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
    const captured = await captureControlledSource({
      vaultRoot: root,
      mutationId: "blocked-capture",
      expectedRevision: 1,
      committedAt: "2026-08-01T10:00:00Z",
      captureTimestamp: "2026-08-01T09:59:00Z",
      input: { kind: "file", filePath: binary, pi: mockPi() as never },
    });
    await blockControlledSource({
      vaultRoot: root,
      mutationId: "curation-block",
      expectedRevision: 2,
      committedAt: "2026-08-01T10:01:00Z",
      rawSourceId: captured.rawSourceId,
      reason: "A curator must provide a readable version of this source.",
    });

    const page = await readFile(join(root, ".llm-wiki/wiki", captured.conceptPath), "utf8");
    expect(page).toContain("llm_wiki_source_curation_state: blocked");
    expect(page).toContain("A curator must provide a readable version");
    expect(page).not.toMatch(/queue|retry|extractor|runtime/i);
  });

  it("atomically synthesizes the source and related Concepts with canonical links and citations", async () => {
    const root = await vault();
    const captured = await captureControlledSource({
      vaultRoot: root,
      mutationId: "capture-paper",
      expectedRevision: 1,
      committedAt: "2026-08-01T10:00:00Z",
      captureTimestamp: "2026-08-01T09:59:00Z",
      input: { kind: "text", text: "Transformers use attention.", title: "Transformer paper" },
    });
    const result = await synthesizeControlledSource({
      vaultRoot: root,
      mutationId: "synthesize-paper",
      expectedRevision: 2,
      committedAt: "2026-08-02T11:00:00Z",
      rawSourceId: captured.rawSourceId,
      sourceDescription: "A grounded summary of a paper about attention-based Transformers.",
      summary: "The source explains that Transformers use attention.",
      keyTakeaways: ["Attention replaces recurrence in the described architecture."],
      entities: [{ title: "Transformer", description: "An attention-based model architecture." }],
      topics: [
        { title: "Self Attention", description: "A mechanism relating positions in one sequence." },
      ],
    });

    expect(result).toMatchObject({ status: "committed", revision: 3 });
    expect(result.changedPaths).toEqual(
      expect.arrayContaining([
        "concepts/self-attention.md",
        "entities/transformer.md",
        captured.conceptPath,
      ]),
    );
    const bundle = await readControlledKnowledgeBundle(root);
    expect(bundle.nativeContract.status).toBe("pass");
    const source = bundle.concepts.find((concept) => concept.path === captured.conceptPath)!;
    expect(source.metadata).toMatchObject({
      description: "A grounded summary of a paper about attention-based Transformers.",
      timestamp: "2026-08-02T11:00:00Z",
      llm_wiki_raw_source_id: captured.rawSourceId,
      llm_wiki_source_curation_state: "synthesized",
    });
    expect(source.body).toContain("[Transformer](../entities/transformer.md)");
    expect(source.body).not.toContain("raw/sources");
    const entity = await readFile(join(root, ".llm-wiki/wiki/entities/transformer.md"), "utf8");
    expect(entity).toContain(
      "# Citations\n\n1. [Transformer paper](../sources/transformer-paper.md)",
    );
  });

  it("preserves permanent provenance across move, deletion, and explicit restoration", async () => {
    const root = await vault();
    const captured = await captureControlledSource({
      vaultRoot: root,
      mutationId: "capture-movable",
      expectedRevision: 1,
      committedAt: "2026-08-01T10:00:00Z",
      captureTimestamp: "2026-08-01T09:59:00Z",
      input: { kind: "text", text: "Move me", title: "Movable" },
    });
    await synthesizeControlledSource({
      vaultRoot: root,
      mutationId: "synthesize-movable",
      expectedRevision: 2,
      committedAt: "2026-08-02T09:00:00Z",
      rawSourceId: captured.rawSourceId,
      sourceDescription: "A grounded summary of movable evidence.",
      summary: "The source asks to be moved.",
      keyTakeaways: [],
      entities: [],
      topics: [{ title: "Movement", description: "Changing a Concept's canonical location." }],
    });
    await moveControlledSource({
      vaultRoot: root,
      mutationId: "move-source",
      expectedRevision: 3,
      committedAt: "2026-08-02T10:00:00Z",
      rawSourceId: captured.rawSourceId,
      toPath: "archive/moved-source.md",
    });
    const topicAfterMove = await readFile(
      join(root, ".llm-wiki/wiki/concepts/movement.md"),
      "utf8",
    );
    expect(topicAfterMove).toContain("../archive/moved-source.md");
    await deleteControlledSource({
      vaultRoot: root,
      mutationId: "delete-source",
      expectedRevision: 4,
      committedAt: "2026-08-03T10:00:00Z",
      rawSourceId: captured.rawSourceId,
    });
    const restored = await restoreControlledSource({
      vaultRoot: root,
      mutationId: "restore-source",
      expectedRevision: 5,
      committedAt: "2026-08-04T10:00:00Z",
      rawSourceId: captured.rawSourceId,
      path: "sources/restored.md",
    });

    expect(restored.revision).toBe(6);
    const page = await readFile(join(root, ".llm-wiki/wiki/sources/restored.md"), "utf8");
    expect(page).toContain(`llm_wiki_raw_source_id: ${captured.rawSourceId}`);
    await expect(
      restoreControlledSource({
        vaultRoot: root,
        mutationId: "restore-again",
        expectedRevision: 6,
        committedAt: "2026-08-05T10:00:00Z",
        rawSourceId: captured.rawSourceId,
        path: "sources/duplicate.md",
      }),
    ).rejects.toBeInstanceOf(BundleMutationError);
  });
});
