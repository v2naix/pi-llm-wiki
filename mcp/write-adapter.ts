import type {
  ControlledWriteOperation,
  ControlledWriteResult,
} from "../extensions/llm-wiki/lib/native-okf-application.js";
import { executeControlledWriteOperation } from "../extensions/llm-wiki/lib/native-okf-application.js";

/** MCP protocol adapter: request translation only; no canonical writer lives here. */
export function executeMcpWriteOperation(
  vaultRoot: string,
  operation: ControlledWriteOperation,
): Promise<ControlledWriteResult> {
  return executeControlledWriteOperation(vaultRoot, operation);
}
