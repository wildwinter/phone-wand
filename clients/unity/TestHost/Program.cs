// Phone Wand Unity client: conformance test host.
//
// Replays every session in conformance/index.json through the C# core (Runtime/Core), and checks
// the event log, the final player state and the frame conversions against the recorded answers.
//
//   dotnet run --project clients/unity/TestHost                       # finds ../../conformance
//   dotnet run --project clients/unity/TestHost -- path/to/conformance
//   dotnet run --project clients/unity/TestHost -- --live ws://127.0.0.1:8480/app [seconds]
//
// Prints ALL PASS, or every difference and exits 1.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;

namespace StoryTools.PhoneWand.TestHost
{
    static class Program
    {
        const double Tolerance = 1e-4;

        static int Main(string[] args)
        {
            if (args.Length > 0 && args[0] == "--live")
            {
                string url = args.Length > 1 ? args[1] : PhoneWandCore.DefaultUrl;
                double seconds = args.Length > 2 ? double.Parse(args[2], CultureInfo.InvariantCulture) : 3;
                return Live(url, seconds);
            }

            string dir = args.Length > 0 ? args[0] : FindConformance();
            if (dir == null || !File.Exists(Path.Combine(dir, "index.json")))
            {
                Console.Error.WriteLine("Cannot find the conformance folder. Pass its path as the first argument.");
                return 2;
            }
            dir = Path.GetFullPath(dir);
            Console.WriteLine("Conformance: " + dir);

            var failures = new List<string>();
            var index = (Dictionary<string, object>)Json.Parse(File.ReadAllText(Path.Combine(dir, "index.json")));
            if (!(index["protocol"] is double pv) || (int)pv != PhoneWandCore.ProtocolVersion)
                failures.Add("index.json: protocol " + index["protocol"] + ", this client speaks " + PhoneWandCore.ProtocolVersion);

            foreach (var nameObj in (List<object>)index["sessions"])
            {
                string name = (string)nameObj;
                var sessionFailures = RunSession(dir, name);
                Console.WriteLine((sessionFailures.Count == 0 ? "pass  " : "FAIL  ") + name);
                failures.AddRange(sessionFailures.Select(f => name + ": " + f));
            }

            var conversionFailures = CheckConversions(Path.Combine(dir, "conversions.json"), out int cases);
            Console.WriteLine((conversionFailures.Count == 0 ? "pass  " : "FAIL  ") + "conversions (" + cases + " cases)");
            failures.AddRange(conversionFailures.Select(f => "conversions: " + f));

            if (failures.Count == 0)
            {
                Console.WriteLine("ALL PASS");
                return 0;
            }
            Console.WriteLine();
            foreach (var f in failures) Console.WriteLine(f);
            Console.WriteLine();
            Console.WriteLine(failures.Count + " difference(s).");
            return 1;
        }

        // Look upwards from the build output and from the working directory for conformance/index.json.
        static string FindConformance()
        {
            foreach (var start in new[] { AppContext.BaseDirectory, Directory.GetCurrentDirectory() })
            {
                var d = new DirectoryInfo(start);
                while (d != null)
                {
                    var candidate = Path.Combine(d.FullName, "conformance");
                    if (File.Exists(Path.Combine(candidate, "index.json"))) return candidate;
                    d = d.Parent;
                }
            }
            return null;
        }

        // ------------------------------------------------------------------ sessions

