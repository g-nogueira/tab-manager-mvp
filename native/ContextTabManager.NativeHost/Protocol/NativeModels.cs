namespace ContextTabManager.NativeHost.Protocol;

public sealed record NativeCommandRequest(string Command);

public sealed record NativeResponse(
    bool Ok,
    string Command,
    object? Capabilities = null,
    object? Result = null,
    string? Error = null)
{
    public static NativeResponse Success(
        string command,
        object? capabilities = null,
        object? result = null) =>
        new(true, command, capabilities, result);

    public static NativeResponse Failure(
        string command,
        string error) =>
        new(false, command, Error: error);
}
