import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { parse } from "yaml";
import { resolveEmbedder } from "./embeddings.js";
import { scheduleReindex } from "./indexing.js";
import { runIngestSynthesis } from "./ingest-worker.js";
import { type Registry, appendEvent } from "./metadata.js";
import { readBundleRevision } from "./okf-mutation.js";
import { type YamlValue, readKnowledgeBundle } from "./okf-reader.js";
import { executePiWriteOperation } from "./pi-write-adapter.js";
import {
  readFreshPrivateProjectionSync,
  rebuildPrivateProjections,
} from "./private-projections.js";
import type { Runtime } from "./runtime.js";
import { parseModelRef } from "./task-config.js";
import {
  type VaultPaths,
  detectVaultFormat,
  ensureVaultStructure,
  fmtDate,
  getVaultPaths,
  readJson,
  resolveVaultPaths,
  writeJson,
} from "./utils.js";

/**
 * All LLM Wiki custom tools.
 */

function getPaths(cwd?: string): VaultPaths {
  return resolveVaultPaths(cwd ?? process.cwd());
}

function currentRegistry(paths: VaultPaths): Registry {
  return (
    readFreshPrivateProjectionSync(paths)?.registry ?? {
      version: "2.0",
      last_updated: "",
      pages: {},
    }
  );
}

function requireVault(paths: VaultPaths): { ok: true } | { ok: false; reason: string } {
  if (detectVaultFormat(paths.root) === "none") {
    return { ok: false, reason: `No wiki found at ${paths.root}. Run wiki_bootstrap first.` };
  }
  return { ok: true };
}

type WikiToolResult = {
  content: { type: "text"; text: string }[];
  details: Record<string, unknown>;
  isError?: boolean;
};

type ToolCtx = {
  cwd?: string;
  hasUI: boolean;
  ui?: { notify: (message: string, type?: string) => void };
};

/**
 * Dispatch a heavy mutating action to the background runtime and report its
 * result (issue #77). The agent turn is never blocked: `work` runs off-thread
 * and the returned one-line summary is surfaced to the user via
 * `runtime.report()`. Returns an immediate, non-blocking tool result.
 *
 * When no runtime is available (unit tests / degraded mode), `work` runs
 * synchronously and its summary is returned inline, preserving prior behavior.
 * Retrieval tools (search/read/recall/status) never use this — the model needs
 * their output inline.
 */
async function dispatchReported(
  runtime: Runtime | undefined,
  ctx: ToolCtx,
  opts: {
    label: string;
    /** Immediate, non-blocking acknowledgement shown while work runs. */
    started: string;
    /** Off-thread work; resolves to the human-readable completion summary. */
    work: () => Promise<string>;
    details?: Record<string, unknown>;
  },
): Promise<WikiToolResult> {
  if (!runtime) {
    const summary = await opts.work();
    return {
      content: [{ type: "text", text: summary }],
      details: { background: false, ...opts.details },
    };
  }
  runtime.launchReported({ hasUI: ctx.hasUI, ui: ctx.ui }, opts.label, opts.work);
  return {
    content: [{ type: "text", text: opts.started }],
    details: { background: true, ...opts.details },
  };
}

// ─── 1. wiki_bootstrap ──────────────────────────────────

