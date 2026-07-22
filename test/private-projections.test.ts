import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Embedder } from "../extensions/llm-wiki/lib/embeddings.js";
import {
  initializeKnowledgeBundle,
  readBundleRevision,
  writeConcept,
} from "../extensions/llm-wiki/lib/okf-mutation.js";
import {
  readPrivateProjection,
  rebuildPrivateProjections,
} from "../extensions/llm-wiki/lib/private-projections.js";
import { searchWiki } from "../extensions/llm-wiki/lib/recall.js";
import { getVaultPaths } from "../extensions/llm-wiki/lib/utils.js";

const roots: string[] = [];

async function makeVault(): Promise<{ root: string; wiki: string }> {
  const root = await mkdtemp(join(tmpdir(), "private-projection-"));
  roots.push(root);
  const wiki = join(root, ".llm-wiki", "wiki");
  await mkdir(wiki, { recursive: true });
  return { root, wiki };
}

async function concept(
  wiki: string,
  path: string,
  values: { title: string; body?: string; metadata?: string },
): Promise<void> {
  const target = join(wiki, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(
    target,
    `---\ntype: concept\ntitle: ${values.title}\ndescription: Stored description\ntimestamp: 2026-07-22T10:00:00Z\n${values.metadata ?? ""}---\n\n${values.body ?? "Body."}\n`,
    "utf8",
  );
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("revision-bound private projections", () => {
  it("builds registry and backlinks only from parsed Concepts and valid Canonical Concept Links", async () => {
    const { root, wiki } = await makeVault();
    await concept(wiki, "nested/alpha.md", {
      title: "Alpha",
      body: "[Beta](beta.md) [missing](missing.md) [[raw-wikilink]]",
      metadata: "large_id: 9007199254740993123456789\n",
    });
    await concept(wiki, "nested/beta.md", { title: "Beta" });
    await writeFile(join(wiki, "index.md"), "# Reserved Alpha\n", "utf8");
    await mkdir(join(root, ".llm-wiki", "raw", "sources", "packet"), { recursive: true });
    await writeFile(
      join(root, ".llm-wiki", "raw", "sources", "packet", "manifest.json"),
      JSON.stringify({ title: "Private packet" }),
    );

    const result = await rebuildPrivateProjections(getVaultPaths(root));
    const projection = await readPrivateProjection(getVaultPaths(root));

    expect(result.effect).toBe("private-only");
    expect(result.status).toBe("published");
    expect(Object.keys(projection?.registry.pages ?? {})).toEqual(["nested/alpha", "nested/beta"]);
    expect(projection?.registry.pages["nested/alpha"]).toMatchObject({
      type: "concept",
      title: "Alpha",
      description: "Stored description",
      large_id: "9007199254740993123456789",
    });
    expect(projection?.backlinks).toEqual({ "nested/alpha": [], "nested/beta": ["nested/alpha"] });
    expect(projection?.manifest.source.contentIdentity).toMatch(/^sha256:/);
  });

  it("publishes a complete generation only after embeddings finish", async () => {
    const { root, wiki } = await makeVault();
    await concept(wiki, "alpha.md", { title: "Alpha" });
    const paths = getVaultPaths(root);
    await rebuildPrivateProjections(paths);

    await concept(wiki, "beta.md", { title: "Beta" });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const embedder: Embedder = {
      model: "blocked",
      embed: async (texts) => {
        await blocked;
        return texts.map(() => [1, 0]);
      },
    };

    const rebuilding = rebuildPrivateProjections(paths, { embedder });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(Object.keys((await readPrivateProjection(paths))?.registry.pages ?? {})).toEqual([
      "alpha",
    ]);
    release();
    await rebuilding;

    const published = await readPrivateProjection(paths);
    expect(Object.keys(published?.registry.pages ?? {})).toEqual(["alpha", "beta"]);
    expect(Object.keys(published?.embeddings.entries ?? {})).toEqual(["alpha", "beta"]);
    expect(published?.embeddings.sourceContentIdentity).toBe(
      published?.manifest.source.contentIdentity,
    );
  });

  it("coalesces concurrent rebuilds and is idempotent for the same canonical identity", async () => {
    const { root, wiki } = await makeVault();
    await concept(wiki, "alpha.md", { title: "Alpha" });
    const paths = getVaultPaths(root);

    const first = rebuildPrivateProjections(paths);
    expect(rebuildPrivateProjections(paths)).toBe(first);
    const published = await first;
    const noOp = await rebuildPrivateProjections(paths);

    expect(published.status).toBe("published");
    expect(noOp).toMatchObject({ status: "no-op", effect: "private-only" });
    expect(noOp.generation).toBe(published.generation);
  });

  it("handles empty bundles and never changes canonical bytes", async () => {
    const { root, wiki } = await makeVault();
    await writeFile(join(wiki, "log.md"), "# Log\n", "utf8");
    const before = await readFile(join(wiki, "log.md"), "utf8");

    await rebuildPrivateProjections(getVaultPaths(root));
    const projection = await readPrivateProjection(getVaultPaths(root));

    expect(projection?.registry.pages).toEqual({});
    expect(projection?.backlinks).toEqual({});
    await expect(readFile(join(wiki, "log.md"), "utf8")).resolves.toBe(before);
  });

  it("declares the controlled Bundle Revision without changing revision, timestamps, or canonical bytes", async () => {
    const { root, wiki } = await makeVault();
    await initializeKnowledgeBundle({
      vaultRoot: root,
      mutationId: "init",
      expectedRevision: 0,
      committedAt: "2026-07-22T09:00:00Z",
    });
    await writeConcept({
      vaultRoot: root,
      mutationId: "alpha",
      expectedRevision: 1,
      committedAt: "2026-07-22T10:00:00Z",
      path: "alpha.md",
      type: "concept",
      title: "Alpha",
      description: "Stored description",
      body: "Body.\n",
    });
    const canonicalBefore = await Promise.all(
      ["alpha.md", "index.md", "log.md"].map(async (path) => [
        path,
        await readFile(join(wiki, path), "utf8"),
      ]),
    );

    await rebuildPrivateProjections(getVaultPaths(root));
    const projection = await readPrivateProjection(getVaultPaths(root));

    expect(projection?.manifest.source.bundleRevision).toBe(2);
    await expect(readBundleRevision(root)).resolves.toBe(2);
    await Promise.all(
      canonicalBefore.map(async ([path, bytes]) => {
        await expect(readFile(join(wiki, path), "utf8")).resolves.toBe(bytes);
      }),
    );
  });

  it("makes recall reject a stale generation instead of mixing it with changed canonical bytes", async () => {
    const { root, wiki } = await makeVault();
    await concept(wiki, "alpha.md", { title: "Alpha", body: "needle" });
    const paths = getVaultPaths(root);
    await rebuildPrivateProjections(paths);
    expect(searchWiki(paths, "needle").map(({ id }) => id)).toEqual(["alpha"]);

    await concept(wiki, "alpha.md", { title: "Alpha", body: "changed" });
    expect(searchWiki(paths, "needle")).toEqual([]);
  });
});
