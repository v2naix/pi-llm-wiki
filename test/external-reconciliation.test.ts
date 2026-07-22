import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  initializeKnowledgeBundle,
  inspectExternalBundle,
  readBundleRevision,
  readControlledKnowledgeBundle,
  reconcileExternalBundle,
  writeBundleAsset,
  writeConcept,
} from "../extensions/llm-wiki/lib/okf-mutation.js";

const roots: string[] = [];

async function vault(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "okf-reconciliation-"));
  roots.push(root);
  await initializeKnowledgeBundle({
    vaultRoot: root,
    mutationId: "init",
    expectedRevision: 0,
    committedAt: "2026-07-01T10:00:00Z",
  });
  return root;
}

async function concept(root: string, path = "topic.md", revision = 1): Promise<void> {
  await writeConcept({
    vaultRoot: root,
    mutationId: `create-${path}`,
    expectedRevision: revision,
    committedAt: "2026-07-02T10:00:00Z",
    path,
    type: "concept",
    title: "Topic",
    description: "A topic.",
    body: "Original knowledge.\n",
    metadata: { extension: { large: 9007199254740993123456789n } },
  });
}

function externalConcept(timestamp: string | undefined, body = "External knowledge.\n"): string {
  return `---\ntype: concept\ntitle: Topic\ndescription: A topic.\n${timestamp ? `timestamp: ${timestamp}\n` : ""}extension:\n  large: 9007199254740993123456789\n---\n${body}`;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("external Bundle reconciliation", () => {
  it("inspects and admits valid Concept and asset observations as one revision", async () => {
    const root = await vault();
    await concept(root);
    await writeBundleAsset({
      vaultRoot: root,
      mutationId: "asset",
      expectedRevision: 2,
      committedAt: "2026-07-03T10:00:00Z",
      path: "files/data.bin",
      content: Uint8Array.from([1, 2]),
    });
    const wiki = join(root, ".llm-wiki/wiki");
    await writeFile(join(wiki, "topic.md"), externalConcept("2026-07-04T09:00:00Z"));
    await writeFile(join(wiki, "files/data.bin"), Uint8Array.from([3, 4]));
    await writeFile(join(wiki, "added.md"), externalConcept("2026-07-04T09:30:00Z", "Added.\n"));

    const inspection = await inspectExternalBundle(root);
    expect(inspection.status).toBe("ready");
    expect(inspection.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "concept", operation: "modified", path: "topic.md" }),
        expect.objectContaining({ kind: "concept", operation: "added", path: "added.md" }),
        expect.objectContaining({ kind: "asset", operation: "modified", path: "files/data.bin" }),
      ]),
    );
    expect(await readBundleRevision(root)).toBe(3);

    const request = {
      vaultRoot: root,
      mutationId: "admit-external",
      expectedRevision: 3,
      committedAt: "2026-07-05T10:00:00Z",
    } as const;
    const result = await reconcileExternalBundle(request);
    const retry = await reconcileExternalBundle(request);
    expect(result).toMatchObject({ status: "committed", revision: 4 });
    expect(retry).toEqual(result);
    expect(await readBundleRevision(root)).toBe(4);
    expect((await readControlledKnowledgeBundle(root)).nativeContract.status).toBe("pass");
    await expect(readFile(join(wiki, "topic.md"), "utf8")).resolves.toContain(
      "timestamp: 2026-07-04T09:00:00Z",
    );
  });

  it("requires explicit reaffirmation instead of inferring a missing or unchanged timestamp", async () => {
    const root = await vault();
    await concept(root);
    const path = join(root, ".llm-wiki/wiki/topic.md");
    await writeFile(path, externalConcept(undefined));

    const inspection = await inspectExternalBundle(root);
    expect(inspection.status).toBe("reaffirmation-required");
    expect(inspection.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "concept-reaffirmation-required", path: "topic.md" }),
      ]),
    );
    await expect(
      reconcileExternalBundle({
        vaultRoot: root,
        mutationId: "missing-reaffirmation",
        expectedRevision: 2,
        committedAt: "2026-07-05T10:00:00Z",
      }),
    ).rejects.toMatchObject({ code: "concept-reaffirmation-required", path: "topic.md" });

    const result = await reconcileExternalBundle({
      vaultRoot: root,
      mutationId: "reaffirm-topic",
      expectedRevision: 2,
      committedAt: "2026-07-05T10:00:00Z",
      reaffirmConcepts: ["topic.md"],
    });
    expect(result).toMatchObject({ status: "committed", revision: 3 });
    await expect(readFile(path, "utf8")).resolves.toContain("timestamp: 2026-07-05T10:00:00Z");
  });

  it("reports invalid YAML and untrusted Reserved Document edits without changing authority or bytes", async () => {
    const root = await vault();
    await concept(root);
    const wiki = join(root, ".llm-wiki/wiki");
    const topic = join(wiki, "topic.md");
    const index = join(wiki, "index.md");
    await writeFile(topic, "---\ntype: [\n---\ninvalid\n", "utf8");
    await writeFile(index, "# Human editorial content\n", "utf8");

    const beforeTopic = await readFile(topic);
    const beforeIndex = await readFile(index);
    const inspection = await inspectExternalBundle(root);
    expect(inspection.status).toBe("conflict");
    expect(inspection.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "yaml-parse-error", path: "topic.md" }),
        expect.objectContaining({ code: "reserved-document-conflict", path: "index.md" }),
      ]),
    );
    expect(await readFile(topic)).toEqual(beforeTopic);
    expect(await readFile(index)).toEqual(beforeIndex);
    expect(await readBundleRevision(root)).toBe(2);
  });

  it("restores trusted Reserved preimages, detects ambiguous moves, provenance conflicts, stale baselines, and no-ops", async () => {
    const root = await vault();
    const wiki = join(root, ".llm-wiki/wiki");
    const trustedIndex = await readFile(join(wiki, "index.md"));
    await concept(root, "one.md", 1);
    await concept(root, "two.md", 2);
    await writeFile(join(wiki, "index.md"), trustedIndex);

    const restored = await reconcileExternalBundle({
      vaultRoot: root,
      mutationId: "restore-preimage",
      expectedRevision: 3,
      committedAt: "2026-07-05T10:00:00Z",
    });
    expect(restored).toMatchObject({ status: "committed", revision: 4 });
    await expect(readFile(join(wiki, "index.md"), "utf8")).resolves.toContain("[Topic](one.md)");
    const noOp = await reconcileExternalBundle({
      vaultRoot: root,
      mutationId: "reconcile-no-op",
      expectedRevision: 4,
      committedAt: "2026-07-06T10:00:00Z",
    });
    expect(noOp).toEqual({
      status: "no-op",
      revision: 4,
      mutationId: "reconcile-no-op",
      changedPaths: [],
    });

    await writeConcept({
      vaultRoot: root,
      mutationId: "link-to-one",
      expectedRevision: 4,
      committedAt: "2026-07-07T10:00:00Z",
      path: "linker.md",
      type: "concept",
      title: "Linker",
      description: "Links to one.",
      body: "[One](one.md)\n",
    });
    const bytes = await readFile(join(wiki, "one.md"));
    await rm(join(wiki, "one.md"));
    await rm(join(wiki, "two.md"));
    await writeFile(join(wiki, "moved.md"), bytes);
    const ambiguous = await inspectExternalBundle(root);
    expect(ambiguous.status).toBe("conflict");
    expect(ambiguous.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "ambiguous-concept-move" }),
        expect.objectContaining({ code: "ambiguous-link-resolution", path: "linker.md" }),
      ]),
    );

    const second = await vault();
    await mkdir(join(second, ".llm-wiki/wiki/sources"), { recursive: true });
    await writeFile(
      join(second, ".llm-wiki/wiki/source-a.md"),
      externalConcept("2026-07-02T10:00:00Z").replace(
        "extension:\n",
        "llm_wiki_raw_source_id: packet-1\nextension:\n",
      ),
    );
    await writeFile(
      join(second, ".llm-wiki/wiki/source-b.md"),
      externalConcept("2026-07-04T10:00:00Z").replace(
        "extension:\n",
        "llm_wiki_raw_source_id: packet-1\nextension:\n",
      ),
    );
    expect((await inspectExternalBundle(second)).diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "source-provenance-conflict" })]),
    );

    const statePath = join(second, ".llm-wiki/meta/native-okf/state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.baselineRevision = 0;
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    expect(await inspectExternalBundle(second)).toMatchObject({ status: "conflict" });
  });
});
