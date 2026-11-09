export interface DesktopCompanionStatus {
  available: boolean;
  healthy: boolean;
  canPrepareDesktopForFocus: boolean;
  platform?: string;
  hostVersion?: string;
  protocolVersion?: number;
  reason?: string;
}
