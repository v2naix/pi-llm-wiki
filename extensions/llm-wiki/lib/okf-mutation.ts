import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  access,
  cp,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { stringify } from "yaml";
import {
  type KnowledgeBundleReadResult,
  type YamlValue,
  readKnowledgeBundle,
} from "./okf-reader.js";

export interface InitializeKnowledgeBundleRequest {
  vaultRoot: string;
  mutationId: string;
  expectedRevision: number;
  committedAt?: string;
}

export interface WriteConceptRequest extends InitializeKnowledgeBundleRequest {
  path: string;
  type: string;
  title: string;
  description: string;
  body: string;
  metadata?: Record<string, YamlValue>;
}

export interface BundleMutationResult {
  status: "committed" | "no-op";
  revision: number;
  mutationId: string;
  changedPaths: string[];
}

export class BundleMutationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly path?: string,
  ) {
    super(message);
    this.name = "BundleMutationError";
  }
}

interface MutationRecord {
  intentHash: string;
  result: BundleMutationResult;
}

interface HistoryEntry {
  date: string;
  text: string;
}

interface MutationState {
  format: 1;
  vaultIdentity: string;
  revision: number;
  mutations: Record<string, MutationRecord>;
  history: HistoryEntry[];
  reservedHashes: Record<string, string>;
  trustedReservedHashes: string[];
}

interface Paths {
  vault: string;
  dotWiki: string;
  wiki: string;
  stateDirectory: string;
  state: string;
  lock: string;
  journal: string;
}

interface Journal {
  phase: "prepared" | "backed-up" | "installed";
  stage: string;
  backup: string;
  targetState: MutationState;
}

const CORE_FIELDS = new Set(["type", "title", "description", "timestamp"]);
const encoder = new TextEncoder();

export async function initializeKnowledgeBundle(
  request: InitializeKnowledgeBundleRequest,
): Promise<BundleMutationResult> {
  return withMutationLock(request.vaultRoot, async (paths) => {
    const committedAt = validateCommitTime(request.committedAt);
    const intentHash = hashRequestIntent("initialize", request);
    const state = await loadState(paths);
    const retry = retryResult(state, request.mutationId, intentHash);
    if (retry) return retry;
    validateMutationIdentity(state, request.mutationId);
    requireRevision(state?.revision ?? 0, request.expectedRevision);

    if (state) {
      const result: BundleMutationResult = {
        status: "no-op",
        revision: state.revision,
        mutationId: request.mutationId,
        changedPaths: [],
      };
      state.mutations[request.mutationId] = { intentHash, result };
      await atomicWriteJson(paths.state, state);
      return result;
    }

    if ((await listFiles(paths.wiki)).length > 0) {
      throw new BundleMutationError(
        "unmanaged-bundle-conflict",
        "Initialization will not replace an existing unmanaged Knowledge Bundle.",
      );
    }

    const baselineHash = await bundleContentHash(paths.wiki);
    const nextState: MutationState = {
      format: 1,
      vaultIdentity: randomUUID(),
      revision: 1,
      mutations: {},
      history: [{ date: committedAt.slice(0, 10), text: "**Initialized** the Knowledge Bundle." }],
      reservedHashes: {},
      trustedReservedHashes: [],
    };
    const result: BundleMutationResult = {
      status: "committed",
      revision: 1,
      mutationId: request.mutationId,
      changedPaths: ["index.md", "log.md"],
    };
    nextState.mutations[request.mutationId] = { intentHash, result };
    return publishMutation(paths, baselineHash, nextState, async (stage) => {
      await mkdir(stage, { recursive: true });
      await materializeReservedDocuments(stage, nextState);
    });
  });
}

