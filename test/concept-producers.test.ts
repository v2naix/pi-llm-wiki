import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureObservationConcept,
  captureRetrospectiveConcept,
  writeGeneralConcept,
  writeRequirementConcept,
  writeTrajectoryDerivedConcept,
} from "../extensions/llm-wiki/lib/concept-producers.js";
import {
  BundleMutationError,
  initializeKnowledgeBundle,
  readControlledKnowledgeBundle,
} from "../extensions/llm-wiki/lib/okf-mutation.js";

const roots: string[] = [];

async function vault(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "concept-producers-"));
  roots.push(root);
  await initializeKnowledgeBundle({
    vaultRoot: root,
    mutationId: "init",
    expectedRevision: 0,
    committedAt: "2026-09-01T08:00:00Z",
  });
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("native OKF non-source Concept producers", () => {
  it("writes general pages with truthful metadata, canonical links, retries, and Reserved Documents", async () => {
    const root = await vault();
    const request = {
      vaultRoot: root,
      mutationId: "general-page",
      expectedRevision: 1,
      committedAt: "2026-09-01T09:00:00Z",
      path: "concepts/attention.md",
      type: "concept" as const,
      title: "Attention",
      description: "A mechanism that weights relevant context.",
      body: "See [[entities/transformer|Transformer]].\n",
      metadata: { domain: "machine-learning" },
    };
    const first = await writeGeneralConcept(request);
    const retry = await writeGeneralConcept(request);

    expect(retry).toEqual(first);
    expect(first.revision).toBe(2);
    const page = await readFile(join(root, ".llm-wiki/wiki/concepts/attention.md"), "utf8");
    expect(page).toContain("description: A mechanism that weights relevant context.");
    expect(page).toContain("timestamp: 2026-09-01T09:00:00Z");
    expect(page).toContain("[Transformer](../entities/transformer.md)");
    expect(page).not.toContain("[[");
    expect(await readFile(join(root, ".llm-wiki/wiki/index.md"), "utf8")).toContain(
      "concepts/index.md",
    );
  });

  it("creates every general reader-visible page family through the same revision boundary", async () => {
    const root = await vault();
    const families = [
      ["entity", "entities/model.md", "Model", "A named model used by the project."],
      ["concept", "concepts/context.md", "Context", "Information available to a model."],
      ["synthesis", "syntheses/design.md", "Design Synthesis", "A synthesis of design evidence."],
      ["analysis", "analyses/tradeoffs.md", "Tradeoff Analysis", "An analysis of known tradeoffs."],
    ] as const;
    for (const [index, [type, path, title, description]] of families.entries()) {
      const result = await writeGeneralConcept({
        vaultRoot: root,
        mutationId: `general-${type}`,
        expectedRevision: index + 1,
        committedAt: `2026-09-01T09:0${index}:00Z`,
        path,
        type,
        title,
        description,
        body: `## Overview\n\n${description}\n`,
      });
      expect(result.revision).toBe(index + 2);
    }
    const bundle = await readControlledKnowledgeBundle(root);
    expect(bundle.concepts.map((concept) => concept.metadata?.type)).toEqual([
      "analysis",
      "concept",
      "entity",
      "synthesis",
    ]);
    expect(bundle.nativeContract.status).toBe("pass");
  });

  it("captures observations and retrospectives as honest non-Source Concepts", async () => {
    const root = await vault();
    await captureObservationConcept({
      vaultRoot: root,
      mutationId: "observe",
      expectedRevision: 1,
      committedAt: "2026-09-01T09:01:00Z",
      title: "Cache key mismatch",
      content: "The API and worker used different cache-key prefixes.",
      relevance: "high",
      tags: ["cache", "worker"],
      sourceContext: "Debugging stale reads",
    });
    await captureRetrospectiveConcept({
      vaultRoot: root,
      mutationId: "retro",
      expectedRevision: 2,
      committedAt: "2026-09-01T09:02:00Z",
      slug: "cache-key-contract",
      title: "Cache Key Contract",
      insight: "Keep cache-key construction behind one shared module.",
      category: "architecture",
    });

    const bundle = await readControlledKnowledgeBundle(root);
    expect(bundle.concepts.map((concept) => concept.metadata?.type)).toEqual([
      "observation",
      "retrospective",
    ]);
    expect(bundle.concepts.every((concept) => concept.metadata?.type !== "source")).toBe(true);
    expect(bundle.concepts.map((concept) => concept.metadata?.description)).toEqual([
      "The API and worker used different cache-key prefixes.",
      "Keep cache-key construction behind one shared module.",
    ]);
  });

  it("treats requirement fields as meaningful knowledge and preserves unknown YAML", async () => {
    const root = await vault();
    const created = await writeRequirementConcept({
      vaultRoot: root,
      mutationId: "requirement-create",
      expectedRevision: 1,
      committedAt: "2026-09-01T10:00:00Z",
      slug: "oauth-login",
      title: "OAuth Login",
      description: "Users can authenticate through an approved OAuth provider.",
      status: "draft",
      priority: "p1",
      dependencies: [],
      traceability: ["product-brief"],
      acceptanceCriteria: ["Google sign-in succeeds"],
    });
    const path = join(root, ".llm-wiki/wiki/requirements/oauth-login.md");
    const original = await readFile(path, "utf8");
    await writeFile(path, original.replace("priority: p1", "priority: p1\nthird_party: keep-me"));

    await expect(
      writeRequirementConcept({
        vaultRoot: root,
        mutationId: "requirement-update-stale",
        expectedRevision: 1,
        committedAt: "2026-09-01T10:01:00Z",
        slug: "oauth-login",
        title: "OAuth Login",
        description: "Users can authenticate through an approved OAuth provider.",
        status: "approved",
        priority: "p0",
        dependencies: [],
        traceability: ["product-brief"],
        acceptanceCriteria: ["Google sign-in succeeds"],
      }),
    ).rejects.toMatchObject({ code: "stale-revision" });

    const updated = await writeRequirementConcept({
      vaultRoot: root,
      mutationId: "requirement-update",
      expectedRevision: created.revision,
      committedAt: "2026-09-01T10:01:00Z",
      slug: "oauth-login",
      title: "OAuth Login",
      description: "Users can authenticate through an approved OAuth provider.",
      status: "approved",
      priority: "p0",
      dependencies: [],
      traceability: ["product-brief"],
      acceptanceCriteria: ["Google sign-in succeeds"],
    });
    expect(updated.revision).toBe(3);
    const page = await readFile(path, "utf8");
    expect(page).toContain("third_party: keep-me");
    expect(page).toContain("status: approved");
    expect(page).toContain("priority: p0");
    expect(page).toContain("timestamp: 2026-09-01T10:01:00Z");
  });

  it("keeps trajectory evidence private while producing disclosure-safe skill and case Concepts", async () => {
    const root = await vault();
    await writeTrajectoryDerivedConcept({
      vaultRoot: root,
      mutationId: "skill",
      expectedRevision: 1,
      committedAt: "2026-09-01T11:00:00Z",
      kind: "skill",
      slug: "debug-cache-keys",
      title: "Debug Cache Keys",
      description: "A repeatable procedure for diagnosing cache-key mismatches.",
      body: "Compare producers, then record the fix in [[cases/cache-key-incident]].\n",
      trajectoryIds: ["TRJ-2026-09-01-001"],
    });

    await writeTrajectoryDerivedConcept({
      vaultRoot: root,
      mutationId: "case",
      expectedRevision: 2,
      committedAt: "2026-09-01T11:01:00Z",
      kind: "case",
      slug: "cache-key-incident",
      title: "Cache Key Incident",
      description: "A resolved incident caused by inconsistent cache-key prefixes.",
      body: "The fix applied the [Debug Cache Keys](../skills/debug-cache-keys.md) procedure.\n",
      trajectoryIds: ["TRJ-2026-09-01-001"],
    });

    const page = await readFile(join(root, ".llm-wiki/wiki/skills/debug-cache-keys.md"), "utf8");
    const casePage = await readFile(
      join(root, ".llm-wiki/wiki/cases/cache-key-incident.md"),
      "utf8",
    );
    expect(page).toContain("[cache key incident](../cases/cache-key-incident.md)");
    expect(page).toContain("llm_wiki_trajectory_ids:");
    expect(page).toContain("Private trajectory evidence remains outside");
    expect(casePage).toContain("type: case");
    expect(casePage).toContain("../skills/debug-cache-keys.md");
    expect(`${page}${casePage}`).not.toContain("raw/trajectories");
  });

  it("rejects unsafe private trajectory links before changing canonical bytes", async () => {
    const root = await vault();
    await expect(
      writeTrajectoryDerivedConcept({
        vaultRoot: root,
        mutationId: "unsafe-skill",
        expectedRevision: 1,
        committedAt: "2026-09-01T11:00:00Z",
        kind: "skill",
        slug: "unsafe",
        title: "Unsafe",
        description: "An invalid skill that exposes private evidence.",
        body: "Read [packet](../raw/trajectories/TRJ-1/packet.json).",
        trajectoryIds: ["TRJ-1"],
      }),
    ).rejects.toBeInstanceOf(BundleMutationError);
    expect((await readControlledKnowledgeBundle(root)).concepts).toEqual([]);
  });
});
