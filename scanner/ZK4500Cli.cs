using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using AxInterop.ZKFPEngXControl;

internal static class ZK4500Cli
{
    private static AxZKFPEngX fp;
    private static bool captured;
    private static int exitCode = 1;
    private static Options options;

    [STAThread]
    private static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        options = Options.Parse(args);
        if (options.ShowHelp)
        {
            PrintHelp();
            return options.BadArgs ? 1 : 0;
        }

        Directory.CreateDirectory(options.OutDir);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        bool fingerDown = false;
        bool deadlineExtended = false;
        DateTime deadline = DateTime.UtcNow;

        using (var form = new Form())
        {
            form.Text = "ZK4500 CLI";
            form.Width = 300;
            form.Height = 220;
            form.ShowInTaskbar = false;
            form.WindowState = FormWindowState.Minimized;

            fp = new AxZKFPEngX();
            ((System.ComponentModel.ISupportInitialize)fp).BeginInit();
            fp.Dock = DockStyle.Fill;
            form.Controls.Add(fp);
            ((System.ComponentModel.ISupportInitialize)fp).EndInit();

            fp.OnFingerTouching += delegate
            {
                Console.WriteLine("finger=detected");
                fingerDown = true;
                if (!deadlineExtended)
                {
                    deadlineExtended = true;
                    deadline = DateTime.UtcNow.AddSeconds(options.TimeoutSeconds);
                }
            };
            fp.OnFingerLeaving += delegate
            {
                Console.WriteLine("finger=removed");
                fingerDown = false;
            };
            fp.OnFeatureInfo += delegate(object sender, IZKFPEngXEvents_OnFeatureInfoEvent e)
            {
                Console.WriteLine("quality=" + e.aQuality);
            };
            fp.OnImageReceived += delegate(object sender, IZKFPEngXEvents_OnImageReceivedEvent e)
            {
                Console.WriteLine("image_valid=" + e.aImageValid);
                if (e.aImageValid && options.SaveImageEvent) SaveImage("image-event");
            };
            fp.OnCapture += delegate(object sender, IZKFPEngXEvents_OnCaptureEvent e)
            {
                Console.WriteLine("capture_success=" + e.actionResult);
                if (!e.actionResult) return;
                captured = true;
                string template = null;
                try
                {
                    SaveImage(options.Prefix);
                    template = options.SaveTemplate ? SaveTemplate() : null;
                    exitCode = 0;
                }
                catch (Exception ex)
                {
                    Console.WriteLine("error=" + ex.GetType().Name + ": " + ex.Message);
                    exitCode = 1;
                }
                if (exitCode == 0 && options.Command == "identify")
                {
                    try
                    {
                        IdentifyTemplate(template);
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine("match_found=False");
                        Console.WriteLine("match_error=" + ex.Message);
                        Console.WriteLine("match_score=0");
                    }
                }
                form.BeginInvoke(new Action(form.Close));
            };

            form.Shown += delegate
            {
                try
                {
                    int init = OpenEngine();
                    PrintDevice(init);
                    if (init != 0)
                    {
                        Console.WriteLine("error=scanner_not_ready");
                        exitCode = 1;
                        form.Close();
                        return;
                    }

                    if (options.Command == "info")
                    {
                        exitCode = 0;
                        form.Close();
                        return;
                    }

                    if (options.Command == "compare")
                    {
                        IdentifyTemplate(ReadTemplateText(options.TemplateFile));
                        exitCode = init == 0 ? 0 : 1;
                        form.Close();
                        return;
                    }

                    Console.WriteLine("waiting_seconds=" + options.TimeoutSeconds);
                    deadline = DateTime.UtcNow.AddSeconds(options.TimeoutSeconds);
                    fp.BeginCapture();
                    var timer = new System.Windows.Forms.Timer();
                    timer.Interval = 250;
                    timer.Tick += delegate
                    {
                        if (captured || DateTime.UtcNow < deadline) return;
                        if (fingerDown && !deadlineExtended)
                        {
                            deadlineExtended = true;
                            deadline = DateTime.UtcNow.AddSeconds(options.TimeoutSeconds);
                            return;
                        }
                        timer.Stop();
                        if (!captured)
                        {
                            Console.WriteLine("capture_success=False");
                            Console.WriteLine("error=timeout");
                            exitCode = 2;
                        }
                        try { fp.CancelCapture(); } catch { }
                        form.Close();
                    };
                    timer.Start();
                }
                catch (Exception ex)
                {
                    Console.WriteLine("error=" + ex.Message);
                    exitCode = 1;
                    form.Close();
                }
            };

            Application.Run(form);
        }

