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

function sendNative(command: string): Promise<NativeHostResponse> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(
      NATIVE_HOST_NAME,
      { command },
      (response: NativeHostResponse | undefined) => {
        const runtimeError = chrome.runtime.lastError;

        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }

        if (!response) {
          reject(new Error("Desktop companion returned no response"));
          return;
        }

        resolve(response);
      }
    );
  });
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
