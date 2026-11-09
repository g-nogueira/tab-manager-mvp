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
                status: GetStatus()),

            "getCapabilities" => NativeResponse.Success(
                request.Command,
                capabilities: desktopService.GetCapabilities()),

            "prepareDesktopForFocus" => await PrepareDesktopForFocusAsync(
                request.Command,
                cancellationToken),

            _ => NativeResponse.Failure(
                request.Command,
                $"Unsupported command: {request.Command}")
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
            ProtocolVersion: 1,
            capabilities.Platform,
            capabilities.CanPrepareDesktopForFocus);
    }

    private async Task<NativeResponse> PrepareDesktopForFocusAsync(
        string command,
        CancellationToken cancellationToken)
    {
        var capabilities = desktopService.GetCapabilities();

        if (!capabilities.CanPrepareDesktopForFocus)
        {
            return NativeResponse.Failure(
                command,
                $"Desktop Focus is not supported on {capabilities.Platform}.");
        }

        var result = await desktopService.PrepareForFocusAsync(
            cancellationToken);

        return NativeResponse.Success(command, result: result);
    }
}
