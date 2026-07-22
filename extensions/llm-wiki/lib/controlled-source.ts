import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, extname, join, posix } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  BundleMutationError,
  type BundleMutationResult,
  deleteConcept,
  mutateKnowledgeBundle,
  readControlledKnowledgeBundle,
  writeConcept,
} from "./okf-mutation.js";
import {
  type ExtractedContent,
  binaryExtractionFailureMessage,
  detectBinaryMagicBytes,
  extractUrlContent,
  fileExtractorFor,
} from "./source-extractors.js";
import { exec, slugify } from "./utils.js";

const RAW_SOURCE_ID_FIELD = "llm_wiki_raw_source_id";
const CAPTURE_TIMESTAMP_FIELD = "llm_wiki_source_capture_timestamp";
const CURATION_STATE_FIELD = "llm_wiki_source_curation_state";
const SOURCE_OPERATIONS = "source-operations";
const URL_ORIGINAL_EXTENSIONS = new Set([".html", ".htm", ".md", ".pdf", ".txt", ".xml", ".json"]);

type CurationState = "captured" | "synthesized" | "blocked";

type CaptureInput =
  | { kind: "text"; text: string; title?: string }
  | { kind: "file"; filePath: string; pi: ExtensionAPI; title?: string; signal?: AbortSignal }
  | { kind: "url"; url: string; pi: ExtensionAPI; title?: string; signal?: AbortSignal };

export interface CaptureControlledSourceRequest {
  vaultRoot: string;
  mutationId: string;
  expectedRevision: number;
  committedAt?: string;
  captureTimestamp?: string;
  input: CaptureInput;
}

export interface ControlledSourceMutationRequest {
  vaultRoot: string;
  mutationId: string;
  expectedRevision: number;
  committedAt?: string;
  rawSourceId: string;
}

export interface CaptureControlledSourceResult extends BundleMutationResult {
  rawSourceId: string;
  conceptPath: string;
  curationState: CurationState;
}

export interface SynthesizeControlledSourceRequest extends ControlledSourceMutationRequest {
  sourceDescription: string;
  summary: string;
  keyTakeaways: string[];
  entities: Array<{ title: string; description: string }>;
  topics: Array<{ title: string; description: string }>;
  quotes?: Array<{ text: string; attribution?: string }>;
}

export interface BlockControlledSourceRequest extends ControlledSourceMutationRequest {
  reason: string;
}

export interface MoveControlledSourceRequest extends ControlledSourceMutationRequest {
  toPath: string;
}

export interface RestoreControlledSourceRequest extends ControlledSourceMutationRequest {
  path: string;
}

interface PacketManifest {
  format: string;
  title: string;
  capture_timestamp: string;
  extraction_status: string;
  extractor: string;
  content_type?: string;
  complete: true;
  extracted_sha256: string;
  original?: { name: string; sha256: string };
  upstream_url?: string;
}

interface CapturingRecovery {
  format: 1;
  intentHash: string;
  phase: "capturing";
  rawSourceId: string;
}

interface EstablishedRecovery {
  format: 1;
  intentHash: string;
  phase: "packet-established" | "committed";
  rawSourceId: string;
  conceptPath: string;
  captureTimestamp: string;
  title: string;
  sourceFormat: string;
  curationState: CurationState;
  resource?: string;
  result?: CaptureControlledSourceResult;
}

type CaptureRecovery = CapturingRecovery | EstablishedRecovery;

interface EstablishedPacket {
  rawSourceId: string;
  manifest: PacketManifest;
}

/**
 * Establish immutable private evidence, then commit its reader-visible Source Concept.
 * A failed second stage is resumed from private recovery state under the same identity.
 */
