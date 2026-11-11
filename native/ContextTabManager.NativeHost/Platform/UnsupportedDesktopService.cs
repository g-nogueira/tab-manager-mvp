using ContextTabManager.NativeHost.Application;

namespace ContextTabManager.NativeHost.Platform;

public sealed class UnsupportedDesktopService(string platform)
    : IDesktopService
{
    public DesktopCapabilities GetCapabilities() =>
        new(
            platform,
            CanPrepareDesktopForFocus: false,
            CanEnumerateDesktopWindows: false);

    public Task<IReadOnlyList<DesktopWindowCandidate>> GetWindowCandidatesAsync(
        CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<DesktopWindowCandidate>>([]);

    public Task<PrepareDesktopForFocusResult> PrepareForFocusAsync(
        IReadOnlyList<DesktopWindowMatcher> matchers,
        CancellationToken cancellationToken) =>
        throw new NotSupportedException(
            $"Desktop Focus is not supported on {platform}.");
}
