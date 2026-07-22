import type { ControlledWriteOperation, ControlledWriteResult } from "./native-okf-application.js";
import { executeControlledWriteOperation } from "./native-okf-application.js";

/** Pi protocol adapter: request translation only; no canonical writer lives here. */
export function executePiWriteOperation(
  vaultRoot: string,
  operation: ControlledWriteOperation,
): Promise<ControlledWriteResult> {
  return executeControlledWriteOperation(vaultRoot, operation);
}
