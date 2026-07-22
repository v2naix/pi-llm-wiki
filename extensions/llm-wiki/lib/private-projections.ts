import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, readlink, rename, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Embedder, EmbeddingStore } from "./embeddings.js";
import { buildEmbeddingText, contentHash, normalizeVector } from "./embeddings.js";
import {
  type Backlinks,
  type Registry,
  type RegistryEntry,
  buildIndexMarkdown,
  buildLogMarkdown,
} from "./metadata.js";
import { readKnowledgeBundle } from "./okf-reader.js";
import type { VaultPaths } from "./utils.js";

const FORMAT = 1;
const inflight = new Map<string, Promise<PrivateProjectionResult>>();

export interface ProjectionSource {
  bundleRevision: number | null;
  contentIdentity: string;
}

export interface PrivateProjectionManifest {
  format: 1;
  generation: string;
  source: ProjectionSource;
  createdAt: string;
  embeddingModel: string | null;
  files: readonly ["registry.json", "backlinks.json", "embeddings.json", "index.md", "log.md"];
}

export interface PrivateProjectionSnapshot {
  manifest: PrivateProjectionManifest;
  registry: Registry;
  backlinks: Backlinks;
  embeddings: EmbeddingStore;
  directory: string;
}

export interface PrivateProjectionResult {
  status: "published" | "no-op";
  effect: "private-only";
  generation: string;
  source: ProjectionSource;
}

export class PrivateProjectionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PrivateProjectionError";
  }
}

export interface RebuildPrivateProjectionOptions {
  embedder?: Embedder;
  force?: boolean;
}

interface CurrentPointer {
  format: 1;
  generation: string;
}

function projectionRoot(paths: VaultPaths): string {
  return join(paths.meta, "projections");
}

function currentPath(paths: VaultPaths): string {
  return join(projectionRoot(paths), "current.json");
}

function generationDirectory(paths: VaultPaths, generation: string): string {
  return join(projectionRoot(paths), "generations", generation);
}

/** Hash every externally observable bundle entry, independent of private state and mtimes. */
export function canonicalContentIdentitySync(bundleRoot: string): string {
  const hash = createHash("sha256");
  if (!existsSync(bundleRoot)) return `sha256:${hash.digest("hex")}`;

  const visit = (directory: string): void => {
    for (const name of readdirSync(directory).sort((a, b) => a.localeCompare(b))) {
      const absolute = join(directory, name);
      const path = relative(bundleRoot, absolute).split("\\").join("/");
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        hash.update(`L\0${path}\0${readlinkSync(absolute)}\0`);
      } else if (stat.isDirectory()) {
        // Empty directory structure is not canonical bundle content; only entries with bytes count.
        visit(absolute);
      } else if (stat.isFile()) {
        hash.update(`F\0${path}\0`);
        hash.update(readFileSync(absolute));
        hash.update("\0");
      }
    }
  };
  visit(bundleRoot);
  return `sha256:${hash.digest("hex")}`;
}

async function canonicalContentIdentity(bundleRoot: string): Promise<string> {
  const hash = createHash("sha256");
  const visit = async (directory: string): Promise<void> => {
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const name of names.sort((a, b) => a.localeCompare(b))) {
      const absolute = join(directory, name);
      const path = relative(bundleRoot, absolute).split("\\").join("/");
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) {
        hash.update(`L\0${path}\0${await readlink(absolute)}\0`);
      } else if (stat.isDirectory()) {
        await visit(absolute);
      } else if (stat.isFile()) {
        hash.update(`F\0${path}\0`);
        hash.update(await readFile(absolute));
        hash.update("\0");
      }
    }
  };
  await visit(bundleRoot);
  return `sha256:${hash.digest("hex")}`;
}

function controlledRevision(paths: VaultPaths): number | null {
  const statePath = join(paths.meta, "native-okf", "state.json");
  if (!existsSync(statePath)) return null;
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8")) as { revision?: unknown };
    return typeof state.revision === "number" && Number.isSafeInteger(state.revision)
      ? state.revision
      : null;
  } catch {
    return null;
  }
}