export async function captureControlledSource(
  request: CaptureControlledSourceRequest,
): Promise<CaptureControlledSourceResult> {
  validateUtc("captureTimestamp", request.captureTimestamp);
  const operationDirectory = join(request.vaultRoot, ".llm-wiki", SOURCE_OPERATIONS);
  await mkdir(operationDirectory, { recursive: true });
  return withPrivateLock(join(operationDirectory, ".lock"), async () => {
    const intentHash = captureIntentHash(request);
    const recoveryPath = join(operationDirectory, `${hash(request.mutationId)}.json`);
    let recovery = await readJson<CaptureRecovery>(recoveryPath);
    if (recovery && recovery.intentHash !== intentHash) {
      throw new BundleMutationError(
        "mutation-identity-conflict",
        "Mutation Identity was already used for a different Source Capture Operation.",
      );
    }
    if (recovery?.phase === "committed" && recovery.result) return recovery.result;

    if (!recovery) {
      recovery = {
        format: 1,
        intentHash,
        phase: "capturing",
        rawSourceId: randomUUID(),
      };
      await atomicWriteJson(recoveryPath, recovery);
    }
    if (recovery.phase === "capturing") {
      let manifest: PacketManifest;
      try {
        manifest = await verifyPacket(request.vaultRoot, recovery.rawSourceId);
      } catch (error) {
        if (
          !(error instanceof BundleMutationError) ||
          error.code !== "incomplete-raw-source-packet"
        ) {
          throw error;
        }
        manifest = (await establishPacket(request, recovery.rawSourceId)).manifest;
      }
      const bundle = await readControlledKnowledgeBundle(request.vaultRoot);
      const base = slugify(manifest.title) || "captured-source";
      const basePath = `sources/${base}.md`;
      const conceptPath = bundle.concepts.some(({ path }) => path === basePath)
        ? `sources/${base}-${recovery.rawSourceId.slice(0, 8)}.md`
        : basePath;
      const resource =
        request.input.kind === "url" ? disclosureSafeResource(request.input.url) : undefined;
      recovery = {
        format: 1,
        intentHash,
        phase: "packet-established",
        rawSourceId: recovery.rawSourceId,
        conceptPath,
        captureTimestamp: manifest.capture_timestamp,
        title: manifest.title,
        sourceFormat: manifest.format,
        curationState: manifest.extraction_status === "success" ? "captured" : "blocked",
        ...(resource ? { resource } : {}),
      };
      await atomicWriteJson(recoveryPath, recovery);
    }

    await verifyPacket(request.vaultRoot, recovery.rawSourceId);
    const description = pendingDescription(recovery.title, recovery.curationState);
    const result = await writeConcept({
      vaultRoot: request.vaultRoot,
      mutationId: request.mutationId,
      expectedRevision: request.expectedRevision,
      committedAt: request.committedAt,
      path: recovery.conceptPath,
      type: "source",
      title: recovery.title,
      description,
      body: sourcePendingBody(recovery),
      metadata: sourceMetadata(recovery),
    });
    const completed: CaptureControlledSourceResult = {
      ...result,
      rawSourceId: recovery.rawSourceId,
      conceptPath: recovery.conceptPath,
      curationState: recovery.curationState,
    };
    recovery.phase = "committed";
    recovery.result = completed;
    await atomicWriteJson(recoveryPath, recovery);
    return completed;
  });
}

