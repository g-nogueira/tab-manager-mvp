using ContextTabManager.NativeHost.Application;
using ContextTabManager.NativeHost.Diagnostics;
using ContextTabManager.NativeHost.Platform;
using ContextTabManager.NativeHost.Protocol;

var desktopService = DesktopServiceFactory.Create();
var dispatcher = new DesktopCommandDispatcher(desktopService);
var transport = new NativeMessagingTransport(
    Console.OpenStandardInput(),
    Console.OpenStandardOutput());

NativeHostDiagnostics.Info(
    $"Native host started. Log: {NativeHostDiagnostics.LogPath}");

while (true)
{
    NativeCommandRequest? request;

    try
    {
        request = await transport.ReadAsync(CancellationToken.None);
    }
    catch (Exception exception)
    {
        Console.Error.WriteLine($"Failed to read native message: {exception}");
        NativeHostDiagnostics.Error(
            "Failed to read native message.",
            exception);
        break;
    }

    if (request is null)
    {
        NativeHostDiagnostics.Info(
            "Native Messaging input closed; host is exiting.");
        break;
    }

    NativeHostDiagnostics.Info(
        $"Received command '{request.Command}'.",
        request.RequestId);

    NativeResponse response;

    try
    {
        response = await dispatcher.DispatchAsync(
            request,
            CancellationToken.None);

        NativeHostDiagnostics.Info(
            $"Command '{request.Command}' completed with ok={response.Ok}.",
            request.RequestId);

        if (response.Result is PrepareDesktopForFocusResult focusResult)
        {
            NativeHostDiagnostics.Info(
                $"Focus considered={focusResult.WindowsConsidered}, minimized={focusResult.WindowsMinimized}, matched={focusResult.DesktopWindowsMatched}, restored={focusResult.DesktopWindowsRestored}, unresolved={focusResult.DesktopMatchersUnresolved}.",
                request.RequestId);
        }
        else if (response.Result is ListDesktopWindowsResult listResult)
        {
            NativeHostDiagnostics.Info(
                $"Desktop window discovery returned {listResult.Windows.Count} candidate(s).",
                request.RequestId);
        }
    }
    catch (Exception exception)
    {
        Console.Error.WriteLine($"Native command failed: {exception}");
        NativeHostDiagnostics.Error(
            $"Command '{request.Command}' failed.",
            exception,
            request.RequestId);

        response = NativeResponse.Failure(
            request.Command,
            exception.Message,
            request.RequestId);
    }

    try
    {
        await transport.WriteAsync(response, CancellationToken.None);

        NativeHostDiagnostics.Info(
            $"Response sent for '{request.Command}'.",
            request.RequestId);
    }
    catch (Exception exception)
    {
        Console.Error.WriteLine($"Failed to write native response: {exception}");
        NativeHostDiagnostics.Error(
            $"Failed to write response for '{request.Command}'.",
            exception,
            request.RequestId);
        break;
    }
}
