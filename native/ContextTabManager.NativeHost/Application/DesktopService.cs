namespace ContextTabManager.NativeHost.Application;

public sealed record DesktopCapabilities(
    string Platform,
    bool CanPrepareDesktopForFocus);

public sealed record DesktopCompanionStatus(
    string HostVersion,
    int ProtocolVersion,
    string Platform,
    bool CanPrepareDesktopForFocus);

public sealed record PrepareDesktopForFocusResult(
    int WindowsConsidered,
    int WindowsMinimized);

public interface IDesktopService
{
    DesktopCapabilities GetCapabilities();

    Task<PrepareDesktopForFocusResult> PrepareForFocusAsync(
        CancellationToken cancellationToken);
}