/** Commit a grounded source synthesis and all related Concepts as one Bundle Mutation. */
export async function synthesizeControlledSource(
  request: SynthesizeControlledSourceRequest,
): Promise<BundleMutationResult> {
  requireNonEmpty("sourceDescription", request.sourceDescription);
  requireNonEmpty("summary", request.summary);
  for (const value of request.keyTakeaways) requireNonEmpty("keyTakeaway", value);
  for (const item of [...request.entities, ...request.topics]) {
    requireNonEmpty("related title", item.title);
    requireNonEmpty("related description", item.description);
  }
  await verifyPacket(request.vaultRoot, request.rawSourceId);
  const source = await findLiveSource(request.vaultRoot, request.rawSourceId);
  const metadata = source.metadata!;
  const title = String(metadata.title);
  const captureTimestamp = String(metadata[CAPTURE_TIMESTAMP_FIELD]);
  const resource = typeof metadata.resource === "string" ? metadata.resource : undefined;
  const related = [
    ...request.entities.map((item) => ({ ...item, directory: "entities", type: "entity" })),
    ...request.topics.map((item) => ({ ...item, directory: "concepts", type: "concept" })),
  ].map((item) => ({ ...item, path: `${item.directory}/${slugify(item.title)}.md` }));
  if (related.some(({ path }) => path.endsWith("/.md"))) {
    throw new BundleMutationError(
      "invalid-related-concept",
      "Related Concept titles must produce a path.",
    );
  }
  const paths = new Set(related.map(({ path }) => path));
  if (paths.size !== related.length) {
    throw new BundleMutationError(
      "duplicate-related-concept",
      "Synthesis contains colliding related Concept paths.",
    );
  }

  const changes = [
    {
      kind: "write-concept" as const,
      path: source.path,
      type: "source",
      title,
      description: request.sourceDescription.trim(),
      body: synthesizedSourceBody(source.path, title, request, related, captureTimestamp, resource),
      metadata: {
        [RAW_SOURCE_ID_FIELD]: request.rawSourceId,
        [CAPTURE_TIMESTAMP_FIELD]: captureTimestamp,
        [CURATION_STATE_FIELD]: "synthesized",
        ...(resource ? { resource } : {}),
      },
    },
    ...related.map((item) => ({
      kind: "write-concept" as const,
      path: item.path,
      type: item.type,
      title: item.title.trim(),
      description: item.description.trim(),
      body: relatedConceptBody(item.path, item.title, item.description, source.path, title),
    })),
  ];
  return mutateKnowledgeBundle({
    vaultRoot: request.vaultRoot,
    mutationId: request.mutationId,
    expectedRevision: request.expectedRevision,
    committedAt: request.committedAt,
    changes,
  });
}

/** Persist a durable reader-facing intervention state, without runtime vocabulary. */
export async function blockControlledSource(
  request: BlockControlledSourceRequest,
): Promise<BundleMutationResult> {
  requireNonEmpty("reason", request.reason);
  const source = await findLiveSource(request.vaultRoot, request.rawSourceId);
  const metadata = source.metadata!;
  const captureTimestamp = String(metadata[CAPTURE_TIMESTAMP_FIELD]);
  const resource = typeof metadata.resource === "string" ? metadata.resource : undefined;
  return writeConcept({
    vaultRoot: request.vaultRoot,
    mutationId: request.mutationId,
    expectedRevision: request.expectedRevision,
    committedAt: request.committedAt,
    path: source.path,
    type: "source",
    title: String(metadata.title),
    description: `Captured source “${String(metadata.title)}”; curation requires intervention.`,
    body: `${provenanceNotice("blocked", captureTimestamp, resource)}\n\n## Curation intervention\n\n${request.reason.trim()}\n`,
    metadata: {
      [RAW_SOURCE_ID_FIELD]: request.rawSourceId,
      [CAPTURE_TIMESTAMP_FIELD]: captureTimestamp,
      [CURATION_STATE_FIELD]: "blocked",
      ...(resource ? { resource } : {}),
    },
  });
}

export async function moveControlledSource(
  request: MoveControlledSourceRequest,
): Promise<BundleMutationResult> {
  const source = await findLiveSource(request.vaultRoot, request.rawSourceId);
  return mutateKnowledgeBundle({
    vaultRoot: request.vaultRoot,
    mutationId: request.mutationId,
    expectedRevision: request.expectedRevision,
    committedAt: request.committedAt,
    changes: [{ kind: "move-concept", fromPath: source.path, toPath: request.toPath }],
  });
}

export async function deleteControlledSource(
  request: ControlledSourceMutationRequest,
): Promise<BundleMutationResult> {
  const source = await findLiveSource(request.vaultRoot, request.rawSourceId);
  return deleteConcept({
    vaultRoot: request.vaultRoot,
    mutationId: request.mutationId,
    expectedRevision: request.expectedRevision,
    committedAt: request.committedAt,
    path: source.path,
  });
}

