import type { DesktopCompanionStatus } from "../domain/desktop";
import {
  createDiagnosticRequestId,
  diagnosticError,
  diagnosticInfo,
  diagnosticWarn
} from "./diagnostics";

const NATIVE_HOST_NAME = "com.gnogueira.context_tab_manager";

interface NativeHostStatus {
  hostVersion: string;
  protocolVersion: number;
  platform: string;
  canPrepareDesktopForFocus: boolean;
}

interface NativeHostResponse {
  ok: boolean;
  command: string;
  requestId?: string;
  status?: NativeHostStatus;
  error?: string;
}

async function sendNative(
  command: string,
  requestId = createDiagnosticRequestId(),
  timeoutMs = 5000
): Promise<NativeHostResponse> {
  const startedAt = performance.now();
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;

  diagnosticInfo("native-client", "send:start", {
    requestId,
    command,
    host: NATIVE_HOST_NAME,
    timeoutMs
  });

  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      const error = new Error(
        `Desktop companion timed out after ${timeoutMs}ms while running ${command}`
      );

      diagnosticError(
        "native-client",
        "send:timeout",
        error,
        {
          requestId,
          command,
          elapsedMs: Math.round(performance.now() - startedAt)
        }
      );

      reject(error);
    }, timeoutMs);
  });

  try {
    const nativeRequest = chrome.runtime.sendNativeMessage(
      NATIVE_HOST_NAME,
      { command, requestId }
    ) as Promise<NativeHostResponse>;

    diagnosticInfo("native-client", "send:dispatched", {
      requestId,
      command
    });

    const response = await Promise.race([nativeRequest, timeout]);

    if (!response) {
      throw new Error("Desktop companion returned no response");
    }

    if (response.requestId && response.requestId !== requestId) {
      diagnosticWarn("native-client", "send:correlation-mismatch", {
        requestId,
        responseRequestId: response.requestId,
        command
      });
    }

    diagnosticInfo("native-client", "send:completed", {
      requestId,
      responseRequestId: response.requestId,
      command,
      ok: response.ok,
      elapsedMs: Math.round(performance.now() - startedAt)
    });

    return response;
  } catch (error) {
    diagnosticError(
      "native-client",
      "send:failed",
      error,
      {
        requestId,
        command,
        elapsedMs: Math.round(performance.now() - startedAt)
      }
    );

    throw error;
  } finally {
    if (timeoutId !== undefined) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

export async function getDesktopCompanionStatus(
  requestId = createDiagnosticRequestId()
): Promise<DesktopCompanionStatus> {
  diagnosticInfo("native-client", "status:start", { requestId });

  try {
    const response = await sendNative("getStatus", requestId);

    if (!response.ok || !response.status) {
      diagnosticWarn("native-client", "status:invalid-response", {
        requestId,
        ok: response.ok,
        hasStatus: Boolean(response.status),
        error: response.error
      });

      return {
        available: true,
        healthy: false,
        canPrepareDesktopForFocus: false,
        reason: response.error ?? "Desktop companion did not report status"
      };
    }

    diagnosticInfo("native-client", "status:healthy", {
      requestId,
      platform: response.status.platform,
      hostVersion: response.status.hostVersion,
      protocolVersion: response.status.protocolVersion,
      canPrepareDesktopForFocus:
        response.status.canPrepareDesktopForFocus
    });

    return {
      available: true,
      healthy: true,
      platform: response.status.platform,
      hostVersion: response.status.hostVersion,
      protocolVersion: response.status.protocolVersion,
      canPrepareDesktopForFocus:
        response.status.canPrepareDesktopForFocus
    };
  } catch (error) {
    diagnosticError("native-client", "status:unavailable", error, {
      requestId
    });

    return {
      available: false,
      healthy: false,
      canPrepareDesktopForFocus: false,
      reason:
        error instanceof Error
          ? error.message
          : "Desktop companion is unavailable"
    };
  }
}

export async function prepareDesktopForFocus(
  requestId = createDiagnosticRequestId()
): Promise<void> {
  let response: NativeHostResponse;

  diagnosticInfo("native-client", "focus:start", { requestId });

  try {
    response = await sendNative("prepareDesktopForFocus", requestId);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Desktop companion is unavailable";

    throw new Error(
      `Desktop Focus requires the native companion. ${reason}`
    );
  }

  if (!response.ok) {
    throw new Error(
      response.error ?? "Desktop companion could not prepare the desktop for focus"
    );
  }
}
