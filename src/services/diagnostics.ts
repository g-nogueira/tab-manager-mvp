type DiagnosticDetails = Record<string, unknown>;

function prefix(scope: string, event: string): string {
  return `[ContextTabManager][${scope}] ${event}`;
}

export function diagnosticInfo(
  scope: string,
  event: string,
  details?: DiagnosticDetails
): void {
  if (details) {
    console.info(prefix(scope, event), details);
    return;
  }

  console.info(prefix(scope, event));
}

export function diagnosticWarn(
  scope: string,
  event: string,
  details?: DiagnosticDetails
): void {
  if (details) {
    console.warn(prefix(scope, event), details);
    return;
  }

  console.warn(prefix(scope, event));
}

export function diagnosticError(
  scope: string,
  event: string,
  error: unknown,
  details?: DiagnosticDetails
): void {
  console.error(prefix(scope, event), {
    ...details,
    error: error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : String(error)
  });
}

export function createDiagnosticRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}