export function registerWikiBootstrap(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "wiki_bootstrap",
    label: "Wiki Bootstrap",
    description:
      "Initialize a Canonical Knowledge Bundle and its Private Vault Layer. " +
      "Creates configuration, templates, operating rules, and initial Reserved Documents.",
    promptSnippet: "Initialize a new LLM Wiki vault",
    promptGuidelines: ["Use wiki_bootstrap when the user wants to start a new wiki."],
    parameters: Type.Object({
      topic: Type.String({ description: "Main topic of the wiki" }),
      mode: Type.Optional(Type.String({ description: "personal or company (default: personal)" })),
      root: Type.Optional(
        Type.String({ description: "Root directory (default: current directory)" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const root = params.root ?? ctx.cwd ?? process.cwd();
      const mode = params.mode || "personal";
      const paths = getVaultPaths(root);

      ensureVaultStructure(paths);
      const initialized = await executePiWriteOperation(paths.root, {
        kind: "initialize",
        mutationId: _toolCallId,
        expectedRevision: 0,
      });

      const config = {
        name: params.topic,
        mode,
        topic: params.topic,
        created: fmtDate(),
        version: "1.0",
      };
      writeJson(join(paths.dotWiki, "config.json"), config);

      const schema = [
        "# LLM Wiki Schema",
        "",
        "## Ownership Rules",
        "",
        "| Path | Owner | Rule |",
        "|------|-------|------|",
        "| raw/** | extension | immutable private evidence after capture |",
        "| wiki/** | Bundle Mutation + external editors | Canonical Knowledge Bundle |",
        "| meta/* | extension | generated Private Projections |",
        "| . | human + explicit request | operating rules |",
        "",
        "## Raw Source Packet Format",
        "",
        "```",
        "raw/sources/<opaque-raw-source-id>/",
        "  manifest.json",
        "  original/",
        "  extracted.md",
        "  attachments/",
        "```",
        "",
        "## Page Types",
        "",
        "- **source** — what this specific source says",
        "- **entity** — people, orgs, tools, products",
        "- **concept** — ideas, patterns, frameworks",
        "- **synthesis** — cross-source theses and tensions",
        "- **analysis** — durable filed answers from queries",
        "- **requirement** — atomic requirements with status, priority, and traceability",
        "",
        "## Linking Style",
        "",
        "- Internal: [Label](../folder/concept.md)",
        "- Citation: [Source title](../sources/source-title.md)",
        "",
      ].join("\n");
      writeFileSync(join(paths.dotWiki, "WIKI_SCHEMA.md"), schema, "utf-8");

      await rebuildPrivateProjections(paths);
      appendEvent(paths, { kind: "bootstrap", topic: params.topic, mode });

      return {
        content: [
          {
            type: "text",
            text: [
              `✅ Wiki bootstrapped at \`${paths.root}\``,
              "**Scope:** project-local",
              "",
              "**Structure:**",
              "- .llm-wiki/raw/sources/ — immutable Raw Source Packets in the Private Vault Layer",
              "- .llm-wiki/wiki/ — editable Canonical Knowledge Bundle",
              "- .llm-wiki/meta/ — revision-bound Private Projections",
              "- .llm-wiki/ — config and templates",
              "- .llm-wiki/WIKI_SCHEMA.md — operating rules",
              "",
              "Next: Use wiki_capture_source to add your first source.",
            ].join("\n"),
          },
        ],
        details: {
          root,
          mode,
          topic: params.topic,
          revision: initialized.revision,
          effect: initialized.effect,
        } as Record<string, unknown>,
      };
    },
  });
}

// ─── 2. wiki_capture_source ─────────────────────────────

export function registerWikiCaptureSource(pi: ExtensionAPI, runtime?: Runtime): void {
  pi.registerTool({
    name: "wiki_capture_source",
    label: "Wiki Capture Source",
    description:
      "Capture a URL, local file, or pasted text as immutable private evidence and an honest Source Concept.",
    promptSnippet: "Capture a source through the controlled Source Capture Operation",
    promptGuidelines: [
      "Use wiki_capture_source when the user provides a URL, file, or text to capture.",
      "Use wiki_ingest to commit a grounded synthesis; do not edit the Source Concept directly.",
    ],
    parameters: Type.Object({
      url: Type.Optional(Type.String({ description: "URL to capture" })),
      file_path: Type.Optional(Type.String({ description: "Local file path to capture" })),
      text: Type.Optional(Type.String({ description: "Pasted text content" })),
      title: Type.Optional(Type.String({ description: "Title for pasted text" })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const paths = getPaths(ctx.cwd);
      const vaultCheck = requireVault(paths);
      if (!vaultCheck.ok) {
        return {
          content: [{ type: "text", text: vaultCheck.reason }],
          details: { error: vaultCheck.reason } as Record<string, unknown>,
          isError: true,
        };
      }

      if (signal?.aborted) throw signal.reason;
      const input = params.url
        ? ({ kind: "url", url: params.url, title: params.title, pi, signal } as const)
        : params.file_path
          ? ({
              kind: "file",
              filePath: params.file_path,
              title: params.title,
              pi,
              signal,
            } as const)
          : params.text
            ? ({ kind: "text", text: params.text, title: params.title } as const)
            : undefined;
      if (!input) {
        return {
          content: [{ type: "text", text: "❌ Provide one of: url, file_path, or text" }],
          details: { error: "missing_source" } as Record<string, unknown>,
          isError: true,
        };
      }
      const result = await executePiWriteOperation(paths.root, {
        kind: "capture-source",
        mutationId: _toolCallId,
        expectedRevision: await readBundleRevision(paths.root),
        input,
      });

      return {
        content: [
          {
            type: "text",
            text: [
              `✅ Captured Source Concept **${result.conceptPath}**`,
              "",
              `- Raw Source Identifier: \`${result.rawSourceId}\``,
              `- Curation state: \`${result.curationState}\``,
              `- Bundle Revision: ${result.revision}`,
              "",
              "**Next:** Use wiki_ingest to commit grounded synthesis through one Bundle Mutation.",
            ].join("\n"),
          },
        ],
        details: {
          rawSourceId: result.rawSourceId,
          conceptPath: result.conceptPath,
          curationState: result.curationState,
          revision: result.revision,
          effect: result.effect,
          validation: result.validation,
        } as Record<string, unknown>,
      };
    },
  });
}

// ─── 3. wiki_ingest ─────────────────────────────────────

export function registerWikiIngest(pi: ExtensionAPI, runtime?: Runtime): void {
  pi.registerTool({
    name: "wiki_ingest",
    label: "Wiki Ingest",
    description:
      "Process captured Raw Source Packets. By default controlled synthesis runs in the background (non-blocking) on the configured task model; pass background=false to inspect pending evidence.",
    promptSnippet: "Synthesize captured Source Concepts (background by default)",
    promptGuidelines: [
      "Use wiki_ingest when the user wants to process captured sources.",
      "By default ingestion runs in the BACKGROUND — you'll get a notification, not extracted content. Do NOT synthesize those sources yourself.",
      "If the tool returns extracted content (background unavailable, or background=false), then read each source's extracted.md, update its source page, create entity/concept pages, and cross-reference.",
      "The extension rebuilds Private Projections — never edit meta/ files manually.",
    ],
    parameters: Type.Object({
      source_id: Type.Optional(
        Type.String({ description: "Specific source ID to ingest. Leave empty for all new." }),
      ),
      batch_size: Type.Optional(
        Type.Number({ description: "Max sources to process (default: 3, max: 5)", default: 3 }),
      ),
      background: Type.Optional(
        Type.Boolean({
          description:
            "Synthesize in the background without blocking (default: true). Set false to return extracted content for the main agent to synthesize.",
          default: true,
        }),
      ),
      model: Type.Optional(
        Type.String({
          description:
            "Per-call model override as 'provider/id' (e.g. anthropic/claude-haiku). Overrides the configured wiki taskModel for this call; defaults to the configured/session model.",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const paths = getPaths(ctx.cwd);
      const vaultCheck = requireVault(paths);
      if (!vaultCheck.ok) {
        return {
          content: [{ type: "text", text: vaultCheck.reason }],
          details: { error: vaultCheck.reason } as Record<string, unknown>,
          isError: true,
        };
      }

      const batchSize = Math.min(params.batch_size ?? 3, 5);

      if (!existsSync(paths.rawSources)) {
        return {
          content: [
            {
              type: "text",
              text: "No raw/sources/ directory. Capture sources first with wiki_capture_source.",
            },
          ],
          details: { error: "no_sources" } as Record<string, unknown>,
        };
      }

      const packets = readdirSync(paths.rawSources)
        .filter((directory) => existsSync(join(paths.rawSources, directory, "manifest.json")))
        .sort();

      const registry = currentRegistry(paths);
      const ingested = new Set<string>();
      for (const entry of Object.values(registry.pages)) {
        const metadata = entry as Record<string, unknown>;
        if (
          entry.type === "source" &&
          metadata.llm_wiki_source_curation_state === "synthesized" &&
          typeof metadata.llm_wiki_raw_source_id === "string"
        ) {
          ingested.add(metadata.llm_wiki_raw_source_id);
        }
      }

      let toProcess = packets.filter((p) => !ingested.has(p));

      if (params.source_id) {
        if (!toProcess.includes(params.source_id) && !packets.includes(params.source_id)) {
          return {
            content: [
              { type: "text", text: `Source ${params.source_id} not found or already ingested.` },
            ],
            details: { source_id: params.source_id, status: "not_found" } as Record<
              string,
              unknown
            >,
          };
        }
        toProcess = [params.source_id];
      }

      const batch = toProcess.slice(0, batchSize);

      if (batch.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "✅ All sources ingested. Use wiki_capture_source to add new ones.",
            },
          ],
          details: { ingested: ingested.size, total: packets.length } as Record<string, unknown>,
        };
      }

      const sources = batch.map((id) => {
        const extractedPath = join(paths.rawSources, id, "extracted.md");
        const manifestPath = join(paths.rawSources, id, "manifest.json");
        const extracted = existsSync(extractedPath) ? readFileSync(extractedPath, "utf-8") : "";
        const manifest = readJson<Record<string, unknown>>(manifestPath, {});
        return { id, extracted, manifest };
      });

      // ── Background synthesis (issue #65) ──────────────────
      // Default path: dispatch each source to a background sub-agent so the
      // main agent is not blocked. Falls back to the synchronous return below
      // when no runtime/model is available (resolveModel ok:false).
      const wantBackground = params.background !== false;
      if (wantBackground && runtime) {
        runtime.ensureConfig(ctx.cwd);
        // Per-call model override (issue #69): 'provider/id' beats the
        // configured taskModel; a malformed/unknown ref degrades to the
        // configured/session model inside resolveModel.
        const override = params.model ? parseModelRef(params.model) : undefined;
        const resolved = await runtime.resolveModel(ctx, override);
        if (resolved.ok) {
          const launchCtx = { hasUI: ctx.hasUI, ui: ctx.ui };
          for (const s of sources) {
            runtime.launchTask(launchCtx, `ingest:${s.id}`, async () => {
              const committed = await runIngestSynthesis({
                model: resolved.model as Parameters<typeof runIngestSynthesis>[0]["model"],
                apiKey: resolved.apiKey,
                headers: resolved.headers,
                paths,
                sourceId: s.id,
                manifest: s.manifest,
                extracted: s.extracted,
              });
              if (committed) {
                // Publish embeddings with the same complete projection generation.
                const embedder = resolveEmbedder(runtime.config);
                if (embedder) await rebuildPrivateProjections(paths, { embedder });
              }
              const summary = committed
                ? `LLM Wiki: ingested ${s.id} → ${committed.entitiesCreated.length} entit${committed.entitiesCreated.length === 1 ? "y" : "ies"}, ${committed.conceptsCreated.length} concept${committed.conceptsCreated.length === 1 ? "" : "s"}`
                : `LLM Wiki: ${s.id} produced no synthesis`;
              if (ctx.hasUI) {
                ctx.ui.notify(summary, committed ? "info" : "warning");
              }
              // Persistent, user-visible completion report (issue #77) in
              // addition to the transient toast above. Notices-gated.
              runtime.report(committed ? `✅ ${summary}` : `⚠️ ${summary}`);
            });
          }
          return {
            content: [
              {
                type: "text",
                text: [
                  `🔄 **Ingesting ${sources.length} source(s) in the background** (${toProcess.length - batch.length} remaining).`,
                  "",
                  ...sources.map((s) => `- **${s.id}**: ${s.manifest.title || s.id}`),
                  "",
                  "Synthesis runs on the configured task model without blocking. You'll be notified as each source completes — do NOT synthesize these yourself.",
                ].join("\n"),
              },
            ],
            details: {
              background: true,
              dispatched: sources.map((s) => s.id),
              remaining: toProcess.length - batch.length,
            } as Record<string, unknown>,
          };
        }
      }

      return {
        content: [
          {
            type: "text",
            text: [
              `📥 **${batch.length} source(s) ready** (${toProcess.length - batch.length} remaining)`,
              "",
              ...sources.map((s) =>
                [
                  `- **${s.id}**: ${s.manifest.title || s.id}`,
                  `  - Extracted: ${s.extracted.length} chars`,
                  `  - Read: \`raw/sources/${s.id}/extracted.md\``,
                ].join("\n"),
              ),
              "",
              "**Next steps for each source:**",
              "1. Read extracted.md",
              "2. Do not edit Canonical Knowledge Bundle or Private Projection files directly",
              "3. Retry wiki_ingest with background=true when the background synthesis runtime is available",
              "4. Controlled synthesis will commit the Source Concept and related Concepts atomically",
              "",
              "Controlled synthesis atomically updates Concepts, Reserved Documents, and Private Projections.",
            ].join("\n"),
          },
        ],
        details: {
          batch: sources.map((s) => s.id),
          remaining: toProcess.length - batch.length,
        } as Record<string, unknown>,
      };
    },
  });
}

// ─── 4. wiki_ensure_page ────────────────────────────────

export function registerWikiEnsurePage(pi: ExtensionAPI, runtime?: Runtime): void {
  pi.registerTool({
    name: "wiki_ensure_page",
    label: "Wiki Ensure Page",
    description:
      "Resolve, create, or replace a canonical Concept through a Bundle Mutation. Returns the Concept path.",
    promptSnippet: "Create a canonical wiki page if it doesn't exist",
    promptGuidelines: [
      "Use wiki_ensure_page to create or deliberately replace general Concepts.",
      "Search existing pages first with wiki_search.",
    ],
    parameters: Type.Object({
      type: Type.String({
        description:
          "Page type: entity | concept | synthesis | analysis | requirement | skill | case",
      }),
      title: Type.String({ description: "Page title" }),
      content: Type.Optional(
        Type.String({ description: "Optional initial content (otherwise uses template)" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const paths = getPaths(ctx.cwd);
      const vaultCheck = requireVault(paths);
      if (!vaultCheck.ok) {
        return {
          content: [{ type: "text", text: vaultCheck.reason }],
          details: { error: vaultCheck.reason } as Record<string, unknown>,
          isError: true,
        };
      }

      const type = params.type as
        | "entity"
        | "concept"
        | "synthesis"
        | "analysis"
        | "requirement"
        | "skill"
        | "case";
      const slug = params.title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .slice(0, 80);

      const folderMap: Record<string, string> = {
        entity: "entities",
        concept: "concepts",
        synthesis: "syntheses",
        analysis: "analyses",
        requirement: "requirements",
        skill: "skills",
        case: "cases",
      };
      const folder = folderMap[type] || "concepts";
      const pagePath = join(paths.wiki, folder, `${slug}.md`);

      if (existsSync(pagePath) && params.content === undefined) {
        return {
          content: [{ type: "text", text: `✅ Concept already exists: \`${pagePath}\`` }],
          details: { path: pagePath, created: false, effect: "no-op" } as Record<string, unknown>,
        };
      }

      const existed = existsSync(pagePath);
      const today = fmtDate();
      const payload = buildNativePagePayload(type, params.title, today, params.content);
      const result = await executePiWriteOperation(paths.root, {
        kind: "write-concept",
        mutationId: _toolCallId,
        expectedRevision: await readBundleRevision(paths.root),
        path: `${folder}/${slug}.md`,
        type,
        title: params.title,
        description: payload.description,
        body: payload.body,
        metadata: payload.metadata,
      });

      if (runtime) scheduleReindex(runtime, { hasUI: ctx.hasUI, ui: ctx.ui }, paths);

      return {
        content: [
          {
            type: "text",
            text: `✅ ${existed ? "Updated" : "Created"} ${type} Concept: \`${pagePath}\``,
          },
        ],
        details: {
          path: pagePath,
          created: !existed,
          revision: result.revision,
          effect: result.effect,
        } as Record<string, unknown>,
      };
    },
  });
}

function canonicalConceptLink(fromPath: string, targetId: string): string {
  const targetPath = targetId.endsWith(".md") ? targetId : `${targetId}.md`;
  const destination = posix.relative(posix.dirname(fromPath), targetPath);
  const encoded = destination.split("/").map(encodeURIComponent).join("/");
  const label = posix.basename(targetId).replaceAll("-", " ");
  return `[${label}](${encoded})`;
}

function buildNativePagePayload(
  type: GeneralPageType,
  title: string,
  date: string,
  customContent?: string,
): { description: string; body: string; metadata: Record<string, YamlValue> } {
  const template = buildPageTemplate(type, title, date, customContent);
  const match = template.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const parsed = match ? (parse(match[1]) as Record<string, unknown>) : {};
  const body = (match ? match[2] : template).trimStart();
  const metadata: Record<string, YamlValue> = {};
  for (const [key, value] of Object.entries(parsed ?? {})) {
    if (new Set(["type", "title", "description", "timestamp", "created", "updated"]).has(key)) {
      continue;
    }
    metadata[key] = value as YamlValue;
  }
  const prose = body
    .replace(/^#.*$/gm, "")
    .replace(/\[([^\]]+)\]\([^\)]+\)|\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1$2")
    .replace(/\[[^\]]*\]|[*_`>#-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const description = customContent
    ? (prose.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || prose).slice(0, 240)
    : `A newly created ${type} page titled “${title}”; detailed knowledge has not yet been added.`;
  if (!description)
    throw new Error("Page content must provide enough knowledge for a description.");
  return { description, body, metadata };
}

type GeneralPageType =
  | "entity"
  | "concept"
  | "synthesis"
  | "analysis"
  | "requirement"
  | "skill"
  | "case";

function buildPageTemplate(
  type: string,
  title: string,
  date: string,
  customContent?: string,
): string {
  if (customContent) return customContent;

  const base = `---\ntype: ${type}\ncreated: ${date}\nupdated: ${date}\nsources: []\n---\n\n# ${title}\n\n[Description to be filled]\n\n## Links\n\n- [Related Concept](../concepts/related-concept.md)\n`;

  if (type === "entity") {
    return base
      .replace("[Description to be filled]", "One-line description.\n\n## Overview\n\n[Key facts]")
      .replace("type: entity", "type: entity\ncategory: organization");
  }
  if (type === "concept") {
    return base
      .replace(
        "[Description to be filled]",
        "One-line definition.\n\n## Definition\n\n[Clear explanation]",
      )
      .replace("type: concept", "type: concept\ndomain: ai");
  }
  if (type === "synthesis") {
    return base
      .replace(
        "[Description to be filled]",
        "Cross-cutting analysis.\n\n## Question\n\n[What drove this?]",
      )
      .replace("sources: []", "sources_count: 0");
  }
  if (type === "analysis") {
    return base.replace(
      "[Description to be filled]",
      "Durable answer from a query.\n\n## Question\n\n[Original question]",
    );
  }
  if (type === "skill") {
    return [
      "---",
      "type: skill",
      `created: ${date}`,
      `updated: ${date}`,
      "status: draft",
      "trajectories: []",
      "tags: []",
      "---",
      "",
      `# ${title}`,
      "",
      "_One-line summary of the reusable pattern this skill captures._",
      "",
      "## When to Use",
      "",
      "[Trigger conditions — when this pattern applies]",
      "",
      "## Procedure",
      "",
      "1. [Step 1]",
      "2. [Step 2]",
      "",
      "## Pitfalls",
      "",
      "- [Known failure mode or caveat]",
      "",
      "## Provenance",
      "",
      "_Add disclosure-safe provenance when this draft is distilled from private trajectory evidence._",
      "",
    ].join("\n");
  }
  if (type === "case") {
    return [
      "---",
      "type: case",
      `created: ${date}`,
      `updated: ${date}`,
      "status: draft",
      "outcome: success",
      "trajectory_id: ",
      "tags: []",
      "---",
      "",
      `# ${title}`,
      "",
      "_One-line summary of the specific task this case records._",
      "",
      "## Task",
      "",
      "[What was requested]",
      "",
      "## Approach",
      "",
      "[How the agent solved it — key steps and decisions]",
      "",
      "## Outcome",
      "",
      "[Result, and anything worth reusing or avoiding next time]",
      "",
      "## Provenance",
      "",
      "_Add disclosure-safe provenance for any private trajectory evidence used to write this case._",
      "",
    ].join("\n");
  }
  if (type === "requirement") {
    return [
      "---",
      "type: requirement",
      `created: ${date}`,
      `updated: ${date}`,
      "status: draft",
      "priority: p2",
      "source_id: ",
      "depends_on: []",
      "---",
      "",
      `# ${title}`,
      "",
      "## Description",
      "",
      "[Clear description of what this requirement entails]",
      "",
      "## Acceptance Criteria",
      "",
      "- [ ] [Criterion 1]",
      "- [ ] [Criterion 2]",
      "",
      "## Dependencies",
      "",
      "_Pages this requirement depends on._",
      "",
      "## Implementation Notes",
      "",
      "[Optional notes]",
      "",
      "## Sources",
      "",
      "- [Source Concept](../sources/source-concept.md) — original concept capture",
      "",
    ].join("\n");
  }
  return base;
}

// ─── 5. wiki_search ─────────────────────────────────────

export function registerWikiSearch(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "wiki_search",
    label: "Wiki Search",
    description: "Search the wiki registry for pages matching a query.",
    promptSnippet: "Search the wiki registry for pages",
    promptGuidelines: ["Use wiki_search to find existing pages before creating duplicates."],
    parameters: Type.Object({
      query: Type.String({ description: "Search term" }),
      type: Type.Optional(Type.String({ description: "Filter by page type" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const paths = getPaths(ctx.cwd);
      const registry = currentRegistry(paths);
      const q = params.query.toLowerCase();

      const matches = Object.entries(registry.pages)
        .filter(([id, entry]) => {
          const matchesQuery =
            id.toLowerCase().includes(q) ||
            String(entry.title).toLowerCase().includes(q) ||
            String(entry.type).toLowerCase().includes(q);
          const matchesType =
            !params.type || String(entry.type).toLowerCase() === params.type.toLowerCase();
          return matchesQuery && matchesType;
        })
        .map(([id, entry]) => ({ id, title: entry.title, type: entry.type }));

      if (matches.length === 0) {
        return {
          content: [{ type: "text", text: `No pages found for "${params.query}"` }],
          details: { query: params.query, matches: [] } as Record<string, unknown>,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: [
              `🔍 **${matches.length} result(s)** for "${params.query}":`,
              "",
              ...matches.map((m) => `- [${m.title}](${m.id}.md) — *${m.type}*`),
            ].join("\n"),
          },
        ],
        details: { query: params.query, matches } as Record<string, unknown>,
      };
    },
  });
}

// ─── 6. wiki_lint ───────────────────────────────────────

export function registerWikiLint(pi: ExtensionAPI, runtime?: Runtime): void {
  pi.registerTool({
    name: "wiki_lint",
    label: "Wiki Lint",
    description:
      "Health check the wiki. Scans for orphans, missing pages, contradictions, gaps. Optionally auto-fixes.",
    promptSnippet: "Lint the wiki for health issues",
    promptGuidelines: [
      "Use wiki_lint when the user asks to check wiki health.",
      "Contradictions always need human review.",
    ],
    parameters: Type.Object({
      auto_fix: Type.Optional(
        Type.Boolean({ description: "Auto-fix orphans and missing pages", default: false }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const paths = getPaths(ctx.cwd);
      const vaultCheck = requireVault(paths);
      if (!vaultCheck.ok) {
        return {
          content: [{ type: "text", text: vaultCheck.reason }],
          details: { error: vaultCheck.reason } as Record<string, unknown>,
          isError: true,
        };
      }

      // Full-vault scan (+ optional auto-fix writes + reindex) is O(pages):
      // run it in the background and report the health summary (issue #77).
      return dispatchReported(runtime, ctx as ToolCtx, {
        label: `lint:${paths.root}`,
        started:
          "\u{1F9F9} LLM Wiki: lint started in the background — the health report will be posted when it completes.",
        work: async () => runWikiLint(paths, params.auto_fix === true),
      });
    },
  });
}

/**
 * Run the wiki health scan (issue #77 extracted it from the tool body so it can
 * run off-thread via `dispatchReported`). Returns the human-readable summary.
 */
async function runWikiLint(paths: VaultPaths, autoFix: boolean): Promise<string> {
  // Lint the same parsed Concept boundary used by registry, backlinks, and recall.
  // Reserved Documents, assets, private packets, code, and external links never enter this set.
  const bundle = await readKnowledgeBundle(paths.wiki);
  const concepts = bundle.concepts.filter(({ metadata }) => metadata !== null);

  const findings: string[] = [];
  let orphans = 0;
  let missingPages = 0;
  let contradictions = 0;
  const gaps: Array<{ topic: string; mentionedBy: string[] }> = [];
  const inbound = new Map(concepts.map(({ id }) => [id, 0]));
  for (const relationship of bundle.relationships) {
    if (inbound.has(relationship.target)) {
      inbound.set(relationship.target, (inbound.get(relationship.target) ?? 0) + 1);
    }
  }

  for (const concept of concepts) {
    for (const link of concept.links.filter(({ classification }) => classification === "broken")) {
      const topic = link.normalizedTarget ?? link.originalDestination;
      missingPages++;
      findings.push(`Missing Concept link: ${link.originalDestination} (in ${concept.path})`);
      const existing = gaps.find((gap) => gap.topic === topic);
      if (existing) {
        if (!existing.mentionedBy.includes(concept.id)) existing.mentionedBy.push(concept.id);
      } else {
        gaps.push({ topic, mentionedBy: [concept.id] });
      }
    }
    if ((inbound.get(concept.id) ?? 0) === 0) {
      orphans++;
      findings.push(`Orphan: ${concept.path} has no inbound Concept Relationship`);
    }
    if (concept.body.includes("⚠️ **Contradiction")) {
      contradictions++;
      findings.push(`Contradiction flagged in ${concept.path}`);
    }
  }

  let fixesApplied = 0;
  if (autoFix) {
    for (const gap of gaps) {
      if (gap.mentionedBy.length >= 2) {
        const folder = gap.topic.includes("/") ? gap.topic.split("/")[0] : "concepts";
        const name = gap.topic.includes("/") ? gap.topic.split("/").pop()! : gap.topic;
        const pagePath = join(paths.wiki, folder, `${name}.md`);
        if (existsSync(pagePath)) continue;
        const title = name.replace(/-/g, " ");
        await executePiWriteOperation(paths.root, {
          kind: "write-concept",
          mutationId: `lint-stub-${folder}-${name}-${fmtDate()}`,
          expectedRevision: await readBundleRevision(paths.root),
          path: `${folder}/${name}.md`,
          type: "concept",
          title,
          description: `A knowledge gap mentioned by ${gap.mentionedBy.length} existing Concepts; substantive detail is not yet recorded.`,
          body: `## Knowledge gap\n\nThis topic was mentioned by ${gap.mentionedBy.map((id) => canonicalConceptLink(`${folder}/${name}.md`, id)).join(", ")} but still needs substantive knowledge.\n`,
          metadata: { status: "stub", mentioned_by: gap.mentionedBy },
        });
        fixesApplied++;
      }
    }
  }

  writeJson(join(paths.discoveries, "gaps.json"), {
    gaps,
    generated: new Date().toISOString(),
  });

  const reportLines = [
    "# Wiki Lint Report",
    `Generated: ${fmtDate()}`,
    "",
    "## Summary",
    `- Total pages: ${concepts.length}`,
    `- Orphans: ${orphans}`,
    `- Missing pages: ${missingPages}`,
    `- Contradictions: ${contradictions}`,
    autoFix ? `- Fixes applied: ${fixesApplied}` : "",
    "",
    "## Findings",
    findings.length > 0 ? findings.map((f) => `- ${f}`).join("\n") : "✅ No issues found!",
    "",
  ].filter(Boolean);

  const reportPath = join(paths.outputs, `lint-${fmtDate()}.md`);
  mkdirSync(paths.outputs, { recursive: true });
  writeFileSync(reportPath, `${reportLines.join("\n")}\n`, "utf-8");

  return [
    "🧹 **LLM Wiki lint complete**",
    "",
    `- Pages: ${concepts.length}`,
    `- Orphans: ${orphans}`,
    `- Missing: ${missingPages}`,
    `- Contradictions: ${contradictions}`,
    autoFix ? `- Auto-fixes: ${fixesApplied}` : "",
    "",
    `📄 Report: \`${reportPath}\``,
    gaps.length > 0 ? `💡 ${gaps.length} knowledge gap(s) tracked` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ─── 7. wiki_status ─────────────────────────────────────

export function registerWikiStatus(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "wiki_status",
    label: "Wiki Status",
    description: "Report wiki health and stats instantly from generated registry.",
    promptSnippet: "Report wiki health and stats",
    promptGuidelines: ["Use wiki_status for a quick overview."],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const paths = getPaths(ctx.cwd);
      const vaultCheck = requireVault(paths);
      if (!vaultCheck.ok) {
        return {
          content: [{ type: "text", text: vaultCheck.reason }],
          details: { error: vaultCheck.reason } as Record<string, unknown>,
          isError: true,
        };
      }

      const freshProjection = readFreshPrivateProjectionSync(paths);
      const registry = currentRegistry(paths);
      const backlinks = freshProjection?.backlinks ?? {};
      const config = readJson<Record<string, unknown>>(join(paths.dotWiki, "config.json"), {});

      const byType: Record<string, number> = {};
      for (const entry of Object.values(registry.pages)) {
        byType[entry.type] = (byType[entry.type] || 0) + 1;
      }

      const orphanCount = Object.entries(backlinks).filter(
        ([, inbound]) => inbound.length === 0,
      ).length;
      const gaps = readJson<{ gaps?: unknown[] }>(join(paths.discoveries, "gaps.json"), {
        gaps: [],
      });

      const health =
        Object.keys(registry.pages).length === 0
          ? "🔴 Empty"
          : orphanCount > 5
            ? "⚠️ Warning"
            : "✅ Good";

      const lines = [
        "📊 LLM Wiki Status",
        "══════════════════",
        `Topic: ${config.topic || "Unknown"}`,
        `Mode: ${config.mode || "personal"}`,
        `Pages: ${Object.keys(registry.pages).length}`,
        ...Object.entries(byType).map(([t, c]) => `  - ${t}s: ${c}`),
        `Orphans: ${orphanCount}`,
        `Gaps: ${gaps.gaps?.length || 0}`,
        `Health: ${health}`,
        `Last updated: ${registry.last_updated || "Never"}`,
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          topic: config.topic,
          mode: config.mode,
          totalPages: Object.keys(registry.pages).length,
          byType,
          orphans: orphanCount,
          gaps: gaps.gaps?.length || 0,
          health,
        } as Record<string, unknown>,
      };
    },
  });
}

// ─── 8. wiki_rebuild_meta ───────────────────────────────

export function registerWikiRebuildMeta(pi: ExtensionAPI, runtime?: Runtime): void {
  pi.registerTool({
    name: "wiki_rebuild_meta",
    label: "Wiki Rebuild Meta",
    description: "Publish a complete revision-bound Private Projection generation.",
    promptSnippet: "Rebuild wiki Private Projections",
    promptGuidelines: ["Use wiki_rebuild_meta if a Private Projection is missing or stale."],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const paths = getPaths(ctx.cwd);
      const vaultCheck = requireVault(paths);
      if (!vaultCheck.ok) {
        return {
          content: [{ type: "text", text: vaultCheck.reason }],
          details: { error: vaultCheck.reason } as Record<string, unknown>,
          isError: true,
        };
      }

      // Heavy O(pages) rebuild — dispatch off the agent's critical path and
      // report on completion (issue #77).
      return dispatchReported(runtime, ctx as ToolCtx, {
        label: `rebuild_meta:${paths.root}`,
        started:
          "\u{1F9E0} LLM Wiki: Private Projection rebuild started in the background — the result will be reported when it completes.",
        work: async () => {
          const result = await rebuildPrivateProjections(paths);
          const registry = readFreshPrivateProjectionSync(paths)?.registry;
          const effect = result.status === "no-op" ? "no-op" : result.effect;
          return `✅ LLM Wiki: Private Projection rebuilt — ${Object.keys(registry?.pages ?? {}).length} Concepts indexed (${effect}).`;
        },
      });
    },
  });
}

// ─── 9. wiki_log_event ──────────────────────────────────

export function registerWikiReindexEmbeddings(pi: ExtensionAPI, runtime?: Runtime): void {
  pi.registerTool({
    name: "wiki_reindex_embeddings",
    label: "Wiki Reindex Embeddings",
    description:
      "Backfill / refresh semantic embeddings for the vault. Embeds pages that " +
      "are new or stale (content changed); pass force to re-embed everything. " +
      "No-op when no embedding provider is configured.",
    promptSnippet: "Backfill semantic embeddings for the wiki",
    promptGuidelines: [
      "Use wiki_reindex_embeddings to embed an existing vault or refresh stale embeddings.",
      "Embeddings are optional: this no-ops cleanly when no embedding provider is configured.",
    ],
    parameters: Type.Object({
      force: Type.Optional(
        Type.Boolean({ description: "Re-embed every page, ignoring staleness (default: false)" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const paths = getPaths(ctx.cwd);
      const vaultCheck = requireVault(paths);
      if (!vaultCheck.ok) {
        return {
          content: [{ type: "text", text: vaultCheck.reason }],
          details: { error: vaultCheck.reason } as Record<string, unknown>,
          isError: true,
        };
      }

      if (runtime) runtime.ensureConfig(ctx.cwd ?? paths.root);
      const embedder = runtime ? resolveEmbedder(runtime.config) : undefined;
      if (!embedder) {
        return {
          content: [
            {
              type: "text",
              text: 'ℹ️ No embedding provider configured — semantic embeddings are disabled. Set `llm-wiki.embeddingProvider` (e.g. "openai") in settings to enable.',
            },
          ],
          details: { enabled: false } as Record<string, unknown>,
        };
      }

      // Embedding is network-bound and O(pages) — run it in the background and
      // report the stats on completion (issue #77).
      return dispatchReported(runtime, ctx as ToolCtx, {
        label: `reindex_embeddings:${paths.root}`,
        started: `\u{1F9E0} LLM Wiki: embedding reindex started in the background (${embedder.model}) — stats will be reported when it completes.`,
        details: { enabled: true, model: embedder.model },
        work: async () => {
          const result = await rebuildPrivateProjections(paths, {
            embedder,
            force: params.force === true,
          });
          return `✅ LLM Wiki: embeddings reindexed (${embedder.model}) — ${result.status} (${result.effect}).`;
        },
      });
    },
  });
}

export function registerWikiLogEvent(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "wiki_log_event",
    label: "Wiki Log Event",
    description: "Append a structured event to meta/events.jsonl and regenerate meta/log.md.",
    promptSnippet: "Log an event to the wiki activity log",
    promptGuidelines: ["Use wiki_log_event to record significant actions manually."],
    parameters: Type.Object({
      kind: Type.String({ description: "Event kind (e.g., ingest, query, decision)" }),
      details: Type.Optional(Type.Object({}, { description: "Additional event fields" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const paths = getPaths(ctx.cwd);
      const vaultCheck = requireVault(paths);
      if (!vaultCheck.ok) {
        return {
          content: [{ type: "text", text: vaultCheck.reason }],
          details: { error: vaultCheck.reason } as Record<string, unknown>,
          isError: true,
        };
      }

      appendEvent(paths, { kind: params.kind, ...params.details });

      // Regenerate log.md
      const { buildLogMarkdown } = await import("./metadata.js");
      const log = buildLogMarkdown(paths);
      writeFileSync(join(paths.meta, "log.md"), log, "utf-8");

      return {
        content: [{ type: "text", text: `✅ Event logged: ${params.kind}` }],
        details: { kind: params.kind } as Record<string, unknown>,
      };
    },
  });
}

// ─── 10. wiki_watch ─────────────────────────────────────

export function registerWikiWatch(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "wiki_watch",
    label: "Wiki Watch",
    description:
      "Print a ready-to-paste crontab line for scheduling automatic wiki updates (discover → ingest → lint). Does NOT schedule anything itself — it returns the command for the user to install.",
    promptSnippet: "Schedule auto-updates for the wiki",
    promptGuidelines: [
      "Use wiki_watch when the user wants the wiki to stay current automatically.",
      "wiki_watch only PRINTS a cron line — surface the output to the user verbatim so they can install it. Do not claim the schedule is active.",
    ],
    parameters: Type.Object({
      interval: Type.String({ description: "daily, weekly, hourly, or stop" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (params.interval === "stop") {
        return {
          content: [
            {
              type: "text",
              text: [
                "🛑 To stop wiki auto-updates, remove the cron line you installed earlier:",
                "",
                "```bash",
                "crontab -e   # then delete the line tagged '# llm-wiki-autoupdate'",
                "```",
                "",
                "Or list current jobs to confirm:",
                "",
                "```bash",
                "crontab -l | grep llm-wiki-autoupdate",
                "```",
              ].join("\n"),
            },
          ],
          details: { action: "stop_instructions" } as Record<string, unknown>,
        };
      }

      // 5-field POSIX crontab expressions (min hour dom month dow).
      const intervals: Record<string, { cron: string; label: string }> = {
        daily: { cron: "0 8 * * *", label: "Daily at 8:00 AM" },
        weekly: { cron: "0 9 * * 1", label: "Weekly on Monday at 9:00 AM" },
        hourly: { cron: "0 * * * *", label: "Every hour" },
      };

      const config = intervals[params.interval];
      if (!config) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Unknown interval: "${params.interval}". Use: daily, weekly, hourly, or stop.`,
            },
          ],
          details: { error: "bad_interval" } as Record<string, unknown>,
          isError: true,
        };
      }

      // Robustness for global crontab environments:
      //   * `/bin/bash -lc` runs a LOGIN shell that sources /etc/profile +
      //     ~/.profile / ~/.bash_profile, so npm-global / bun / nvm PATH
      //     additions are imported — cron's default PATH is only
      //     `/usr/bin:/bin` and would not find `pi`.
      //   * `mkdir -p` makes the log dir self-healing for users with only
      //     a project vault (no `~/.llm-wiki/` yet).
      //   * All `$HOME` references are double-quoted to survive paths with spaces.
      //   * `# llm-wiki-autoupdate` tags the line so the user can find and
      //     remove it via `crontab -e` later (see `interval=stop`).
      const cronLine = `${config.cron} /bin/bash -lc 'mkdir -p "$HOME/.llm-wiki" && pi -p "/wiki-run" >> "$HOME/.llm-wiki/cron.log" 2>&1' # llm-wiki-autoupdate`;

      return {
        content: [
          {
            type: "text",
            text: [
              `⏰ To set up ${config.label} wiki updates, add this line to your crontab.`,
              "**This tool only prints the line — it does not install it.**",
              "",
              "```bash",
              "crontab -e",
              "```",
              "",
              "Then append:",
              "",
              "```cron",
              cronLine,
              "```",
              "",
              `The line uses \`/bin/bash -lc\` so your shell profile (and the \`pi\` binary on npm-global / bun PATH) is loaded. Output goes to \`~/.llm-wiki/cron.log\`. If your system has no \`/bin/bash\`, replace with \`/bin/sh -c\` and ensure \`pi\` is in cron's PATH yourself.`,
            ].join("\n"),
          },
        ],
        details: {
          interval: params.interval,
          cronSchedule: config.cron,
          label: config.label,
          cronLine,
          installed: false,
        } as Record<string, unknown>,
      };
    },
  });
}
