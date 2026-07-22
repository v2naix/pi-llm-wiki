import { posix } from "node:path";
import {
  BundleMutationError,
  type BundleMutationResult,
  initializeKnowledgeBundle,
  readBundleRevision,
  writeConcept,
} from "./okf-mutation.js";
import type { YamlValue } from "./okf-reader.js";

export type GeneralConceptType =
  | "entity"
  | "concept"
  | "synthesis"
  | "analysis"
  | "requirement"
  | "skill"
  | "case";

interface ProducerMutation {
  vaultRoot: string;
  mutationId: string;
  expectedRevision: number;
  committedAt?: string;
}

export interface WriteGeneralConceptRequest extends ProducerMutation {
  path: string;
  type: GeneralConceptType;
  title: string;
  description: string;
  body: string;
  metadata?: Record<string, YamlValue>;
}

export interface CaptureObservationConceptRequest extends ProducerMutation {
  title: string;
  content: string;
  relevance: "low" | "medium" | "high" | "critical";
  tags?: string[];
  sourceContext?: string;
}

export interface CaptureRetrospectiveConceptRequest extends ProducerMutation {
  slug: string;
  title: string;
  insight: string;
  category?: string;
}

export interface WriteRequirementConceptRequest extends ProducerMutation {
  slug: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  dependencies: string[];
  traceability: string[];
  acceptanceCriteria: string[];
  implementationNotes?: string;
  metadata?: Record<string, YamlValue>;
}

export interface WriteTrajectoryDerivedConceptRequest extends ProducerMutation {
  kind: "skill" | "case";
  slug: string;
  title: string;
  description: string;
  body: string;
  trajectoryIds: string[];
  metadata?: Record<string, YamlValue>;
}

/** Resolve a producer precondition, initializing only a genuinely absent native bundle. */
export async function resolveProducerRevision(
  vaultRoot: string,
  mutationId: string,
  committedAt?: string,
): Promise<number> {
  try {
    return await readBundleRevision(vaultRoot);
  } catch (error) {
    if (!(error instanceof BundleMutationError) || error.code !== "bundle-not-initialized") {
      throw error;
    }
    await initializeKnowledgeBundle({
      vaultRoot,
      mutationId: `${mutationId}-initialize`,
      expectedRevision: 0,
      committedAt,
    });
    return 1;
  }
}

/** Shared producer boundary for every reader-visible non-Source workflow. */
export async function writeGeneralConcept(
  request: WriteGeneralConceptRequest,
): Promise<BundleMutationResult> {
  validateProducerPath(request.path, request.type);
  return writeConcept({
    ...request,
    body: canonicalizeInternalLinks(request.path, request.body),
  });
}

/** Lightweight captures are knowledge notes, not project-owned Source Concepts. */
export async function captureObservationConcept(
  request: CaptureObservationConceptRequest,
): Promise<BundleMutationResult & { slug: string; conceptPath: string }> {
  requireText("observation title", request.title);
  requireText("observation content", request.content);
  const slug = `obs-${request.committedAt?.slice(0, 10) ?? utcNow().slice(0, 10)}-${slugify(request.title)}`;
  if (slug.endsWith("-")) {
    throw new BundleMutationError("invalid-observation", "Observation title must produce a slug.");
  }
  const conceptPath = `observations/${slug}.md`;
  const context = request.sourceContext?.trim();
  const body = [
    "## Observation",
    "",
    request.content.trim(),
    "",
    "## Capture context",
    "",
    `- **Relevance:** ${request.relevance}`,
    ...(context ? [`- **Context:** ${context}`] : []),
    ...(request.tags?.length ? [`- **Tags:** ${request.tags.join(", ")}`] : []),
    "",
  ].join("\n");
  const result = await writeConcept({
    ...request,
    path: conceptPath,
    type: "observation",
    title: `Observation: ${request.title.trim()}`,
    description: summarize(request.content),
    body: canonicalizeInternalLinks(conceptPath, body),
    metadata: {
      llm_wiki_knowledge_kind: "observation",
      relevance: request.relevance,
      ...(request.tags?.length ? { tags: request.tags } : {}),
      ...(context ? { source_context: context } : {}),
    },
  });
  return { ...result, slug, conceptPath };
}

export async function captureRetrospectiveConcept(
  request: CaptureRetrospectiveConceptRequest,
): Promise<BundleMutationResult & { slug: string; conceptPath: string }> {
  requireText("retrospective slug", request.slug);
  requireText("retrospective title", request.title);
  requireText("retrospective insight", request.insight);
  const slug = safeSlug(request.slug);
  const conceptPath = `retrospectives/${slug}.md`;
  const category = request.category?.trim();
  const result = await writeConcept({
    ...request,
    path: conceptPath,
    type: "retrospective",
    title: request.title.trim(),
    description: summarize(request.insight),
    body: canonicalizeInternalLinks(
      conceptPath,
      `## Insight\n\n${request.insight.trim()}\n${category ? `\n## Category\n\n${category}\n` : ""}`,
    ),
    metadata: {
      llm_wiki_knowledge_kind: "retrospective",
      ...(category ? { category } : {}),
    },
  });
  return { ...result, slug, conceptPath };
}

