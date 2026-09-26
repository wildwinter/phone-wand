// Starting the relay from a game: see docs/shipping.md. Engine-free, so the Unity component (and
// anything else) can use it with its own paths:
//
//   var relay = ManagedRelay.Start(new ManagedRelayOptions { Path = folder, LogFile = log }, Console.WriteLine);
//   ... connect as usual ...
//   relay.Stop();
//
// Only for a relay on this computer; a relay that is already running is used as it is and never
// stopped. A relay this starts runs hidden with a pipe as its standard input (--lifeline), so it
// stops by itself when the game ends, however it ends.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;

namespace StoryTools.PhoneWand
{
    /// <summary>Where to find the relay and how to run it. See ManagedRelay.Start.</summary>
    public sealed class ManagedRelayOptions
    {
        /// <summary>The app URL the client will use. Its port becomes the relay's --app-port.</summary>
        public string Url = PhoneWandCore.DefaultUrl;

        /// <summary>
        /// A phone-wand-relay folder (holding macos, windows-x64 and so on), or the relay program
        /// itself. Default: phone-wand-relay in the working directory.
        /// </summary>
        public string Path;

        /// <summary>Extra relay options, as on a command line, e.g. "--max-players 8 --key party".</summary>
        public string Arguments;

        /// <summary>Where the relay writes its output (--log). Default phone-wand-relay.log in the temporary folder.</summary>
        public string LogFile;
    }

    /// <summary>A relay started by a game, or the knowledge that none was needed.</summary>
    public sealed class ManagedRelay
    {
        /// <summary>How long Stop waits for the relay to finish after closing its input, in milliseconds.</summary>
        public const int StopWaitMilliseconds = 2000;

        /// <summary>How long to wait for a running relay's status.json, in milliseconds.</summary>
        public const int StatusTimeoutMilliseconds = 1000;

        Process process;

        ManagedRelay(Process process, int appPort)
        {
            this.process = process;
            AppPort = appPort;
        }

        /// <summary>The relay process this started, or null once stopped.</summary>
        public Process Process => process;

        /// <summary>The relay's app port.</summary>
        public int AppPort { get; }

        /// <summary>True while the relay this started is still running.</summary>
        public bool IsRunning
        {
            get
            {
                var p = process;
                if (p == null) return false;
                try { return !p.HasExited; }
                catch (Exception) { return false; }
            }
        }

        /// <summary>
        /// Start a relay unless one is already running, following docs/shipping.md. Returns the relay
        /// it started, or null when it started none: the URL is not on this computer, a relay already
        /// answers on its port, or there is no relay program (logged). log receives warnings.
        /// </summary>
        public static ManagedRelay Start(ManagedRelayOptions options, Action<string> log = null)
        {
            if (options == null) options = new ManagedRelayOptions();
            if (log == null) log = _ => { };
            string url = string.IsNullOrEmpty(options.Url) ? PhoneWandCore.DefaultUrl : options.Url;
            if (!IsLocal(url)) return null;
            int port = AppPortOf(url);
            if (RelayAnswers(port)) return null;

            string exe = FindExecutable(options.Path, out string lookedFor);
            if (exe == null)
            {
                log("No relay to start. Looked for " + lookedFor + ". See docs/shipping.md.");
                return null;
            }
            MakeExecutable(exe);

            string logFile = string.IsNullOrEmpty(options.LogFile)
                ? System.IO.Path.Combine(System.IO.Path.GetTempPath(), "phone-wand-relay.log")
                : options.LogFile;
            try
            {
                string dir = System.IO.Path.GetDirectoryName(logFile);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            }
            catch (Exception)
            {
                // The relay reports it if it can't write there.
            }

            var info = new ProcessStartInfo(exe, BuildArguments(port, logFile, options.Arguments))
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                // stdin is the lifeline: it closes when the game ends, however it ends, and the relay stops.
                RedirectStandardInput = true,
                RedirectStandardOutput = false,
                RedirectStandardError = false,
                WorkingDirectory = System.IO.Path.GetDirectoryName(exe) ?? "",
            };
            try
            {
                var process = Process.Start(info);
                if (process == null)
                {
                    log("The relay could not start: " + exe);
                    return null;
                }
                return new ManagedRelay(process, port);
            }
            catch (Exception e)
            {
                log("The relay could not start (" + exe + "): " + e.Message);
                return null;
            }
        }

        /// <summary>
        /// Stop the relay this started: close its standard input, which makes it stop cleanly, and
        /// end the process if it hasn't gone within two seconds. Safe to call more than once.
        /// </summary>
        public void Stop()
        {
            var p = process;
            process = null;
            if (p == null) return;
            try
            {
                if (!p.HasExited)
                {
                    try { p.StandardInput.Close(); }
                    catch (Exception) { }
                    if (!p.WaitForExit(StopWaitMilliseconds))
                    {
                        try { p.Kill(); }
                        catch (Exception) { }
                        p.WaitForExit(StopWaitMilliseconds);
                    }
                }
            }
            catch (Exception)
            {
                // Already gone.
            }
            finally
            {
                p.Dispose();
            }
        }

