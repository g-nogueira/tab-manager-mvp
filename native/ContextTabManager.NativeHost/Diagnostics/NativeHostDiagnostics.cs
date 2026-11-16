namespace ContextTabManager.NativeHost.Diagnostics;

public static class NativeHostDiagnostics
{
    private static readonly object Gate = new();

    public static string LogDirectory =>
        Path.Combine(
            Environment.GetFolderPath(
                Environment.SpecialFolder.LocalApplicationData),
            "ContextTabManager",
            "NativeHost",
            "logs");

    public static string LogPath =>
        Path.Combine(LogDirectory, "native-host.log");

    public static void Info(
        string message,
        string? requestId = null)
    {
        Write("INFO", message, requestId);
    }

    public static void Error(
        string message,
        Exception? exception = null,
        string? requestId = null)
    {
        var suffix = exception is null
            ? string.Empty
            : $" | {exception.GetType().Name}: {exception.Message}";

        Write("ERROR", message + suffix, requestId);
    }

    private static void Write(
        string level,
        string message,
        string? requestId)
    {
        try
        {
            Directory.CreateDirectory(LogDirectory);

            var timestamp = DateTimeOffset.UtcNow.ToString("O");
            var correlation = string.IsNullOrWhiteSpace(requestId)
                ? string.Empty
                : $" [{requestId}]";

            var line =
                $"{timestamp} {level} [pid:{Environment.ProcessId}]{correlation} {message}{Environment.NewLine}";

            lock (Gate)
            {
                File.AppendAllText(LogPath, line);
            }
        }
        catch
        {
            // Diagnostics must never break Native Messaging.
        }
    }
}
