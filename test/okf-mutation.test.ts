import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initializeKnowledgeBundle,
  readControlledKnowledgeBundle,
  writeConcept,
} from "../extensions/llm-wiki/lib/okf-mutation.js";

const roots: string[] = [];

async function vault(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "okf-mutation-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("native OKF Bundle Mutations", () => {
  it("initializes one valid canonical state and returns the same commit for an identical retry", async () => {
    const root = await vault();
    const request = {
      vaultRoot: root,
      mutationId: "initialize-1",
      expectedRevision: 0,
      committedAt: "2026-07-22T10:00:00Z",
    };

    const first = await initializeKnowledgeBundle(request);
    const retry = await initializeKnowledgeBundle(request);
    const bundle = await readControlledKnowledgeBundle(root);

    expect(first).toEqual({
      status: "committed",
      revision: 1,
      mutationId: "initialize-1",
      changedPaths: ["index.md", "log.md"],
    });
    expect(retry).toEqual(first);
    expect(bundle.nativeContract.status).toBe("pass");
    expect(bundle.reservedDocuments.map(({ path }) => path)).toEqual(["index.md", "log.md"]);
    await expect(readFile(join(root, ".llm-wiki/wiki/index.md"), "utf8")).resolves.toBe(
      '---\nokf_version: "0.1"\n---\n\n# Knowledge Bundle\n',
    );
    await expect(readFile(join(root, ".llm-wiki/wiki/log.md"), "utf8")).resolves.toBe(
      "# 2026-07-22\n\n- **Initialized** the Knowledge Bundle.\n",
    );
  });

  it("treats an omitted server commit time as result data rather than retry intent", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-22T10:00:00Z"));
      const root = await vault();
      const request = { vaultRoot: root, mutationId: "init", expectedRevision: 0 };

      const first = await initializeKnowledgeBundle(request);
      vi.setSystemTime(new Date("2026-07-23T10:00:00Z"));
      const retry = await initializeKnowledgeBundle(request);

      expect(retry).toEqual(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it("creates Concepts with controlled timestamps and deterministic progressive indexes", async () => {
    const root = await vault();
    await initializeKnowledgeBundle({
      vaultRoot: root,
      mutationId: "init",
      expectedRevision: 0,
      committedAt: "2026-07-22T10:00:00Z",
    });

    const result = await writeConcept({
      vaultRoot: root,
      mutationId: "write-guide",
      expectedRevision: 1,
      committedAt: "2026-07-23T11:30:00Z",
      path: "guides/start.md",
      type: "guide",
      title: "Getting [Started]",
      description: "Read | this guide.",
      body: "# Start\n\nHello.\n",
      metadata: { priority: 9007199254740993123456789n },
    });

    expect(result.status).toBe("committed");
    expect(result.revision).toBe(2);
    await expect(readFile(join(root, ".llm-wiki/wiki/guides/index.md"), "utf8")).resolves.toBe(
      "# guide\n\n- [Getting \\[Started\\]](start.md) - Read \\| this guide.\n",
    );
    await expect(readFile(join(root, ".llm-wiki/wiki/index.md"), "utf8")).resolves.toBe(
      '---\nokf_version: "0.1"\n---\n\n# Knowledge Bundle\n\n## Subdirectories\n\n- [guides](guides/index.md)\n',
    );

    const bundle = await readControlledKnowledgeBundle(root);
    expect(bundle.nativeContract.status).toBe("pass");
    expect(bundle.concepts[0]?.metadata).toMatchObject({
      timestamp: "2026-07-23T11:30:00Z",
      priority: 9007199254740993123456789n,
    });
  });

  it("URL-encodes every index path component without changing the Concept ID", async () => {
    const root = await vault();
    await initializeKnowledgeBundle({
      vaultRoot: root,
      mutationId: "init",
      expectedRevision: 0,
      committedAt: "2026-07-22T10:00:00Z",
    });
    await writeConcept({
      vaultRoot: root,
      mutationId: "encoded",
      expectedRevision: 1,
      committedAt: "2026-07-23T10:00:00Z",
      path: "encoded%2F#name.md",
      type: "concept",
      title: "Encoded",
      description: "An encoded filename.",
      body: "Body\n",
    });

    await expect(readFile(join(root, ".llm-wiki/wiki/index.md"), "utf8")).resolves.toContain(
      "[Encoded](encoded%252F%23name.md)",
    );
    const bundle = await readControlledKnowledgeBundle(root);
    expect(bundle.concepts[0]?.id).toBe("encoded%2F#name");
  });

  it("preserves unknown metadata and the Concept Timestamp on a semantic no-op", async () => {
    const root = await vault();
    await initializeKnowledgeBundle({
      vaultRoot: root,
      mutationId: "init",
      expectedRevision: 0,
      committedAt: "2026-07-22T10:00:00Z",
    });
    const create = {
      vaultRoot: root,
      expectedRevision: 1,
      path: "topic.md",
      type: "concept",
      title: "Topic",
      description: "A topic.",
      body: "Body\n",
      metadata: { extension: { enabled: true } },
    } as const;
    await writeConcept({
      ...create,
      mutationId: "create",
      committedAt: "2026-07-23T10:00:00Z",
    });

    const noOp = await writeConcept({
      ...create,
      metadata: undefined,
      expectedRevision: 2,
      mutationId: "same",
      committedAt: "2026-07-24T10:00:00Z",
    });
    const bundle = await readControlledKnowledgeBundle(root);

    expect(noOp).toEqual({
      status: "no-op",
      revision: 2,
      mutationId: "same",
      changedPaths: [],
    });
    expect(bundle.concepts[0]?.metadata).toMatchObject({
      timestamp: "2026-07-23T10:00:00Z",
      extension: { enabled: true },
    });
  });

  it("commits missing Reserved Document materialization without changing Concept knowledge", async () => {
    const root = await vault();
    await initializeKnowledgeBundle({
      vaultRoot: root,
      mutationId: "init",
      expectedRevision: 0,
      committedAt: "2026-07-22T10:00:00Z",
    });
    const request = {
      vaultRoot: root,
      expectedRevision: 1,
      path: "topic.md",
      type: "concept",
      title: "Topic",
      description: "A topic.",
      body: "Body\n",
    } as const;
    await writeConcept({
      ...request,
      mutationId: "create",
      committedAt: "2026-07-23T10:00:00Z",
    });
    await rm(join(root, ".llm-wiki/wiki/index.md"));

    const materialized = await writeConcept({
      ...request,
      expectedRevision: 2,
      mutationId: "materialize",
      committedAt: "2026-07-24T10:00:00Z",
    });
    const bundle = await readControlledKnowledgeBundle(root);

    expect(materialized).toMatchObject({ status: "committed", revision: 3 });
    expect(materialized.changedPaths).toEqual(["index.md", "log.md"]);
    expect(bundle.concepts[0]?.metadata?.timestamp).toBe("2026-07-23T10:00:00Z");
    expect(bundle.nativeContract.status).toBe("pass");
  });

  it("replaces a trusted generated index preimage and records a meaningful update once", async () => {
    const root = await vault();
    await initializeKnowledgeBundle({
      vaultRoot: root,
      mutationId: "init",
      expectedRevision: 0,
      committedAt: "2026-07-22T10:00:00Z",
    });
    const rootIndex = join(root, ".llm-wiki/wiki/index.md");
    const trustedPreimage = await readFile(rootIndex, "utf8");
    await writeConcept({
      vaultRoot: root,
      mutationId: "create",
      expectedRevision: 1,
      committedAt: "2026-07-23T10:00:00Z",
      path: "topic.md",
      type: "concept",
      title: "Topic",
      description: "A topic.",
      body: "First\n",
    });
    await writeFile(rootIndex, trustedPreimage, "utf8");

    const update = await writeConcept({
      vaultRoot: root,
      mutationId: "update",
      expectedRevision: 2,
      committedAt: "2026-07-24T10:00:00Z",
      path: "topic.md",
      type: "concept",
      title: "Topic",
      description: "A topic.",
      body: "Second\n",
    });
    const bundle = await readControlledKnowledgeBundle(root);

    expect(update.revision).toBe(3);
    expect(await readFile(rootIndex, "utf8")).toContain("[Topic](topic.md) - A topic.");
    expect(bundle.concepts[0]?.metadata?.timestamp).toBe("2026-07-24T10:00:00Z");
    await expect(readFile(join(root, ".llm-wiki/wiki/log.md"), "utf8")).resolves.toBe(
      "# 2026-07-24\n\n- **Updated** Topic (topic.md).\n\n# 2026-07-23\n\n- **Added** Topic (topic.md).\n\n# 2026-07-22\n\n- **Initialized** the Knowledge Bundle.\n",
    );
  });

  it("recovers an interrupted publication without exposing or advancing the partial state", async () => {
    const root = await vault();
    await initializeKnowledgeBundle({
      vaultRoot: root,
      mutationId: "init",
      expectedRevision: 0,
      committedAt: "2026-07-22T10:00:00Z",
    });
    const dotWiki = join(root, ".llm-wiki");
    const wiki = join(dotWiki, "wiki");
    const stage = join(dotWiki, ".interrupted-stage");
    const backup = join(dotWiki, ".interrupted-backup");
    const statePath = join(dotWiki, "meta/native-okf/state.json");
    const journalPath = join(dotWiki, "meta/native-okf/journal.json");
    const targetState = JSON.parse(await readFile(statePath, "utf8"));
    await cp(wiki, stage, { recursive: true });
    await writeFile(join(stage, "partial.md"), "partial canonical bytes\n", "utf8");
    await rename(wiki, backup);
    await writeFile(
      journalPath,
      `${JSON.stringify({ phase: "prepared", stage, backup, targetState }, null, 2)}\n`,
      "utf8",
    );

    const recovered = await readControlledKnowledgeBundle(root);
    const next = await writeConcept({
      vaultRoot: root,
      mutationId: "after-recovery",
      expectedRevision: 1,
      committedAt: "2026-07-23T10:00:00Z",
      path: "safe.md",
      type: "concept",
      title: "Safe",
      description: "A recovered write.",
      body: "Body\n",
    });

    expect(recovered.concepts).toEqual([]);
    expect(recovered.nativeContract.status).toBe("pass");
    expect(next.revision).toBe(2);
    await expect(readFile(join(wiki, "partial.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("serializes concurrent writers so only one stale revision can commit", async () => {
    const root = await vault();
    await initializeKnowledgeBundle({
      vaultRoot: root,
      mutationId: "init",
      expectedRevision: 0,
      committedAt: "2026-07-22T10:00:00Z",
    });
    const base = {
      vaultRoot: root,
      expectedRevision: 1,
      committedAt: "2026-07-23T10:00:00Z",
      type: "concept",
      description: "A concurrent write.",
      body: "Body\n",
    } as const;

    const settled = await Promise.allSettled([
      writeConcept({ ...base, mutationId: "one", path: "one.md", title: "One" }),
      writeConcept({ ...base, mutationId: "two", path: "two.md", title: "Two" }),
    ]);

    expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(settled.filter(({ status }) => status === "rejected")).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: "stale-revision" }) }),
    ]);
    const bundle = await readControlledKnowledgeBundle(root);
    expect(bundle.concepts).toHaveLength(1);
    expect(bundle.nativeContract.status).toBe("pass");
  });

  it("does not replace a pre-existing untrusted bundle during initialization", async () => {
    const root = await vault();
    await mkdir(join(root, ".llm-wiki/wiki"), { recursive: true });
    await writeFile(join(root, ".llm-wiki/wiki/note.md"), "external bytes\n", "utf8");

    await expect(
      initializeKnowledgeBundle({
        vaultRoot: root,
        mutationId: "init",
        expectedRevision: 0,
        committedAt: "2026-07-22T10:00:00Z",
      }),
    ).rejects.toMatchObject({ code: "unmanaged-bundle-conflict" });
    await expect(readFile(join(root, ".llm-wiki/wiki/note.md"), "utf8")).resolves.toBe(
      "external bytes\n",
    );
  });

  it("rejects stale revisions, changed retry intent, invalid paths, and unrecognized index edits", async () => {
    const root = await vault();
    await initializeKnowledgeBundle({
      vaultRoot: root,
      mutationId: "init",
      expectedRevision: 0,
      committedAt: "2026-07-22T10:00:00Z",
    });

    await expect(
      writeConcept({
        vaultRoot: root,
        mutationId: "stale",
        expectedRevision: 0,
        committedAt: "2026-07-23T10:00:00Z",
        path: "topic.md",
        type: "concept",
        title: "Topic",
        description: "A topic.",
        body: "Body\n",
      }),
    ).rejects.toMatchObject({ code: "stale-revision" });

    await expect(
      initializeKnowledgeBundle({
        vaultRoot: root,
        mutationId: "init",
        expectedRevision: 0,
        committedAt: "2026-07-23T10:00:00Z",
      }),
    ).rejects.toMatchObject({ code: "mutation-identity-conflict" });

    await expect(
      writeConcept({
        vaultRoot: root,
        mutationId: "escape",
        expectedRevision: 1,
        committedAt: "2026-07-23T10:00:00Z",
        path: "../private.md",
        type: "concept",
        title: "Private",
        description: "Must not escape.",
        body: "Body\n",
      }),
    ).rejects.toMatchObject({ code: "invalid-concept-path" });

    await writeFile(join(root, ".llm-wiki/wiki/index.md"), "# edited externally\n", "utf8");
    await expect(
      writeConcept({
        vaultRoot: root,
        mutationId: "conflict",
        expectedRevision: 1,
        committedAt: "2026-07-23T10:00:00Z",
        path: "topic.md",
        type: "concept",
        title: "Topic",
        description: "A topic.",
        body: "Body\n",
      }),
    ).rejects.toMatchObject({ code: "reserved-document-conflict", path: "index.md" });
  });
});
