using System.Globalization;
using System.Text.Json;

namespace ContextTabManager.NativeHost.Application;

public sealed record ContextBackupMetadata(
    string Id,
    string CreatedAt,
    string? Reason,
    int ContextCount,
    int WindowCount,
    int TabCount,
    int DesktopWindowCount,
    long SizeBytes);

public sealed record ContextBackupSettings(
    string LocalBackupDirectory,
    string? SecondaryBackupDirectory);

public sealed record SaveContextBackupResult(
    ContextBackupMetadata Backup,
    ContextBackupSettings Settings,
    bool SecondaryCopyWritten,
    string? SecondaryError);

public sealed record ListContextBackupsResult(
    IReadOnlyList<ContextBackupMetadata> Backups,
    ContextBackupSettings Settings);

public sealed record ReadContextBackupResult(
    JsonElement Backup);

public sealed class ContextBackupService
{
    private const int SchemaVersion = 1;
    private const int ImmediateRetentionCount = 20;
    private const int DailyRetentionCount = 7;
    private const int WeeklyRetentionCount = 4;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    private string RootDirectory =>
        Path.Combine(
            Environment.GetFolderPath(
                Environment.SpecialFolder.LocalApplicationData),
            "ContextTabManager");

    private string BackupDirectory =>
        Path.Combine(RootDirectory, "Backups");

    private string SettingsPath =>
        Path.Combine(RootDirectory, "backup-settings.json");

    public async Task<SaveContextBackupResult> SaveAsync(
        JsonElement backup,
        CancellationToken cancellationToken)
    {
        ValidateBackup(backup);

        Directory.CreateDirectory(BackupDirectory);

        var now = DateTimeOffset.UtcNow;
        var id =
            $"context-backup-{now:yyyyMMddTHHmmssfffZ}-{Guid.NewGuid():N}";
        var fileName = id + ".json";
        var json = JsonSerializer.Serialize(
            backup,
            JsonOptions);

        var localPath = Path.Combine(
            BackupDirectory,
            fileName);

        await WriteAtomicAsync(
            localPath,
            json,
            cancellationToken);
        await WriteAtomicAsync(
            Path.Combine(BackupDirectory, "latest.json"),
            json,
            cancellationToken);

        PruneDirectory(BackupDirectory);

        var settings = await GetSettingsAsync(
            cancellationToken);

        var secondaryCopyWritten = false;
        string? secondaryError = null;

        if (!string.IsNullOrWhiteSpace(
                settings.SecondaryBackupDirectory))
        {
            try
            {
                Directory.CreateDirectory(
                    settings.SecondaryBackupDirectory);

                await WriteAtomicAsync(
                    Path.Combine(
                        settings.SecondaryBackupDirectory,
                        fileName),
                    json,
                    cancellationToken);

                await WriteAtomicAsync(
                    Path.Combine(
                        settings.SecondaryBackupDirectory,
                        "latest.json"),
                    json,
                    cancellationToken);

                PruneDirectory(
                    settings.SecondaryBackupDirectory);

                secondaryCopyWritten = true;
            }
            catch (Exception exception)
            {
                secondaryError = exception.Message;
            }
        }

        var metadata = ReadMetadata(
            localPath,
            backup,
            new FileInfo(localPath).Length);

        return new SaveContextBackupResult(
            metadata,
            settings,
            secondaryCopyWritten,
            secondaryError);
    }

    public async Task<ListContextBackupsResult> ListAsync(
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Directory.CreateDirectory(BackupDirectory);

        var settings = await GetSettingsAsync(
            cancellationToken);

        var backups =
            new Dictionary<string, ContextBackupMetadata>(
                StringComparer.OrdinalIgnoreCase);

        AddBackupMetadataFromDirectory(
            BackupDirectory,
            backups);

        if (
            !string.IsNullOrWhiteSpace(
                settings.SecondaryBackupDirectory) &&
            Directory.Exists(
                settings.SecondaryBackupDirectory))
        {
            AddBackupMetadataFromDirectory(
                settings.SecondaryBackupDirectory,
                backups);
        }

        return new ListContextBackupsResult(
            backups.Values
                .OrderByDescending(
                    metadata => metadata.CreatedAt)
                .Take(50)
                .ToArray(),
            settings);
    }

