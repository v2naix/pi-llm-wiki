import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { BundleMutationError, readBundleRevision } from "./okf-mutation.js";
import { executePiWriteOperation } from "./pi-write-adapter.js";
import type { VaultPaths } from "./utils.js";

export interface CaptureResult {
  sourceId: string;
  packetPath: string;
  sourcePagePath: string;
  extracted: string;
}

/** @deprecated Use the Controlled Write Adapter's capture-source operation. */
export async function captureUrl(
  pi: ExtensionAPI,
  paths: VaultPaths,
  url: string,
  signal?: AbortSignal,
): Promise<CaptureResult> {
  return captureThroughControlledAdapter(paths, {
    kind: "url",
    url,
    pi,
    signal,
  });
}

/** @deprecated Use the Controlled Write Adapter's capture-source operation. */
export async function captureFile(
  pi: ExtensionAPI,
  paths: VaultPaths,
  filePath: string,
  signal?: AbortSignal,
): Promise<CaptureResult> {
  return captureThroughControlledAdapter(paths, {
    kind: "file",
    filePath,
    pi,
    signal,
  });
}

/** @deprecated Use the Controlled Write Adapter's capture-source operation. */
export async function captureText(
  paths: VaultPaths,
  text: string,
  title?: string,
): Promise<CaptureResult> {
  return captureThroughControlledAdapter(paths, { kind: "text", text, title });
}

async function captureThroughControlledAdapter(
  paths: VaultPaths,
  input:
    | { kind: "text"; text: string; title?: string }
    | {
        kind: "file";
        filePath: string;
        title?: string;
        pi: ExtensionAPI;
        signal?: AbortSignal;
      }
    | { kind: "url"; url: string; title?: string; pi: ExtensionAPI; signal?: AbortSignal },
): Promise<CaptureResult> {
  const mutationId = `capture-${randomUUID()}`;
  let expectedRevision: number;
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
    });
    expectedRevision = initialized.revision;
  }
  const result = await executePiWriteOperation(paths.root, {
    kind: "capture-source",
    mutationId,
    expectedRevision,
    input,
  });
  const packetPath = join(paths.rawSources, result.rawSourceId!);
  return {
    sourceId: result.rawSourceId!,
    packetPath,
    sourcePagePath: join(paths.wiki, result.conceptPath!),
    extracted: await readFile(join(packetPath, "extracted.md"), "utf8"),
  };
}