        static List<string> RunSession(string dir, string name)
        {
            var failures = new List<string>();
            var core = new PhoneWandCore();
            var events = new List<string>();
            core.ListenerError = e => failures.Add("listener threw: " + e);
            core.Connected += h => events.Add("connected protocol=" + h.Protocol + " max=" + h.MaxPlayers);
            core.PlayerJoined += p => events.Add("join " + p.Id + " slot=" + p.Slot + " name=" + p.Name + " colour=" + p.Colour);
            core.PlayerChanged += p => events.Add("player " + p.Id + " state=" + ProtocolNames.Of(p.State) + " calibration=" +
                ProtocolNames.Of(p.Calibration) + " name=" + p.Name + " colour=" + p.Colour + " transport=" + p.Device.Transport);
            core.PlayerLeft += p => events.Add("leave " + p.Id);
            core.Pose += (pose, p) => events.Add("pose " + pose.Id + " seq=" + pose.Seq + " screen=" + (pose.Screen.HasValue ? "yes" : "no"));
            core.Button += (e, p) => events.Add("button " + e.Id + " " + ProtocolNames.Of(e.Button) + " " + (e.Down ? "down" : "up"));
            core.Calibrating += (step, p) => events.Add("calibrating " + p.Id + " " + ProtocolNames.Of(step));
            core.Calibrated += (c, p) => events.Add("calibrated " + p.Id + " " + ProtocolNames.Of(c));
            core.Stats += (s, p) => events.Add("stats " + s.Id);

            foreach (var line in File.ReadAllLines(Path.Combine(dir, "app", name + ".jsonl")))
            {
                if (line.Trim().Length == 0) continue;
                core.Handle(line);
            }

            // Event log, line by line.
            var expected = File.ReadAllText(Path.Combine(dir, "app", name + ".events.txt")).Replace("\r\n", "\n")
                .Split('\n').ToList();
            if (expected.Count > 0 && expected[expected.Count - 1] == "") expected.RemoveAt(expected.Count - 1);
            int n = Math.Max(expected.Count, events.Count);
            int shown = 0;
            for (int i = 0; i < n; i++)
            {
                string want = i < expected.Count ? expected[i] : "(nothing)";
                string got = i < events.Count ? events[i] : "(nothing)";
                if (want == got) continue;
                if (shown++ < 20) failures.Add("events line " + (i + 1) + ": expected \"" + want + "\", got \"" + got + "\"");
            }
            if (shown > 20) failures.Add("events: " + (shown - 20) + " more differing line(s)");

            // Final state.
            var expectedState = Json.Parse(File.ReadAllText(Path.Combine(dir, "app", name + ".state.json")));
            Compare("state", expectedState, StateOf(core), failures);
            return failures;
        }

        static object StateOf(PhoneWandCore core)
        {
            var players = new List<object>();
            foreach (var p in core.Players)
            {
                object pose = null;
                if (p.Pose != null)
                {
                    var q = p.Pose.Rotation;
                    var d = p.Pose.Direction;
                    pose = new Dictionary<string, object>
                    {
                        { "seq", (double)p.Pose.Seq },
                        { "yaw", p.Pose.Yaw },
                        { "pitch", p.Pose.Pitch },
                        { "roll", p.Pose.Roll },
                        { "q", new List<object> { q.X, q.Y, q.Z, q.W } },
                        { "dir", new List<object> { d.Right, d.Up, d.Forward } },
                        { "screen", p.Pose.Screen.HasValue ? new List<object> { p.Pose.Screen.Value.X, p.Pose.Screen.Value.Y } : null },
                    };
                }
                players.Add(new Dictionary<string, object>
                {
                    { "id", p.Id },
                    { "slot", (double)p.Slot },
                    { "name", p.Name },
                    { "colour", p.Colour },
                    { "label", p.Label },
                    { "state", ProtocolNames.Of(p.State) },
                    { "calibration", ProtocolNames.Of(p.Calibration) },
                    { "transport", p.Device.Transport },
                    { "buttons", p.Buttons.Select(ProtocolNames.Of).OrderBy(s => s, StringComparer.Ordinal).Cast<object>().ToList() },
                    { "pose", pose },
                });
            }
            return new Dictionary<string, object> { { "players", players } };
        }

        // Structural comparison: strings and bools exactly, numbers to within Tolerance.
        static void Compare(string path, object want, object got, List<string> failures)
        {
            if (want is double wd)
            {
                if (!(got is double gd) || Math.Abs(wd - gd) > Tolerance)
                    failures.Add(path + ": expected " + Show(want) + ", got " + Show(got));
                return;
            }
            if (want is Dictionary<string, object> wo)
            {
                if (!(got is Dictionary<string, object> go))
                {
                    failures.Add(path + ": expected an object, got " + Show(got));
                    return;
                }
                foreach (var key in wo.Keys.Union(go.Keys))
                {
                    if (!wo.ContainsKey(key)) failures.Add(path + "." + key + ": not expected, got " + Show(go[key]));
                    else if (!go.ContainsKey(key)) failures.Add(path + "." + key + ": missing, expected " + Show(wo[key]));
                    else Compare(path + "." + key, wo[key], go[key], failures);
                }
                return;
            }
            if (want is List<object> wl)
            {
                if (!(got is List<object> gl) || gl.Count != wl.Count)
                {
                    failures.Add(path + ": expected " + Show(want) + ", got " + Show(got));
                    return;
                }
                for (int i = 0; i < wl.Count; i++) Compare(path + "[" + i + "]", wl[i], gl[i], failures);
                return;
            }
            if (!Equals(want, got)) failures.Add(path + ": expected " + Show(want) + ", got " + Show(got));
        }

        static string Show(object o) => o == null ? "null" : Json.Write(o);

        // ------------------------------------------------------------------ conversions