/** Explicitly restore the same provenance identity; the packet is never reassigned. */
export async function restoreControlledSource(
  request: RestoreControlledSourceRequest,
): Promise<BundleMutationResult> {
  await verifyPacket(request.vaultRoot, request.rawSourceId);
  const bundle = await readControlledKnowledgeBundle(request.vaultRoot);
  if (
    bundle.concepts.some(({ metadata }) => metadata?.[RAW_SOURCE_ID_FIELD] === request.rawSourceId)
  ) {
    throw new BundleMutationError(
      "source-provenance-conflict",
      "The Raw Source Identifier already has a live Source Concept.",
    );
  }
  const recovery = await findRecoveryByRawSourceId(request.vaultRoot, request.rawSourceId);
  if (!recovery || recovery.phase === "capturing") {
    throw new BundleMutationError(
      "unknown-raw-source-identifier",
      "The Raw Source Identifier is not owned by a completed capture in this vault.",
    );
  }
  return writeConcept({
    vaultRoot: request.vaultRoot,
    mutationId: request.mutationId,
    expectedRevision: request.expectedRevision,
    committedAt: request.committedAt,
    path: request.path,
    type: "source",
    title: recovery.title,
    description: pendingDescription(recovery.title, recovery.curationState),
    body: sourcePendingBody(recovery),
    metadata: sourceMetadata(recovery),
  });
}

