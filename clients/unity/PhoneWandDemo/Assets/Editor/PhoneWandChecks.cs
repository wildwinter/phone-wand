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