export async function writeRequirementConcept(
  request: WriteRequirementConceptRequest,
): Promise<BundleMutationResult> {
  for (const [field, value] of [
    ["requirement status", request.status],
    ["requirement priority", request.priority],
  ] as const) {
    requireText(field, value);
  }
  const path = `requirements/${safeSlug(request.slug)}.md`;
  const dependencies = request.dependencies.map(normalizeConceptId);
  const traceability = request.traceability.map((item) => item.trim()).filter(Boolean);
  const criteria = request.acceptanceCriteria.map((item) => item.trim()).filter(Boolean);
  const body = [
    "## Description",
    "",
    request.description.trim(),
    "",
    "## Acceptance Criteria",
    "",
    ...(criteria.length ? criteria.map((item) => `- [ ] ${item}`) : ["_None recorded._"]),
    "",
    "## Dependencies",
    "",
    ...(dependencies.length
      ? dependencies.map((id) => `- [${labelFromId(id)}](${relativeConceptLink(path, `${id}.md`)})`)
      : ["_None._"]),
    "",
    "## Traceability",
    "",
    ...(traceability.length ? traceability.map((item) => `- ${item}`) : ["_None recorded._"]),
    ...(request.implementationNotes?.trim()
      ? ["", "## Implementation Notes", "", request.implementationNotes.trim()]
      : []),
    "",
  ].join("\n");
  return writeConcept({
    ...request,
    path,
    type: "requirement",
    title: request.title.trim(),
    description: request.description.trim(),
    body: canonicalizeInternalLinks(path, body),
    metadata: {
      ...request.metadata,
      status: request.status.trim(),
      priority: request.priority.trim(),
      depends_on: dependencies,
      traceability,
    },
  });
}

export async function writeTrajectoryDerivedConcept(
  request: WriteTrajectoryDerivedConceptRequest,
): Promise<BundleMutationResult> {
  if (/\b(?:\.\.\/)*raw\/trajectories\b|\[\[\s*trajectories\//i.test(request.body)) {
    throw new BundleMutationError(
      "private-evidence-link",
      "Reader-visible Concepts must not link to Private Vault trajectory evidence.",
    );
  }
  const trajectoryIds = [...new Set(request.trajectoryIds.map((id) => id.trim()).filter(Boolean))];
  if (trajectoryIds.length === 0) {
    throw new BundleMutationError(
      "trajectory-provenance-required",
      "A trajectory-derived Concept requires disclosure-safe provenance identifiers.",
    );
  }
  const path = `${request.kind === "skill" ? "skills" : "cases"}/${safeSlug(request.slug)}.md`;
  const provenance = [
    "## Provenance",
    "",
    `Derived from private trajectory evidence: ${trajectoryIds.map((id) => `\`${id}\``).join(", ")}.`,
    "Private trajectory evidence remains outside the Canonical Knowledge Bundle.",
    "",
  ].join("\n");
  return writeConcept({
    ...request,
    path,
    type: request.kind,
    title: request.title.trim(),
    description: request.description.trim(),
    body: canonicalizeInternalLinks(path, `${request.body.trim()}\n\n${provenance}`),
    metadata: {
      ...request.metadata,
      llm_wiki_trajectory_ids: trajectoryIds,
    },
  });
}

export function canonicalizeInternalLinks(sourcePath: string, markdown: string): string {
  if (typeof markdown !== "string") {
    throw new BundleMutationError("invalid-concept-body", "Concept body must be a string.");
  }
  return markdown.replace(
    /\[\[([^\]|#]+)(#[^\]|]+)?(?:\|([^\]]+))?\]\]/g,
    (_all, rawId, hash, alias) => {
      const id = normalizeConceptId(String(rawId));
      if (id.startsWith("trajectories/")) {
        throw new BundleMutationError(
          "private-evidence-link",
          "Reader-visible Concepts must not link to Private Vault trajectory evidence.",
        );
      }
      const label = String(alias ?? labelFromId(id))
        .trim()
        .replace(/([\\\[\]])/g, "\\$1");
      return `[${label}](${relativeConceptLink(sourcePath, `${id}.md`)}${hash ?? ""})`;
    },
  );
}

function relativeConceptLink(fromPath: string, toPath: string): string {
  return posix
    .relative(posix.dirname(fromPath), toPath)
    .split("/")
    .map((part) => (part === ".." ? part : encodeURIComponent(part)))
    .join("/");
}

function normalizeConceptId(value: string): string {
  const id = value.trim().replaceAll("\\", "/").replace(/\.md$/, "");
  if (
    !id ||
    id.startsWith("/") ||
    id.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new BundleMutationError(
      "invalid-concept-link",
      "Internal Concept link is not bundle-safe.",
    );
  }
  return id;
}

function validateProducerPath(path: string, type: string): void {
  requireText("Concept type", type);
  normalizeConceptId(path);
  if (!path.endsWith(".md")) {
    throw new BundleMutationError("invalid-concept-path", "Concept path must end in .md.", path);
  }
}

function safeSlug(value: string): string {
  const slug = slugify(value);
  if (!slug) throw new BundleMutationError("invalid-concept-slug", "Concept slug is invalid.");
  return slug;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function summarize(value: string): string {
  const summary = value
    .replace(/^---[\s\S]*?---\s*/, "")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  requireText("Concept description", summary);
  const sentence = summary.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim();
  return (sentence || summary).slice(0, 240);
}

function labelFromId(id: string): string {
  const leaf = id.split("/").at(-1) ?? id;
  return leaf.replace(/-/g, " ");
}

function requireText(field: string, value: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new BundleMutationError("invalid-producer-knowledge", `${field} must be non-empty.`);
  }
}

function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
