import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readKnowledgeBundle } from "../extensions/llm-wiki/lib/okf-reader.js";

const roots: string[] = [];

async function bundle(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "okf-reader-"));
  const root = join(parent, "wiki");
  roots.push(root);
  await mkdir(root, { recursive: true });
  return root;
}

async function put(root: string, path: string, content: string): Promise<void> {
  const target = join(root, path);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, content, "utf8");
}

function concept(body = "", extra = ""): string {
  return `---\ntype: concept\ntitle: Example\ndescription: A real description\ntimestamp: "2026-07-22T00:00:00Z"\n${extra}---\n\n${body}`;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(join(root, ".."), { recursive: true, force: true })),
  );
});

describe("readKnowledgeBundle", () => {
  it("discovers folder-qualified Concepts and assets but excludes reserved documents", async () => {
    const root = await bundle();
    await put(root, "Topic.md", concept());
    await put(root, "nested/Topic.md", concept());
    await writeFile(join(root, "unreadable.md"), Buffer.from([0xff, 0xfe]));
    await put(root, "nested/index.md", "# Concepts\n");
    await put(root, "nested/log.md", "# 2026-07-22\n\n- Updated\n");
    await put(root, "diagram.png", "asset");
    await put(join(root, ".."), "private.md", "not bundle content");

    const result = await readKnowledgeBundle(root);

    expect(result.concepts.map(({ id }) => id)).toEqual(["Topic", "nested/Topic", "unreadable"]);
    expect(result.concepts.find(({ id }) => id === "unreadable")?.metadata).toBeNull();
    expect(result.assets.map(({ path }) => path)).toEqual(["diagram.png"]);
    expect(result.reservedDocuments.map(({ path }) => path)).toEqual([
      "nested/index.md",
      "nested/log.md",
    ]);
  });

  it("preserves safe YAML values exactly and keeps profile judgments independent", async () => {
    const root = await bundle();
    await put(
      root,
      "external.md",
      "---\ntype: unusual-extension\nbig: 9007199254740993123456789\nfeature: {enabled: true}\nnote: |\n  ---\n---\n\nBody\n",
    );

    const result = await readKnowledgeBundle(root);
    const metadata = result.concepts[0]?.metadata;

    expect(metadata?.type).toBe("unusual-extension");
    expect(metadata?.big).toBe(9007199254740993123456789n);
    expect(metadata?.feature).toEqual({ enabled: true });
    expect(metadata?.note).toBe("---\n");
    expect(result.okfConformance.status).toBe("pass");
    expect(result.nativeContract.status).toBe("fail");
    expect(
      result.nativeContract.diagnostics.every((item) => item.profile === "native-contract"),
    ).toBe(true);
    expect(
      result.referenceCompatibility.find(({ operation }) => operation === "document-parse")?.status,
    ).toBe("pass");
    expect(
      result.referenceCompatibility.find(
        ({ operation }) => operation === "document-write-validation",
      )?.status,
    ).toBe("fail");
  });

  it("rejects adversarial YAML with path-addressed diagnostics", async () => {
    const root = await bundle();
    await put(root, "duplicate.md", "---\ntype: one\ntype: two\n---\n");
    await put(root, "merge.md", "---\nbase: &base {type: concept}\n<<: *base\n---\n");
    await put(root, "tag.md", "---\ntype: !private concept\n---\n");
    await put(root, "cycle.md", "---\ntype: concept\ncycle: &cycle [*cycle]\n---\n");
    await put(root, "malformed.md", "---\ntype: [broken\n---\n");
    await put(root, "deep.md", "---\ntype: concept\nnested: [[[too-deep]]]\n---\n");
    await put(
      root,
      "timestamp.md",
      '---\ntype: concept\ntitle: Bad date\ndescription: Invalid calendar date\ntimestamp: "2026-02-30T00:00:00Z"\n---\n',
    );
    await put(root, "bom.md", `\ufeff${concept()}`);

    const result = await readKnowledgeBundle(root, { limits: { maxYamlDepth: 3 } });
    const nativeCodes = result.nativeContract.diagnostics.map(({ code }) => code);

    expect(nativeCodes).toEqual(
      expect.arrayContaining([
        "yaml-duplicate-key",
        "yaml-merge-key",
        "yaml-custom-tag",
        "yaml-cyclic-alias",
        "yaml-parse-error",
        "yaml-depth-limit",
        "concept-timestamp",
        "frontmatter-bom",
      ]),
    );
    expect(result.nativeContract.diagnostics.every(({ path }) => path.endsWith(".md"))).toBe(true);
  });

  it("retains parsed link occurrences and deduplicates valid relationships", async () => {
    const root = await bundle();
    await put(root, "guides/hello world.md", concept());
    await put(
      root,
      "source.md",
      concept(
        [
          "[inline](guides/hello%20world.md#intro) and [again][guide].",
          "[query](guides/hello%20world.md?view=compact) and [no suffix](guides/hello%20world).",
          "<https://example.com/autolink>",
          "",
          "![image](guides/hello%20world.md)",
          "`[code](guides/hello%20world.md)`",
          "```md",
          "[fenced](guides/hello%20world.md)",
          "```",
          "",
          "# Citations",
          "",
          "1. [upstream](https://example.com/source)",
          "2. [missing](missing.md)",
          "3. [outside](../private.md)",
          "",
          "[guide]: /guides/hello%20world.md",
        ].join("\n"),
      ),
    );

    const result = await readKnowledgeBundle(root);
    const source = result.concepts.find(({ id }) => id === "source");

    expect(
      source?.links.map(({ label, classification, citationContext }) => ({
        label,
        classification,
        citationContext,
      })),
    ).toEqual([
      { label: "inline", classification: "valid", citationContext: false },
      { label: "again", classification: "valid", citationContext: false },
      { label: "query", classification: "valid", citationContext: false },
      { label: "no suffix", classification: "broken", citationContext: false },
      { label: "upstream", classification: "external", citationContext: true },
      { label: "missing", classification: "broken", citationContext: true },
      { label: "outside", classification: "out-of-bundle", citationContext: true },
    ]);
    expect(source?.links[0]).toMatchObject({
      originalDestination: "guides/hello%20world.md#intro",
      normalizedTarget: "guides/hello world",
      fragment: "intro",
      position: { start: { line: 8, column: 1, offset: expect.any(Number) } },
    });
    expect(result.relationships).toEqual([{ source: "source", target: "guides/hello world" }]);
    expect(result.okfConformance.status).toBe("pass");
    expect(
      result.okfConformance.diagnostics.some(({ code }) => code === "broken-concept-link"),
    ).toBe(false);
    expect(result.nativeContract.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "broken-concept-link", path: "source.md" }),
      ]),
    );
  });

  it("passes the Native OKF Contract when required metadata and root reserved documents are valid", async () => {
    const root = await bundle();
    await put(root, "concept.md", concept("Body"));
    await put(
      root,
      "index.md",
      '---\nokf_version: "0.1"\n---\n\n# concept\n\n- [Example](concept.md) - A real description\n',
    );
    await put(root, "log.md", "# 2026-07-22\n\n- **Added** Example.\n");

    const result = await readKnowledgeBundle(root);

    expect(result.okfConformance.status).toBe("pass");
    expect(result.nativeContract.status).toBe("pass");
    expect(result.referenceCompatibility).toHaveLength(5);
    expect(result.referenceCompatibility.every(({ revision }) => revision.length === 40)).toBe(
      true,
    );
  });

  it("consumes unknown OKF versions best-effort with an explicit outside-profile diagnostic", async () => {
    const root = await bundle();
    await put(root, "concept.md", concept("Body"));
    await put(
      root,
      "index.md",
      '---\nokf_version: "9.9"\n---\n\n# concept\n\n- [Example](concept.md) - A real description\n',
    );
    await put(root, "log.md", "# 2026-07-22\n\n- **Added** Example.\n");

    const result = await readKnowledgeBundle(root);

    expect(result.okfConformance).toMatchObject({
      status: "pass",
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          profile: "okf-conformance",
          severity: "warning",
          code: "unknown-okf-version",
          path: "index.md",
        }),
      ]),
    });
    expect(result.nativeContract.status).toBe("fail");
    expect(result.referenceCompatibility).toHaveLength(5);
  });

  it("does not follow a symbolic link out of the Canonical Knowledge Bundle", async () => {
    const root = await bundle();
    const outside = join(root, "..", "private-concept.md");
    await writeFile(outside, concept(), "utf8");
    await symlink(outside, join(root, "escaped.md"));

    const result = await readKnowledgeBundle(root);

    expect(result.concepts).toEqual([]);
    expect(result.nativeContract.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "symbolic-link-escape", path: "escaped.md" }),
      ]),
    );
  });
});
