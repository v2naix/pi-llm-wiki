import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  type GeneralConceptType,
  captureRetrospectiveConcept,
  writeGeneralConcept,
} from "./concept-producers.js";
import { captureControlledSource, synthesizeControlledSource } from "./controlled-source.js";
import {
  type BundleMutationResult,
  initializeKnowledgeBundle,
  writeBundleAsset,
} from "./okf-mutation.js";
import {
  type KnowledgeBundleReadResult,
  type ReferenceCompatibilityResult,
  type ValidationResult,
  readKnowledgeBundle,
} from "./okf-reader.js";
import { rebuildPrivateProjections } from "./private-projections.js";
import { getVaultPaths } from "./utils.js";

interface MutationOperation {
  mutationId: string;
  expectedRevision: number;
  committedAt?: string;
}

export type ControlledWriteOperation =
  | ({ kind: "initialize" } & MutationOperation)
  | ({
      kind: "retrospective";
      slug: string;
      title: string;
      insight: string;
      category?: string;
    } & MutationOperation)
  | ({
      kind: "write-concept";
      path: string;
      type: GeneralConceptType;
      title: string;
      description: string;
      body: string;
      metadata?: Parameters<typeof writeGeneralConcept>[0]["metadata"];
    } & MutationOperation)
  | ({
      kind: "capture-source";
      input:
        | { kind: "text"; text: string; title?: string }
        | {
            kind: "file";
            filePath: string;
            title?: string;
            pi: ExtensionAPI;
            signal?: AbortSignal;
          }
        | { kind: "url"; url: string; title?: string; pi: ExtensionAPI; signal?: AbortSignal };
      captureTimestamp?: string;
    } & MutationOperation)
  | ({
      kind: "synthesize-source";
      rawSourceId: string;
      sourceDescription: string;
      summary: string;
      keyTakeaways: string[];
      entities: Array<{ title: string; description: string }>;
      topics: Array<{ title: string; description: string }>;
      quotes?: Array<{ text: string; attribution?: string }>;
    } & MutationOperation)
  | ({ kind: "write-asset"; path: string; content: Uint8Array } & MutationOperation);

export interface ControlledValidationReport {
  okfConformance: ValidationResult;
  nativeContract: ValidationResult;
  referenceCompatibility: ReferenceCompatibilityResult[];
}

export interface ControlledWriteResult {
  status: BundleMutationResult["status"];
  effect: "canonical" | "no-op";
  revision: number;
  mutationId: string;
  changedPaths: string[];
  validation: ControlledValidationReport;
  conceptPath?: string;
  rawSourceId?: string;
  curationState?: "captured" | "synthesized" | "blocked";
}

/**
 * The application-layer boundary shared by every public Controlled Write Adapter.
 * Protocol adapters translate requests only; canonical semantics live here.
 */
export async function executeControlledWriteOperation(
  vaultRoot: string,
  operation: ControlledWriteOperation,
): Promise<ControlledWriteResult> {
  let mutation: BundleMutationResult;
  let source: Pick<ControlledWriteResult, "conceptPath" | "rawSourceId" | "curationState"> = {};

  switch (operation.kind) {
    case "initialize":
      mutation = await initializeKnowledgeBundle({ vaultRoot, ...operation });
      break;
    case "retrospective": {
      const result = await captureRetrospectiveConcept({ vaultRoot, ...operation });
      mutation = result;
      source = { conceptPath: result.conceptPath };
      break;
    }
    case "write-concept":
      mutation = await writeGeneralConcept({ vaultRoot, ...operation });
      source = { conceptPath: operation.path };
      break;
    case "capture-source": {
      const result = await captureControlledSource({ vaultRoot, ...operation });
      mutation = result;
      source = {
        conceptPath: result.conceptPath,
        rawSourceId: result.rawSourceId,
        curationState: result.curationState,
      };
      break;
    }
    case "synthesize-source":
      mutation = await synthesizeControlledSource({ vaultRoot, ...operation });
      break;
    case "write-asset":
      mutation = await writeBundleAsset({ vaultRoot, ...operation });
      break;
  }

  const paths = getVaultPaths(vaultRoot);
  await rebuildPrivateProjections(paths);
  const validation = validationReport(await readKnowledgeBundle(paths.wiki));
  return {
    ...mutation,
    effect: mutation.status === "committed" ? "canonical" : "no-op",
    validation,
    ...source,
  };
}

function validationReport(bundle: KnowledgeBundleReadResult): ControlledValidationReport {
  return {
    okfConformance: bundle.okfConformance,
    nativeContract: bundle.nativeContract,
    referenceCompatibility: bundle.referenceCompatibility,
  };
}

export interface CreateBundleSnapshotRequest {
  vaultRoot: string;
  destination: string;
}

export interface BundleSnapshotResult {
  status: "created";
  source: string;
  destination: string;
  contentIdentity: string;
  fileCount: number;
}

/** Copy the editable bundle root byte-for-byte, without deriving or rewriting content. */
export async function createBundleSnapshot(
  request: CreateBundleSnapshotRequest,
): Promise<BundleSnapshotResult> {
  const source = resolve(request.vaultRoot, ".llm-wiki", "wiki");
  const destination = resolve(request.destination);
  const destinationFromSource = relative(source, destination);
  if (
    destination === source ||
    (!destinationFromSource.startsWith("..") && !isAbsolute(destinationFromSource))
  ) {
    throw new Error(
      "A Bundle Snapshot destination must be outside the Canonical Knowledge Bundle.",
    );
  }
  try {
    await lstat(destination);
    throw new Error("A Bundle Snapshot destination must not already exist.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const before = await snapshotInventory(source);
  await mkdir(resolve(destination, ".."), { recursive: true });
  await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
  const [after, inventory] = await Promise.all([
    snapshotInventory(source),
    snapshotInventory(destination),
  ]);
  if (
    before.contentIdentity !== after.contentIdentity ||
    after.contentIdentity !== inventory.contentIdentity ||
    after.fileCount !== inventory.fileCount
  ) {
    throw new Error("Canonical bytes changed while the Bundle Snapshot was being copied.");
  }
  return {
    status: "created",
    source,
    destination,
    contentIdentity: inventory.contentIdentity,
    fileCount: inventory.fileCount,
  };
}

async function snapshotInventory(
  root: string,
): Promise<{ contentIdentity: string; fileCount: number }> {
  const hash = createHash("sha256");
  let fileCount = 0;
  async function visit(directory: string): Promise<void> {
    for (const name of (await readdir(directory)).sort((a, b) => a.localeCompare(b, "en"))) {
      const absolute = join(directory, name);
      const stat = await lstat(absolute);
      if (stat.isDirectory()) {
        await visit(absolute);
      } else if (stat.isFile()) {
        const path = relative(root, absolute).replaceAll("\\", "/");
        const bytes = await readFile(absolute);
        hash.update(`${path.length}:${path}:${bytes.byteLength}:`);
        hash.update(bytes);
        fileCount += 1;
      } else {
        throw new Error("Bundle Snapshots support regular files and directories only.");
      }
    }
  }
  await visit(root);
  return { contentIdentity: `sha256:${hash.digest("hex")}`, fileCount };
}
