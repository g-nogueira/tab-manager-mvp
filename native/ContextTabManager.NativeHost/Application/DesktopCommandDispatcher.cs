using ContextTabManager.NativeHost.Protocol;

namespace ContextTabManager.NativeHost.Application;

public sealed class DesktopCommandDispatcher(
    IDesktopService desktopService,
    ContextBackupService backupService)
{
    public async Task<NativeResponse> DispatchAsync(
        NativeCommandRequest request,
        CancellationToken cancellationToken)
    {
        return request.Command switch
        {
            "getStatus" => NativeResponse.Success(
                request.Command,
                request.RequestId,
                status: GetStatus()),

            "getCapabilities" => NativeResponse.Success(
                request.Command,
                request.RequestId,
                capabilities: desktopService.GetCapabilities()),

            "listDesktopWindows" => await ListDesktopWindowsAsync(
                request.Command,
                request.RequestId,
                cancellationToken),

            "prepareDesktopForFocus" => await PrepareDesktopForFocusAsync(
                request.Command,
                request.RequestId,
                request.Matchers ?? [],
                cancellationToken),

            "backupContextState" => await BackupContextStateAsync(
                request,
                cancellationToken),

            "listContextBackups" => NativeResponse.Success(
                request.Command,
                request.RequestId,
                result: await backupService.ListAsync(
                    cancellationToken)),

            "readContextBackup" => await ReadContextBackupAsync(
                request,
                cancellationToken),

            "getContextBackupSettings" => NativeResponse.Success(
                request.Command,
                request.RequestId,
                result: await backupService.GetSettingsAsync(
                    cancellationToken)),

            "setContextBackupSecondaryDirectory" =>
                NativeResponse.Success(
                    request.Command,
                    request.RequestId,
                    result:
                        await backupService.SetSecondaryDirectoryAsync(
                            request.SecondaryBackupDirectory,
                            cancellationToken)),

            "setContextBackupRetention" =>
                await SetContextBackupRetentionAsync(
                    request,
                    cancellationToken),

            _ => NativeResponse.Failure(
                request.Command,
                $"Unsupported command: {request.Command}",
                request.RequestId)
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
            ProtocolVersion: 4,
            capabilities.Platform,
            capabilities.CanPrepareDesktopForFocus,
            capabilities.CanEnumerateDesktopWindows,
            CanBackupContexts: true);
    }

    private async Task<NativeResponse> SetContextBackupRetentionAsync(
        NativeCommandRequest request,
        CancellationToken cancellationToken)
    {
        if (
            request.RecentSnapshotCount is null ||
            request.DailyRetentionDays is null ||
            request.WeeklyRetentionWeeks is null)
        {
            return NativeResponse.Failure(
                request.Command,
                "All retention settings are required.",
                request.RequestId);
        }

        var settings = await backupService.SetRetentionAsync(
            request.RecentSnapshotCount.Value,
            request.DailyRetentionDays.Value,
            request.WeeklyRetentionWeeks.Value,
            cancellationToken);

        return NativeResponse.Success(
            request.Command,
            request.RequestId,
            result: settings);
    }

    private async Task<NativeResponse> BackupContextStateAsync(
        NativeCommandRequest request,
        CancellationToken cancellationToken)
    {
        if (request.Backup is null)
        {
            return NativeResponse.Failure(
                request.Command,
                "Backup payload is required.",
                request.RequestId);
        }

        var result = await backupService.SaveAsync(
            request.Backup.Value,
            cancellationToken);

        return NativeResponse.Success(
            request.Command,
            request.RequestId,
            result: result);
    }

    private async Task<NativeResponse> ReadContextBackupAsync(
        NativeCommandRequest request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.BackupId))
        {
            return NativeResponse.Failure(
                request.Command,
                "Backup id is required.",
                request.RequestId);
        }

        var result = await backupService.ReadAsync(
            request.BackupId,
            cancellationToken);

        return NativeResponse.Success(
            request.Command,
            request.RequestId,
            result: result);
    }

    private async Task<NativeResponse> ListDesktopWindowsAsync(
        string command,
        string? requestId,
        CancellationToken cancellationToken)
    {
        var capabilities = desktopService.GetCapabilities();

        if (!capabilities.CanEnumerateDesktopWindows)
        {
            return NativeResponse.Failure(
                command,
                $"Desktop window discovery is not supported on {capabilities.Platform}.",
                requestId);
        }

        var windows = await desktopService.GetWindowCandidatesAsync(
            cancellationToken);

        return NativeResponse.Success(
            command,
            requestId,
            result: new ListDesktopWindowsResult(windows));
    }

    private async Task<NativeResponse> PrepareDesktopForFocusAsync(
        string command,
        string? requestId,
        IReadOnlyList<DesktopWindowMatcher> matchers,
        CancellationToken cancellationToken)
    {
        var capabilities = desktopService.GetCapabilities();

        if (!capabilities.CanPrepareDesktopForFocus)
        {
            return NativeResponse.Failure(
                command,
                $"Desktop Focus is not supported on {capabilities.Platform}.",
                requestId);
        }

        var result = await desktopService.PrepareForFocusAsync(
            matchers,
            cancellationToken);

        return NativeResponse.Success(
            command,
            requestId,
            result: result);
    }
}
