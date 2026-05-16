import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureVaultStructure, getVaultPaths } from "../extensions/llm-wiki/lib/utils.js";
import { readFile } from "./helpers.js";

describe("wiki retro", () => {
  let wikiDir: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(import.meta.dirname, "..", "tmp", `retro-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    wikiDir = (() => {
      const dir = join(tmpDir, `wiki-${Math.random().toString(36).slice(2)}`);
      mkdirSync(dir, { recursive: true });
      const llmWiki = join(dir, ".llm-wiki");
      const dirs = [
        "raw/articles",
        "raw/papers",
        "raw/notes",
        "raw/assets",
        "wiki/entities",
        "wiki/concepts",
        "wiki/sources",
        "wiki/syntheses",
        "wiki/changes",
        "meta",
        "outputs",
        ".discoveries",
      ];
      for (const d of dirs) mkdirSync(join(llmWiki, d), { recursive: true });
      return dir;
    })();
    const paths = getVaultPaths(wikiDir);
    ensureVaultStructure(paths);
    const dotWiki = join(paths.dotWiki);
    mkdirSync(dotWiki, { recursive: true });
    writeFileSync(
      join(dotWiki, "config.json"),
      JSON.stringify({ topic: "Test", mode: "personal" }),
    );
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("should save an insight as a source packet with manifest", async () => {
    const { saveInsight } = await import("../extensions/llm-wiki/lib/retro.js");
    const paths = getVaultPaths(wikiDir);
    const result = saveInsight(
      paths,
      "test-pattern",
      "Test Pattern",
      "This is a test insight.",
      "devops",
    );
    expect(result.sourceId).toMatch(/^SRC-/);
    expect(result.packetPath).toContain(".llm-wiki/raw/sources/");
    expect(result.sourcePagePath).toContain(".llm-wiki/wiki/sources/");
    const manifest = JSON.parse(readFile(join(result.packetPath, "manifest.json")));
    expect(manifest.title).toBe("Test Pattern");
    expect(manifest.slug).toBe("test-pattern");
    expect(manifest.format).toBe("insight");
    expect(manifest.category).toBe("devops");
    const extracted = readFile(join(result.packetPath, "extracted.md"));
    expect(extracted).toContain("# Test Pattern");
    expect(extracted).toContain("This is a test insight.");
    expect(extracted).toContain("*Captured:");
    const sourcePage = readFile(result.sourcePagePath);
    expect(sourcePage).toContain("type: source");
    expect(sourcePage).toContain('title: "Test Pattern"');
    expect(sourcePage).toContain("status: insight");
    expect(sourcePage).toContain("This is a test insight.");
  });

  it("should save an insight without a category", async () => {
    const { saveInsight } = await import("../extensions/llm-wiki/lib/retro.js");
    const paths = getVaultPaths(wikiDir);
    const result = saveInsight(paths, "simple-note", "Simple Note", "Just a note.");
    const manifest = JSON.parse(readFile(join(result.packetPath, "manifest.json")));
    expect(manifest.category).toBe("uncategorized");
    const sourcePage = readFile(result.sourcePagePath);
    expect(sourcePage).not.toContain("category:");
  });

  it("should support multiple retros generating unique source IDs", async () => {
    const { saveInsight } = await import("../extensions/llm-wiki/lib/retro.js");
    const paths = getVaultPaths(wikiDir);
    const r1 = saveInsight(paths, "insight-one", "One", "First insight.");
    const r2 = saveInsight(paths, "insight-two", "Two", "Second insight.");
    expect(r1.sourceId).not.toBe(r2.sourceId);
    expect(existsSync(r1.packetPath)).toBe(true);
    expect(existsSync(r2.packetPath)).toBe(true);
  });

  it("should rebuild metadata after saving an insight", async () => {
    const { saveInsight } = await import("../extensions/llm-wiki/lib/retro.js");
    const paths = getVaultPaths(wikiDir);
    saveInsight(paths, "meta-test", "Meta Test", "Checking metadata.");
    const registry = JSON.parse(readFile(join(paths.meta, "registry.json")));
    const sourcePageId = Object.keys(registry.pages).find((id) => id.startsWith("sources/SRC-"));
    expect(sourcePageId).toBeTruthy();
    expect(registry.pages[sourcePageId!].title).toBe('"Meta Test"');
  });
});