    public async Task<ReadContextBackupResult> ReadAsync(
        string backupId,
        CancellationToken cancellationToken)
    {
        if (
            string.IsNullOrWhiteSpace(backupId) ||
            Path.GetFileName(backupId) != backupId ||
            !backupId.StartsWith(
                "context-backup-",
                StringComparison.Ordinal))
        {
            throw new InvalidDataException(
                "Invalid backup identifier.");
        }

        var settings = await GetSettingsAsync(
            cancellationToken);

        var candidatePaths = new List<string>
        {
            Path.Combine(
                BackupDirectory,
                backupId + ".json")
        };

        if (!string.IsNullOrWhiteSpace(
                settings.SecondaryBackupDirectory))
        {
            candidatePaths.Add(
                Path.Combine(
                    settings.SecondaryBackupDirectory,
                    backupId + ".json"));
        }

        foreach (var path in candidatePaths)
        {
            if (!File.Exists(path))
            {
                continue;
            }

            await using var stream = File.OpenRead(path);
            using var document = await JsonDocument.ParseAsync(
                stream,
                cancellationToken: cancellationToken);

            ValidateBackup(document.RootElement);

            return new ReadContextBackupResult(
                document.RootElement.Clone());
        }

        throw new FileNotFoundException(
            "Context backup was not found in the local or configured secondary backup directory.");
    }

    public async Task<ContextBackupSettings> GetSettingsAsync(
        CancellationToken cancellationToken)
    {
        if (!File.Exists(SettingsPath))
        {
            return new ContextBackupSettings(
                BackupDirectory,
                null);
        }

        try
        {
            await using var stream = File.OpenRead(SettingsPath);
            var persisted =
                await JsonSerializer.DeserializeAsync<PersistedSettings>(
                    stream,
                    JsonOptions,
                    cancellationToken);

            return new ContextBackupSettings(
                BackupDirectory,
                persisted?.SecondaryBackupDirectory);
        }
        catch
        {
            return new ContextBackupSettings(
                BackupDirectory,
                null);
        }
    }

    public async Task<ContextBackupSettings> SetSecondaryDirectoryAsync(
        string? directory,
        CancellationToken cancellationToken)
    {
        string? normalized = null;

        if (!string.IsNullOrWhiteSpace(directory))
        {
            var expanded =
                Environment.ExpandEnvironmentVariables(
                    directory.Trim());

            if (!Path.IsPathFullyQualified(expanded))
            {
                throw new InvalidDataException(
                    "Secondary backup directory must be an absolute path.");
            }

            normalized = Path.GetFullPath(expanded);
            Directory.CreateDirectory(normalized);
        }

        Directory.CreateDirectory(RootDirectory);

        var persisted = new PersistedSettings(normalized);
        var json = JsonSerializer.Serialize(
            persisted,
            JsonOptions);

        await WriteAtomicAsync(
            SettingsPath,
            json,
            cancellationToken);

        return new ContextBackupSettings(
            BackupDirectory,
            normalized);
    }

    private static void ValidateBackup(
        JsonElement backup)
    {
        if (backup.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidDataException(
                "Backup payload must be a JSON object.");
        }

        if (
            !backup.TryGetProperty(
                "schemaVersion",
                out var schemaVersion) ||
            schemaVersion.ValueKind != JsonValueKind.Number ||
            schemaVersion.GetInt32() != SchemaVersion)
        {
            throw new InvalidDataException(
                $"Unsupported context backup schema. Expected {SchemaVersion}.");
        }

        if (
            !backup.TryGetProperty(
                "contexts",
                out var contexts) ||
            contexts.ValueKind != JsonValueKind.Array)
        {
            throw new InvalidDataException(
                "Backup payload does not contain contexts.");
        }
    }

    private static async Task WriteAtomicAsync(
        string destination,
        string content,
        CancellationToken cancellationToken)
    {
        var directory =
            Path.GetDirectoryName(destination)
            ?? throw new InvalidDataException(
                "Backup destination has no directory.");

        Directory.CreateDirectory(directory);

        var temporary =
            destination +
            $".{Guid.NewGuid():N}.tmp";

        try
        {
            await File.WriteAllTextAsync(
                temporary,
                content,
                cancellationToken);

            File.Move(
                temporary,
                destination,
                overwrite: true);
        }
        finally
        {
            if (File.Exists(temporary))
            {
                File.Delete(temporary);
            }
        }
    }

