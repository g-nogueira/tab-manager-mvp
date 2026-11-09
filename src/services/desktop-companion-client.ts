import type { DesktopCompanionStatus } from "../domain/desktop";

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
  status?: NativeHostStatus;
  error?: string;
}

async function sendNative(
  command: string,
  timeoutMs = 5000
): Promise<NativeHostResponse> {
  let timeoutId: number | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      reject(
        new Error(
          `Desktop companion timed out after ${timeoutMs}ms while running ${command}`
        )
      );
    }, timeoutMs);
  });

  try {
    const nativeRequest = chrome.runtime.sendNativeMessage(
      NATIVE_HOST_NAME,
      { command }
    ) as Promise<NativeHostResponse>;

    const response = await Promise.race([nativeRequest, timeout]);

    if (!response) {
      throw new Error("Desktop companion returned no response");
    }

    return response;
  } finally {
    if (timeoutId !== undefined) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

export async function getDesktopCompanionStatus(): Promise<DesktopCompanionStatus> {
  try {
    const response = await sendNative("getStatus");

    if (!response.ok || !response.status) {
      return {
        available: true,
        healthy: false,
        canPrepareDesktopForFocus: false,
        reason: response.error ?? "Desktop companion did not report status"
      };
    }

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

export async function prepareDesktopForFocus(): Promise<void> {
  let response: NativeHostResponse;

  try {
    response = await sendNative("prepareDesktopForFocus");
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
