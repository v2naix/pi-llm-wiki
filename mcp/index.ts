#!/usr/bin/env node

/**
 * LLM Wiki MCP Server
 *
 * Exposes wiki tools over the Model Context Protocol (MCP).
 * Run: node mcp/index.js
 * Pi installation: pi install git:github.com/v2naix/pi-llm-wiki@main
 *
 * Environment:
 *   WIKI_ROOT — path to wiki vault (default: auto-detect from cwd)
 *   WIKI_MARKITDOWN_TIMEOUT_MS — PDF extraction timeout (default: 180000)
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { readBundleRevision } from "../extensions/llm-wiki/lib/okf-mutation.js";
import { readFreshPrivateProjectionSync } from "../extensions/llm-wiki/lib/private-projections.js";
import type { VaultPaths as NativeVaultPaths } from "../extensions/llm-wiki/lib/utils.js";
import { executeMcpWriteOperation } from "./write-adapter.js";

// ─── Wiki Vault Detection ──────────────────────────────

interface VaultPaths extends NativeVaultPaths {
  root: string;
  raw: string;
  rawSources: string;
  wiki: string;
  meta: string;
  dotWiki: string;
  outputs: string;
  discoveries: string;
}

/** Detect vault format at a directory. */
function detectFormat(dir: string): "new" | "legacy" | "none" {
  if (existsSync(join(dir, ".llm-wiki", "config.json"))) return "new";
  if (existsSync(join(dir, ".wiki", "config.json"))) return "legacy";
  return "none";
}

function resolveVaultRoot(cwd: string): string | null {
  // Check cwd first
  if (detectFormat(cwd) !== "none") return cwd;

  // Walk up
  const parts = cwd.split("/");
  for (let i = parts.length - 1; i >= 0; i--) {
    const dir = parts.slice(0, i + 1).join("/") || "/";
    if (detectFormat(dir) !== "none") return dir;
  }
  return null;
}

function getPaths(): VaultPaths {
  const detectedRoot = resolveVaultRoot(process.cwd());
  const root = process.env.WIKI_ROOT || detectedRoot || process.cwd();
  const format = process.env.WIKI_ROOT
    ? detectFormat(root) // Use format detection even with explicit WIKI_ROOT
    : detectedRoot
      ? detectFormat(root)
      : "none";

  if (format === "legacy") {
    return {
      root,
      raw: join(root, "raw"),
      rawSources: join(root, "raw", "sources"),
      wiki: join(root, "wiki"),
      meta: join(root, "meta"),
      dotWiki: join(root, ".wiki"),
      outputs: join(root, "outputs"),
      discoveries: join(root, ".discoveries"),
    };
  }

  return {
    root,
    raw: join(root, ".llm-wiki", "raw"),
    rawSources: join(root, ".llm-wiki", "raw", "sources"),
    wiki: join(root, ".llm-wiki", "wiki"),
    meta: join(root, ".llm-wiki", "meta"),
    dotWiki: join(root, ".llm-wiki"),
    outputs: join(root, ".llm-wiki", "outputs"),
    discoveries: join(root, ".llm-wiki", ".discoveries"),
  };
}

function hasVault(): boolean {
  const paths = getPaths();
  return existsSync(join(paths.dotWiki, "config.json"));
}

const mcpPi = {
  exec(command: string, args: string[], options?: { timeout?: number; signal?: AbortSignal }) {
    return new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
      execFile(command, args, options, (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") return reject(error);
        resolve({ stdout, stderr, code: typeof error?.code === "number" ? error.code : 0 });
      });
    });
  },
};

// ─── Helpers ────────────────────────────────────────────

function readJson<T>(path: string, defaultVal: T): T {
  try {
    if (!existsSync(path)) return defaultVal;
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return defaultVal;
  }
}

function currentRegistry(paths: VaultPaths) {
  return (
    readFreshPrivateProjectionSync(paths)?.registry ?? {
      version: "2.0",
      last_updated: "",
      pages: {},
    }
  );
}

// ─── MCP Server ─────────────────────────────────────────

const server = new McpServer({
  name: "llm-wiki",
  version: "1.0.0",
});

// ---- wiki_recall ----

