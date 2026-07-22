import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBundleSnapshot } from "../extensions/llm-wiki/lib/native-okf-application.js";
import { executePiWriteOperation } from "../extensions/llm-wiki/lib/pi-write-adapter.js";
import { privateProjectionFreshSync } from "../extensions/llm-wiki/lib/private-projections.js";
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
