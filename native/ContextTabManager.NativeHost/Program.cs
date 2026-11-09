using ContextTabManager.NativeHost.Application;
using ContextTabManager.NativeHost.Platform;
using ContextTabManager.NativeHost.Protocol;

var desktopService = DesktopServiceFactory.Create();
var dispatcher = new DesktopCommandDispatcher(desktopService);
var transport = new NativeMessagingTransport(
    Console.OpenStandardInput(),
    Console.OpenStandardOutput());

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
        break;
    }

    if (request is null)
    {
        break;
    }

    NativeResponse response;

    try
    {
        response = await dispatcher.DispatchAsync(
            request,
            CancellationToken.None);
    }
    catch (Exception exception)
    {
        Console.Error.WriteLine($"Native command failed: {exception}");
        response = NativeResponse.Failure(
            request.Command,
            exception.Message);
    }

    try
    {
        await transport.WriteAsync(response, CancellationToken.None);
    }
    catch (Exception exception)
    {
        Console.Error.WriteLine($"Failed to write native response: {exception}");
        break;
    }
}
