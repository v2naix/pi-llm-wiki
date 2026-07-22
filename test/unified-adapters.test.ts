import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBundleSnapshot } from "../extensions/llm-wiki/lib/native-okf-application.js";
import { executePiWriteOperation } from "../extensions/llm-wiki/lib/pi-write-adapter.js";
import {
  privateProjectionFreshSync,
  readFreshPrivateProjectionSync,
} from "../extensions/llm-wiki/lib/private-projections.js";
import { getVaultPaths } from "../extensions/llm-wiki/lib/utils.js";
import { executeMcpWriteOperation } from "../mcp/write-adapter.js";

const roots: string[] = [];

async function vault(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  await mkdir(join(root, ".llm-wiki/wiki"), { recursive: true });
  await writeFile(join(root, ".llm-wiki/config.json"), "{}\n", "utf8");
  return root;
}

async function files(
  root: string,
  directory = join(root, ".llm-wiki/wiki"),
): Promise<Record<string, Buffer>> {
  const result: Record<string, Buffer> = {};
  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else
        result[absolute.slice(directory.length + 1).replaceAll("\\", "/")] =
          await readFile(absolute);
    }
  }
  await visit(directory);
  return result;
}

async function normalizedBundleFiles(root: string): Promise<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(await files(root)).map(([path, bytes]) => [
      path,
      bytes
        .toString("utf8")
        .replaceAll(
          /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi,
          "<raw-source-id>",
        ),
    ]),
  );
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("unified Controlled Write Adapters", () => {
  it("gives Pi Extension and MCP byte-equivalent canonical outcomes and classifications", async () => {
    const piRoot = await vault("native-okf-pi-");
    const mcpRoot = await vault("native-okf-mcp-");
    const init = {
      kind: "initialize" as const,
      mutationId: "init",
      expectedRevision: 0,
      committedAt: "2026-08-08T09:00:00Z",
    };
    await executePiWriteOperation(piRoot, init);
    await executeMcpWriteOperation(mcpRoot, init);

    const request = {
      kind: "retrospective" as const,
      mutationId: "retro-1",
      expectedRevision: 1,
      committedAt: "2026-08-08T10:00:00Z",
      slug: "adapter-seam",
      title: "Adapter seam",
      insight: "Both public adapters submit the same application operation.",
      category: "architecture",
    };
    const piResult = await executePiWriteOperation(piRoot, request);
    const mcpResult = await executeMcpWriteOperation(mcpRoot, request);

    expect(piResult).toEqual(mcpResult);
    expect(piResult).toMatchObject({ effect: "canonical", status: "committed", revision: 2 });
    expect(await files(piRoot)).toEqual(await files(mcpRoot));
    expect(privateProjectionFreshSync(getVaultPaths(piRoot))).toBe(true);
    expect(privateProjectionFreshSync(getVaultPaths(mcpRoot))).toBe(true);

    await expect(executePiWriteOperation(piRoot, request)).resolves.toEqual(piResult);
    await expect(executeMcpWriteOperation(mcpRoot, request)).resolves.toEqual(mcpResult);
    await expect(
      executeMcpWriteOperation(mcpRoot, { ...request, mutationId: "stale", title: "Stale" }),
    ).rejects.toMatchObject({ code: "stale-revision" });
  });

  it("preserves source lifecycle semantics, provenance, timestamps, and diagnostics across adapters", async () => {
    const piRoot = await vault("native-okf-source-pi-");
    const mcpRoot = await vault("native-okf-source-mcp-");
    const init = {
      kind: "initialize" as const,
      mutationId: "init",
      expectedRevision: 0,
      committedAt: "2026-08-08T09:00:00Z",
    };
    await executePiWriteOperation(piRoot, init);
    await executeMcpWriteOperation(mcpRoot, init);
    const capture = {
      kind: "capture-source" as const,
      mutationId: "capture",
      expectedRevision: 1,
      committedAt: "2026-08-08T10:00:00Z",
      captureTimestamp: "2026-08-08T09:30:00Z",
      input: { kind: "text" as const, text: "Shared source evidence.", title: "Shared source" },
    };
    const piCapture = await executePiWriteOperation(piRoot, capture);
    const mcpCapture = await executeMcpWriteOperation(mcpRoot, capture);

    expect(piCapture).toMatchObject({
      status: "committed",
      effect: "canonical",
      revision: 2,
      conceptPath: "sources/shared-source.md",
      curationState: "captured",
    });
    expect(mcpCapture).toMatchObject({
      ...piCapture,
      rawSourceId: expect.any(String),
    });
    expect(await normalizedBundleFiles(piRoot)).toEqual(await normalizedBundleFiles(mcpRoot));
    await expect(executePiWriteOperation(piRoot, capture)).resolves.toEqual(piCapture);
    await expect(executeMcpWriteOperation(mcpRoot, capture)).resolves.toEqual(mcpCapture);

    const synthesis = {
      kind: "synthesize-source" as const,
      mutationId: "synthesize",
      expectedRevision: 2,
      committedAt: "2026-08-08T11:00:00Z",
      sourceDescription: "Evidence that both adapters share source lifecycle semantics.",
      summary: "Both adapters commit the same reader-visible source knowledge.",
      keyTakeaways: ["Source capture and synthesis use the shared application seam."],
      entities: [{ title: "Adapter", description: "A protocol translation surface." }],
      topics: [{ title: "Mutation seam", description: "The shared controlled write seam." }],
    };
    const [piSynthesis, mcpSynthesis] = await Promise.all([
      executePiWriteOperation(piRoot, { ...synthesis, rawSourceId: piCapture.rawSourceId! }),
      executeMcpWriteOperation(mcpRoot, { ...synthesis, rawSourceId: mcpCapture.rawSourceId! }),
    ]);
    expect(piSynthesis).toEqual(mcpSynthesis);
    expect(await normalizedBundleFiles(piRoot)).toEqual(await normalizedBundleFiles(mcpRoot));
    const source = await readFile(join(piRoot, ".llm-wiki/wiki/sources/shared-source.md"), "utf8");
    expect(source).toContain("timestamp: 2026-08-08T11:00:00Z");
    expect(source).toContain("**Captured:** 2026-08-08T09:30:00Z");
    expect(source).toContain("Raw Source Packet remains outside this Canonical Knowledge Bundle");

    const invalid = {
      kind: "write-concept" as const,
      mutationId: "invalid",
      expectedRevision: 3,
      path: "concepts/invalid.md",
      type: "concept" as const,
      title: "Invalid",
      description: "",
      body: "Invalid.",
    };
    const failures = await Promise.allSettled([
      executePiWriteOperation(piRoot, invalid),
      executeMcpWriteOperation(mcpRoot, invalid),
    ]);
    expect(failures.map((failure) => failure.status)).toEqual(["rejected", "rejected"]);
    expect(failures.map((failure) => (failure as PromiseRejectedResult).reason.code)).toEqual([
      "core-field-required",
      "core-field-required",
    ]);
  });

  it("classifies projection publication as private-only and a fresh retry as no-op", async () => {
    const piRoot = await vault("native-okf-private-pi-");
    const mcpRoot = await vault("native-okf-private-mcp-");
    const init = {
      kind: "initialize" as const,
      mutationId: "init",
      expectedRevision: 0,
      committedAt: "2026-08-08T09:00:00Z",
    };
    await executePiWriteOperation(piRoot, init);
    await executeMcpWriteOperation(mcpRoot, init);
    const piBefore = await files(piRoot);
    const mcpBefore = await files(mcpRoot);
    await Promise.all([
      rm(join(piRoot, ".llm-wiki/meta/projections/current.json")),
      rm(join(mcpRoot, ".llm-wiki/meta/projections/current.json")),
    ]);
    const operation = {
      kind: "rebuild-private-projections" as const,
      mutationId: "projection-rebuild",
      expectedRevision: 1,
    };

    const [piResult, mcpResult] = await Promise.all([
      executePiWriteOperation(piRoot, operation),
      executeMcpWriteOperation(mcpRoot, operation),
    ]);

    expect(piResult).toEqual(mcpResult);
    expect(piResult).toMatchObject({ effect: "private-only", status: "published", revision: 1 });
    expect(await files(piRoot)).toEqual(piBefore);
    expect(await files(mcpRoot)).toEqual(mcpBefore);
    await expect(executePiWriteOperation(piRoot, operation)).resolves.toMatchObject({
      effect: "no-op",
      status: "no-op",
      revision: 1,
    });
    await expect(executeMcpWriteOperation(mcpRoot, operation)).resolves.toMatchObject({
      effect: "no-op",
      status: "no-op",
      revision: 1,
    });
  });

  it("uses the same fresh-projection selection policy for every read adapter", async () => {
    const root = await vault("native-okf-projection-read-");
    await executePiWriteOperation(root, {
      kind: "initialize",
      mutationId: "init",
      expectedRevision: 0,
      committedAt: "2026-08-08T09:00:00Z",
    });
    const paths = getVaultPaths(root);
    expect(readFreshPrivateProjectionSync(paths)).toBeDefined();

    await writeFile(
      join(paths.wiki, "external.md"),
      "---\ntype: concept\ntitle: External\ndescription: External edit.\ntimestamp: 2026-08-08T10:00:00Z\n---\n",
    );

    expect(privateProjectionFreshSync(paths)).toBe(false);
    expect(readFreshPrivateProjectionSync(paths)).toBeUndefined();
  });

  it("returns profile-scoped support claims without cross-profile contamination", async () => {
    const root = await vault("native-okf-profile-");
    await executeMcpWriteOperation(root, {
      kind: "initialize",
      mutationId: "init",
      expectedRevision: 0,
      committedAt: "2026-08-08T09:00:00Z",
    });
    const result = await executeMcpWriteOperation(root, {
      kind: "retrospective",
      mutationId: "retro",
      expectedRevision: 1,
      committedAt: "2026-08-08T10:00:00Z",
      slug: "support-profile",
      title: "Support profile",
      insight: "Compatibility is reported for each named reference operation.",
    });

    expect(result.validation.okfConformance).toMatchObject({
      status: "pass",
      version: "0.1",
      revision: "ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a",
    });
    expect(result.validation.nativeContract.status).toBe("pass");
    expect(result.validation.referenceCompatibility.map(({ operation }) => operation)).toEqual([
      "document-parse",
      "document-write-validation",
      "index-generation",
      "graph-extraction",
      "viewer-navigation",
    ]);
  });

  it("creates a byte-preserving snapshot of exactly the editable bundle root", async () => {
    const root = await vault("native-okf-snapshot-");
    await executePiWriteOperation(root, {
      kind: "initialize",
      mutationId: "init",
      expectedRevision: 0,
      committedAt: "2026-08-08T09:00:00Z",
    });
    await executePiWriteOperation(root, {
      kind: "write-asset",
      mutationId: "asset",
      expectedRevision: 1,
      committedAt: "2026-08-08T10:00:00Z",
      path: "assets/data.bin",
      content: Uint8Array.from([0, 255, 1, 2]),
    });
    await writeFile(join(root, ".llm-wiki/meta/private.txt"), "not distributed", "utf8");
    const destination = join(root, "snapshot");

    const result = await createBundleSnapshot({ vaultRoot: root, destination });

    expect(result).toMatchObject({ status: "created", source: join(root, ".llm-wiki/wiki") });
    expect(await files(root, destination)).toEqual(await files(root));
    await expect(readFile(join(destination, "../meta/private.txt"))).rejects.toThrow();
  });
});