        static List<string> CheckConversions(string file, out int count)
        {
            var failures = new List<string>();
            var doc = (Dictionary<string, object>)Json.Parse(File.ReadAllText(file));
            var cases = (List<object>)doc["cases"];
            count = cases.Count;
            for (int i = 0; i < cases.Count; i++)
            {
                var c = (Dictionary<string, object>)cases[i];
                var rig = (Dictionary<string, object>)c["rig"];
                var unity = (Dictionary<string, object>)c["unity"];

                // The conversions the Unity assembly applies (PhoneWandExtensions): components copied
                // straight across, x = right, y = up, z = forward; quaternion x, y, z, w unchanged.
                var rq = Quat(rig["q"]);
                var unityQ = new[] { rq.X, rq.Y, rq.Z, rq.W };
                var rd = Vec(rig["dir"]);
                var unityDir = new[] { rd.Right, rd.Up, rd.Forward };
                var ru = Vec(rig["up"]);
                var unityUp = new[] { ru.Right, ru.Up, ru.Forward };
                Near("case " + i + " unity.q", unity["q"], unityQ, failures);
                Near("case " + i + " unity.dir", unity["dir"], unityDir, failures);
                Near("case " + i + " unity.up", unity["up"], unityUp, failures);

                // Rotating Unity's forward (+z) and up (+y) by the Unity quaternion gives dir and up.
                var uq = Quat(unity["q"]);
                var f = uq.Rotate(new RigVector3(0, 0, 1));
                var u = uq.Rotate(new RigVector3(0, 1, 0));
                Near("case " + i + " unity q * forward", unity["dir"], new[] { f.Right, f.Up, f.Forward }, failures);
                Near("case " + i + " unity q * up", unity["up"], new[] { u.Right, u.Up, u.Forward }, failures);

                // And in the rig frame: the pose's dir is the body forward rotated by q.
                var rf = rq.Forward;
                Near("case " + i + " rig q.Forward", rig["dir"], new[] { rf.Right, rf.Up, rf.Forward }, failures);
                var rup = rq.Up;
                Near("case " + i + " rig q.Up", rig["up"], new[] { rup.Right, rup.Up, rup.Forward }, failures);
            }
            return failures;
        }

        static RigQuaternion Quat(object o)
        {
            var l = (List<object>)o;
            return new RigQuaternion((double)l[0], (double)l[1], (double)l[2], (double)l[3]);
        }

        static RigVector3 Vec(object o)
        {
            var l = (List<object>)o;
            return new RigVector3((double)l[0], (double)l[1], (double)l[2]);
        }

        static void Near(string what, object want, double[] got, List<string> failures)
        {
            var w = (List<object>)want;
            bool ok = w.Count == got.Length;
            for (int i = 0; ok && i < got.Length; i++) ok = Math.Abs((double)w[i] - got[i]) <= Tolerance;
            if (!ok)
                failures.Add(what + ": expected " + Json.Write(w) + ", got " + Json.Write(got.Cast<object>().ToList()));
        }

        // ------------------------------------------------------------------ live

        // Connect to a running relay for a few seconds and report what arrived. Exit 0 only if the
        // hello, at least one join and at least one pose were seen.
        static int Live(string url, double seconds)
        {
            var connection = new PhoneWandConnection(url) { AutoReconnect = false };
            var core = connection.Core;
            int hellos = 0, joins = 0, poses = 0, buttons = 0, stats = 0;
            core.Connected += h => { hellos++; Console.WriteLine("hello: protocol " + h.Protocol + ", relay " + h.Relay + ", join " + h.JoinUrl); };
            core.PlayerJoined += p => { joins++; Console.WriteLine("join: " + p.Id + " " + p.Name + " slot " + p.Slot + " " + p.Colour); };
            core.Pose += (pose, p) => poses++;
            core.Button += (e, p) => buttons++;
            core.Stats += (s, p) => stats++;
            connection.Connect();
            var sw = Stopwatch.StartNew();
            while (sw.Elapsed.TotalSeconds < seconds)
            {
                connection.Pump();
                Thread.Sleep(10);
            }
            foreach (var p in core.Players)
            {
                var pose = p.Pose;
                Console.WriteLine("player " + p.Id + ": " + ProtocolNames.Of(p.State) + ", pose " +
                    (pose == null ? "none" : "seq " + pose.Seq + " screen " + (pose.Screen.HasValue ? pose.Screen.Value.ToString() : "null")));
            }
            connection.Close();
            Console.WriteLine("hello=" + hellos + " joins=" + joins + " poses=" + poses + " buttons=" + buttons + " stats=" + stats);
            bool ok = hellos > 0 && joins > 0 && poses > 0;
            Console.WriteLine(ok ? "LIVE PASS" : "LIVE FAIL");
            return ok ? 0 : 1;
        }
    }
}