    private static void AddBackupMetadataFromDirectory(
        string directory,
        IDictionary<string, ContextBackupMetadata> backups)
    {
        foreach (
            var path in Directory.EnumerateFiles(
                directory,
                "context-backup-*.json",
                SearchOption.TopDirectoryOnly))
        {
            var metadata = TryReadMetadata(path);

            if (metadata is null)
            {
                continue;
            }

            backups.TryAdd(
                metadata.Id,
                metadata);
        }
    }

    private static ContextBackupMetadata? TryReadMetadata(
        string path)
    {
        try
        {
            using var document = JsonDocument.Parse(
                File.ReadAllText(path));

            ValidateBackup(document.RootElement);

            return ReadMetadata(
                path,
                document.RootElement,
                new FileInfo(path).Length);
        }
        catch
        {
            return null;
        }
    }

    private static ContextBackupMetadata ReadMetadata(
        string path,
        JsonElement backup,
        long sizeBytes)
    {
        var contexts = backup.GetProperty("contexts");
        var contextCount = contexts.GetArrayLength();
        var windowCount = 0;
        var tabCount = 0;
        var desktopWindowCount = 0;

        foreach (var context in contexts.EnumerateArray())
        {
            if (
                context.TryGetProperty(
                    "windows",
                    out var windows) &&
                windows.ValueKind == JsonValueKind.Array)
            {
                windowCount += windows.GetArrayLength();

                foreach (var window in windows.EnumerateArray())
                {
                    if (
                        window.TryGetProperty(
                            "tabs",
                            out var tabs) &&
                        tabs.ValueKind == JsonValueKind.Array)
                    {
                        tabCount += tabs.GetArrayLength();
                    }
                }
            }

            if (
                context.TryGetProperty(
                    "desktopWindows",
                    out var desktopWindows) &&
                desktopWindows.ValueKind == JsonValueKind.Array)
            {
                desktopWindowCount +=
                    desktopWindows.GetArrayLength();
            }
        }

        var createdAt =
            backup.TryGetProperty(
                "createdAt",
                out var created) &&
            created.ValueKind == JsonValueKind.String
                ? created.GetString()
                    ?? File.GetLastWriteTimeUtc(path)
                        .ToString("O")
                : File.GetLastWriteTimeUtc(path)
                    .ToString("O");

        var reason =
            backup.TryGetProperty(
                "reason",
                out var reasonElement) &&
            reasonElement.ValueKind == JsonValueKind.String
                ? reasonElement.GetString()
                : null;

        return new ContextBackupMetadata(
            Path.GetFileNameWithoutExtension(path),
            createdAt,
            reason,
            contextCount,
            windowCount,
            tabCount,
            desktopWindowCount,
            sizeBytes);
    }

    private static void PruneDirectory(
        string directory)
    {
        var files = Directory
            .EnumerateFiles(
                directory,
                "context-backup-*.json",
                SearchOption.TopDirectoryOnly)
            .Select(path => new FileInfo(path))
            .OrderByDescending(file => file.LastWriteTimeUtc)
            .ToArray();

        var keep = new HashSet<string>(
            StringComparer.OrdinalIgnoreCase);

        foreach (var file in files.Take(
                     ImmediateRetentionCount))
        {
            keep.Add(file.FullName);
        }

        var older = files.Skip(
            ImmediateRetentionCount);

        foreach (
            var file in older
                .GroupBy(file =>
                    file.LastWriteTimeUtc.Date)
                .OrderByDescending(group => group.Key)
                .Take(DailyRetentionCount)
                .Select(group =>
                    group.OrderByDescending(
                            file => file.LastWriteTimeUtc)
                        .First()))
        {
            keep.Add(file.FullName);
        }

        foreach (
            var file in older
                .Where(file =>
                    !keep.Contains(file.FullName))
                .GroupBy(file =>
                {
                    var date = file.LastWriteTimeUtc;
                    return (
                        ISOWeek.GetYear(date),
                        ISOWeek.GetWeekOfYear(date));
                })
                .OrderByDescending(group =>
                    group.Key.Item1)
                .ThenByDescending(group =>
                    group.Key.Item2)
                .Take(WeeklyRetentionCount)
                .Select(group =>
                    group.OrderByDescending(
                            file => file.LastWriteTimeUtc)
                        .First()))
        {
            keep.Add(file.FullName);
        }

        foreach (var file in files)
        {
            if (!keep.Contains(file.FullName))
            {
                try
                {
                    file.Delete();
                }
                catch
                {
                    // Retention failure must not invalidate a successful backup.
                }
            }
        }
    }

    private sealed record PersistedSettings(
        string? SecondaryBackupDirectory);
}
