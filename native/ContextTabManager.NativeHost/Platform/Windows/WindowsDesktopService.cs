using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using ContextTabManager.NativeHost.Application;

namespace ContextTabManager.NativeHost.Platform.Windows;

public sealed class WindowsDesktopService : IDesktopService
{
    private const int SwMinimize = 6;
    private const int SwRestore = 9;
    private const int GwlExStyle = -20;
    private const uint GwOwner = 4;
    private const int MinimumMatcherScore = 65;

    private const long WsExToolWindow = 0x00000080L;
    private const long WsExAppWindow = 0x00040000L;
    private const long WsExNoActivate = 0x08000000L;

    private static readonly HashSet<string> IgnoredWindowClasses =
    [
        "Progman",
        "WorkerW",
        "Shell_TrayWnd",
        "Shell_SecondaryTrayWnd"
    ];

    private static readonly HashSet<string> BrowserProcessNames =
        new(StringComparer.OrdinalIgnoreCase)
        {
            "chrome",
            "firefox",
            "msedge",
            "brave",
            "vivaldi",
            "opera"
        };

    public DesktopCapabilities GetCapabilities() =>
        new(
            "windows",
            CanPrepareDesktopForFocus: true,
            CanEnumerateDesktopWindows: true);

    public Task<IReadOnlyList<DesktopWindowCandidate>> GetWindowCandidatesAsync(
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var windows = EnumerateUserWindows(
                cancellationToken)
            .Where(window =>
                !string.IsNullOrWhiteSpace(window.Title) &&
                !BrowserProcessNames.Contains(window.ProcessName))
            .OrderBy(window => window.ApplicationName)
            .ThenBy(window => window.Title)
            .Select(window =>
                new DesktopWindowCandidate(
                    window.ApplicationName,
                    window.ProcessName,
                    window.ExecutablePath,
                    window.Title,
                    new DesktopWindowMatcher(
                        window.ProcessName,
                        window.ExecutablePath,
                        window.Title)))
            .ToArray();

        return Task.FromResult<IReadOnlyList<DesktopWindowCandidate>>(
            windows);
    }

    public Task<PrepareDesktopForFocusResult> PrepareForFocusAsync(
        IReadOnlyList<DesktopWindowMatcher> matchers,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var windows = EnumerateUserWindows(cancellationToken);
        var matchedHandles = new HashSet<IntPtr>();
        var unresolved = 0;

        foreach (var matcher in matchers)
        {
            var best = windows
                .Where(window => !matchedHandles.Contains(window.Handle))
                .Select(window => new
                {
                    Window = window,
                    Score = ScoreMatcher(matcher, window)
                })
                .Where(match => match.Score >= MinimumMatcherScore)
                .OrderByDescending(match => match.Score)
                .FirstOrDefault();

            if (best is null)
            {
                unresolved += 1;
                continue;
            }

            matchedHandles.Add(best.Window.Handle);
        }

        var minimized = 0;
        var restored = 0;

        foreach (var window in windows)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (matchedHandles.Contains(window.Handle))
            {
                if (
                    window.IsMinimized &&
                    ShowWindowAsync(window.Handle, SwRestore))
                {
                    restored += 1;
                }

                continue;
            }

            if (
                !window.IsMinimized &&
                ShowWindowAsync(window.Handle, SwMinimize))
            {
                minimized += 1;
            }
        }