        try { if (fp != null) fp.EndEngine(); } catch { }
        return exitCode;
    }

    private static int OpenEngine()
    {
        int init = 1;
        for (int attempt = 0; attempt < 2; attempt++)
        {
            if (attempt > 0)
            {
                try { fp.EndEngine(); } catch { }
                Thread.Sleep(500);
            }
            try
            {
                fp.SensorIndex = 0;
                init = fp.InitEngine();
            }
            catch
            {
                init = 1;
            }
            if (init == 0) return 0;
        }
        return init;
    }

    private static void PrintDevice(int init)
    {
        Console.WriteLine("init=" + init);
        Console.WriteLine("engine_valid=" + fp.EngineValid);
        Console.WriteLine("sensor_count=" + fp.SensorCount);
        Console.WriteLine("sensor_index=" + fp.SensorIndex);
        Console.WriteLine("vendor=" + fp.Vendor);
        Console.WriteLine("product=" + fp.ProduceName);
        Console.WriteLine("image_width=" + fp.ImageWidth);
        Console.WriteLine("image_height=" + fp.ImageHeight);
        Console.WriteLine("out_dir=" + options.OutDir);
    }

    private static void SaveImage(string prefix)
    {
        string jpg = Path.Combine(options.OutDir, prefix + "-" + Stamp() + ".jpg");
        fp.SaveJPG(jpg);
        Console.WriteLine("image=" + jpg);
    }

    private static string SaveTemplate()
    {
        string template = fp.GetTemplateAsString() ?? "";
        string path = Path.Combine(options.OutDir, "template-" + Stamp() + ".txt");
        File.WriteAllText(path, template);
        Console.WriteLine("template=" + path);
        Console.WriteLine("template_length=" + template.Length);
        return template;
    }

    private sealed class Sample
    {
        public int Id;
        public string Sid;
        public string Text;
    }

    private struct Hit
    {
        public int Score;
        public string Sid;
    }

    private static void IdentifyTemplate(string verifyTemplate)
    {
        int threshold = options.Threshold < 1 ? 1 : options.Threshold;
        Console.WriteLine("match_threshold=" + threshold);
        if (string.IsNullOrWhiteSpace(verifyTemplate))
        {
            Console.WriteLine("match_found=False");
            Console.WriteLine("match_error=empty_template");
            Console.WriteLine("match_score=0");
            Console.WriteLine("match_loaded=0");
            return;
        }

        // 1 makes the engine return the best candidate. The attendance threshold is applied below.
        try { fp.Threshold = 1; }
        catch (Exception ex) { Console.WriteLine("match_threshold_error=" + ex.Message); }

        object liveTemplate = null;
        if (options.Command != "compare")
        {
            try { liveTemplate = fp.GetVerTemplate(); }
            catch (Exception ex) { Console.WriteLine("match_live_error=" + ex.Message); }
        }

        List<Sample> samples = LoadSamples();
        Console.WriteLine("match_loaded=" + samples.Count);

        Hit cache = IdentifyInCache(samples, verifyTemplate);
        Hit binary = IdentifyBinary(samples, liveTemplate);
        Hit pair = new Hit();
        if (cache.Score < threshold && binary.Score < threshold)
            pair = IdentifyOneToOne(samples, verifyTemplate);

        Hit best = cache;
        string method = "cache";
        if (binary.Score > best.Score) { best = binary; method = "binary"; }
        if (pair.Score > best.Score) { best = pair; method = "one-to-one"; }
        if (best.Sid == null) best.Sid = "";
        if (best.Score <= 0) method = "";

        bool found = best.Sid.Length > 0 && best.Score >= threshold;
        Console.WriteLine("match_method=" + method);
        Console.WriteLine("match_cache_score=" + cache.Score);
        Console.WriteLine("match_binary_score=" + binary.Score);
        Console.WriteLine("match_pair_score=" + pair.Score);
        Console.WriteLine("match_found=" + (found ? "True" : "False"));
        Console.WriteLine("match_best_sid=" + best.Sid);
        Console.WriteLine("match_sid=" + (found ? best.Sid : ""));
        Console.WriteLine("match_score=" + best.Score);
    }

    private static List<Sample> LoadSamples()
    {
        var samples = new List<Sample>();
        if (!Directory.Exists(options.MatchDir)) return samples;
        foreach (string file in Directory.GetFiles(options.MatchDir, "*.txt"))
        {
            if (options.Command == "compare"
                && !string.IsNullOrEmpty(options.TemplateFile)
                && string.Equals(Path.GetFullPath(file), options.TemplateFile, StringComparison.OrdinalIgnoreCase))
                continue;
            string sid = Path.GetFileNameWithoutExtension(file).ToLowerInvariant();
            if (!(sid.StartsWith("s-") || sid.StartsWith("t-"))) continue;
            string text = ReadTemplateText(file);
            if (text.Length == 0) continue;
            samples.Add(new Sample { Id = samples.Count + 1, Sid = sid, Text = text });
        }
        return samples;
    }

    private static string ReadTemplateText(string file)
    {
        string text = File.ReadAllText(file);
        if (text.Length > 0 && text[0] == '\uFEFF') text = text.Substring(1);
        return text.Trim();
    }

    private static Hit IdentifyInCache(List<Sample> samples, string verifyTemplate)
    {
        int handle = 0;
        try
        {
            handle = fp.CreateFPCacheDB();
            if (handle == 0) return new Hit();
            int added = 0;
            foreach (Sample sample in samples)
            {
                int result = fp.AddRegTemplateStrToFPCacheDB(handle, sample.Id, sample.Text);
                if (result != 0) added++;
            }
            Console.WriteLine("match_cache_added=" + added);
            int score = 0;
            int processed = 0;
            int fid = fp.IdentificationFromStrInFPCacheDB(handle, verifyTemplate, ref score, ref processed);
            Console.WriteLine("match_cache_fid=" + fid);
            return HitFor(samples, fid, score);
        }
        catch (Exception ex)
        {
            Console.WriteLine("match_cache_error=" + ex.Message);
            return new Hit();
        }
        finally
        {
            if (handle != 0)
            {
                try { fp.FreeFPCacheDB(handle); } catch { /* engine is closing */ }
            }
        }
    }

    private static Hit IdentifyBinary(List<Sample> samples, object liveTemplate)
    {
        if (liveTemplate == null) return new Hit();
        int handle = 0;
        try
        {
            handle = fp.CreateFPCacheDB();
            if (handle == 0) return new Hit();
            int added = 0;
            foreach (Sample sample in samples)
            {
                object decoded = null;
                if (!fp.DecodeTemplate(sample.Text, ref decoded) || decoded == null) continue;
                int result = fp.AddRegTemplateToFPCacheDB(handle, sample.Id, decoded);
                if (result != 0) added++;
            }
            Console.WriteLine("match_binary_added=" + added);
            int score = 0;
            int processed = 0;
            int fid = fp.IdentificationInFPCacheDB(handle, liveTemplate, ref score, ref processed);
            Console.WriteLine("match_binary_fid=" + fid);
            return HitFor(samples, fid, score);
        }
        catch (Exception ex)
        {
            Console.WriteLine("match_binary_error=" + ex.Message);
            return new Hit();
        }
        finally
        {
            if (handle != 0)
            {
                try { fp.FreeFPCacheDB(handle); } catch { /* engine is closing */ }
            }
        }
    }

    private static Hit IdentifyOneToOne(List<Sample> samples, string verifyTemplate)
    {
        Hit best = new Hit();
        foreach (Sample sample in samples)
        {
            int score = Math.Max(VerScore(sample.Text, verifyTemplate), VerScore(verifyTemplate, sample.Text));
            if (score > best.Score)
            {
                best.Score = score;
                best.Sid = sample.Sid;
            }
        }
        return best;
    }

    private static int VerScore(string registered, string verify)
    {
        try
        {
            string reg = registered;
            bool changed = false;
            fp.VerFingerFromStr(ref reg, verify, false, ref changed);
            int score = fp.GetVerScore();
            return score < 0 ? 0 : score;
        }
        catch
        {
            return 0;
        }
    }

    private static Hit HitFor(List<Sample> samples, int fid, int score)
    {
        if (fid <= 0 || score <= 0) return new Hit();
        foreach (Sample sample in samples)
        {
            if (sample.Id == fid) return new Hit { Score = score, Sid = sample.Sid };
        }
        return new Hit();
    }

    private static string Stamp()
    {
        return DateTime.Now.ToString("yyyyMMdd-HHmmss");
    }

    private static void PrintHelp()
    {
        Console.WriteLine("ZK4500 CLI");
        Console.WriteLine();
        Console.WriteLine("Usage:");
        Console.WriteLine("  zk4500.exe info");
        Console.WriteLine("  zk4500.exe scan [--timeout 20] [--out PATH] [--prefix capture] [--no-template]");
        Console.WriteLine("  zk4500.exe identify [--timeout 20] [--out PATH] [--prefix capture] [--match-dir PATH] [--threshold 8]");
        Console.WriteLine("  zk4500.exe compare --template FILE --match-dir PATH [--threshold 8]");
        Console.WriteLine();
        Console.WriteLine("Exit codes:");
        Console.WriteLine("  0 success, 1 error, 2 timeout/no capture");
    }

    private sealed class Options
    {
        public string Command = "help";
        public int TimeoutSeconds = 20;
        public string OutDir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "captures");
        public string Prefix = "capture";
        public string MatchDir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "captures");
        public string TemplateFile = "";
        public int Threshold = 8;
        public bool SaveTemplate = true;
        public bool SaveImageEvent = false;
        public bool ShowHelp;
        public bool BadArgs;

        public static Options Parse(string[] args)
        {
            var o = new Options();
            if (args.Length == 0 || args[0] == "-h" || args[0] == "--help" || args[0] == "help")
            {
                o.ShowHelp = true;
                return o;
            }
            o.Command = args[0].ToLowerInvariant();
            if (o.Command != "info" && o.Command != "scan" && o.Command != "identify" && o.Command != "compare")
            {
                o.ShowHelp = true;
                o.BadArgs = true;
                return o;
            }

            for (int i = 1; i < args.Length; i++)
            {
                string a = args[i];
                if (a == "--timeout" && i + 1 < args.Length) o.TimeoutSeconds = Math.Max(1, int.Parse(args[++i]));
                else if (a == "--out" && i + 1 < args.Length) o.OutDir = Path.GetFullPath(args[++i]);
                else if (a == "--prefix" && i + 1 < args.Length) o.Prefix = args[++i];
                else if (a == "--match-dir" && i + 1 < args.Length) o.MatchDir = Path.GetFullPath(args[++i]);
                else if (a == "--template" && i + 1 < args.Length) o.TemplateFile = Path.GetFullPath(args[++i]);
                else if (a == "--threshold" && i + 1 < args.Length) o.Threshold = Math.Min(100, Math.Max(1, int.Parse(args[++i])));
                else if (a == "--no-template") o.SaveTemplate = false;
                else if (a == "--save-image-event") o.SaveImageEvent = true;
                else
                {
                    o.ShowHelp = true;
                    o.BadArgs = true;
                    break;
                }
            }
            return o;
        }
    }
}