export async function writeConcept(request: WriteConceptRequest): Promise<BundleMutationResult> {
  return withMutationLock(request.vaultRoot, async (paths) => {
    const committedAt = validateCommitTime(request.committedAt);
    validateConceptPath(request.path);
    validateRequiredString("type", request.type);
    validateRequiredString("title", request.title);
    validateRequiredString("description", request.description);
    if (typeof request.body !== "string") {
      throw new BundleMutationError("invalid-concept-body", "Concept body must be a string.");
    }
    for (const key of Object.keys(request.metadata ?? {})) {
      if (CORE_FIELDS.has(key)) {
        throw new BundleMutationError(
          "owned-metadata-field",
          `The controlled writer owns the ${key} field.`,
          request.path,
        );
      }
    }

    const intentHash = hashRequestIntent("write-concept", request);
    const state = await requireState(paths);
    const retry = retryResult(state, request.mutationId, intentHash);
    if (retry) return retry;
    validateMutationIdentity(state, request.mutationId);
    requireRevision(state.revision, request.expectedRevision);
    const reservedDrift = await validateReservedPreconditions(paths, state);
    const baselineHash = await bundleContentHash(paths.wiki);

    const current = await readKnowledgeBundle(paths.wiki);
    if (current.nativeContract.status === "fail") {
      const diagnostic = current.nativeContract.diagnostics.find(
        ({ code }) => !code.includes("index") && !code.includes("log"),
      );
      if (diagnostic) {
        throw new BundleMutationError(
          "invalid-bundle-precondition",
          diagnostic.message,
          diagnostic.path,
        );
      }
    }
    if ((await bundleContentHash(paths.wiki)) !== baselineHash) {
      throw new BundleMutationError(
        "external-bundle-conflict",
        "Canonical bytes changed while mutation preconditions were being evaluated.",
      );
    }
    const existing = current.concepts.find(({ path }) => path === request.path);
    const ambiguous = current.concepts.find(
      ({ path }) => path !== request.path && comparablePath(path) === comparablePath(request.path),
    );
    if (ambiguous) {
      throw new BundleMutationError(
        "ambiguous-concept-path",
        `Concept path ambiguously collides with ${ambiguous.path}.`,
        request.path,
      );
    }
    if (existing && !existing.metadata) {
      throw new BundleMutationError(
        "invalid-concept-precondition",
        "Existing Concept metadata cannot be safely preserved.",
        request.path,
      );
    }

    const unowned: Record<string, YamlValue> = {};
    for (const [key, value] of Object.entries(existing?.metadata ?? {})) {
      if (!CORE_FIELDS.has(key)) unowned[key] = value;
    }
    Object.assign(unowned, request.metadata ?? {});
    const proposedWithoutTimestamp = {
      type: request.type,
      title: request.title,
      description: request.description,
      ...unowned,
    };
    const existingWithoutTimestamp = existing?.metadata
      ? Object.fromEntries(Object.entries(existing.metadata).filter(([key]) => key !== "timestamp"))
      : undefined;
    const semanticNoOp =
      existing !== undefined &&
      canonicalValue(existingWithoutTimestamp) === canonicalValue(proposedWithoutTimestamp) &&
      existing.body === request.body;

    if (semanticNoOp && !reservedDrift) {
      const result: BundleMutationResult = {
        status: "no-op",
        revision: state.revision,
        mutationId: request.mutationId,
        changedPaths: [],
      };
      state.mutations[request.mutationId] = { intentHash, result };
      await atomicWriteJson(paths.state, state);
      return result;
    }

    const nextState: MutationState = structuredClone(state);
    nextState.revision += 1;
    nextState.history.push({
      date: committedAt.slice(0, 10),
      text: semanticNoOp
        ? "**Materialized** Reserved Documents."
        : `**${existing ? "Updated" : "Added"}** ${escapeText(request.title)} (${request.path}).`,
    });

    const stage = stagePath(paths, request.mutationId);
    await rm(stage, { recursive: true, force: true });
    await cp(paths.wiki, stage, { recursive: true, errorOnExist: false });
    if (!semanticNoOp) {
      const metadata = { ...proposedWithoutTimestamp, timestamp: committedAt };
      const raw = serializeConcept(metadata, request.body);
      const target = resolve(stage, request.path);
      await assertNoSymbolicLinkTraversal(stage, request.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, raw, "utf8");
    }
    await materializeReservedDocuments(stage, nextState);
    const validation = await readKnowledgeBundle(stage);
    if (validation.nativeContract.status !== "pass") {
      const diagnostic = validation.nativeContract.diagnostics.find(
        ({ severity }) => severity === "error",
      );
      await rm(stage, { recursive: true, force: true });
      throw new BundleMutationError(
        "invalid-mutation-postcondition",
        diagnostic?.message ?? "Staged bundle does not satisfy the Native OKF Contract.",
        diagnostic?.path,
      );
    }

    const changedPaths = await changedFilePaths(paths.wiki, stage);
    const result: BundleMutationResult = {
      status: "committed",
      revision: nextState.revision,
      mutationId: request.mutationId,
      changedPaths,
    };
    nextState.mutations[request.mutationId] = { intentHash, result };
    return installPreparedStage(paths, stage, baselineHash, nextState, result);
  });
}