        // ------------------------------------------------------------------ helpers

        /// <summary>The folder name for this computer inside phone-wand-relay/, or null if there is no build for it.</summary>
        public static string Platform()
        {
            var arch = RuntimeInformation.ProcessArchitecture;
            if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX)) return "macos";
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) return arch == Architecture.X64 ? "windows-x64" : null;
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
                return arch == Architecture.Arm64 ? "linux-arm64" : arch == Architecture.X64 ? "linux-x64" : null;
            return null;
        }

        /// <summary>The relay program's file name on this computer.</summary>
        public static string ExecutableName =>
            RuntimeInformation.IsOSPlatform(OSPlatform.Windows) ? "phone-wand-relay.exe" : "phone-wand-relay";

        /// <summary>True if the URL's host is this computer (127.0.0.1, localhost or [::1]).</summary>
        public static bool IsLocal(string url)
        {
            if (!Uri.TryCreate(url, UriKind.Absolute, out Uri uri)) return false;
            string host = uri.Host.ToLowerInvariant();
            return host == "127.0.0.1" || host == "localhost" || host == "[::1]" || host == "::1";
        }

        /// <summary>The URL's port, or 8480 when it has none.</summary>
        public static int AppPortOf(string url)
        {
            if (!Uri.TryCreate(url, UriKind.Absolute, out Uri uri)) return 8480;
            return uri.IsDefaultPort || uri.Port <= 0 ? 8480 : uri.Port;
        }

        /// <summary>True if a relay answers http://127.0.0.1:port/status.json within about a second.</summary>
        public static bool RelayAnswers(int port, int timeoutMilliseconds = StatusTimeoutMilliseconds)
        {
            try
            {
                // On a pool thread, so a caller with a synchronisation context (Unity's main thread) can't deadlock.
                var task = Task.Run(async () =>
                {
                    using (var http = new HttpClient { Timeout = TimeSpan.FromMilliseconds(timeoutMilliseconds) })
                    {
                        return await http.GetStringAsync("http://127.0.0.1:" + port + "/status.json").ConfigureAwait(false);
                    }
                });
                if (!task.Wait(timeoutMilliseconds + 250)) return false;
                return Json.Parse(task.Result) is Dictionary<string, object> status &&
                    status.TryGetValue("relay", out object relay) && relay is string;
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>
        /// The relay program for a path that is either the program itself or a phone-wand-relay
        /// folder, or null. lookedFor says where it looked, for messages.
        /// </summary>
        public static string FindExecutable(string path, out string lookedFor)
        {
            if (string.IsNullOrEmpty(path)) path = "phone-wand-relay";
            if (File.Exists(path))
            {
                lookedFor = path;
                return System.IO.Path.GetFullPath(path);
            }
            string platform = Platform();
            if (platform == null)
            {
                lookedFor = "a build for " + RuntimeInformation.OSDescription + " " + RuntimeInformation.ProcessArchitecture +
                    " in " + path;
                return null;
            }
            string exe = System.IO.Path.Combine(path, platform, ExecutableName);
            lookedFor = exe;
            return File.Exists(exe) ? System.IO.Path.GetFullPath(exe) : null;
        }

        /// <summary>The relay's command line: --lifeline --no-open --app-port port --log file, then the extra options.</summary>
        public static string BuildArguments(int appPort, string logFile, string extra)
        {
            var sb = new StringBuilder("--lifeline --no-open --app-port ");
            sb.Append(appPort);
            sb.Append(" --log ").Append(Quote(logFile));
            if (!string.IsNullOrWhiteSpace(extra)) sb.Append(' ').Append(extra.Trim());
            return sb.ToString();
        }

        static string Quote(string arg)
        {
            if (arg.Length > 0 && arg.IndexOfAny(new[] { ' ', '\t', '"', '\'' }) < 0) return arg;
            // A trailing backslash would escape the closing quote on Windows, so double it.
            string inner = arg.Replace("\"", "\\\"");
            if (inner.EndsWith("\\", StringComparison.Ordinal)) inner += "\\";
            return "\"" + inner + "\"";
        }

        // On macOS and Linux, make sure the program can run (unzipping or copying may lose the bit).
        static void MakeExecutable(string exe)
        {
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) return;
            try
            {
                var info = new ProcessStartInfo("/bin/chmod", "+x " + Quote(exe))
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                using (var chmod = Process.Start(info)) chmod?.WaitForExit(2000);
            }
            catch (Exception)
            {
                // A read-only location; it may already be executable.
            }
        }
    }
}
