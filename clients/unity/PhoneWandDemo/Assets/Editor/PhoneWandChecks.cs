// Batch-mode checks for the Phone Wand Unity package, run by scripts/check-unity.sh. They live in
// the demo project rather than the package, so users never see them.
//
//   Unity -batchmode -nographics -projectPath clients/unity/PhoneWandDemo \
//     -executeMethod PhoneWandChecks.Conversions
//   Unity -batchmode -nographics -projectPath clients/unity/PhoneWandDemo \
//     -executeMethod PhoneWandChecks.Live -phoneWandUrl ws://127.0.0.1:8480/app -phoneWandSeconds 3
//   Unity -batchmode -nographics -projectPath clients/unity/PhoneWandDemo \
//     -executeMethod PhoneWandChecks.ManagedRelay -phoneWandUrl ws://127.0.0.1:23480/app \
//     -phoneWandRelayArgs "--port 23443 --no-landing"
//   Unity -batchmode -nographics -projectPath clients/unity/PhoneWandDemo \
//     -executeMethod PhoneWandChecks.Layouts -phoneWandUrl ws://127.0.0.1:8480/app
//   Unity -batchmode -nographics -projectPath clients/unity/PhoneWandDemo \
//     -executeMethod PhoneWandChecks.Gestures -phoneWandUrl ws://127.0.0.1:8480/app
//
// Each exits the editor with 0 on success and 1 on failure, and logs a line starting with
// "PhoneWandChecks:".

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Threading;
using StoryTools.PhoneWand;
using UnityEditor;
using UnityEngine;
using Debug = UnityEngine.Debug;

