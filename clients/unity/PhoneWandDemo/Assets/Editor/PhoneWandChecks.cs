// Batch-mode checks for the Phone Wand Unity package, run by scripts/check-unity.sh. They live in
// the demo project rather than the package, so users never see them.
//
//   Unity -batchmode -nographics -projectPath clients/unity/PhoneWandDemo \
//     -executeMethod PhoneWandChecks.Conversions
//   Unity -batchmode -nographics -projectPath clients/unity/PhoneWandDemo \
//     -executeMethod PhoneWandChecks.Live -phoneWandUrl ws://127.0.0.1:8480/app -phoneWandSeconds 3
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
