// The engine-free heart of the Phone Wand client: turns relay messages into player state and
// events, and builds the messages an app sends to the relay. It does no networking itself;
// PhoneWandConnection feeds it, and the conformance TestHost replays recorded streams through
// Handle(). Mirrors the PhoneWand class in packages/client-js/src/index.ts, event for event.
//
// Not thread safe: call everything from one thread (Unity's main thread, in practice).

using System;
using System.Collections.Generic;

namespace StoryTools.PhoneWand
{
    public sealed class PhoneWandCore
    {
        public const int ProtocolVersion = 0;
        public const string DefaultUrl = "ws://127.0.0.1:8480/app";

        readonly Dictionary<string, Player> players = new Dictionary<string, Player>();
        readonly List<Player> sorted = new List<Player>();
        bool sortedDirty = true;

        /// <summary>The relay's hello, or null when not connected.</summary>
        public RelayHello Hello { get; private set; }

        /// <summary>True once the relay's hello has arrived, until the connection closes.</summary>
        public bool IsConnected => Hello != null;

        /// <summary>
        /// Where outgoing messages go. PhoneWandConnection sets this; messages are dropped while it
        /// is null.
        /// </summary>
        public Action<string> Sender;

        /// <summary>Called when an event listener throws. Default: writes to Console.Error.</summary>
        public Action<Exception> ListenerError = e => Console.Error.WriteLine(e);

        // ------------------------------------------------------------------ events

        /// <summary>The relay said hello. Join events for its current players follow.</summary>
        public event Action<RelayHello> Connected;
        /// <summary>The connection to the relay closed (after Leave for every player).</summary>
        public event Action Disconnected;
        /// <summary>A player joined (or was already there when we connected).</summary>
        public event Action<Player> PlayerJoined;
        /// <summary>A player left, or the connection closed.</summary>
        public event Action<Player> PlayerLeft;
        /// <summary>Something about a player changed: state, name, colour, calibration or transport.</summary>
        public event Action<Player> PlayerChanged;
        /// <summary>A new pose. Typically 60 per second per player.</summary>
        public event Action<PlayerPose, Player> Pose;
        /// <summary>A button went down or up.</summary>
        public event Action<ButtonEvent, Player> Button;
        /// <summary>The player is being asked to point at a corner, or cancelled calibration.</summary>
        public event Action<CalibrationStep, Player> Calibrating;
        /// <summary>The player pressed Recentre (Ray) or finished screen calibration (Screen).</summary>
        public event Action<Calibration, Player> Calibrated;
        /// <summary>Connection statistics, once a second per player.</summary>
        public event Action<PlayerStats, Player> Stats;

        // ------------------------------------------------------------------ players

        /// <summary>Players sorted by slot. The list is reused; copy it if you keep it.</summary>
        public IReadOnlyList<Player> Players
        {
            get
            {
                if (sortedDirty)
                {
                    sorted.Clear();
                    sorted.AddRange(players.Values);
                    sorted.Sort((a, b) => a.Slot.CompareTo(b.Slot));
                    sortedDirty = false;
                }
                return sorted;
            }
        }

        /// <summary>The player with this id, or null.</summary>
        public Player GetPlayer(string id)
        {
            Player p;
            return id != null && players.TryGetValue(id, out p) ? p : null;
        }

        /// <summary>The player in this slot, or null.</summary>
        public Player GetPlayerInSlot(int slot)
        {
            foreach (var p in players.Values)
                if (p.Slot == slot) return p;
            return null;
        }

        // ------------------------------------------------------------------ app -> relay

        /// <summary>Set the smoothing for poses sent to this app. Smoothing.Off for raw.</summary>
        public void Configure(Smoothing smoothing)
        {
            if (smoothing == null) throw new ArgumentNullException(nameof(smoothing));
            Send(new Dictionary<string, object> { { "type", "configure" }, { "smoothing", smoothing.ToJsonValue() } });
        }

        /// <summary>Change a player's colour ("#rrggbb") and/or label. Null leaves a field unchanged.</summary>
        public void Style(string id, string colour = null, string label = null)
        {
            var msg = new Dictionary<string, object> { { "type", "style" }, { "id", id } };
            if (colour != null) msg["colour"] = colour;
            if (label != null) msg["label"] = label;
            Send(msg);
        }

        /// <summary>
        /// Show text on a phone, or on every phone when id is null. duration is in ms (relay default
        /// 3000); 0 keeps it up until the next prompt. Empty text clears it.
        /// </summary>
        public void Prompt(string text, string id = null, int? duration = null)
        {
            var msg = new Dictionary<string, object> { { "type", "prompt" }, { "text", text ?? "" } };
            if (id != null) msg["id"] = id;
            if (duration.HasValue) msg["duration"] = duration.Value;
            Send(msg);
        }