public static class PhoneWandChecks
{
    /// <summary>
    /// conformance/conversions.json through the Unity conversions and Unity's own quaternion
    /// maths: the converted quaternion times Vector3.forward and Vector3.up must give the case's
    /// Unity dir and up.
    /// </summary>
    public static void Conversions()
    {
        int code = 1;
        try
        {
            string file = Arg("-phoneWandConformance") ??
                Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "..", "conformance", "conversions.json"));
            var doc = (Dictionary<string, object>)Json.Parse(File.ReadAllText(file));
            var cases = (List<object>)doc["cases"];
            var failures = new List<string>();
            for (int i = 0; i < cases.Count; i++)
            {
                var c = (Dictionary<string, object>)cases[i];
                var rig = (Dictionary<string, object>)c["rig"];
                var unity = (Dictionary<string, object>)c["unity"];
                var rq = (List<object>)rig["q"];
                var rd = (List<object>)rig["dir"];
                Quaternion q = new RigQuaternion((double)rq[0], (double)rq[1], (double)rq[2], (double)rq[3]).ToQuaternion();
                Vector3 dir = new RigVector3((double)rd[0], (double)rd[1], (double)rd[2]).ToVector3();
                Expect(failures, "case " + i + " q", unity["q"], new[] { q.x, q.y, q.z, q.w });
                Expect(failures, "case " + i + " dir", unity["dir"], new[] { dir.x, dir.y, dir.z });
                Vector3 f = q * Vector3.forward;
                Vector3 u = q * Vector3.up;
                Expect(failures, "case " + i + " q * forward", unity["dir"], new[] { f.x, f.y, f.z });
                Expect(failures, "case " + i + " q * up", unity["up"], new[] { u.x, u.y, u.z });
            }
            foreach (var f in failures) Debug.LogError("PhoneWandChecks: " + f);
            if (failures.Count == 0)
            {
                Debug.Log("PhoneWandChecks: conversions PASS (" + cases.Count + " cases, UnityEngine maths)");
                code = 0;
            }
            else
            {
                Debug.LogError("PhoneWandChecks: conversions FAIL");
            }
        }
        catch (Exception e)
        {
            Debug.LogError("PhoneWandChecks: conversions FAIL: " + e);
        }
        EditorApplication.Exit(code);
    }

    /// <summary>
    /// Connect the client to a running relay for a few seconds. Passes only if the relay said
    /// hello, at least one player joined and at least one pose arrived.
    /// </summary>
    public static void Live()
    {
        int code = 1;
        try
        {
            string url = Arg("-phoneWandUrl") ?? PhoneWandCore.DefaultUrl;
            double seconds = double.Parse(Arg("-phoneWandSeconds") ?? "3", CultureInfo.InvariantCulture);
            var connection = new PhoneWandConnection(url) { AutoReconnect = false };
            var core = connection.Core;
            core.ListenerError = Debug.LogException;
            int hellos = 0, joins = 0, poses = 0, buttons = 0, stats = 0;
            core.Connected += h => { hellos++; Debug.Log("PhoneWandChecks: hello from relay " + h.Relay + ", protocol " + h.Protocol); };
            core.PlayerJoined += p => { joins++; Debug.Log("PhoneWandChecks: join " + p.Id + " \"" + p.Name + "\" slot " + p.Slot); };
            core.Pose += (pose, p) =>
            {
                poses++;
                // Exercise the Unity conversions on live data too.
                Vector3 d = PhoneWandClient.Direction(pose);
                Quaternion q = PhoneWandClient.Rotation(pose);
                if (Vector3.Distance(q * Vector3.forward, d) > 0.01f)
                    Debug.LogWarning("PhoneWandChecks: pose " + pose.Seq + " rotation does not match its direction");
            };
            core.Button += (e, p) => buttons++;
            core.Stats += (s, p) => stats++;

            Debug.Log("PhoneWandChecks: connecting to " + url + " for " + seconds + " s");
            connection.Connect();
            var clock = Stopwatch.StartNew();
            while (clock.Elapsed.TotalSeconds < seconds)
            {
                connection.Pump();
                Thread.Sleep(10);
            }
            int players = core.Players.Count;
            connection.Close();

            string summary = "hello=" + hellos + " joins=" + joins + " poses=" + poses + " buttons=" + buttons +
                " stats=" + stats + " players=" + players;
            if (hellos > 0 && joins > 0 && poses > 0)
            {
                Debug.Log("PhoneWandChecks: live PASS " + summary);
                code = 0;
            }
            else
            {
                Debug.LogError("PhoneWandChecks: live FAIL " + summary);
            }
        }
        catch (Exception e)
        {
            Debug.LogError("PhoneWandChecks: live FAIL: " + e);
        }
        EditorApplication.Exit(code);
    }

    /// <summary>
    /// Start Relay on a PhoneWandClient. With no relay answering on the URL's port, the client must
    /// start one from StreamingAssets/phone-wand-relay, connect and get a hello, and stopping the
    /// client (its OnDisable) must stop that relay: status.json no longer answers and the process
    /// has exited. With a relay already running there, the client must start none, connect to it,
    /// and leave it running when it stops. -phoneWandRelayArgs are the extra relay options.
    /// </summary>
    public static void ManagedRelay()
    {
        int code = 1;
        GameObject go = null;
        StoryTools.PhoneWand.ManagedRelay started = null;
        try
        {
            string url = Arg("-phoneWandUrl") ?? "ws://127.0.0.1:23480/app";
            string relayArgs = Arg("-phoneWandRelayArgs") ?? "";
            double seconds = double.Parse(Arg("-phoneWandSeconds") ?? "20", CultureInfo.InvariantCulture);
            int port = StoryTools.PhoneWand.ManagedRelay.AppPortOf(url);
            bool existing = StoryTools.PhoneWand.ManagedRelay.RelayAnswers(port);
            Debug.Log("PhoneWandChecks: managed relay for " + url + (existing
                ? ": a relay is already running, so the client must use it and leave it alone"
                : ": no relay running, so the client must start one from " + PhoneWandClient.DefaultRelayPath));

            // In edit mode the component's Awake and OnEnable don't run, so this drives it by hand:
            // Connect() as OnEnable does, Pump() as Update does, and OnDisable as disabling does.
            go = new GameObject("PhoneWandChecks.ManagedRelay");
            var wand = go.AddComponent<PhoneWandClient>();
            wand.Url = url;
            wand.AutoReconnect = true;
            wand.StartRelay = true;
            wand.RelayArguments = relayArgs;
            wand.Connect();
            started = wand.Relay;
            var failures = new List<string>();
            int pid = -1;
            if (existing && started != null) failures.Add("the client started a relay although one was running");
            if (!existing)
            {
                if (started == null) failures.Add("the client did not start a relay");
                else
                {
                    pid = started.Process.Id;
                    Debug.Log("PhoneWandChecks: the client started relay process " + pid + "; its log is " + PhoneWandClient.RelayLogFile);
                }
            }

            RelayHello hello = null;
            var clock = Stopwatch.StartNew();
            while (clock.Elapsed.TotalSeconds < seconds && (hello = wand.Hello) == null)
            {
                wand.Connection.Pump();
                Thread.Sleep(20);
            }
            if (hello == null) failures.Add("no hello within " + seconds + " s");
            else Debug.Log("PhoneWandChecks: hello from relay " + hello.Relay + " after " +
                clock.Elapsed.TotalSeconds.ToString("0.0", CultureInfo.InvariantCulture) + " s; phones join at " + hello.JoinUrl);

            // Connecting again must not start a second relay.
            wand.Connect();
            if (wand.Relay != started) failures.Add("connecting again replaced the relay");

            var stopping = Stopwatch.StartNew();
            typeof(PhoneWandClient).GetMethod("OnDisable", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
                .Invoke(wand, null);
            // Under two seconds means the relay stopped by itself when its input closed (--lifeline).
            Debug.Log("PhoneWandChecks: OnDisable took " + stopping.Elapsed.TotalSeconds.ToString("0.00", CultureInfo.InvariantCulture) + " s");
            if (wand.Relay != null) failures.Add("OnDisable left the client holding a relay");
            bool answers = StoryTools.PhoneWand.ManagedRelay.RelayAnswers(port);
            if (existing && !answers) failures.Add("the relay that was already running stopped");
            if (!existing && answers) failures.Add("the relay still answers status.json after the client stopped");
            if (pid > 0)
            {
                bool gone;
                try { gone = Process.GetProcessById(pid).HasExited; }
                catch (ArgumentException) { gone = true; }
                if (!gone) failures.Add("relay process " + pid + " is still running");
                else Debug.Log("PhoneWandChecks: relay process " + pid + " has exited");
            }
            Debug.Log("PhoneWandChecks: after stopping, status.json " + (answers ? "answers" : "does not answer"));

            foreach (var f in failures) Debug.LogError("PhoneWandChecks: " + f);
            if (failures.Count == 0)
            {
                Debug.Log("PhoneWandChecks: managed relay PASS (" + (existing ? "used the running relay" : "started and stopped its own") + ")");
                code = 0;
            }
            else
            {
                Debug.LogError("PhoneWandChecks: managed relay FAIL");
            }
        }
        catch (Exception e)
        {
            Debug.LogError("PhoneWandChecks: managed relay FAIL: " + e);
        }
        finally
        {
            // Never leave a relay behind, even when the check fails.
            if (started != null) started.Stop();
            if (go != null) UnityEngine.Object.DestroyImmediate(go);
        }
        EditorApplication.Exit(code);
    }

    /// <summary>
    /// Layouts, against a running relay with one phone that plays along (a scripted fake phone:
    /// on the grid layout it presses "fire", sets "power" to 0.7 and "shield" on; when the default
    /// comes back it presses "primary"). Drives a PhoneWandClient component: SetLayout to the grid,
    /// then checks the Button and ControlChanged events and the player's Layout and Controls,
    /// SetControl on a label, an invalid layout raising Error (and, with no listener, a logged
    /// warning), and SetLayout(null) going back to the default.
    /// </summary>
    public static void Layouts()
    {
        int code = 1;
        GameObject go = null;
        var warnings = new List<string>();
        Application.LogCallback onLog = (text, trace, type) =>
        {
            if (type == LogType.Warning && text.StartsWith("[Phone Wand]")) warnings.Add(text);
        };
        Application.logMessageReceived += onLog;
        try
        {
            string url = Arg("-phoneWandUrl") ?? PhoneWandCore.DefaultUrl;
            double seconds = double.Parse(Arg("-phoneWandSeconds") ?? "20", CultureInfo.InvariantCulture);
            var failures = new List<string>();

            // In edit mode Awake and OnEnable don't run, so drive the component by hand, as Unity would.
            go = new GameObject("PhoneWandChecks.Layouts");
            var wand = go.AddComponent<PhoneWandClient>();
            typeof(PhoneWandClient).GetMethod("Awake", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
                .Invoke(wand, null);
            wand.Url = url;
            wand.AutoReconnect = false;

            var buttons = new List<string>();
            var controls = new List<ControlEvent>();
            var errors = new List<string>();
            wand.Button += (e, p) => { buttons.Add(e.Button + (e.Down ? " down" : " up")); Debug.Log("PhoneWandChecks: button " + e.Id + " " + e.Button + " " + (e.Down ? "down" : "up")); };
            wand.ControlChanged += (e, p) => { controls.Add(e); Debug.Log("PhoneWandChecks: control " + e); };
            Action<string> onError = m => { errors.Add(m); Debug.Log("PhoneWandChecks: error event: " + m); };
            wand.Error += onError;
            wand.PlayerChanged += p => Debug.Log("PhoneWandChecks: player " + p.Id + " template " + p.Layout.Template + " controls " + p.Layout.Controls.Count);

            var clock = Stopwatch.StartNew();
            bool WaitFor(Func<bool> condition, string what)
            {
                var start = clock.Elapsed.TotalSeconds;
                while (clock.Elapsed.TotalSeconds - start < seconds)
                {
                    wand.Connection.Pump();
                    if (condition()) return true;
                    Thread.Sleep(10);
                }
                failures.Add("timed out waiting for " + what);
                return false;
            }

            wand.Connect();
            Player player = null;
            if (!WaitFor(() => (player = FirstActive(wand)) != null, "an active player")) throw new Exception("no phone");
            Debug.Log("PhoneWandChecks: player " + player.Id + " \"" + player.Name + "\" starts with template " + player.Layout.Template);
            if (player.Layout.Template != LayoutTemplate.PrimarySecondary) failures.Add("the first layout is " + player.Layout.Template + ", not the default");

            // 1. A grid with every control type, for this player.
            var grid = Layout.Grid(
                Control.Button("fire", "Fire").WithColour(Color.red),
                Control.Toggle("shield", "Shield"),
                Control.Slider("power", "Power", 0.25),
                Control.Slider("throttle", "Throttle", vertical: true, spring: 0.5),
                Control.Choice("weapon", "Weapon", new[] { "Bow", "Sling", "Net" }, 1),
                Control.TextLabel("score", "Score", "0"));
            wand.SetLayout(grid, player.Id);
            if (WaitFor(() => player.Layout.Template == LayoutTemplate.Grid, "the player's layout to become the grid"))
            {
                if (player.Layout.Controls.Count != 6) failures.Add("the grid came back with " + player.Layout.Controls.Count + " controls");
                var fire = player.Layout.Find("fire");
                if (fire == null || fire.Colour != "#ff0000") failures.Add("fire's colour came back as " + (fire == null ? "nothing" : fire.Colour));
                if (Math.Abs(player.GetSlider("power") - 0.25) > 1e-6) failures.Add("power starts at " + player.GetSlider("power"));
                if (player.GetChoice("weapon") != 1) failures.Add("weapon starts at " + player.GetChoice("weapon"));
                if (player.GetText("score") != "0") failures.Add("score starts as " + player.GetText("score"));
            }

            // 2. The fake phone presses fire and changes power and shield.
            if (WaitFor(() => buttons.Contains("fire up") && player.GetToggle("shield"), "fire presses and control changes"))
            {
                if (buttons.IndexOf("fire down") != 0) failures.Add("buttons arrived as " + string.Join(", ", buttons));
                if (player.IsHeld("fire")) failures.Add("fire is still held");
                if (Math.Abs(player.GetSlider("power") - 0.7) > 1e-6) failures.Add("power is " + player.GetSlider("power") + ", not 0.7");
                var power = controls.Find(c => c.Control == "power");
                if (power.Control == null || Math.Abs(power.AsNumber - 0.7) > 1e-6 || power.Id != player.Id)
                    failures.Add("no ControlChanged for power = 0.7");
            }

            // 3. The app sets a label.
            wand.SetControl("score", "42", player.Id);
            if (WaitFor(() => player.GetText("score") == "42", "score to become 42"))
            {
                var score = controls.Find(c => c.Control == "score");
                if (score.AsString != "42") failures.Add("ControlChanged for score carried " + score.Value);
            }

            // 4. An invalid layout: the first control of a primary template must be a button.
            wand.SetLayout(Layout.Primary(Control.Toggle("nope", "Nope")), player.Id);
            if (WaitFor(() => errors.Count > 0, "an Error event"))
                Debug.Log("PhoneWandChecks: the invalid layout raised Error: " + errors[0]);
            if (player.Layout.Template != LayoutTemplate.Grid) failures.Add("the invalid layout changed the layout");

            // 5. With no listener, the error is logged as a warning.
            wand.Error -= onError;
            wand.SetControl("shield", "yes", player.Id);
            if (WaitFor(() => warnings.Count > 0, "a warning for an error nobody listens to"))
                Debug.Log("PhoneWandChecks: logged: " + warnings[0]);
            if (errors.Count != 1) failures.Add("Error fired " + errors.Count + " times");

            // 6. Back to the default; the fake phone then presses primary.
            wand.SetLayout(null, player.Id);
            if (WaitFor(() => player.Layout.Template == LayoutTemplate.PrimarySecondary && buttons.Contains("primary up"), "the default layout and a primary press"))
            {
                if (player.Controls.Count != 0) failures.Add("the default layout left " + player.Controls.Count + " control values");
                if (player.Layout.Find(PhoneButton.Secondary) == null) failures.Add("the default layout has no secondary button");
            }

            typeof(PhoneWandClient).GetMethod("OnDisable", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
                .Invoke(wand, null);

            foreach (var f in failures) Debug.LogError("PhoneWandChecks: " + f);
            string summary = "buttons=[" + string.Join(", ", buttons) + "] controls=" + controls.Count + " errors=" + errors.Count + " warnings=" + warnings.Count;
            if (failures.Count == 0)
            {
                Debug.Log("PhoneWandChecks: layouts PASS " + summary);
                code = 0;
            }
            else
            {
                Debug.LogError("PhoneWandChecks: layouts FAIL " + summary);
            }
        }
        catch (Exception e)
        {
            Debug.LogError("PhoneWandChecks: layouts FAIL: " + e);
        }
        finally
        {
            Application.logMessageReceived -= onLog;
            if (go != null) UnityEngine.Object.DestroyImmediate(go);
        }
        EditorApplication.Exit(code);
    }

    /// <summary>
    /// Gestures, against a running relay with one phone that flicks every second or two while
    /// holding "primary" (a scripted fake phone sending acceleration in its poses). Drives a
    /// PhoneWandClient component: a gesture must arrive with buttons ["primary"] and poses must carry
    /// accel; turning GesturesEnabled off must stop them, including after a reconnect (so the
    /// setting is sent again on connect); turning it back on must bring them back.
    /// </summary>
    public static void Gestures()
    {
        int code = 1;
        GameObject go = null;
        try
        {
            string url = Arg("-phoneWandUrl") ?? PhoneWandCore.DefaultUrl;
            double seconds = double.Parse(Arg("-phoneWandSeconds") ?? "20", CultureInfo.InvariantCulture);
            var failures = new List<string>();

            go = new GameObject("PhoneWandChecks.Gestures");
            var wand = go.AddComponent<PhoneWandClient>();
            typeof(PhoneWandClient).GetMethod("Awake", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
                .Invoke(wand, null);
            wand.Url = url;
            wand.AutoReconnect = false;
            if (!wand.GesturesEnabled || wand.GestureThreshold != 7f || wand.GestureMinSpeed != 0.35f || wand.GestureTwistRate != 360f)
                failures.Add("the gesture defaults are not on, 7, 0.35, 360");

            var gestures = new List<GestureEvent>();
            int poses = 0, accels = 0;
            wand.Gesture += (g, p) =>
            {
                gestures.Add(g);
                Vector3 dir = PhoneWandClient.GestureDirection(g);
                Debug.Log("PhoneWandChecks: gesture " + g + " dir " + dir.ToString("F2") + " speed " +
                    g.Speed.ToString("0.00", CultureInfo.InvariantCulture) + " buttons [" + string.Join(",", g.Buttons) + "]");
                if (g.DirectionVector() != dir) failures.Add("DirectionVector and GestureDirection differ");
            };
            wand.Pose += (pose, p) =>
            {
                poses++;
                Vector3? a = PhoneWandClient.Accel(pose);
                if (!a.HasValue) return;
                accels++;
                if (pose.AccelVector() != a) failures.Add("AccelVector and Accel differ");
                if (a.Value.magnitude > 5f && accels % 10 == 0) Debug.Log("PhoneWandChecks: accel " + a.Value.ToString("F2"));
            };

            var clock = Stopwatch.StartNew();
            bool WaitFor(Func<bool> condition, string what)
            {
                var start = clock.Elapsed.TotalSeconds;
                while (clock.Elapsed.TotalSeconds - start < seconds)
                {
                    wand.Connection.Pump();
                    if (condition()) return true;
                    Thread.Sleep(10);
                }
                failures.Add("timed out waiting for " + what);
                return false;
            }
            void PumpFor(double s)
            {
                var start = clock.Elapsed.TotalSeconds;
                while (clock.Elapsed.TotalSeconds - start < s)
                {
                    wand.Connection.Pump();
                    Thread.Sleep(10);
                }
            }

            // 1. On by default: a gesture while primary is held.
            wand.Connect();
            if (WaitFor(() => gestures.Exists(g => g.WasHeld(PhoneButton.Primary)), "a gesture with primary held"))
            {
                var first = gestures.Find(x => x.WasHeld(PhoneButton.Primary));
                if (string.Join(",", first.Buttons) != "primary") failures.Add("the gesture's buttons are [" + string.Join(",", first.Buttons) + "]");
                if (first.Strength <= 0 || first.Strength > 1) failures.Add("the gesture's strength is " + first.Strength);
            }
            if (accels == 0) failures.Add("no pose carried accel (" + poses + " poses)");

            // 2. Off while connected: sent at once, so no more gestures.
            wand.GesturesEnabled = false;
            PumpFor(0.3);
            int before = gestures.Count;
            PumpFor(4);
            if (gestures.Count != before) failures.Add((gestures.Count - before) + " gesture(s) arrived with gestures off");

            // 3. Still off after reconnecting: the setting goes out again on connect.
            wand.Disconnect();
            wand.Connect();
            WaitFor(() => wand.IsConnected, "reconnecting");
            before = gestures.Count;
            PumpFor(4);
            if (gestures.Count != before) failures.Add((gestures.Count - before) + " gesture(s) arrived after reconnecting with gestures off");

            // 4. On again, with an explicit sensitivity.
            wand.ConfigureGestures(7f, 0.35f, 360f);
            before = gestures.Count;
            WaitFor(() => gestures.Count > before, "a gesture after turning gestures back on");

            typeof(PhoneWandClient).GetMethod("OnDisable", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
                .Invoke(wand, null);

            foreach (var f in failures) Debug.LogError("PhoneWandChecks: " + f);
            string summary = "gestures=" + gestures.Count + " poses=" + poses + " poses-with-accel=" + accels;
            if (failures.Count == 0)
            {
                Debug.Log("PhoneWandChecks: gestures PASS " + summary);
                code = 0;
            }
            else
            {
                Debug.LogError("PhoneWandChecks: gestures FAIL " + summary);
            }
        }
        catch (Exception e)
        {
            Debug.LogError("PhoneWandChecks: gestures FAIL: " + e);
        }
        finally
        {
            if (go != null) UnityEngine.Object.DestroyImmediate(go);
        }
        EditorApplication.Exit(code);
    }

    static Player FirstActive(PhoneWandClient wand)
    {
        foreach (var p in wand.Players)
            if (p.State == PlayerState.Active) return p;
        return null;
    }

    static void Expect(List<string> failures, string what, object want, float[] got)
    {
        var w = (List<object>)want;
        bool ok = w.Count == got.Length;
        for (int i = 0; ok && i < got.Length; i++) ok = Math.Abs((double)w[i] - got[i]) <= 1e-4;
        if (!ok) failures.Add(what + ": expected " + Json.Write(w) + ", got " + Json.Write(got));
    }

    static string Arg(string name)
    {
        var args = Environment.GetCommandLineArgs();
        for (int i = 0; i < args.Length - 1; i++)
            if (args[i] == name) return args[i + 1];
        return null;
    }
}
