import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { scheduleReindex } from "./indexing.js";
import { BundleMutationError, readBundleRevision } from "./okf-mutation.js";
import { executePiWriteOperation } from "./pi-write-adapter.js";
import type { Runtime } from "./runtime.js";
import { type VaultPaths, resolveVaultPaths } from "./utils.js";

// ─── Public API ────────────────────────────────────────

export interface RetroResult {
  slug: string;
  sourcePagePath: string;
  revision: number;
}

/**
 * Save an atomic insight as a reader-visible Retrospective Concept.
 *
 * Unlike wiki_capture_source, this lightweight path does not claim ownership
 * of raw evidence or create a Source Concept.
 */
export async function saveInsight(
  paths: VaultPaths,
  slug: string,
  title: string,
  body: string,
  category?: string,
  opts?: {
    mutationId?: string;
    expectedRevision?: number;
    committedAt?: string;
  },
): Promise<RetroResult> {
  const mutationId = opts?.mutationId ?? `retro-${randomUUID()}`;
  let expectedRevision = opts?.expectedRevision;
  if (expectedRevision === undefined) {
    try {
      expectedRevision = await readBundleRevision(paths.root);
    } catch (error) {
      if (!(error instanceof BundleMutationError) || error.code !== "bundle-not-initialized") {
        throw error;
      }
      const initialized = await executePiWriteOperation(paths.root, {
        kind: "initialize",
        mutationId: `${mutationId}-initialize`,
        expectedRevision: 0,
        committedAt: opts?.committedAt,
      });
      expectedRevision = initialized.revision;
    }
  }
  const result = await executePiWriteOperation(paths.root, {
    kind: "retrospective",
    mutationId,
    expectedRevision,
    committedAt: opts?.committedAt,
    slug,
    title,
    insight: body,
    category,
  });
  return {
    slug,
    sourcePagePath: join(paths.wiki, result.conceptPath!),
    revision: result.revision,
  };
}

// ─── Tool Registration ──────────────────────────────────

/**
 * Register the `wiki_retro` tool.
 * The model calls this to save an atomic insight from a completed task.
 * Inspired by the memex_retro pattern.
 */
export function registerWikiRetro(pi: ExtensionAPI, runtime?: Runtime): void {
  pi.registerTool({
    name: "wiki_retro",
    label: "Wiki Retro",
    description:
      "Save an atomic insight from a completed task into the wiki. " +
      "Creates a reader-visible Retrospective Concept. The insight will be " +
      "surfaced automatically by wiki_recall in future sessions.",
    promptSnippet: "Save atomic insights from completed tasks into the wiki",
    promptGuidelines: [
      "Use wiki_retro at the END of every meaningful task to save what you learned.",
      "Write atomic insights — one insight per call. Use multiple calls for multiple insights.",
      "The insight will be auto-surfaced by wiki_recall in future sessions.",
    ],
    parameters: Type.Object({
      slug: Type.String({
        description:
          "Unique kebab-case identifier (e.g. 'jwt-revocation-pattern'). Used for lookups.",
      }),
      title: Type.String({
        description: "Short descriptive title (60 chars max). Noun phrase, not a sentence.",
      }),
      body: Type.String({
        description:
          "Markdown body with [[wikilinks]] to related wiki pages. Explain what was learned.",
      }),
      category: Type.Optional(
        Type.String({
          description: "Optional category (e.g. frontend, architecture, devops, bugfix, design)",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const paths = resolveVaultPaths(ctx.cwd ?? process.cwd());

      if (!existsSync(join(paths.dotWiki, "config.json"))) {
        return {
          content: [
            {
              type: "text",
              text: "No wiki vault found at this location. Initialize one with wiki_bootstrap first.",
            },
          ],
          details: { error: "no_vault" } as Record<string, unknown>,
          isError: true,
        };
      }

      const result = await saveInsight(
        paths,
        params.slug,
        params.title,
        params.body,
        params.category,
        { mutationId: _toolCallId },
      );
      if (runtime) {
        scheduleReindex(runtime, { hasUI: ctx.hasUI, ui: ctx.ui }, paths);
      }

      return {
        content: [
          {
            type: "text",
            text: [
              `🧠 **Insight saved**: ${params.title}`,
              "",
              `- Page: \`${result.sourcePagePath}\``,
              "",
              "This insight will be auto-surfaced by wiki_recall in future sessions.",
            ].join("\n"),
          },
        ],
        details: {
          slug: params.slug,
          title: params.title,
          category: params.category || null,
        } as Record<string, unknown>,
      };
    },
  });
}