server.registerTool(
  "wiki_recall",
  {
    description:
      "Search the wiki for pages relevant to a query. Returns matching page IDs, titles, types, and content previews.",
    inputSchema: z.object({
      query: z.string().describe("Search query — use the user's full request or key terms"),
      max_results: z.number().optional().default(5).describe("Max results (default: 5, max: 10)"),
    }),
  },
  async ({ query, max_results }) => {
    if (!hasVault()) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No wiki vault found. Set WIKI_ROOT or run wiki_bootstrap first.",
          },
        ],
        isError: true,
      };
    }

    const paths = getPaths();
    const registry = currentRegistry(paths);

    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2)
      .slice(0, 10);

    if (terms.length === 0) {
      return {
        content: [{ type: "text" as const, text: "Query too short." }],
      };
    }

    type Scored = { id: string; score: number };
    const scored: Scored[] = [];

    for (const [id, entry] of Object.entries(registry.pages)) {
      let score = 0;
      const title = String(entry.title || "").toLowerCase();
      const type = String(entry.type || "").toLowerCase();

      for (const term of terms) {
        if (id.toLowerCase().includes(term)) score += 3;
        if (title.includes(term)) score += 4;
        if (type.includes(term)) score += 1;
      }

      const tags = String(entry.tags || entry.category || entry.domain || "").toLowerCase();
      for (const term of terms) {
        if (tags.includes(term)) score += 2;
      }

      if (score > 0) scored.push({ id, score });
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, Math.min(max_results ?? 5, 10));

    const results = top.map(({ id }) => {
      const entry = registry.pages[id];
      let preview = "";
      const pagePath = join(paths.wiki, `${id}.md`);
      if (existsSync(pagePath)) {
        const content = readFileSync(pagePath, "utf-8");
        preview = content
          .replace(/^---[\s\S]*?---\n/, "")
          .trim()
          .slice(0, 200)
          .replace(/\n/g, " ");
      }
      return {
        id,
        title: String(entry?.title || id),
        type: String(entry?.type || "page"),
        preview,
      };
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(results, null, 2),
        },
      ],
    };
  },
);

// ---- wiki_search ----

server.registerTool(
  "wiki_search",
  {
    description: "Search the wiki registry for pages matching a query.",
    inputSchema: z.object({
      query: z.string().describe("Search term"),
      type: z
        .string()
        .optional()
        .describe("Filter by page type (source, entity, concept, synthesis, analysis)"),
    }),
  },
  async ({ query, type }) => {
    if (!hasVault()) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No wiki vault found. Set WIKI_ROOT or run wiki_bootstrap first.",
          },
        ],
        isError: true,
      };
    }

    const paths = getPaths();
    const registry = currentRegistry(paths);

    const q = query.toLowerCase();
    const matches = Object.entries(registry.pages)
      .filter(([id, entry]) => {
        const matchesQuery =
          id.toLowerCase().includes(q) ||
          String(entry.title).toLowerCase().includes(q) ||
          String(entry.type).toLowerCase().includes(q);
        const matchesType = !type || String(entry.type).toLowerCase() === type.toLowerCase();
        return matchesQuery && matchesType;
      })
      .map(([id, entry]) => ({
        id,
        title: entry.title,
        type: entry.type,
      }));

    return {
      content: [
        {
          type: "text" as const,
          text:
            matches.length > 0 ? JSON.stringify(matches, null, 2) : `No pages found for "${query}"`,
        },
      ],
    };
  },
);

// ---- wiki_status ----

