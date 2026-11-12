using ContextTabManager.NativeHost.Protocol;

namespace ContextTabManager.NativeHost.Application;

public sealed class DesktopCommandDispatcher(IDesktopService desktopService)
{
    public async Task<NativeResponse> DispatchAsync(
        NativeCommandRequest request,
        CancellationToken cancellationToken)
    {
        return request.Command switch
        {
            "getStatus" => NativeResponse.Success(
                request.Command,
                request.RequestId,
                status: GetStatus()),

            "getCapabilities" => NativeResponse.Success(
                request.Command,
                request.RequestId,
                capabilities: desktopService.GetCapabilities()),

            "listDesktopWindows" => await ListDesktopWindowsAsync(
                request.Command,
                request.RequestId,
                cancellationToken),

            "prepareDesktopForFocus" => await PrepareDesktopForFocusAsync(
                request.Command,
                request.RequestId,
                request.Matchers ?? [],
                cancellationToken),

            _ => NativeResponse.Failure(
                request.Command,
                $"Unsupported command: {request.Command}",
                request.RequestId)
        };
    }

    private DesktopCompanionStatus GetStatus()
    {
        var capabilities = desktopService.GetCapabilities();
        var version =
            typeof(DesktopCommandDispatcher).Assembly
                .GetName()
                .Version?
                .ToString(3)
            ?? "unknown";

        return new DesktopCompanionStatus(
            version,
            ProtocolVersion: 2,
            capabilities.Platform,
            capabilities.CanPrepareDesktopForFocus,
            capabilities.CanEnumerateDesktopWindows);
    }

    private async Task<NativeResponse> ListDesktopWindowsAsync(
        string command,
        string? requestId,
        CancellationToken cancellationToken)
    {
        var capabilities = desktopService.GetCapabilities();

        if (!capabilities.CanEnumerateDesktopWindows)
        {
            return NativeResponse.Failure(
                command,
                $"Desktop window discovery is not supported on {capabilities.Platform}.",
                requestId);
        }

        var windows = await desktopService.GetWindowCandidatesAsync(
            cancellationToken);

        return NativeResponse.Success(
            command,
            requestId,
            result: new ListDesktopWindowsResult(windows));
    }

    private async Task<NativeResponse> PrepareDesktopForFocusAsync(
        string command,
        string? requestId,
        IReadOnlyList<DesktopWindowMatcher> matchers,
        CancellationToken cancellationToken)
    {
        var capabilities = desktopService.GetCapabilities();

        if (!capabilities.CanPrepareDesktopForFocus)
        {
            return NativeResponse.Failure(
                command,
                $"Desktop Focus is not supported on {capabilities.Platform}.",
                requestId);
        }

        var result = await desktopService.PrepareForFocusAsync(
            matchers,
            cancellationToken);

        return NativeResponse.Success(
            command,
            requestId,
            result: result);
    }
}
