using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

internal static class Program
{
    private static readonly HttpClient Http = new() { Timeout = Timeout.InfiniteTimeSpan };
    private static readonly byte[] SyntheticJpeg = Convert.FromBase64String("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AV//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AV//2Q==");

    public static async Task<int> Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        if (args.Length == 1 && args[0] is "--help" or "-h")
        {
            Console.WriteLine("zk4500-fake identify --timeout N --out DIR --prefix scan --match-dir DIR --threshold 8");
            return 0;
        }

        Uri? endpoint = null;
        var started = false;
        var exitCode = 1;
        try
        {
            var options = ParseArgs(args);
            endpoint = ReadEndpoint();
            var root = Path.GetFullPath(Environment.GetEnvironmentVariable("ATTENDANCE_E2E_ROOT")
                ?? throw new InvalidOperationException("ATTENDANCE_E2E_ROOT is required."));
            var output = ResolveUnderRoot(root, options.OutDir);
            var matchDir = ResolveUnderRoot(root, options.MatchDir);
            Directory.CreateDirectory(output);
            Directory.CreateDirectory(matchDir);

            var identity = new { pid = Environment.ProcessId, argv = args, cwd = Environment.CurrentDirectory };
            await Post(endpoint, "/scanner/started", identity);
            started = true;
            Console.WriteLine("init=0");
            Console.WriteLine("sensor_count=1");

            var script = await GetScript(endpoint);
            exitCode = await RunScenario(script, output, matchDir, options);
            return exitCode;
        }
        catch (Exception error)
        {
            Console.WriteLine($"error={error.Message}");
            exitCode = 1;
            return 1;
        }
        finally
        {
            if (started && endpoint is not null)
            {
                try
                {
                    await Post(endpoint, "/scanner/exited", new { pid = Environment.ProcessId, argv = args, cwd = Environment.CurrentDirectory, exitCode });
                }
                catch (Exception error)
                {
                    Console.WriteLine($"error={error.Message}");
                }
            }
        }
    }

    private static async Task<int> RunScenario(Scenario script, string output, string matchDir, Options options)
    {
        foreach (var item in script.Events ?? [])
        {
            if (item.DelayMs > 0) await Task.Delay(item.DelayMs);
            await WriteLine(item.Line, script.FragmentUtf8, false);
        }

        if (script.HangMs > 0) await Task.Delay(script.HangMs);
        if (script.ExitCode == 2 || script.Error == "timeout")
        {
            await WriteLine("capture_success=False", script.FragmentUtf8, string.IsNullOrEmpty(script.Error) && script.OmitFinalNewline);
            if (!string.IsNullOrEmpty(script.Error)) await WriteLine($"error={script.Error}", script.FragmentUtf8, script.OmitFinalNewline);
            return script.ExitCode == 0 ? 2 : script.ExitCode;
        }
        if (!string.IsNullOrEmpty(script.Error) || !script.CaptureSuccess)
        {
            await WriteLine("capture_success=False", script.FragmentUtf8, string.IsNullOrEmpty(script.Error) && script.OmitFinalNewline);
            if (!string.IsNullOrEmpty(script.Error)) await WriteLine($"error={script.Error}", script.FragmentUtf8, script.OmitFinalNewline);
            return script.ExitCode;
        }
        var stem = SafePrefix(options.Prefix);
        var imagePath = Path.Combine(output, stem + ".jpg");
        var templatePath = Path.Combine(output, stem + ".txt");
        var template = script.Template ?? "synthetic-template";
        if (!script.NoImage) await File.WriteAllBytesAsync(imagePath, SyntheticJpeg);
        if (!script.NoTemplate) await File.WriteAllTextAsync(templatePath, template, new UTF8Encoding(false));

        var found = !string.IsNullOrWhiteSpace(script.MatchSid) && script.Score >= options.Threshold;
        var lines = new List<string>
        {
            $"image={(script.NoImage ? "" : imagePath)}",
            $"template={(script.NoTemplate ? "" : templatePath)}",
            "capture_success=True",
            $"match_found={(found ? "True" : "False")}",
            $"match_sid={(found ? script.MatchSid : "")}",
            $"match_best_sid={script.MatchSid ?? ""}",
            $"match_score={script.Score}",
            $"match_threshold={options.Threshold}",
            $"match_loaded={CountTemplates(matchDir)}",
        };
        for (var index = 0; index < lines.Count; index++)
            await WriteLine(lines[index], script.FragmentUtf8, script.OmitFinalNewline && index == lines.Count - 1);
        return script.ExitCode;
    }

    private static async Task<Scenario> GetScript(Uri endpoint)
    {
        using var response = await Http.GetAsync(new Uri(endpoint, "/scanner/next"), HttpCompletionOption.ResponseContentRead);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<Scenario>()
            ?? throw new InvalidOperationException("Controller returned an empty scanner script.");
    }

    private static async Task Post(Uri endpoint, string path, object body)
    {
        using var response = await Http.PostAsJsonAsync(new Uri(endpoint, path), body);
        response.EnsureSuccessStatusCode();
    }

    private static Uri ReadEndpoint()
    {
        if (!Uri.TryCreate(Environment.GetEnvironmentVariable("ATTENDANCE_E2E_ENDPOINT"), UriKind.Absolute, out var endpoint)
            || endpoint.Scheme != Uri.UriSchemeHttp
            || !IPAddress.TryParse(endpoint.Host, out var ip)
            || !IPAddress.IsLoopback(ip))
            throw new InvalidOperationException("ATTENDANCE_E2E_ENDPOINT must be an HTTP loopback URL.");
        return new Uri(endpoint.GetLeftPart(UriPartial.Authority));
    }

    private static string ResolveUnderRoot(string root, string path)
    {
        var full = Path.GetFullPath(path);
        var relative = Path.GetRelativePath(root, full);
        if (relative == ".." || relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal)
            || Path.IsPathRooted(relative))
            throw new InvalidOperationException("Scanner paths must stay below ATTENDANCE_E2E_ROOT.");
        return full;
    }

    private static string SafePrefix(string prefix)
    {
        if (string.IsNullOrWhiteSpace(prefix) || prefix.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0
            || prefix.Contains('/') || prefix.Contains('\\') || prefix is "." or "..")
            throw new InvalidOperationException("Invalid scan prefix.");
        return prefix;
    }

    private static int CountTemplates(string directory) => Directory.Exists(directory)
        ? Directory.EnumerateFiles(directory, "*.txt").Count(path => Path.GetFileName(path).StartsWith("s-", StringComparison.OrdinalIgnoreCase)
            || Path.GetFileName(path).StartsWith("t-", StringComparison.OrdinalIgnoreCase))
        : 0;

    private static async Task WriteLine(string line, bool fragment, bool omitNewline)
    {
        var bytes = Encoding.UTF8.GetBytes(line + (omitNewline ? "" : "\n"));
        if (!fragment || bytes.Length < 3)
        {
            await Console.OpenStandardOutput().WriteAsync(bytes);
            await Console.OpenStandardOutput().FlushAsync();
            return;
        }
        var stream = Console.OpenStandardOutput();
        var split = Math.Max(1, bytes.Length / 2);
        await stream.WriteAsync(bytes.AsMemory(0, split));
        await stream.FlushAsync();
        await Task.Delay(5);
        await stream.WriteAsync(bytes.AsMemory(split));
        await stream.FlushAsync();
    }

    private static Options ParseArgs(string[] args)
    {
        if (args.Length < 1 || args[0] != "identify") throw new ArgumentException("Expected identify command.");
        var allowed = new HashSet<string>(["--timeout", "--out", "--prefix", "--match-dir", "--threshold"], StringComparer.Ordinal);
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var index = 1; index < args.Length; index += 2)
        {
            if (index + 1 >= args.Length || !args[index].StartsWith("--", StringComparison.Ordinal))
                throw new ArgumentException("Expected --option value pairs.");
            if (!allowed.Contains(args[index])) throw new ArgumentException($"Unknown option {args[index]}.");
            if (!values.TryAdd(args[index], args[index + 1])) throw new ArgumentException($"Duplicate option {args[index]}.");
        }
        string Require(string key) => values.TryGetValue(key, out var value) ? value : throw new ArgumentException($"Missing {key}.");
        if (!int.TryParse(Require("--timeout"), out var timeout) || timeout <= 0)
            throw new ArgumentException("--timeout must be a positive integer.");
        return new Options(Require("--out"), Require("--prefix"), Require("--match-dir"), int.Parse(Require("--threshold")));
    }

    private sealed record Options(string OutDir, string Prefix, string MatchDir, int Threshold);
    private sealed class Scenario
    {
        public Event[]? Events { get; set; }
        public string? Template { get; set; }
        public string? MatchSid { get; set; }
        public int Score { get; set; } = 20;
        public int ExitCode { get; set; }
        public string? Error { get; set; }
        public bool CaptureSuccess { get; set; } = true;
        public bool NoImage { get; set; }
        public bool NoTemplate { get; set; }
        public bool FragmentUtf8 { get; set; }
        public bool OmitFinalNewline { get; set; }
        public int HangMs { get; set; }
    }
    private sealed class Event { public string Line { get; set; } = ""; public int DelayMs { get; set; } }
}
