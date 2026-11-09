using System.Runtime.InteropServices;
using ContextTabManager.NativeHost.Application;
using ContextTabManager.NativeHost.Platform.Windows;

namespace ContextTabManager.NativeHost.Platform;

public static class DesktopServiceFactory
{
    public static IDesktopService Create()
    {
        if (OperatingSystem.IsWindows())
        {
            return new WindowsDesktopService();
        }

        var platform = OperatingSystem.IsMacOS()
            ? "macos"
            : OperatingSystem.IsLinux()
                ? "linux"
                : RuntimeInformation.OSDescription;

        return new UnsupportedDesktopService(platform);
    }
}