        return Task.FromResult(
            new PrepareDesktopForFocusResult(
                WindowsConsidered: windows.Count,
                WindowsMinimized: minimized,
                DesktopWindowsMatched: matchedHandles.Count,
                DesktopWindowsRestored: restored,
                DesktopMatchersUnresolved: unresolved));
    }

    private static List<WindowSnapshot> EnumerateUserWindows(
        CancellationToken cancellationToken)
    {
        var currentProcessId = (uint)Environment.ProcessId;
        var shellWindow = GetShellWindow();
        var windows = new List<WindowSnapshot>();

        EnumWindows(
            (windowHandle, _) =>
            {
                if (cancellationToken.IsCancellationRequested)
                {
                    return false;
                }

                if (!ShouldManageWindow(
                        windowHandle,
                        shellWindow,
                        currentProcessId))
                {
                    return true;
                }

                GetWindowThreadProcessId(
                    windowHandle,
                    out var processId);

                var processInfo = GetProcessInfo(processId);

                windows.Add(
                    new WindowSnapshot(
                        windowHandle,
                        processInfo.ProcessName,
                        processInfo.ExecutablePath,
                        processInfo.ApplicationName,
                        GetWindowTitle(windowHandle),
                        IsIconic(windowHandle)));

                return true;
            },
            IntPtr.Zero);

        cancellationToken.ThrowIfCancellationRequested();
        return windows;
    }

    private static int ScoreMatcher(
        DesktopWindowMatcher matcher,
        WindowSnapshot window)
    {
        if (
            !string.Equals(
                matcher.ProcessName,
                window.ProcessName,
                StringComparison.OrdinalIgnoreCase))
        {
            return -1;
        }

        var score = 40;

        if (
            !string.IsNullOrWhiteSpace(matcher.ExecutablePath) &&
            !string.IsNullOrWhiteSpace(window.ExecutablePath) &&
            string.Equals(
                matcher.ExecutablePath,
                window.ExecutablePath,
                StringComparison.OrdinalIgnoreCase))
        {
            score += 20;
        }

        var expectedTitle = NormalizeTitle(matcher.TitleHint);
        var actualTitle = NormalizeTitle(window.Title);

        if (
            expectedTitle.Length == 0 ||
            actualTitle.Length == 0)
        {
            return score;
        }

        if (expectedTitle == actualTitle)
        {
            return score + 100;
        }

        if (
            expectedTitle.Contains(actualTitle, StringComparison.Ordinal) ||
            actualTitle.Contains(expectedTitle, StringComparison.Ordinal))
        {
            return score + 70;
        }

        var expectedTokens = Tokenize(expectedTitle);
        var actualTokens = Tokenize(actualTitle);

        if (
            expectedTokens.Count == 0 ||
            actualTokens.Count == 0)
        {
            return score;
        }

        var intersection = expectedTokens.Intersect(actualTokens).Count();
        var union = expectedTokens.Union(actualTokens).Count();
        var similarity = union == 0
            ? 0
            : (double)intersection / union;

        return score + (int)Math.Round(similarity * 60);
    }

    private static string NormalizeTitle(string value)
    {
        var builder = new StringBuilder(value.Length);
        var previousWasSpace = false;

        foreach (var character in value.ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(character))
            {
                builder.Append(character);
                previousWasSpace = false;
                continue;
            }

            if (!previousWasSpace)
            {
                builder.Append(' ');
                previousWasSpace = true;
            }
        }

        return builder.ToString().Trim();
    }

    private static HashSet<string> Tokenize(string value) =>
        value
            .Split(
                ' ',
                StringSplitOptions.RemoveEmptyEntries |
                StringSplitOptions.TrimEntries)
            .Where(token => token.Length >= 2)
            .ToHashSet(StringComparer.Ordinal);

    private static bool ShouldManageWindow(
        IntPtr windowHandle,
        IntPtr shellWindow,
        uint currentProcessId)
    {
        if (
            windowHandle == IntPtr.Zero ||
            windowHandle == shellWindow ||
            !IsWindowVisible(windowHandle))
        {
            return false;
        }

        _ = GetWindowThreadProcessId(windowHandle, out var processId);

        if (
            processId == 0 ||
            processId == currentProcessId)
        {
            return false;
        }

        var className = GetWindowClassName(windowHandle);

        if (IgnoredWindowClasses.Contains(className))
        {
            return false;
        }

        var extendedStyle = GetWindowLongPtr(
            windowHandle,
            GwlExStyle).ToInt64();

        if (
            (extendedStyle & WsExToolWindow) != 0 ||
            (extendedStyle & WsExNoActivate) != 0)
        {
            return false;
        }

        var owner = GetWindow(windowHandle, GwOwner);
        var isExplicitAppWindow =
            (extendedStyle & WsExAppWindow) != 0;

        return owner == IntPtr.Zero || isExplicitAppWindow;
    }

    private static ProcessInfo GetProcessInfo(uint processId)
    {
        try
        {
            using var process = Process.GetProcessById((int)processId);
            var processName = process.ProcessName;
            string? executablePath = null;
            string? applicationName = null;

            try
            {
                executablePath = process.MainModule?.FileName;

                if (!string.IsNullOrWhiteSpace(executablePath))
                {
                    applicationName =
                        FileVersionInfo
                            .GetVersionInfo(executablePath)
                            .FileDescription;
                }
            }
            catch
            {
                // Some elevated/system processes do not expose module details.
            }

            return new ProcessInfo(
                processName,
                executablePath,
                string.IsNullOrWhiteSpace(applicationName)
                    ? processName
                    : applicationName);
        }
        catch
        {
            return new ProcessInfo(
                string.Empty,
                null,
                "Application");
        }
    }

    private static string GetWindowTitle(IntPtr windowHandle)
    {
        var length = GetWindowTextLength(windowHandle);

        if (length <= 0)
        {
            return string.Empty;
        }

        var builder = new StringBuilder(length + 1);
        _ = GetWindowText(
            windowHandle,
            builder,
            builder.Capacity);

        return builder.ToString();
    }

    private static string GetWindowClassName(IntPtr windowHandle)
    {
        var builder = new StringBuilder(256);
        _ = GetClassName(
            windowHandle,
            builder,
            builder.Capacity);

        return builder.ToString();
    }

    private sealed record WindowSnapshot(
        IntPtr Handle,
        string ProcessName,
        string? ExecutablePath,
        string ApplicationName,
        string Title,
        bool IsMinimized);

    private sealed record ProcessInfo(
        string ProcessName,
        string? ExecutablePath,
        string ApplicationName);

    private delegate bool EnumWindowsProc(
        IntPtr windowHandle,
        IntPtr parameter);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(
        EnumWindowsProc callback,
        IntPtr parameter);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr windowHandle);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsIconic(IntPtr windowHandle);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindowAsync(
        IntPtr windowHandle,
        int command);

    [DllImport("user32.dll")]
    private static extern IntPtr GetShellWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(
        IntPtr windowHandle,
        out uint processId);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr(
        IntPtr windowHandle,
        int index);

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(
        IntPtr windowHandle,
        uint command);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(
        IntPtr windowHandle,
        StringBuilder className,
        int maxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLength(
        IntPtr windowHandle);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(
        IntPtr windowHandle,
        StringBuilder text,
        int maxCount);
}
