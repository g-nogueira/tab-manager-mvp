namespace ContextTabManager.NativeHost.Application;

public sealed record DesktopCapabilities(
    string Platform,
    bool CanPrepareDesktopForFocus,
    bool CanEnumerateDesktopWindows);

public sealed record DesktopCompanionStatus(
    string HostVersion,
    int ProtocolVersion,
    string Platform,
    bool CanPrepareDesktopForFocus,
    bool CanEnumerateDesktopWindows);

public sealed record DesktopWindowMatcher(
    string ProcessName,
    string? ExecutablePath,
    string TitleHint);

public sealed record DesktopWindowCandidate(
    string ApplicationName,
    string ProcessName,
    string? ExecutablePath,
    string Title,
    DesktopWindowMatcher Matcher);

public sealed record ListDesktopWindowsResult(
    IReadOnlyList<DesktopWindowCandidate> Windows);

public sealed record PrepareDesktopForFocusResult(
    int WindowsConsidered,
    int WindowsMinimized,
    int DesktopWindowsMatched,
    int DesktopWindowsRestored,
    int DesktopMatchersUnresolved);

public interface IDesktopService
{
    DesktopCapabilities GetCapabilities();

    Task<IReadOnlyList<DesktopWindowCandidate>> GetWindowCandidatesAsync(
        CancellationToken cancellationToken);

    Task<PrepareDesktopForFocusResult> PrepareForFocusAsync(
        IReadOnlyList<DesktopWindowMatcher> matchers,
        CancellationToken cancellationToken);
}