export async function readControlledKnowledgeBundle(
  vaultRoot: string,
): Promise<KnowledgeBundleReadResult> {
  return withMutationLock(vaultRoot, async (paths) => {
    await requireState(paths);
    return readKnowledgeBundle(paths.wiki);
  });
}

async function withMutationLock<T>(
  vaultRoot: string,
  work: (paths: Paths) => Promise<T>,
): Promise<T> {
  const paths = resolvePaths(vaultRoot);
  await mkdir(paths.stateDirectory, { recursive: true });
  await acquireLock(paths.lock);
  try {
    await recoverTransaction(paths);
    return await work(paths);
  } finally {
    await rm(paths.lock, { recursive: true, force: true });
  }
}

function resolvePaths(vaultRoot: string): Paths {
  const vault = resolve(vaultRoot);
  const dotWiki = join(vault, ".llm-wiki");
  const stateDirectory = join(dotWiki, "meta", "native-okf");
  return {
    vault,
    dotWiki,
    wiki: join(dotWiki, "wiki"),
    stateDirectory,
    state: join(stateDirectory, "state.json"),
    lock: join(stateDirectory, "mutation.lock"),
    journal: join(stateDirectory, "journal.json"),
  };
}

async function acquireLock(lockPath: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      await mkdir(lockPath);
      await writeFile(join(lockPath, "owner"), `${process.pid}\n`, "utf8");
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await lockOwnerIsGone(lockPath)) {
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    }
  }
  throw new BundleMutationError("mutation-lock-timeout", "Another Bundle Mutation is in progress.");
}

async function loadState(paths: Paths): Promise<MutationState | undefined> {
  try {
    return JSON.parse(await readFile(paths.state, "utf8")) as MutationState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new BundleMutationError(
      "mutation-state-invalid",
      "Mutation state cannot be read safely.",
    );
  }
}

async function requireState(paths: Paths): Promise<MutationState> {
  const state = await loadState(paths);
  if (!state) {
    throw new BundleMutationError(
      "bundle-not-initialized",
      "Initialize the native OKF Knowledge Bundle before writing Concepts.",
    );
  }
  return state;
}

function retryResult(
  state: MutationState | undefined,
  mutationId: string,
  intentHash: string,
): BundleMutationResult | undefined {
  const previous = state?.mutations[mutationId];
  if (!previous) return undefined;
  if (previous.intentHash !== intentHash) {
    throw new BundleMutationError(
      "mutation-identity-conflict",
      "Mutation Identity was already used for a different intent.",
    );
  }
  return previous.result;
}

function validateMutationIdentity(state: MutationState | undefined, mutationId: string): void {
  if (typeof mutationId !== "string" || mutationId.trim() === "" || mutationId.length > 200) {
    throw new BundleMutationError("invalid-mutation-identity", "Mutation Identity is invalid.");
  }
  if (state?.mutations[mutationId]) {
    throw new BundleMutationError(
      "mutation-identity-conflict",
      "Mutation Identity is not reusable.",
    );
  }
}

function requireRevision(actual: number, expected: number): void {
  if (!Number.isSafeInteger(expected) || expected < 0 || expected !== actual) {
    throw new BundleMutationError(
      "stale-revision",
      `Expected Bundle Revision ${expected}; current revision is ${actual}.`,
    );
  }
}

function validateCommitTime(value: string | undefined): string {
  const timestamp = value ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(timestamp)) {
    throw new BundleMutationError(
      "invalid-commit-time",
      "Commit time must be an ISO 8601 UTC datetime.",
    );
  }
  const parsed = new Date(timestamp);
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().replace(/\.000Z$/, "Z") !== timestamp
  ) {
    throw new BundleMutationError(
      "invalid-commit-time",
      "Commit time is not a valid UTC datetime.",
    );
  }
  return timestamp;
}

