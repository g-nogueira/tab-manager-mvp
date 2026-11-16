using System.Text.Json;

namespace ContextTabManager.NativeHost.Protocol;

public sealed class NativeMessagingTransport(
    Stream input,
    Stream output)
{
    private const int HeaderLength = 4;
    private const int MaxInboundMessageBytes = 1024 * 1024;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    public async Task<NativeCommandRequest?> ReadAsync(
        CancellationToken cancellationToken)
    {
        var header = new byte[HeaderLength];
        var bytesRead = await input.ReadAsync(
            header.AsMemory(0, HeaderLength),
            cancellationToken);

        if (bytesRead == 0)
        {
            return null;
        }

        while (bytesRead < HeaderLength)
        {
            var read = await input.ReadAsync(
                header.AsMemory(bytesRead, HeaderLength - bytesRead),
                cancellationToken);

            if (read == 0)
            {
                throw new EndOfStreamException(
                    "Native message ended before its length header was complete.");
            }

            bytesRead += read;
        }

        var payloadLength = BitConverter.ToUInt32(header, 0);

        if (payloadLength == 0 || payloadLength > MaxInboundMessageBytes)
        {
            throw new InvalidDataException(
                $"Invalid native message length: {payloadLength}.");
        }

        var payload = new byte[(int)payloadLength];
        await input.ReadExactlyAsync(payload, cancellationToken);

        return JsonSerializer.Deserialize<NativeCommandRequest>(
            payload,
            JsonOptions)
            ?? throw new InvalidDataException(
                "Native message did not contain a valid command.");
    }

    public async Task WriteAsync(
        NativeResponse response,
        CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.SerializeToUtf8Bytes(
            response,
            JsonOptions);
        var header = BitConverter.GetBytes((uint)payload.Length);

        await output.WriteAsync(header, cancellationToken);
        await output.WriteAsync(payload, cancellationToken);
        await output.FlushAsync(cancellationToken);
    }
}
