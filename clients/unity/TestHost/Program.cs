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

            var layoutFailures = CheckLayoutMessages();
            Console.WriteLine((layoutFailures.Count == 0 ? "pass  " : "FAIL  ") + "layout and set messages");
            failures.AddRange(layoutFailures.Select(f => "layout messages: " + f));

            var gestureFailures = CheckGestureMessages();
            Console.WriteLine((gestureFailures.Count == 0 ? "pass  " : "FAIL  ") + "gesture and configure messages");
            failures.AddRange(gestureFailures.Select(f => "gesture messages: " + f));

            var relayFailures = CheckManagedRelay();
            Console.WriteLine((relayFailures.Count == 0 ? "pass  " : "FAIL  ") + "managed relay helpers");
            failures.AddRange(relayFailures.Select(f => "managed relay: " + f));

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
            core.Button += (e, p) => events.Add("button " + e.Id + " " + e.Button + " " + (e.Down ? "down" : "up"));
            core.ControlChanged += (e, p) => events.Add("control " + e.Id + " " + e.Control);
            core.Gesture += (g, p) => events.Add("gesture " + g.Id + " " + g.Gesture + " buttons=" +
                (g.Buttons.Count == 0 ? "-" : string.Join(",", g.Buttons)));
            // error fires nothing in the log, but must reach a listener rather than the console.
            core.Error += message => { };
            core.UnhandledError = message => failures.Add("error reached UnhandledError despite a listener: " + message);
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
                    { "buttons", p.Buttons.OrderBy(s => s, StringComparer.Ordinal).Cast<object>().ToList() },
                    { "template", p.Layout.Template },
                    { "controls", p.Controls.ToDictionary(kv => kv.Key, kv => kv.Value) },
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

        // What SetLayout and SetControl send, the builders, the layout round trip, and error with and
        // without a listener.
        static List<string> CheckLayoutMessages()
        {
            var failures = new List<string>();
            void Expect(string what, object want, object got)
            {
                if (!Equals(want, got)) failures.Add(what + ": expected " + Show(want) + ", got " + Show(got));
            }
            var core = new PhoneWandCore();
            var sent = new List<string>();
            core.Sender = sent.Add;

            var grid = Layout.Grid(
                Control.Button("fire", "Fire").WithColour("#00ff88"),
                Control.Toggle("shield", "Shield"),
                Control.Slider("power", "Power", 0.25),
                Control.Slider("throttle", vertical: true, spring: 0.5),
                Control.Choice("weapon", null, new[] { "Bow", "Sling", "Net" }, 1),
                Control.TextLabel("score", "Score", "0"));
            core.SetLayout(grid, "p1");
            Expect("SetLayout grid", "{\"type\":\"layout\",\"layout\":{\"template\":\"grid\",\"controls\":[" +
                "{\"id\":\"fire\",\"type\":\"button\",\"label\":\"Fire\",\"colour\":\"#00ff88\"}," +
                "{\"id\":\"shield\",\"type\":\"toggle\",\"label\":\"Shield\",\"value\":false}," +
                "{\"id\":\"power\",\"type\":\"slider\",\"label\":\"Power\",\"value\":0.25,\"orientation\":\"horizontal\"}," +
                "{\"id\":\"throttle\",\"type\":\"slider\",\"orientation\":\"vertical\",\"spring\":0.5}," +
                "{\"id\":\"weapon\",\"type\":\"choice\",\"value\":1,\"options\":[\"Bow\",\"Sling\",\"Net\"]}," +
                "{\"id\":\"score\",\"type\":\"label\",\"label\":\"Score\",\"text\":\"0\"}]},\"id\":\"p1\"}",
                sent.Count > 0 ? sent[sent.Count - 1] : null);
            core.SetLayout(null);
            Expect("SetLayout null", "{\"type\":\"layout\",\"layout\":null}", sent[sent.Count - 1]);
            core.SetLayout(Layout.PrimaryRow(Control.Button("shoot", "Shoot"), Control.Toggle("zoom", "Zoom", true)));
            Expect("SetLayout primary-row", "{\"type\":\"layout\",\"layout\":{\"template\":\"primary-row\",\"controls\":[" +
                "{\"id\":\"shoot\",\"type\":\"button\",\"label\":\"Shoot\"},{\"id\":\"zoom\",\"type\":\"toggle\",\"label\":\"Zoom\",\"value\":true}]}}",
                sent[sent.Count - 1]);
            core.SetControl("zoom", true, "p2");
            Expect("SetControl bool", "{\"type\":\"set\",\"control\":\"zoom\",\"value\":true,\"id\":\"p2\"}", sent[sent.Count - 1]);
            core.SetControl("power", 0.8);
            Expect("SetControl double", "{\"type\":\"set\",\"control\":\"power\",\"value\":0.8}", sent[sent.Count - 1]);
            core.SetControl("weapon", 2);
            Expect("SetControl int", "{\"type\":\"set\",\"control\":\"weapon\",\"value\":2}", sent[sent.Count - 1]);
            core.SetControl("score", "120");
            Expect("SetControl string", "{\"type\":\"set\",\"control\":\"score\",\"value\":\"120\"}", sent[sent.Count - 1]);

            // Round trip: the JSON a layout writes reads back as the same JSON.
            var back = Layout.FromJsonValue((Dictionary<string, object>)Json.Parse(grid.ToJson()));
            Expect("round trip", grid.ToJson(), back.ToJson());
            Expect("Find", "power", grid.Find("power") != null ? grid.Find("power").Id : null);
            // D-pad and crawl pad: no value, and their directions are buttons "<id>.<direction>".
            var crawl = Layout.PrimarySecondary(Control.Crawl("walk", "Walk").WithColour("#3366ff"), Control.Button("use", "Use"));
            Expect("Crawl", "{\"template\":\"primary-secondary\",\"controls\":[" +
                "{\"id\":\"walk\",\"type\":\"crawl\",\"label\":\"Walk\",\"colour\":\"#3366ff\"}," +
                "{\"id\":\"use\",\"type\":\"button\",\"label\":\"Use\"}]}", crawl.ToJson());
            Expect("Crawl round trip", crawl.ToJson(),
                Layout.FromJsonValue((Dictionary<string, object>)Json.Parse(crawl.ToJson())).ToJson());
            var dpad = Layout.Pair(Control.Dpad("move"), Control.Button("a", "A"));
            Expect("Dpad", "{\"template\":\"pair\",\"controls\":[" +
                "{\"id\":\"move\",\"type\":\"dpad\"},{\"id\":\"a\",\"type\":\"button\",\"label\":\"A\"}]}", dpad.ToJson());
            Expect("Dpad round trip", dpad.ToJson(),
                Layout.FromJsonValue((Dictionary<string, object>)Json.Parse(dpad.ToJson())).ToJson());
            // Rows and columns: counts and optional sizes after the controls, and any control first.
            var rows = Layout.InRows(new[] { 1, 3 }, Control.Crawl("walk"), Control.Button("attack", "Attack"),
                Control.Button("use", "Use"), Control.Toggle("map", "Map")).WithHeights(3, 2);
            Expect("InRows", "{\"template\":\"rows\",\"controls\":[" +
                "{\"id\":\"walk\",\"type\":\"crawl\"},{\"id\":\"attack\",\"type\":\"button\",\"label\":\"Attack\"}," +
                "{\"id\":\"use\",\"type\":\"button\",\"label\":\"Use\"},{\"id\":\"map\",\"type\":\"toggle\",\"label\":\"Map\",\"value\":false}]," +
                "\"rows\":[1,3],\"heights\":[3,2]}", rows.ToJson());
            var rowsBack = Layout.FromJsonValue((Dictionary<string, object>)Json.Parse(rows.ToJson()));
            Expect("InRows round trip", rows.ToJson(), rowsBack.ToJson());
            Expect("InRows Rows", "1,3", rowsBack.Rows != null ? string.Join(",", rowsBack.Rows) : null);
            var columns = Layout.InColumns(new[] { 1, 2 }, Control.Slider("throttle", vertical: true),
                Control.Button("fire", "Fire"), Control.Button("boost"));
            Expect("InColumns", "{\"template\":\"columns\",\"controls\":[" +
                "{\"id\":\"throttle\",\"type\":\"slider\",\"orientation\":\"vertical\"}," +
                "{\"id\":\"fire\",\"type\":\"button\",\"label\":\"Fire\"},{\"id\":\"boost\",\"type\":\"button\"}]," +
                "\"columns\":[1,2]}", columns.ToJson());
            var columnsBack = Layout.FromJsonValue((Dictionary<string, object>)Json.Parse(columns.ToJson()));
            Expect("InColumns round trip", columns.ToJson(), columnsBack.ToJson());
            Expect("InColumns no widths", true, columnsBack.Widths == null && columnsBack.Rows == null);
            Expect("ButtonFor dpad", "move.up", Control.ButtonFor("move", DpadDirection.Up));
            Expect("ButtonFor crawl", "walk.turn-left", Control.ButtonFor("walk", CrawlDirection.TurnLeft));
            Expect("DpadDirection.All", "up,down,left,right", string.Join(",", DpadDirection.All));
            Expect("CrawlDirection.All", "forward,back,step-left,step-right,turn-left,turn-right", string.Join(",", CrawlDirection.All));
            Expect("Default", "{\"template\":\"primary-secondary\",\"controls\":[{\"id\":\"primary\",\"type\":\"button\",\"label\":\"Primary\"}," +
                "{\"id\":\"secondary\",\"type\":\"button\",\"label\":\"Secondary\"}]}", Layout.Default.ToJson());

            // A player before any layout has the default; control values and their getters.
            core.Handle("{\"type\":\"join\",\"player\":{\"id\":\"p1\",\"slot\":0,\"name\":\"A\",\"state\":\"active\"}}");
            var p = core.GetPlayer("p1");
            Expect("default template", LayoutTemplate.PrimarySecondary, p.Layout.Template);
            Expect("default controls", 0, p.Controls.Count);
            core.Handle("{\"type\":\"control\",\"id\":\"p1\",\"control\":\"shield\",\"value\":true}");
            core.Handle("{\"type\":\"control\",\"id\":\"p1\",\"control\":\"power\",\"value\":0.5}");
            core.Handle("{\"type\":\"control\",\"id\":\"p1\",\"control\":\"weapon\",\"value\":2}");
            core.Handle("{\"type\":\"control\",\"id\":\"p1\",\"control\":\"score\",\"value\":\"7\"}");
            Expect("GetToggle", true, p.GetToggle("shield"));
            Expect("GetSlider", 0.5, p.GetSlider("power"));
            Expect("GetChoice", 2, p.GetChoice("weapon"));
            Expect("GetText", "7", p.GetText("score"));
            Expect("GetToggle missing", false, p.GetToggle("nope"));
            core.Handle("{\"type\":\"button\",\"id\":\"p1\",\"button\":\"fire\",\"down\":true}");
            Expect("IsHeld custom", true, p.IsHeld("fire"));
            Expect("IsHeld primary", false, p.IsHeld(PhoneButton.Primary));
            core.Handle("{\"type\":\"button\",\"id\":\"p1\",\"button\":\"walk.step-right\",\"down\":true}");
            Expect("IsHeld crawl direction", true, p.IsHeld(Control.ButtonFor("walk", CrawlDirection.StepRight)));

            // error: to UnhandledError with no listener, to the listener otherwise.
            var unhandled = new List<string>();
            var heard = new List<string>();
            core.UnhandledError = unhandled.Add;
            core.Handle("{\"type\":\"error\",\"message\":\"layout: nope\"}");
            Expect("error unheard", "layout: nope", unhandled.Count == 1 ? unhandled[0] : null);
            Action<string> listener = heard.Add;
            core.Error += listener;
            core.Handle("{\"type\":\"error\",\"message\":\"set: nope\"}");
            Expect("error heard", "set: nope", heard.Count == 1 ? heard[0] : null);
            Expect("error not also unhandled", 1, unhandled.Count);
            core.Error -= listener;
            return failures;
        }

        // What Configure sends for gestures, that the connection re-sends both settings on connect,
        // and how gesture and accel fields are read.
        static List<string> CheckGestureMessages()
        {
            var failures = new List<string>();
            void Expect(string what, object want, object got)
            {
                if (!Equals(want, got)) failures.Add(what + ": expected " + Show(want) + ", got " + Show(got));
            }
            var core = new PhoneWandCore();
            var sent = new List<string>();
            core.Sender = sent.Add;
            string Last() => sent.Count > 0 ? sent[sent.Count - 1] : null;

            core.Configure(new GestureSensitivity(9));
            Expect("Configure gestures", "{\"type\":\"configure\",\"gestures\":{\"threshold\":9,\"minSpeed\":0.35,\"flickRate\":250,\"twistRate\":360}}", Last());
            core.Configure(new GestureSensitivity { Threshold = 5 });
            Expect("Configure gestures partial", "{\"type\":\"configure\",\"gestures\":{\"threshold\":5}}", Last());
            core.Configure(GestureSensitivity.Off);
            Expect("Configure gestures off", "{\"type\":\"configure\",\"gestures\":false}", Last());
            core.Configure(Smoothing.Off, GestureSensitivity.Default);
            Expect("Configure both", "{\"type\":\"configure\",\"smoothing\":false,\"gestures\":{\"threshold\":7,\"minSpeed\":0.35,\"flickRate\":250,\"twistRate\":360}}", Last());
            int before = sent.Count;
            core.Configure(null, null);
            Expect("Configure neither sends nothing", before, sent.Count);

            // The connection sends both settings when it opens, in one message.
            var transport = new FakeTransport();
            var connection = new PhoneWandConnection("ws://fake/app") { TransportFactory = () => transport };
            connection.Smoothing = new Smoothing(1, 5, 1);
            connection.Gestures = GestureSensitivity.Off;
            Expect("nothing sent before open", 0, transport.Sent.Count);
            connection.Connect();
            transport.Accept();
            connection.Pump();
            Expect("configure on open", "{\"type\":\"configure\",\"smoothing\":{\"minCutoff\":1,\"beta\":5,\"dCutoff\":1},\"gestures\":false}",
                transport.Sent.Count == 1 ? transport.Sent[0] : Show(transport.Sent.Cast<object>().ToList()));
            connection.Gestures = new GestureSensitivity(8, 0.4, 300);
            Expect("configure while open", "{\"type\":\"configure\",\"gestures\":{\"threshold\":8,\"minSpeed\":0.4,\"flickRate\":250,\"twistRate\":300}}",
                transport.Sent.Count == 2 ? transport.Sent[1] : null);
            connection.Close();

            // gesture for a known player fires with every field; for an unknown one, nothing.
            var heard = new List<GestureEvent>();
            core.Gesture += (g, p) => heard.Add(g);
            core.Handle("{\"type\":\"gesture\",\"id\":\"p9\",\"gesture\":\"push\",\"strength\":1,\"speed\":1,\"dir\":[0,0,1],\"duration\":1,\"t\":1,\"buttons\":[]}");
            Expect("gesture unknown player", 0, heard.Count);
            core.Handle("{\"type\":\"join\",\"player\":{\"id\":\"p1\",\"slot\":0,\"name\":\"A\",\"state\":\"active\"}}");
            core.Handle("{\"type\":\"gesture\",\"id\":\"p1\",\"gesture\":\"pull\",\"strength\":0.62,\"speed\":1.55," +
                "\"dir\":[0.05,-0.1,-0.99],\"duration\":240,\"t\":1790300000123.4,\"buttons\":[\"secondary\",\"primary\"]}");
            Expect("gesture heard", 1, heard.Count);
            if (heard.Count == 1)
            {
                var g = heard[0];
                Expect("gesture Id", "p1", g.Id);
                Expect("gesture Gesture", GestureName.Pull, g.Gesture);
                Expect("gesture Is", true, g.Is(GestureName.Pull));
                Expect("gesture Strength", 0.62, g.Strength);
                Expect("gesture Speed", 1.55, g.Speed);
                Expect("gesture Dir", new RigVector3(0.05, -0.1, -0.99), g.Dir);
                Expect("gesture Duration", 240.0, g.Duration);
                Expect("gesture T", 1790300000123.4, g.T);
                Expect("gesture Buttons", "primary,secondary", string.Join(",", g.Buttons));
                Expect("gesture WasHeld", true, g.WasHeld(PhoneButton.Primary));
                Expect("gesture WasHeld other", false, g.WasHeld("fire"));
            }
            string[] names = { GestureName.Push, GestureName.Pull, GestureName.Left, GestureName.Right, GestureName.Up,
                GestureName.Down, GestureName.Shake, GestureName.TwistLeft, GestureName.TwistRight };
            Expect("gesture names", "push pull left right up down shake twist-left twist-right", string.Join(" ", names));

            // accel on a pose, and its absence.
            core.Handle("{\"type\":\"pose\",\"id\":\"p1\",\"seq\":1,\"t\":0,\"q\":[0,0,0,1],\"dir\":[0,0,1],\"screen\":null,\"accel\":[1.5,-2,3]}");
            Expect("pose Accel", (RigVector3?)new RigVector3(1.5, -2, 3), core.GetPlayer("p1").Pose.Accel);
            core.Handle("{\"type\":\"pose\",\"id\":\"p1\",\"seq\":2,\"t\":0,\"q\":[0,0,0,1],\"dir\":[0,0,1],\"screen\":null}");
            Expect("pose no Accel", false, core.GetPlayer("p1").Pose.Accel.HasValue);
            return failures;
        }

        // A transport the test drives by hand.
        sealed class FakeTransport : ITransport
        {
            readonly Queue<TransportEvent> events = new Queue<TransportEvent>();
            public readonly List<string> Sent = new List<string>();
            public void Accept() => events.Enqueue(new TransportEvent(TransportEventKind.Opened));
            public void Open(string url) { }
            public void Send(string text) => Sent.Add(text);
            public void Close() { }
            public bool TryReceive(out TransportEvent e)
            {
                if (events.Count > 0) { e = events.Dequeue(); return true; }
                e = default(TransportEvent);
                return false;
            }
        }

        // The parts of ManagedRelay that need no relay: which URLs count, the port, the command
        // line, and what happens when there is nothing to start. The live test is PhoneWandChecks.ManagedRelay.
        static List<string> CheckManagedRelay()
        {
            var failures = new List<string>();
            void Expect(string what, object want, object got)
            {
                if (!Equals(want, got)) failures.Add(what + ": expected " + Show(want) + ", got " + Show(got));
            }
            Expect("IsLocal 127.0.0.1", true, ManagedRelay.IsLocal("ws://127.0.0.1:8480/app"));
            Expect("IsLocal localhost", true, ManagedRelay.IsLocal("ws://localhost:9000/app"));
            Expect("IsLocal [::1]", true, ManagedRelay.IsLocal("ws://[::1]:8480/app"));
            Expect("IsLocal remote", false, ManagedRelay.IsLocal("ws://192.168.1.20:8480/app"));
            Expect("IsLocal garbage", false, ManagedRelay.IsLocal("not a url"));
            Expect("AppPortOf explicit", 23480, ManagedRelay.AppPortOf("ws://127.0.0.1:23480/app"));
            Expect("AppPortOf none", 8480, ManagedRelay.AppPortOf("ws://127.0.0.1/app"));
            Expect("BuildArguments", "--lifeline --no-open --app-port 23480 --log \"/a b/phone-wand-relay.log\" --port 23443 --key x",
                ManagedRelay.BuildArguments(23480, "/a b/phone-wand-relay.log", " --port 23443 --key x "));
            Expect("BuildArguments no extra", "--lifeline --no-open --app-port 8480 --log /tmp/r.log",
                ManagedRelay.BuildArguments(8480, "/tmp/r.log", null));
            Expect("Platform known here", true, ManagedRelay.Platform() != null);

            string missing = Path.Combine(Path.GetTempPath(), "phone-wand-no-such-folder-" + Guid.NewGuid().ToString("N"));
            Expect("FindExecutable missing", null, ManagedRelay.FindExecutable(missing, out string looked));
            Expect("FindExecutable says where", true, looked != null && looked.StartsWith(Path.Combine(missing, ManagedRelay.Platform() ?? "")));

            var logged = new List<string>();
            Expect("Start remote", null, ManagedRelay.Start(new ManagedRelayOptions { Url = "ws://10.0.0.1:8480/app", Path = missing }, logged.Add));
            Expect("Start remote logs nothing", 0, logged.Count);
            // An unused port, so no relay answers and it looks for the (missing) program.
            Expect("Start missing", null, ManagedRelay.Start(new ManagedRelayOptions { Url = "ws://127.0.0.1:1/app", Path = missing }, logged.Add));
            Expect("Start missing logs where it looked", true, logged.Count == 1 && logged[0].Contains(missing));
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
            int hellos = 0, joins = 0, poses = 0, buttons = 0, stats = 0, gestures = 0, accels = 0;
            core.Connected += h => { hellos++; Console.WriteLine("hello: protocol " + h.Protocol + ", relay " + h.Relay + ", join " + h.JoinUrl); };
            core.PlayerJoined += p => { joins++; Console.WriteLine("join: " + p.Id + " " + p.Name + " slot " + p.Slot + " " + p.Colour); };
            core.Pose += (pose, p) => { poses++; if (pose.Accel.HasValue) accels++; };
            core.Gesture += (g, p) =>
            {
                gestures++;
                Console.WriteLine("gesture: " + g.Id + " " + g.Gesture + " strength " + g.Strength.ToString("0.000", CultureInfo.InvariantCulture) +
                    " speed " + g.Speed.ToString("0.000", CultureInfo.InvariantCulture) + " dir " + g.Dir + " duration " + g.Duration +
                    " buttons [" + string.Join(",", g.Buttons) + "]");
            };
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
            Console.WriteLine("hello=" + hellos + " joins=" + joins + " poses=" + poses + " buttons=" + buttons + " stats=" + stats +
                " gestures=" + gestures + " poses-with-accel=" + accels);
            bool ok = hellos > 0 && joins > 0 && poses > 0;
            Console.WriteLine(ok ? "LIVE PASS" : "LIVE FAIL");
            return ok ? 0 : 1;
        }
    }
}