function validateRequiredString(field: string, value: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BundleMutationError("core-field-required", `${field} must be a non-empty string.`);
  }
}

function validateConceptPath(path: string): void {
  const logical = path.replaceAll("\\", "/");
  if (
    path !== logical ||
    isAbsolute(path) ||
    !logical.endsWith(".md") ||
    basename(logical) === "index.md" ||
    basename(logical) === "log.md" ||
    logical.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new BundleMutationError("invalid-concept-path", "Concept path is not bundle-safe.", path);
  }
}

async function assertNoSymbolicLinkTraversal(root: string, logicalPath: string): Promise<void> {
  let current = root;
  for (const part of logicalPath.split("/").slice(0, -1)) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new BundleMutationError(
          "symbolic-link-path",
          "Concept path resolves through a symbolic link.",
          logicalPath,
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function serializeConcept(metadata: Record<string, YamlValue>, body: string): string {
  const yaml = stringify(metadata, { lineWidth: 0, sortMapEntries: true }).trimEnd();
  return `---\n${yaml}\n---\n${body}`;
}

async function materializeReservedDocuments(root: string, state: MutationState): Promise<void> {
  const read = await readKnowledgeBundleForMaterialization(root);
  const indexes = renderIndexes(read.concepts);
  const existingIndexes = (await listFiles(root)).filter((path) => basename(path) === "index.md");
  for (const path of existingIndexes) {
    if (!indexes.has(path)) await rm(resolve(root, path), { force: true });
  }
  for (const [path, content] of indexes) {
    const target = resolve(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFileIfChanged(target, content);
  }
  for (const path of (await listFiles(root)).filter(
    (path) => basename(path) === "log.md" && path !== "log.md",
  )) {
    await rm(resolve(root, path), { force: true });
  }
  await writeFileIfChanged(join(root, "log.md"), renderLog(state.history));
  const generated = [...indexes.keys(), "log.md"].sort();
  state.reservedHashes = {};
  for (const path of generated) {
    const hash = hashBytes(await readFile(resolve(root, path)));
    state.reservedHashes[path] = hash;
    if (!state.trustedReservedHashes.includes(hash)) state.trustedReservedHashes.push(hash);
  }
  state.trustedReservedHashes.sort();
}

async function readKnowledgeBundleForMaterialization(
  root: string,
): Promise<KnowledgeBundleReadResult> {
  try {
    return await readKnowledgeBundle(root, {
      nativeContractApplicable: false,
      referenceOperations: [],
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(root, { recursive: true });
    return readKnowledgeBundle(root, { nativeContractApplicable: false, referenceOperations: [] });
  }
}

function renderIndexes(concepts: KnowledgeBundleReadResult["concepts"]): Map<string, string> {
  const populated = new Set<string>([""]);
  for (const concept of concepts) {
    let directory = dirname(concept.path).replaceAll("\\", "/");
    if (directory === ".") directory = "";
    while (true) {
      populated.add(directory);
      if (!directory) break;
      const parent = dirname(directory).replaceAll("\\", "/");
      directory = parent === "." ? "" : parent;
    }
  }

  const indexes = new Map<string, string>();
  for (const directory of [...populated].sort()) {
    const direct = concepts.filter((concept) => {
      const parent = dirname(concept.path).replaceAll("\\", "/");
      return (parent === "." ? "" : parent) === directory;
    });
    const children = [...populated]
      .filter(
        (candidate) => candidate && dirname(candidate).replaceAll("\\", "/") === (directory || "."),
      )
      .sort();
    const lines: string[] = [];
    if (!directory) {
      lines.push("---", 'okf_version: "0.1"', "---", "", "# Knowledge Bundle");
    }
    const groups = new Map<string, typeof direct>();
    for (const concept of direct) {
      const type = String(concept.metadata?.type ?? "");
      const group = groups.get(type) ?? [];
      group.push(concept);
      groups.set(type, group);
    }
    for (const [type, items] of [...groups].sort(([a], [b]) => a.localeCompare(b, "en"))) {
      lines.push("", `${directory ? "#" : "##"} ${escapeText(type)}`, "");
      for (const concept of items.sort((a, b) => a.id.localeCompare(b.id, "en"))) {
        const link = encodePathComponent(basename(concept.path));
        lines.push(
          `- [${escapeText(String(concept.metadata?.title ?? ""))}](${link}) - ${escapeText(String(concept.metadata?.description ?? ""))}`,
        );
      }
    }
    if (children.length > 0) {
      lines.push("", `${directory ? "#" : "##"} Subdirectories`, "");
      for (const child of children) {
        const name = basename(child);
        lines.push(`- [${escapeText(name)}](${encodePathComponent(name)}/index.md)`);
      }
    }
    lines.push("");
    while (lines[0] === "") lines.shift();
    indexes.set(directory ? `${directory}/index.md` : "index.md", lines.join("\n"));
  }
  return indexes;
}

function renderLog(history: HistoryEntry[]): string {
  const byDate = new Map<string, string[]>();
  for (const entry of history) {
    const entries = byDate.get(entry.date) ?? [];
    entries.push(entry.text);
    byDate.set(entry.date, entries);
  }
  const lines: string[] = [];
  for (const [date, entries] of [...byDate].sort(([a], [b]) => b.localeCompare(a, "en"))) {
    lines.push(`# ${date}`, "", ...entries.map((entry) => `- ${entry}`), "");
  }
  return lines.join("\n");
}

function encodePathComponent(value: string): string {
  return encodeURIComponent(value)
    .replaceAll("'", "%27")
    .replaceAll("(", "%28")
    .replaceAll(")", "%29");
}

function comparablePath(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("en-US");
}

function escapeText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

async function validateReservedPreconditions(paths: Paths, state: MutationState): Promise<boolean> {
  let drift = false;
  const actualReserved = (await listFiles(paths.wiki)).filter((path) => {
    const name = basename(path);
    return name === "index.md" || name === "log.md";
  });
  for (const path of new Set([...actualReserved, ...Object.keys(state.reservedHashes)])) {
    const expected = state.reservedHashes[path];
    let actual: string | undefined;
    try {
      actual = hashBytes(await readFile(resolve(paths.wiki, path)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (actual === expected) continue;
    if (actual === undefined || state.trustedReservedHashes.includes(actual)) {
      drift = true;
      continue;
    }
    throw new BundleMutationError(
      "reserved-document-conflict",
      "Reserved Document contains an unrecognized external edit.",
      path,
    );
  }
  return drift;
}

async function publishMutation(
  paths: Paths,
  baselineHash: string,
  nextState: MutationState,
  prepare: (stage: string) => Promise<void>,
): Promise<BundleMutationResult> {
  const mutation = Object.values(nextState.mutations).at(-1)!;
  const stage = stagePath(paths, mutation.result.mutationId);
  await rm(stage, { recursive: true, force: true });
  await prepare(stage);
  const validation = await readKnowledgeBundle(stage);
  if (validation.nativeContract.status !== "pass") {
    await rm(stage, { recursive: true, force: true });
    throw new BundleMutationError(
      "invalid-mutation-postcondition",
      "Initialized bundle is invalid.",
    );
  }
  return installPreparedStage(paths, stage, baselineHash, nextState, mutation.result);
}

async function installPreparedStage(
  paths: Paths,
  stage: string,
  baselineHash: string,
  nextState: MutationState,
  result: BundleMutationResult,
): Promise<BundleMutationResult> {
  if ((await bundleContentHash(paths.wiki)) !== baselineHash) {
    await rm(stage, { recursive: true, force: true });
    throw new BundleMutationError(
      "external-bundle-conflict",
      "Canonical bytes changed before the Bundle Mutation could be published.",
    );
  }
  const backup = `${paths.wiki}.backup-${hashBytes(encoder.encode(result.mutationId)).slice(0, 12)}`;
  await rm(backup, { recursive: true, force: true });
  const journal: Journal = { phase: "prepared", stage, backup, targetState: nextState };
  await atomicWriteJson(paths.journal, journal);
  if (await exists(paths.wiki)) {
    await rename(paths.wiki, backup);
    journal.phase = "backed-up";
    await atomicWriteJson(paths.journal, journal);
  }
  await rename(stage, paths.wiki);
  journal.phase = "installed";
  await atomicWriteJson(paths.journal, journal);
  await atomicWriteJson(paths.state, nextState);
  await rm(backup, { recursive: true, force: true });
  await rm(paths.journal, { force: true });
  return result;
}

async function recoverTransaction(paths: Paths): Promise<void> {
  let journal: Journal;
  try {
    journal = JSON.parse(await readFile(paths.journal, "utf8")) as Journal;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new BundleMutationError(
      "mutation-journal-invalid",
      "Mutation recovery journal is invalid.",
    );
  }
  if (journal.phase === "prepared") {
    const [wikiExists, stageExists, backupExists] = await Promise.all([
      exists(paths.wiki),
      exists(journal.stage),
      exists(journal.backup),
    ]);
    if (!wikiExists && backupExists) {
      await rename(journal.backup, paths.wiki);
      await rm(journal.stage, { recursive: true, force: true });
    } else if (wikiExists && !stageExists && !backupExists) {
      await atomicWriteJson(paths.state, journal.targetState);
    } else {
      await rm(journal.stage, { recursive: true, force: true });
      await rm(journal.backup, { recursive: true, force: true });
    }
  } else {
    if (journal.phase === "backed-up" && !(await exists(paths.wiki))) {
      await rename(journal.stage, paths.wiki);
    }
    await atomicWriteJson(paths.state, journal.targetState);
    await rm(journal.stage, { recursive: true, force: true });
    await rm(journal.backup, { recursive: true, force: true });
  }
  await rm(paths.journal, { force: true });
}

function stagePath(paths: Paths, mutationId: string): string {
  return join(
    paths.dotWiki,
    `.native-okf-stage-${hashBytes(encoder.encode(mutationId)).slice(0, 12)}`,
  );
}

async function bundleContentHash(root: string): Promise<string> {
  const hash = createHash("sha256");
  for (const path of await listFiles(root)) {
    const absolute = resolve(root, path);
    const stat = await lstat(absolute);
    const bytes = stat.isSymbolicLink()
      ? encoder.encode(`symlink:${await readlink(absolute)}`)
      : await readFile(absolute);
    hash.update(`${encoder.encode(path).byteLength}:${path}:${bytes.byteLength}:`);
    hash.update(bytes);
  }
  return hash.digest("hex");
}

async function changedFilePaths(before: string, after: string): Promise<string[]> {
  const paths = new Set([...(await listFiles(before)), ...(await listFiles(after))]);
  const changed: string[] = [];
  for (const path of paths) {
    const [left, right] = await Promise.all([
      readOptional(resolve(before, path)),
      readOptional(resolve(after, path)),
    ]);
    if (!left || !right || !left.equals(right)) changed.push(path);
  }
  return changed.sort();
}

async function listFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(directory: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const absolute = join(directory, entry.name);
      const logical = relative(root, absolute).split(sep).join("/");
      if (entry.isDirectory()) await walk(absolute);
      else result.push(logical);
    }
  }
  await walk(root);
  return result;
}

async function readOptional(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeFileIfChanged(path: string, content: string): Promise<void> {
  const current = await readOptional(path);
  const next = Buffer.from(content);
  if (!current?.equals(next)) await writeFile(path, next);
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

function canonicalValue(value: unknown): string {
  if (typeof value === "bigint") return `bigint:${value}`;
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalValue(item)}`)
    .join(",")}}`;
}

function hashRequestIntent(
  operation: "initialize" | "write-concept",
  request: InitializeKnowledgeBundleRequest | WriteConceptRequest,
): string {
  const { vaultRoot: _vaultRoot, ...intent } = request;
  return hashIntent({ operation, ...intent });
}

function hashIntent(value: unknown): string {
  return hashBytes(encoder.encode(canonicalValue(value)));
}

function hashBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function lockOwnerIsGone(lockPath: string): Promise<boolean> {
  try {
    const pid = Number.parseInt((await readFile(join(lockPath, "owner"), "utf8")).trim(), 10);
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH";
    }
  } catch {
    try {
      return Date.now() - (await lstat(lockPath)).mtimeMs > 1_000;
    } catch {
      return false;
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