async function controlledRevisionAsync(paths: VaultPaths): Promise<number | null> {
  try {
    const state = JSON.parse(
      await readFile(join(paths.meta, "native-okf", "state.json"), "utf8"),
    ) as { revision?: unknown };
    return typeof state.revision === "number" && Number.isSafeInteger(state.revision)
      ? state.revision
      : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

function sourceIdentity(paths: VaultPaths): ProjectionSource {
  return {
    bundleRevision: controlledRevision(paths),
    contentIdentity: canonicalContentIdentitySync(paths.wiki),
  };
}

async function sourceIdentityAsync(paths: VaultPaths): Promise<ProjectionSource> {
  const [bundleRevision, contentIdentity] = await Promise.all([
    controlledRevisionAsync(paths),
    canonicalContentIdentity(paths.wiki),
  ]);
  return { bundleRevision, contentIdentity };
}

function sameSource(a: ProjectionSource, b: ProjectionSource): boolean {
  return a.bundleRevision === b.bundleRevision && a.contentIdentity === b.contentIdentity;
}

function currentPointerSync(paths: VaultPaths): CurrentPointer | undefined {
  try {
    const pointer = JSON.parse(readFileSync(currentPath(paths), "utf8")) as CurrentPointer;
    if (pointer.format !== FORMAT || !pointer.generation) return undefined;
    return pointer;
  } catch {
    return undefined;
  }
}

function readGenerationSync(
  paths: VaultPaths,
  pointer: CurrentPointer,
): PrivateProjectionSnapshot | undefined {
  const directory = generationDirectory(paths, pointer.generation);
  try {
    const manifest = JSON.parse(
      readFileSync(join(directory, "manifest.json"), "utf8"),
    ) as PrivateProjectionManifest;
    if (manifest.format !== FORMAT || manifest.generation !== pointer.generation) return undefined;
    return {
      manifest,
      registry: JSON.parse(readFileSync(join(directory, "registry.json"), "utf8")) as Registry,
      backlinks: JSON.parse(readFileSync(join(directory, "backlinks.json"), "utf8")) as Backlinks,
      embeddings: JSON.parse(
        readFileSync(join(directory, "embeddings.json"), "utf8"),
      ) as EmbeddingStore,
      directory,
    };
  } catch {
    return undefined;
  }
}

/** Read one immutable complete generation selected by the atomic current pointer. */
export async function readPrivateProjection(
  paths: VaultPaths,
): Promise<PrivateProjectionSnapshot | undefined> {
  return readPrivateProjectionSync(paths);
}

export function readPrivateProjectionSync(
  paths: VaultPaths,
): PrivateProjectionSnapshot | undefined {
  const pointer = currentPointerSync(paths);
  return pointer ? readGenerationSync(paths, pointer) : undefined;
}

/** Select a projection only when its complete generation matches current canonical bytes. */
export function readFreshPrivateProjectionSync(
  paths: VaultPaths,
): PrivateProjectionSnapshot | undefined {
  const snapshot = readPrivateProjectionSync(paths);
  return snapshot && sameSource(snapshot.manifest.source, sourceIdentity(paths))
    ? snapshot
    : undefined;
}

export function privateProjectionFreshSync(paths: VaultPaths): boolean {
  return readFreshPrivateProjectionSync(paths) !== undefined;
}

function metadataString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function buildRegistryAndBacklinks(paths: VaultPaths): Promise<{
  registry: Registry;
  backlinks: Backlinks;
  texts: Array<{ id: string; text: string }>;
}> {
  const bundle = await readKnowledgeBundle(paths.wiki);
  const pages: Record<string, RegistryEntry> = {};
  const texts: Array<{ id: string; text: string }> = [];

  for (const concept of bundle.concepts) {
    if (!concept.metadata) continue;
    const type = metadataString(concept.metadata, "type");
    const title = metadataString(concept.metadata, "title");
    if (!type || !title) continue;
    const stored = { ...concept.metadata } as Record<string, unknown>;
    pages[concept.id] = stored as RegistryEntry;
    texts.push({ id: concept.id, text: buildEmbeddingText(concept.id, stored, concept.body) });
  }

  const backlinks: Backlinks = {};
  for (const id of Object.keys(pages).sort((a, b) => a.localeCompare(b))) backlinks[id] = [];
  for (const relationship of bundle.relationships) {
    if (!backlinks[relationship.target] || !pages[relationship.source]) continue;
    backlinks[relationship.target].push(relationship.source);
  }
  for (const sources of Object.values(backlinks)) sources.sort((a, b) => a.localeCompare(b));

  const registry: Registry = {
    version: "2.0",
    last_updated: "",
    pages: Object.fromEntries(Object.entries(pages).sort(([a], [b]) => a.localeCompare(b))),
  };
  return { registry, backlinks, texts };
}

async function buildEmbeddings(
  texts: Array<{ id: string; text: string }>,
  source: ProjectionSource,
  embedder: Embedder | undefined,
): Promise<EmbeddingStore> {
  const store: EmbeddingStore = {
    version: "2.0",
    sourceContentIdentity: source.contentIdentity,
    sourceBundleRevision: source.bundleRevision,
    entries: {},
  };
  if (!embedder || texts.length === 0) return store;

  const vectors = await embedder.embed(texts.map(({ text }) => text));
  const updated = new Date().toISOString();
  texts.forEach(({ id, text }, index) => {
    const vector = normalizeVector(vectors[index] ?? []);
    store.entries[id] = {
      hash: contentHash(text),
      model: embedder.model,
      dim: vector.length,
      vector,
      updated,
    };
  });
  return store;
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  const json = JSON.stringify(
    value,
    (_key, item) => (typeof item === "bigint" ? item.toString() : item),
    2,
  );
  await writeFile(path, `${json}\n`, "utf8");
}

async function mirrorLegacyFiles(paths: VaultPaths, directory: string): Promise<void> {
  for (const file of ["registry.json", "backlinks.json", "embeddings.json", "index.md", "log.md"]) {
    const bytes = await readFile(join(directory, file));
    const temporary = join(paths.meta, `.${file}.${randomUUID()}.tmp`);
    await writeFile(temporary, bytes);
    await rename(temporary, join(paths.meta, file));
  }
}

async function rebuild(
  paths: VaultPaths,
  options: RebuildPrivateProjectionOptions,
): Promise<PrivateProjectionResult> {
  await mkdir(join(projectionRoot(paths), "generations"), { recursive: true });
  const source = await sourceIdentityAsync(paths);
  const current = readPrivateProjectionSync(paths);
  if (
    !options.force &&
    current &&
    sameSource(current.manifest.source, source) &&
    current.manifest.embeddingModel === (options.embedder?.model ?? null)
  ) {
    return {
      status: "no-op",
      effect: "private-only",
      generation: current.manifest.generation,
      source,
    };
  }

  const { registry, backlinks, texts } = await buildRegistryAndBacklinks(paths);
  const embeddings = await buildEmbeddings(texts, source, options.embedder);
  if (!sameSource(source, await sourceIdentityAsync(paths))) {
    throw new PrivateProjectionError(
      "canonical-source-changed",
      "Canonical bundle bytes changed while the private projection was being built.",
    );
  }

  const generation = randomUUID();
  const finalDirectory = generationDirectory(paths, generation);
  const temporaryDirectory = `${finalDirectory}.tmp`;
  const createdAt = new Date().toISOString();
  registry.last_updated = createdAt;
  const manifest: PrivateProjectionManifest = {
    format: FORMAT,
    generation,
    source,
    createdAt,
    embeddingModel: options.embedder?.model ?? null,
    files: ["registry.json", "backlinks.json", "embeddings.json", "index.md", "log.md"],
  };

  await mkdir(temporaryDirectory, { recursive: true });
  try {
    await Promise.all([
      writeJsonFile(join(temporaryDirectory, "manifest.json"), manifest),
      writeJsonFile(join(temporaryDirectory, "registry.json"), registry),
      writeJsonFile(join(temporaryDirectory, "backlinks.json"), backlinks),
      writeJsonFile(join(temporaryDirectory, "embeddings.json"), embeddings),
      writeFile(join(temporaryDirectory, "index.md"), buildIndexMarkdown(registry), "utf8"),
      writeFile(join(temporaryDirectory, "log.md"), buildLogMarkdown(paths), "utf8"),
    ]);
    await rename(temporaryDirectory, finalDirectory);

    const pointerTemporary = join(projectionRoot(paths), `.current.${generation}.tmp`);
    await writeJsonFile(pointerTemporary, { format: FORMAT, generation });
    await rename(pointerTemporary, currentPath(paths));
    // Compatibility mirrors are not consumed by coherent readers; the pointer above is publication.
    // Their best-effort refresh cannot turn an already published generation into a failed operation.
    await mirrorLegacyFiles(paths, finalDirectory).catch(() => undefined);
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }

  return { status: "published", effect: "private-only", generation, source };
}

/** Single-flight, idempotent private-only derivation of all Concept projections. */
export function rebuildPrivateProjections(
  paths: VaultPaths,
  options: RebuildPrivateProjectionOptions = {},
): Promise<PrivateProjectionResult> {
  const active = inflight.get(paths.root);
  if (active) return active;
  const operation = rebuild(paths, options).finally(() => {
    if (inflight.get(paths.root) === operation) inflight.delete(paths.root);
  });
  inflight.set(paths.root, operation);
  return operation;
}

export function __resetPrivateProjectionState(): void {
  inflight.clear();
}
