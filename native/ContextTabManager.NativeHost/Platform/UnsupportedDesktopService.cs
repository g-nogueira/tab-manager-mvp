using ContextTabManager.NativeHost.Application;

namespace ContextTabManager.NativeHost.Platform;

public sealed class UnsupportedDesktopService(string platform)
    : IDesktopService
{
    public DesktopCapabilities GetCapabilities() =>
        new(platform, CanPrepareDesktopForFocus: false);

    public Task<PrepareDesktopForFocusResult> PrepareForFocusAsync(
        CancellationToken cancellationToken) =>
        throw new NotSupportedException(
            $"Desktop Focus is not supported on {platform}.");
}
