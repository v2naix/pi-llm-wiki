import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteConcept,
  initializeKnowledgeBundle,
  moveConcept,
  mutateKnowledgeBundle,
  readControlledKnowledgeBundle,
  writeBundleAsset,
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

  it("moves a Concept and rejects a move that would silently break incoming links", async () => {
    const root = await vault();
    await initializeKnowledgeBundle({
      vaultRoot: root,
      mutationId: "init",
      expectedRevision: 0,
      committedAt: "2026-07-22T10:00:00Z",
    });
    await writeConcept({
      vaultRoot: root,
      mutationId: "create",
      expectedRevision: 1,
      committedAt: "2026-07-23T10:00:00Z",
      path: "topics/original.md",
      type: "concept",
      title: "Original",
      description: "A movable Concept.",
      body: "Body\n",
    });

    const moveRequest = {
      vaultRoot: root,
      mutationId: "move",
      expectedRevision: 2,
      committedAt: "2026-07-24T10:00:00Z",
      fromPath: "topics/original.md",
      toPath: "archive/renamed.md",
    } as const;
    const moved = await moveConcept(moveRequest);
    const moveRetry = await moveConcept(moveRequest);
    const bundle = await readControlledKnowledgeBundle(root);

    expect(moved).toMatchObject({ status: "committed", revision: 3 });
    expect(moveRetry).toEqual(moved);
    expect(bundle.concepts.map(({ path }) => path)).toEqual(["archive/renamed.md"]);
    expect(bundle.concepts[0]?.metadata?.timestamp).toBe("2026-07-24T10:00:00Z");
    await expect(
      readFile(join(root, ".llm-wiki/wiki/topics/index.md"), "utf8"),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });

    await writeConcept({
      vaultRoot: root,
      mutationId: "linker",
      expectedRevision: 3,
      committedAt: "2026-07-25T10:00:00Z",
      path: "linker.md",
      type: "concept",
      title: "Linker",
      description: "Links to the moved Concept.",
      body: "[Target](archive/renamed.md)\n",
    });
    await expect(
      moveConcept({
        vaultRoot: root,
        mutationId: "unsafe-move",
        expectedRevision: 4,
        committedAt: "2026-07-26T10:00:00Z",
        fromPath: "archive/renamed.md",
        toPath: "elsewhere.md",
      }),
    ).rejects.toMatchObject({ code: "incoming-links-conflict", path: "linker.md" });
  });

  it("commits a declared multi-file change set and rewrites every affected relationship atomically", async () => {
    const root = await vault();
    await initializeKnowledgeBundle({
      vaultRoot: root,
      mutationId: "init",
      expectedRevision: 0,
      committedAt: "2026-07-22T10:00:00Z",
    });
    const concepts = [
      { path: "topics/target.md", title: "Target", body: "[Self](target.md#self)\n" },
      { path: "root-link.md", title: "Root link", body: "[Target](topics/target.md#part)\n" },
      {
        path: "notes/reference.md",
        title: "Reference link",
        body: "[Target][target]\n\n[target]: ../topics/target.md#part\n",
      },
      { path: "temporary.md", title: "Temporary", body: "Delete me.\n" },
      { path: "stable.md", title: "Stable", body: "Unrelated bytes.\n" },
    ];
    let revision = 1;
    for (const concept of concepts) {
      await writeConcept({
        vaultRoot: root,
        mutationId: `create-${revision}`,
        expectedRevision: revision,
        committedAt: `2026-07-${22 + revision}T10:00:00Z`,
        type: "concept",
        description: `${concept.title} description.`,
        ...concept,
      });
      revision += 1;
    }

    const stableBefore = await readFile(join(root, ".llm-wiki/wiki/stable.md"));
    const request = {
      vaultRoot: root,
      mutationId: "multi-file",
      expectedRevision: 6,
      committedAt: "2026-08-01T10:00:00Z",
      changes: [
        {
          kind: "move-concept" as const,
          fromPath: "topics/target.md",
          toPath: "archive/deep/renamed.md",
        },
        { kind: "delete-concept" as const, path: "temporary.md" },
        {
          kind: "write-concept" as const,
          path: "new.md",
          type: "concept",
          title: "New",
          description: "A new Concept in the same change set.",
          body: "[Moved](topics/target.md#new)\n",
        },
        {
          kind: "write-asset" as const,
          path: "assets/data.bin",
          content: Uint8Array.from([7, 8, 9]),
        },
      ],
    };
    const result = await mutateKnowledgeBundle(request);
    const retry = await mutateKnowledgeBundle(request);
    const bundle = await readControlledKnowledgeBundle(root);

    expect(result).toMatchObject({ status: "committed", revision: 7 });
    expect(retry).toEqual(result);
    expect(bundle.concepts.map(({ path }) => path)).toEqual([
      "archive/deep/renamed.md",
      "new.md",
      "notes/reference.md",
      "root-link.md",
      "stable.md",
    ]);
    expect(bundle.relationships).toEqual(
      [
        { source: "archive/deep/renamed", target: "archive/deep/renamed" },
        { source: "new", target: "archive/deep/renamed" },
        { source: "notes/reference", target: "archive/deep/renamed" },
        { source: "root-link", target: "archive/deep/renamed" },
      ].filter(({ source, target }) => source !== target),
    );
    await expect(readFile(join(root, ".llm-wiki/wiki/root-link.md"), "utf8")).resolves.toContain(
      "[Target](archive/deep/renamed.md#part)",
    );
    await expect(readFile(join(root, ".llm-wiki/wiki/new.md"), "utf8")).resolves.toContain(
      "[Moved](archive/deep/renamed.md#new)",
    );
    await expect(
      readFile(join(root, ".llm-wiki/wiki/notes/reference.md"), "utf8"),
    ).resolves.toContain("[target]: ../archive/deep/renamed.md#part");
    await expect(
      readFile(join(root, ".llm-wiki/wiki/archive/deep/renamed.md"), "utf8"),
    ).resolves.toContain("[Self](renamed.md#self)");
    expect(
      bundle.concepts
        .filter(({ path }) => path !== "stable.md")
        .every(({ metadata }) => metadata?.timestamp === "2026-08-01T10:00:00Z"),
    ).toBe(true);
    expect(await readFile(join(root, ".llm-wiki/wiki/stable.md"))).toEqual(stableBefore);
    expect(await readFile(join(root, ".llm-wiki/wiki/assets/data.bin"))).toEqual(
      Buffer.from([7, 8, 9]),
    );
    expect(bundle.nativeContract.status).toBe("pass");

    const assetDeletion = await mutateKnowledgeBundle({
      vaultRoot: root,
      mutationId: "delete-asset",
      expectedRevision: 7,
      committedAt: "2026-08-02T10:00:00Z",
      changes: [{ kind: "delete-asset", path: "assets/data.bin" }],
    });
    expect(assetDeletion).toMatchObject({ status: "committed", revision: 8 });
    await expect(readFile(join(root, ".llm-wiki/wiki/assets/data.bin"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("deletes Concepts and writes opaque Bundle assets through the shared mutation boundary", async () => {
    const root = await vault();
    await initializeKnowledgeBundle({
      vaultRoot: root,
      mutationId: "init",
      expectedRevision: 0,
      committedAt: "2026-07-22T10:00:00Z",
    });
    await writeConcept({
      vaultRoot: root,
      mutationId: "create",
      expectedRevision: 1,
      committedAt: "2026-07-23T10:00:00Z",
      path: "temporary.md",
      type: "concept",
      title: "Temporary",
      description: "A temporary Concept.",
      body: "Body\n",
    });

    const assetRequest = {
      vaultRoot: root,
      mutationId: "asset",
      expectedRevision: 2,
      committedAt: "2026-07-24T10:00:00Z",
      path: "images/pixel.bin",
      content: Uint8Array.from([0, 255, 1]),
    } as const;
    const asset = await writeBundleAsset(assetRequest);
    const assetRetry = await writeBundleAsset(assetRequest);
    const deleteRequest = {
      vaultRoot: root,
      mutationId: "delete",
      expectedRevision: 3,
      committedAt: "2026-07-25T10:00:00Z",
      path: "temporary.md",
    } as const;
    const deleted = await deleteConcept(deleteRequest);
    const deleteRetry = await deleteConcept(deleteRequest);
    const bundle = await readControlledKnowledgeBundle(root);

    expect(asset).toMatchObject({ status: "committed", revision: 3 });
    expect(assetRetry).toEqual(asset);
    expect(deleted).toMatchObject({ status: "committed", revision: 4 });
    expect(deleteRetry).toEqual(deleted);
    expect(bundle.concepts).toEqual([]);
    expect(bundle.assets).toEqual([{ path: "images/pixel.bin" }]);
    expect(await readFile(join(root, ".llm-wiki/wiki/images/pixel.bin"))).toEqual(
      Buffer.from([0, 255, 1]),
    );
    expect(bundle.nativeContract.status).toBe("pass");
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
