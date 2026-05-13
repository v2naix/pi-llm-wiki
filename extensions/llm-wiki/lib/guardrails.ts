import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { rebuildMetadataLight } from "./metadata.js";
import { isProtectedPath, resolveVaultPaths } from "./utils.js";

/**
 * Guardrails and auto-rebuild hooks for the LLM Wiki extension.
 */

let pendingRebuild = false;

/** Install guardrails on the extension API. */
export function installGuardrails(pi: ExtensionAPI): void {
  // Block direct edits to raw/ and meta/
  pi.on("tool_call", async (event) => {
    if (isToolCallEventType("write", event)) {
      const path = event.input.path as string;
      const paths = resolveVaultPaths(process.cwd());
      const check = isProtectedPath(path, paths);
      if (check.protected) {
        return { block: true, reason: check.reason };
      }
    }

    if (isToolCallEventType("edit", event)) {
      const path = event.input.path as string;
      const paths = resolveVaultPaths(process.cwd());
      const check = isProtectedPath(path, paths);
      if (check.protected) {
        return { block: true, reason: check.reason };
      }
    }
  });

  // Track wiki edits for auto-rebuild
  pi.on("tool_result", async (event) => {
    if (event.toolName === "write" || event.toolName === "edit") {
      const path = event.input.path as string;
      const paths = resolveVaultPaths(process.cwd());
      const wikiPath = `${paths.wiki}/`;
      if (path?.startsWith(wikiPath)) {
        pendingRebuild = true;
      }
    }
  });

  // Rebuild metadata at end of turn if wiki was modified
  pi.on("turn_end", async (_event) => {
    if (pendingRebuild) {
      pendingRebuild = false;
      try {
        const paths = resolveVaultPaths(process.cwd());
        rebuildMetadataLight(paths);
      } catch {
        // Silently fail — metadata rebuild is best-effort
      }
    }
  });
}