async function establishPacket(
  request: CaptureControlledSourceRequest,
  rawSourceId: string,
): Promise<EstablishedPacket> {
  const rawRoot = join(request.vaultRoot, ".llm-wiki", "raw", "sources");
  const stagingRoot = join(request.vaultRoot, ".llm-wiki", "raw", ".source-staging");
  const stage = join(stagingRoot, rawSourceId);
  const target = join(rawRoot, rawSourceId);
  await mkdir(rawRoot, { recursive: true });
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  try {
    const captured = await captureInput(stage, request.input);
    const captureTimestamp = request.captureTimestamp ?? nowUtc();
    const extractedPath = join(stage, "extracted.md");
    await writeFile(extractedPath, captured.content.extracted, { encoding: "utf8", flag: "wx" });
    const manifest: PacketManifest = {
      format: captured.format,
      title: captured.title,
      capture_timestamp: captureTimestamp,
      extraction_status: captured.content.extraction_status ?? "success",
      extractor: captured.content.extractor ?? "passthrough",
      ...(captured.content.content_type ? { content_type: captured.content.content_type } : {}),
      complete: true,
      extracted_sha256: hash(captured.content.extracted),
      ...(captured.original ? { original: captured.original } : {}),
      ...(request.input.kind === "url" ? { upstream_url: request.input.url } : {}),
    };
    await writeFile(join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(stage, target);
    await makePacketReadOnly(target, manifest);
    return { rawSourceId, manifest };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    if (error instanceof BundleMutationError) throw error;
    throw new BundleMutationError(
      "incomplete-raw-source-packet",
      error instanceof Error ? error.message : "Raw Source Packet could not be completed.",
    );
  }
}

async function captureInput(
  stage: string,
  input: CaptureInput,
): Promise<{
  title: string;
  format: string;
  content: ExtractedContent;
  original?: { name: string; sha256: string };
}> {
  if (input.kind === "text") {
    return {
      title: input.title?.trim() || "Pasted text",
      format: "text",
      content: { extracted: input.text, extractor: "passthrough", extraction_status: "success" },
    };
  }
  const originalDirectory = join(stage, "original");
  await mkdir(originalDirectory);
  if (input.kind === "url") {
    const name = originalFileNameForUrl(input.url);
    const originalPath = join(originalDirectory, name);
    await exec(input.pi, "curl", ["-sL", "--max-time", "30", "-o", originalPath, input.url], {
      signal: input.signal,
      timeout: 35_000,
    });
    const originalBytes = await requiredFile(originalPath);
    const content = await extractUrlContent(input.pi, input.url, input.signal);
    const resource = disclosureSafeResource(input.url);
    return {
      title: input.title?.trim() || content.title || resource || "Captured web source",
      format: "web",
      content: normalizeExtracted(
        content,
        "_Content could not be extracted from the captured URL._\n",
      ),
      original: { name, sha256: hash(originalBytes) },
    };
  }

  input.signal?.throwIfAborted();
  const name = basename(input.filePath);
  const originalPath = join(originalDirectory, name);
  await copyFile(input.filePath, originalPath, 1);
  const originalBytes = await requiredFile(originalPath);
  const extractor = fileExtractorFor(input.filePath);
  let content: ExtractedContent;
  if (extractor.format === "file") {
    const binary = await detectBinaryMagicBytes(input.filePath);
    if (binary) {
      content = {
        extracted: binaryExtractionFailureMessage(binary),
        extractor: "magicBytes",
        extraction_status: "unsupported",
      };
    } else {
      const text = await readFile(input.filePath, "utf8");
      const extracted = await extractor.extract({
        pi: input.pi,
        filePath: input.filePath,
        content: text,
        signal: input.signal,
      });
      content = {
        extracted,
        extractor: extractor.extractorName ?? "passthrough",
        extraction_status: "success",
      };
    }
  } else {
    const text = extractor.shouldReadText ? await readFile(input.filePath, "utf8") : "";
    const extracted = await extractor.extract({
      pi: input.pi,
      filePath: input.filePath,
      content: text,
      signal: input.signal,
    });
    content = {
      extracted,
      extractor: extractor.extractorName ?? "passthrough",
      extraction_status: extracted.includes("could not be converted") ? "failed" : "success",
      ...(extractor.content_type ? { content_type: extractor.content_type } : {}),
    };
  }
  return {
    title: input.title?.trim() || name,
    format: extractor.format,
    content: normalizeExtracted(
      content,
      "_Content could not be extracted from the captured file._\n",
    ),
    original: { name, sha256: hash(originalBytes) },
  };
}

function normalizeExtracted(content: ExtractedContent, fallback: string): ExtractedContent {
  return { ...content, extracted: content.extracted || fallback };
}

async function verifyPacket(vaultRoot: string, rawSourceId: string): Promise<PacketManifest> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawSourceId)
  ) {
    throw new BundleMutationError(
      "invalid-raw-source-identifier",
      "Raw Source Identifier is invalid.",
    );
  }
  const packet = join(vaultRoot, ".llm-wiki", "raw", "sources", rawSourceId);
  const manifest = await readJson<PacketManifest>(join(packet, "manifest.json"));
  if (!manifest?.complete) {
    throw new BundleMutationError(
      "incomplete-raw-source-packet",
      "Raw Source Packet is incomplete.",
    );
  }
  const extracted = await readFile(join(packet, "extracted.md"));
  if (hash(extracted) !== manifest.extracted_sha256) {
    throw new BundleMutationError(
      "raw-source-packet-changed",
      "Raw Source Packet evidence changed.",
    );
  }
  if (manifest.original) {
    const original = await readFile(join(packet, "original", manifest.original.name));
    if (hash(original) !== manifest.original.sha256) {
      throw new BundleMutationError(
        "raw-source-packet-changed",
        "Raw Source Packet evidence changed.",
      );
    }
  }
  return manifest;
}

async function findLiveSource(vaultRoot: string, rawSourceId: string) {
  const bundle = await readControlledKnowledgeBundle(vaultRoot);
  const matches = bundle.concepts.filter(
    ({ metadata }) => metadata?.[RAW_SOURCE_ID_FIELD] === rawSourceId,
  );
  if (matches.length !== 1 || !matches[0]?.metadata) {
    throw new BundleMutationError(
      matches.length > 1 ? "source-provenance-conflict" : "source-concept-not-found",
      matches.length > 1
        ? "Raw Source Identifier is associated with multiple live Concepts."
        : "No live Source Concept has this Raw Source Identifier.",
    );
  }
  return matches[0];
}

