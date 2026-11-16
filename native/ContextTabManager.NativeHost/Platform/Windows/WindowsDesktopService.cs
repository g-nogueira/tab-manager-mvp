using System.Runtime.InteropServices;
using System.Text;
using ContextTabManager.NativeHost.Application;

namespace ContextTabManager.NativeHost.Platform.Windows;

public sealed class WindowsDesktopService : IDesktopService
{
    private const int SwMinimize = 6;
    private const int GwlExStyle = -20;
    private const uint GwOwner = 4;

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

    public DesktopCapabilities GetCapabilities() =>
        new("windows", CanPrepareDesktopForFocus: true);

    public Task<PrepareDesktopForFocusResult> PrepareForFocusAsync(
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var currentProcessId = (uint)Environment.ProcessId;
        var shellWindow = GetShellWindow();
        var considered = 0;
        var minimized = 0;

        EnumWindows(
            (windowHandle, _) =>
            {
                if (cancellationToken.IsCancellationRequested)
                {
                    return false;
                }

                if (!ShouldMinimize(
                        windowHandle,
                        shellWindow,
                        currentProcessId))
                {
                    return true;
                }

                considered += 1;

                if (IsIconic(windowHandle))
                {
                    return true;
                }

                if (ShowWindowAsync(windowHandle, SwMinimize))
                {
                    minimized += 1;
                }

                return true;
            },
            IntPtr.Zero);

        cancellationToken.ThrowIfCancellationRequested();

        return Task.FromResult(
            new PrepareDesktopForFocusResult(considered, minimized));
    }

    private static bool ShouldMinimize(
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

        if (processId == currentProcessId)
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
        var isExplicitAppWindow = (extendedStyle & WsExAppWindow) != 0;

        return owner == IntPtr.Zero || isExplicitAppWindow;
    }

    private static string GetWindowClassName(IntPtr windowHandle)
    {
        var builder = new StringBuilder(256);
        _ = GetClassName(windowHandle, builder, builder.Capacity);
        return builder.ToString();
    }

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
}