        /// <summary>Vibrate (Android only). pattern alternates on and off milliseconds. Null id means everyone.</summary>
        public void Haptic(int[] pattern, string id = null)
        {
            var msg = new Dictionary<string, object> { { "type", "haptic" }, { "pattern", pattern ?? new int[0] } };
            if (id != null) msg["id"] = id;
            Send(msg);
        }

        /// <summary>Vibrate once for this many milliseconds (Android only). Null id means everyone.</summary>
        public void Haptic(int milliseconds, string id = null)
        {
            Haptic(new[] { milliseconds }, id);
        }

        /// <summary>Ask a player (or everyone, when id is null) to calibrate.</summary>
        public void Calibrate(CalibrationMode mode = CalibrationMode.Screen, string id = null)
        {
            var msg = new Dictionary<string, object> { { "type", "calibrate" }, { "mode", ProtocolNames.Of(mode) } };
            if (id != null) msg["id"] = id;
            Send(msg);
        }

        void Send(Dictionary<string, object> msg)
        {
            var sender = Sender;
            if (sender != null) sender(Json.Write(msg));
        }

        // ------------------------------------------------------------------ relay -> app

        /// <summary>
        /// Handle one message from the relay, as JSON text. Malformed JSON and unknown message types
        /// are ignored. Public so recorded sessions can be replayed through it.
        /// </summary>
        public void Handle(string json)
        {
            object parsed;
            if (!Json.TryParse(json, out parsed)) return;
            Handle(parsed as Dictionary<string, object>);
        }

        /// <summary>Handle one decoded relay message (a JSON object from Json.Parse).</summary>
        public void Handle(Dictionary<string, object> msg)
        {
            if (msg == null) return;
            switch (Str(msg, "type"))
            {
                case "hello":
                {
                    var hello = new RelayHello
                    {
                        Protocol = (int)Num(msg, "protocol"),
                        Relay = Str(msg, "relay") ?? "",
                        JoinUrl = Str(msg, "joinUrl") ?? "",
                        QrUrl = Str(msg, "qrUrl") ?? "",
                        MaxPlayers = (int)Num(msg, "maxPlayers"),
                    };
                    Hello = hello;
                    Emit(Connected, hello);
                    var list = Get(msg, "players") as List<object>;
                    if (list != null)
                    {
                        foreach (var item in list)
                        {
                            var p = Upsert(item as Dictionary<string, object>);
                            if (p != null) Emit(PlayerJoined, p);
                        }
                    }
                    break;
                }
                case "join":
                {
                    var p = Upsert(Get(msg, "player") as Dictionary<string, object>);
                    if (p != null) Emit(PlayerJoined, p);
                    break;
                }
                case "player":
                {
                    var info = Get(msg, "player") as Dictionary<string, object>;
                    var p = Upsert(info);
                    if (p == null) break;
                    var wireState = Str(info, "state");
                    bool active = wireState != null ? wireState == "active" : p.State == PlayerState.Active;
                    if (!active) p.HeldButtons.Clear();
                    Emit(PlayerChanged, p);
                    break;
                }
                case "leave":
                {
                    var id = Str(msg, "id");
                    var p = GetPlayer(id);
                    if (p == null) break;
                    players.Remove(id);
                    sortedDirty = true;
                    Emit(PlayerLeft, p);
                    break;
                }
                case "pose":
                {
                    var p = GetPlayer(Str(msg, "id"));
                    if (p == null) break;
                    var pose = ParsePose(p.Id, msg);
                    p.Pose = pose;
                    Emit(Pose, pose, p);
                    break;
                }
                case "button":
                {
                    var p = GetPlayer(Str(msg, "id"));
                    if (p == null) break;
                    PhoneButton button;
                    // Buttons this version does not know are ignored (protocol: ignore the unknown).
                    if (!ProtocolNames.TryParse(Str(msg, "button"), out button)) break;
                    bool down = Get(msg, "down") is bool b && b;
                    if (down) p.HeldButtons.Add(button);
                    else p.HeldButtons.Remove(button);
                    Emit(Button, new ButtonEvent(p.Id, button, down), p);
                    break;
                }
                case "calibrating":
                {
                    var p = GetPlayer(Str(msg, "id"));
                    if (p == null) break;
                    CalibrationStep step;
                    if (!ProtocolNames.TryParse(Str(msg, "step"), out step)) break;
                    p.Calibrating = step == CalibrationStep.Cancelled ? (CalibrationStep?)null : step;
                    Emit(Calibrating, step, p);
                    break;
                }
                case "calibrated":
                {
                    var p = GetPlayer(Str(msg, "id"));
                    if (p == null) break;
                    Calibration calibration;
                    if (!ProtocolNames.TryParse(Str(msg, "calibration"), out calibration)) break;
                    p.Calibration = calibration;
                    p.Calibrating = null;
                    Emit(Calibrated, calibration, p);
                    break;
                }
                case "stats":
                {
                    var p = GetPlayer(Str(msg, "id"));
                    if (p == null) break;
                    var stats = new PlayerStats(p.Id, Num(msg, "rtt"), Num(msg, "rate"), (int)Num(msg, "dropped"));
                    p.Stats = stats;
                    Emit(Stats, stats, p);
                    break;
                }
            }
        }