function sourceMetadata(recovery: EstablishedRecovery) {
  return {
    format: recovery.sourceFormat,
    [RAW_SOURCE_ID_FIELD]: recovery.rawSourceId,
    [CAPTURE_TIMESTAMP_FIELD]: recovery.captureTimestamp,
    [CURATION_STATE_FIELD]: recovery.curationState,
    ...(recovery.resource ? { resource: recovery.resource } : {}),
  };
}

function pendingDescription(title: string, state: CurationState): string {
  return state === "blocked"
    ? `Captured source “${title}”; curation requires intervention.`
    : `Captured source “${title}”; synthesis is pending.`;
}

function sourcePendingBody(recovery: EstablishedRecovery): string {
  const pending =
    recovery.curationState === "blocked"
      ? "Curation requires intervention before a grounded synthesis can be committed."
      : "Synthesis is pending; this entry does not yet summarize the captured evidence.";
  return `${provenanceNotice(recovery.curationState, recovery.captureTimestamp, recovery.resource)}\n\n## Curation\n\n${pending}\n`;
}

function provenanceNotice(state: CurationState, captured: string, resource?: string): string {
  return [
    "## Source provenance",
    "",
    "This editable Source Concept is a catalog entry and synthesis, not the original evidence.",
    "",
    `- **Curation state:** \`${state}\``,
    `- **Captured:** ${captured}`,
    ...(resource ? [`- **Upstream resource:** [${resource}](${resource})`] : []),
    "- **Raw evidence:** The immutable Raw Source Packet remains outside this Canonical Knowledge Bundle.",
  ].join("\n");
}

function synthesizedSourceBody(
  sourcePath: string,
  _title: string,
  request: SynthesizeControlledSourceRequest,
  related: Array<{ path: string; title: string; type: string }>,
  captured: string,
  resource?: string,
): string {
  const takeaways =
    request.keyTakeaways.map((item) => `- ${item.trim()}`).join("\n") || "- None recorded.";
  const entities =
    related
      .filter(({ type }) => type === "entity")
      .map((item) => `- [${escapeLabel(item.title)}](${relativeLink(sourcePath, item.path)})`)
      .join("\n") || "- None recorded.";
  const topics =
    related
      .filter(({ type }) => type === "concept")
      .map((item) => `- [${escapeLabel(item.title)}](${relativeLink(sourcePath, item.path)})`)
      .join("\n") || "- None recorded.";
  const quotes = request.quotes?.length
    ? request.quotes
        .map(
          (quote) =>
            `> ${quote.text.trim()}${quote.attribution ? ` — ${quote.attribution.trim()}` : ""}`,
        )
        .join("\n\n")
    : "> None recorded.";
  const citations = resource ? `\n\n# Citations\n\n1. [Upstream resource](${resource})` : "";
  return `${provenanceNotice("synthesized", captured, resource)}\n\n## Summary\n\n${request.summary.trim()}\n\n## Key takeaways\n\n${takeaways}\n\n## Entities mentioned\n\n${entities}\n\n## Topics mentioned\n\n${topics}\n\n## Notable quotes\n\n${quotes}${citations}\n`;
}

function relatedConceptBody(
  relatedPath: string,
  title: string,
  description: string,
  sourcePath: string,
  sourceTitle: string,
): string {
  const sourceLink = relativeLink(relatedPath, sourcePath);
  return `## Overview\n\n${description.trim()}\n\n## Related source\n\n- [${escapeLabel(sourceTitle)}](${sourceLink})\n\n# Citations\n\n1. [${escapeLabel(sourceTitle)}](${sourceLink})\n`;
}

function relativeLink(fromPath: string, toPath: string): string {
  const relative = posix.relative(posix.dirname(fromPath), toPath);
  return relative.split("/").map(encodeURIComponent).join("/");
}

