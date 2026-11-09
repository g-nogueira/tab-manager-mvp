namespace ContextTabManager.NativeHost.Protocol;

public sealed record NativeCommandRequest(
    string Command,
    string? RequestId = null);

public sealed record NativeResponse(
    bool Ok,
    string Command,
    string? RequestId = null,
    object? Capabilities = null,
    object? Status = null,
    object? Result = null,
    string? Error = null)
{
    public static NativeResponse Success(
        string command,
        string? requestId = null,
        object? capabilities = null,
        object? status = null,
        object? result = null) =>
        new(
            true,
            command,
            requestId,
            capabilities,
            status,
            result);

    public static NativeResponse Failure(
        string command,
        string error,
        string? requestId = null) =>
        new(
            false,
            command,
            requestId,
            Error: error);
}