        /// <summary>
        /// The connection closed: fires PlayerLeft for every player (in slot order), forgets them,
        /// then fires Disconnected if the relay had said hello.
        /// </summary>
        public void HandleClosed()
        {
            bool was = Hello != null;
            Hello = null;
            var gone = new List<Player>(Players);
            players.Clear();
            sortedDirty = true;
            foreach (var p in gone) Emit(PlayerLeft, p);
            if (was) Emit(Disconnected);
        }

        Player Upsert(Dictionary<string, object> info)
        {
            if (info == null) return null;
            var id = Str(info, "id");
            if (id == null) return null;
            Player p;
            if (!players.TryGetValue(id, out p))
            {
                p = new Player { Id = id };
                players[id] = p;
            }
            sortedDirty = true;

            object v;
            if (info.TryGetValue("slot", out v) && v is double slot) p.Slot = (int)slot;
            if (info.TryGetValue("name", out v) && v is string name) p.Name = name;
            if (info.TryGetValue("colour", out v) && v is string colour) p.Colour = colour;
            if (info.TryGetValue("label", out v) && v is string label) p.Label = label;
            PlayerState state;
            if (ProtocolNames.TryParse(Str(info, "state"), out state)) p.State = state;
            Calibration calibration;
            if (ProtocolNames.TryParse(Str(info, "calibration"), out calibration)) p.Calibration = calibration;
            var device = Get(info, "device") as Dictionary<string, object>;
            if (device != null)
            {
                if (device.TryGetValue("platform", out v) && v is string platform) p.Device.Platform = platform;
                if (device.TryGetValue("sensor", out v) && v is string sensor) p.Device.Sensor = sensor;
                if (device.TryGetValue("transport", out v) && v is string transport) p.Device.Transport = transport;
            }
            return p;
        }

        static PlayerPose ParsePose(string id, Dictionary<string, object> msg)
        {
            var q = Get(msg, "q") as List<object>;
            var dir = Get(msg, "dir") as List<object>;
            var screen = Get(msg, "screen") as List<object>;
            return new PlayerPose(
                id,
                (long)Num(msg, "seq"),
                Num(msg, "t"),
                new RigQuaternion(At(q, 0), At(q, 1), At(q, 2), q == null ? 1 : At(q, 3)),
                Num(msg, "yaw"),
                Num(msg, "pitch"),
                Num(msg, "roll"),
                new RigVector3(At(dir, 0), At(dir, 1), dir == null ? 1 : At(dir, 2)),
                screen != null && screen.Count >= 2 ? new ScreenPoint(At(screen, 0), At(screen, 1)) : (ScreenPoint?)null);
        }

        // ------------------------------------------------------------------ helpers

        static object Get(Dictionary<string, object> o, string key)
        {
            object v;
            return o != null && o.TryGetValue(key, out v) ? v : null;
        }

        static string Str(Dictionary<string, object> o, string key) => Get(o, key) as string;

        static double Num(Dictionary<string, object> o, string key) => Get(o, key) is double d ? d : 0;

        static double At(List<object> list, int i) => list != null && i < list.Count && list[i] is double d ? d : 0;

        void Emit(Action handler)
        {
            if (handler == null) return;
            foreach (Action fn in handler.GetInvocationList())
            {
                try { fn(); }
                catch (Exception e) { ReportError(e); }
            }
        }

        void Emit<T>(Action<T> handler, T a)
        {
            if (handler == null) return;
            foreach (Action<T> fn in handler.GetInvocationList())
            {
                try { fn(a); }
                catch (Exception e) { ReportError(e); }
            }
        }

        void Emit<T1, T2>(Action<T1, T2> handler, T1 a, T2 b)
        {
            if (handler == null) return;
            foreach (Action<T1, T2> fn in handler.GetInvocationList())
            {
                try { fn(a, b); }
                catch (Exception e) { ReportError(e); }
            }
        }

        void ReportError(Exception e)
        {
            var log = ListenerError;
            if (log != null) log(e);
        }
    }
}
