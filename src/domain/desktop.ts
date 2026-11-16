import type { DesktopWindowMatcher } from "./context";

export interface DesktopCompanionStatus {
  available: boolean;
  healthy: boolean;
  canPrepareDesktopForFocus: boolean;
  canEnumerateDesktopWindows?: boolean;
  platform?: string;
  hostVersion?: string;
  protocolVersion?: number;
  reason?: string;
}

export interface DesktopWindowCandidate {
  applicationName: string;
  processName: string;
  executablePath?: string;
  title: string;
  matcher: DesktopWindowMatcher;
}