server.registerTool(
  "wiki_status",
  {
    description: "Show wiki health and stats: page counts, orphans, recent activity.",
    inputSchema: z.object({}),
  },
  async () => {
    if (!hasVault()) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No wiki vault found. Set WIKI_ROOT or run wiki_bootstrap first.",
          },
        ],
        isError: true,
      };
    }

    const paths = getPaths();
    const registry = currentRegistry(paths);

    const config = readJson<Record<string, unknown>>(join(paths.dotWiki, "config.json"), {});

    const byType: Record<string, number> = {};
    for (const entry of Object.values(registry.pages)) {
      byType[entry.type] = (byType[entry.type] || 0) + 1;
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              topic: config.topic || "Unknown",
              mode: config.mode || "personal",
              totalPages: Object.keys(registry.pages).length,
              byType,
              lastUpdated: registry.last_updated || "Never",
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ---- wiki_retro ----

server.registerTool(
  "wiki_retro",
  {
    description:
      "Save an atomic insight from a completed task as a Retrospective Concept through a Bundle Mutation.",
    inputSchema: z.object({
      slug: z.string().describe("Unique kebab-case identifier (e.g. 'jwt-revocation-pattern')"),
      title: z.string().describe("Short descriptive title (60 chars max)"),
      body: z
        .string()
        .describe(
          "Markdown body explaining what was learned. Use standard Markdown links to related Concepts.",
        ),
      category: z
        .string()
        .optional()
        .describe("Category (e.g. frontend, architecture, devops, bugfix)"),
      mutation_id: z
        .string()
        .optional()
        .describe("Stable Mutation Identity for idempotent retries"),
      expected_revision: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Expected Bundle Revision"),
      committed_at: z.string().optional().describe("ISO 8601 UTC commit time"),
    }),
  },
  async ({ slug, title, body, category, mutation_id, expected_revision, committed_at }) => {
    if (!hasVault()) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No wiki vault found. Set WIKI_ROOT or run wiki_bootstrap first.",
          },
        ],
        isError: true,
      };
    }

    const vaultPaths = getPaths();
    const mutationId = mutation_id ?? `mcp-retro-${randomUUID()}`;
    const result = await executeMcpWriteOperation(vaultPaths.root, {
      kind: "retrospective",
      mutationId,
      expectedRevision: expected_revision ?? (await readBundleRevision(vaultPaths.root)),
      committedAt: committed_at,
      slug,
      title,
      insight: body,
      category,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              message: `Insight saved: ${result.conceptPath} — ${title}`,
              status: result.status,
              effect: result.effect,
              revision: result.revision,
              mutationId: result.mutationId,
              validation: result.validation,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ---- wiki_capture_source ----

server.registerTool(
  "wiki_capture_source",
  {
    description: "Capture a URL, local file, or pasted text into an immutable source packet.",
    inputSchema: z.object({
      text: z.string().optional().describe("Text content to capture"),
      url: z.string().optional().describe("URL to capture"),
      file_path: z.string().optional().describe("Local file path to capture"),
      title: z.string().optional().describe("Title for the captured source"),
      mutation_id: z
        .string()
        .optional()
        .describe("Stable Mutation Identity for idempotent retries"),
      expected_revision: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Expected Bundle Revision"),
      committed_at: z.string().optional().describe("ISO 8601 UTC commit time"),
      capture_timestamp: z.string().optional().describe("Immutable Source Capture Timestamp"),
    }),
  },
  async ({
    text,
    url: urlParam,
    file_path,
    title,
    mutation_id,
    expected_revision,
    committed_at,
    capture_timestamp,
  }) => {
    if (!hasVault()) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No wiki vault found. Set WIKI_ROOT or run wiki_bootstrap first.",
          },
        ],
        isError: true,
      };
    }

    const vaultPaths = getPaths();
    const pi = mcpPi as never;
    const input = urlParam
      ? ({ kind: "url", url: urlParam, title, pi } as const)
      : file_path
        ? ({ kind: "file", filePath: file_path, title, pi } as const)
        : text
          ? ({ kind: "text", text, title } as const)
          : undefined;
    if (!input) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Provide one of: text, url, or file_path",
          },
        ],
        isError: true,
      };
    }
    const mutationId = mutation_id ?? `mcp-capture-${randomUUID()}`;
    const result = await executeMcpWriteOperation(vaultPaths.root, {
      kind: "capture-source",
      mutationId,
      expectedRevision: expected_revision ?? (await readBundleRevision(vaultPaths.root)),
      committedAt: committed_at,
      captureTimestamp: capture_timestamp,
      input,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              message: `Source captured: ${result.conceptPath}`,
              rawSourceId: result.rawSourceId,
              curationState: result.curationState,
              status: result.status,
              effect: result.effect,
              revision: result.revision,
              mutationId: result.mutationId,
              validation: result.validation,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ─── Main ───────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🧠 LLM Wiki MCP Server running on stdio");
}

main().catch((err) => {
  console.error("MCP Server error:", err);
  process.exit(1);
});
