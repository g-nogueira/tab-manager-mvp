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