function disclosureSafeResource(value: string): string | undefined {
  try {
    const uri = new URL(value);
    if (!new Set(["http:", "https:"]).has(uri.protocol)) return undefined;
    if (uri.username || uri.password || uri.search || uri.hash) return undefined;
    const host = uri.hostname.toLowerCase().replace(/\.$/, "");
    if (
      !host ||
      (!host.includes(".") && !host.includes(":")) ||
      host === "localhost" ||
      host.endsWith(".local") ||
      host.endsWith(".internal")
    )
      return undefined;
    if (isPrivateIp(host)) return undefined;
    return uri.toString();
  } catch {
    return undefined;
  }
}

function isPrivateIp(host: string): boolean {
  if (host.includes(":")) {
    const normalized = host.replace(/^\[|\]$/g, "").toLowerCase();
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("::ffff:") ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb") ||
      normalized.startsWith("2001:db8:")
    );
  }
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return false;
  const [a, b] = parts;
  const c = parts[2];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

async function findRecoveryByRawSourceId(vaultRoot: string, rawSourceId: string) {
  const directory = join(vaultRoot, ".llm-wiki", SOURCE_OPERATIONS);
  let names: string[];
  try {
    names = await import("node:fs/promises").then(({ readdir }) => readdir(directory));
  } catch {
    return undefined;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const recovery = await readJson<CaptureRecovery>(join(directory, name));
    if (recovery?.rawSourceId === rawSourceId) return recovery;
  }
  return undefined;
}

function captureIntentHash(request: CaptureControlledSourceRequest): string {
  const input =
    request.input.kind === "text"
      ? { kind: "text", text: request.input.text, title: request.input.title }
      : request.input.kind === "file"
        ? { kind: "file", filePath: request.input.filePath, title: request.input.title }
        : { kind: "url", url: request.input.url, title: request.input.title };
  return hash(
    JSON.stringify({
      mutationId: request.mutationId,
      expectedRevision: request.expectedRevision,
      committedAt: request.committedAt,
      captureTimestamp: request.captureTimestamp,
      input,
    }),
  );
}

async function makePacketReadOnly(packet: string, manifest: PacketManifest): Promise<void> {
  await chmod(join(packet, "extracted.md"), 0o444);
  await chmod(join(packet, "manifest.json"), 0o444);
  if (manifest.original) {
    await chmod(join(packet, "original", manifest.original.name), 0o444);
  }
}

async function requiredFile(path: string): Promise<Buffer> {
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error();
    return await readFile(path);
  } catch {
    throw new BundleMutationError(
      "incomplete-raw-source-packet",
      "The original source artifact was not established.",
    );
  }
}

async function withPrivateLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      handle = await open(path, "wx");
      await handle.writeFile(String(process.pid));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await abandonedLock(path)) {
        await rm(path, { force: true });
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (!handle)
    throw new BundleMutationError("source-operation-busy", "Source operation lock is busy.");
  try {
    return await operation();
  } finally {
    await handle.close();
    await rm(path, { force: true });
  }
}

async function abandonedLock(path: string): Promise<boolean> {
  try {
    const owner = Number.parseInt(await readFile(path, "utf8"), 10);
    if (!Number.isSafeInteger(owner) || owner <= 0 || owner === process.pid) return false;
    try {
      process.kill(owner, 0);
      return false;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH";
    }
  } catch {
    return false;
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function originalFileNameForUrl(value: string): string {
  try {
    const extension = extname(new URL(value).pathname).toLowerCase();
    if (URL_ORIGINAL_EXTENSIONS.has(extension)) return `source${extension}`;
  } catch {}
  return "source.html";
}

function escapeLabel(value: string): string {
  return value.trim().replace(/([\\\[\]])/g, "\\$1");
}

function requireNonEmpty(name: string, value: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new BundleMutationError(
      "invalid-source-knowledge",
      `${name} must be a non-empty string.`,
    );
  }
}

function validateUtc(name: string, value?: string): void {
  if (value !== undefined && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) {
    throw new BundleMutationError(
      "invalid-source-timestamp",
      `${name} must be an ISO 8601 UTC datetime.`,
    );
  }
}

function nowUtc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
