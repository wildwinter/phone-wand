// The Phone Wand client as a Unity component. Add it to a GameObject, press Play with the relay
// running, and subscribe to its events or read Players each frame.
//
//   var wand = GetComponent<PhoneWandClient>();
//   wand.Pose += (pose, player) => cursor.position = wand.ScreenPosition(pose) ?? offscreen;
//   wand.Button += (e, player) => { if (e.Button == PhoneButton.Primary && e.Down) Fire(player); };
//
// Messages arrive on a background thread and are delivered in Update, so every event fires on
// the main thread and you can touch the scene from any handler.

using System;
using System.Collections.Generic;
using UnityEngine;

namespace StoryTools.PhoneWand
{
    /// <summary>How the relay should smooth the poses sent to this app.</summary>
    public enum SmoothingMode
    {
        /// <summary>Leave the relay's default filter in place.</summary>
        RelayDefault,
        /// <summary>Use the MinCutoff, Beta and DCutoff values set on the component.</summary>
        Custom,
        /// <summary>No smoothing: raw poses.</summary>
        Raw,
    }

    [AddComponentMenu("Phone Wand/Phone Wand Client")]
    [DefaultExecutionOrder(-1000)]
    [DisallowMultipleComponent]
    public sealed class PhoneWandClient : MonoBehaviour
    {
        [Tooltip("The relay's app endpoint.")]
        [SerializeField] string url = PhoneWandCore.DefaultUrl;

        [Tooltip("Connect when the component is enabled.")]
        [SerializeField] bool connectOnEnable = true;

        [Tooltip("Reconnect automatically when the relay goes away.")]
        [SerializeField] bool autoReconnect = true;

        [Tooltip("How the relay smooths poses for this app.")]
        [SerializeField] SmoothingMode smoothing = SmoothingMode.RelayDefault;

        [Tooltip("One Euro filter: lower is steadier when still.")]
        [SerializeField] float minCutoff = 1f;

        [Tooltip("One Euro filter: higher is quicker when moving.")]
        [SerializeField] float beta = 5f;

        [Tooltip("One Euro filter: cutoff for the speed estimate.")]
        [SerializeField] float dCutoff = 1f;

        [Tooltip("Log connections, joins and leaves to the console.")]
        [SerializeField] bool logEvents = false;

        readonly PhoneWandConnection connection = new PhoneWandConnection();

        // ------------------------------------------------------------------ settings

        /// <summary>The relay's app endpoint. Changing it takes effect on the next connect.</summary>
        public string Url
        {
            get { return url; }
            set { url = value; connection.Url = value; }
        }

        public bool AutoReconnect
        {
            get { return autoReconnect; }
            set { autoReconnect = value; connection.AutoReconnect = value; }
        }

        /// <summary>The engine-free core: state, events and message handling.</summary>
        public PhoneWandCore Core => connection.Core;

        /// <summary>The connection that feeds the core.</summary>
        public PhoneWandConnection Connection => connection;

        // ------------------------------------------------------------------ state

        /// <summary>True once the relay has said hello, until the connection closes.</summary>
        public bool IsConnected => connection.Core.IsConnected;

        /// <summary>The relay's hello (join URL, QR code URL, max players), or null.</summary>
        public RelayHello Hello => connection.Core.Hello;

        /// <summary>Players sorted by slot. The list is reused; copy it if you keep it.</summary>
        public IReadOnlyList<Player> Players => connection.Core.Players;

        /// <summary>The player with this id, or null.</summary>
        public Player GetPlayer(string id) => connection.Core.GetPlayer(id);

        /// <summary>The player in this slot, or null.</summary>
        public Player GetPlayerInSlot(int slot) => connection.Core.GetPlayerInSlot(slot);

        // ------------------------------------------------------------------ events (main thread)

        /// <summary>The relay said hello. PlayerJoined follows for each player already there.</summary>
        public event Action<RelayHello> Connected
        {
            add { connection.Core.Connected += value; }
            remove { connection.Core.Connected -= value; }
        }

        /// <summary>The connection closed. PlayerLeft has already fired for every player.</summary>
        public event Action Disconnected
        {
            add { connection.Core.Disconnected += value; }
            remove { connection.Core.Disconnected -= value; }
        }

        public event Action<Player> PlayerJoined
        {
            add { connection.Core.PlayerJoined += value; }
            remove { connection.Core.PlayerJoined -= value; }
        }

        public event Action<Player> PlayerLeft
        {
            add { connection.Core.PlayerLeft += value; }
            remove { connection.Core.PlayerLeft -= value; }
        }

        /// <summary>State, name, colour, calibration or transport changed.</summary>
        public event Action<Player> PlayerChanged
        {
            add { connection.Core.PlayerChanged += value; }
            remove { connection.Core.PlayerChanged -= value; }
        }

        public event Action<PlayerPose, Player> Pose
        {
            add { connection.Core.Pose += value; }
            remove { connection.Core.Pose -= value; }
        }

        public event Action<ButtonEvent, Player> Button
        {
            add { connection.Core.Button += value; }
            remove { connection.Core.Button -= value; }
        }

        public event Action<CalibrationStep, Player> Calibrating
        {
            add { connection.Core.Calibrating += value; }
            remove { connection.Core.Calibrating -= value; }
        }

        public event Action<Calibration, Player> Calibrated
        {
            add { connection.Core.Calibrated += value; }
            remove { connection.Core.Calibrated -= value; }
        }

        public event Action<PlayerStats, Player> Stats
        {
            add { connection.Core.Stats += value; }
            remove { connection.Core.Stats -= value; }
        }

        // ------------------------------------------------------------------ lifecycle

        void Awake()
        {
            connection.Core.ListenerError = Debug.LogException;
#if UNITY_WEBGL && !UNITY_EDITOR
            connection.TransportFactory = () => new WebGLTransport();
#endif
            connection.Core.Connected += h => Log("connected to relay " + h.Relay + "; phones join at " + h.JoinUrl);
            connection.Core.Disconnected += () => Log("disconnected");
            connection.Core.PlayerJoined += p => Log("join " + p.Id + " \"" + p.Name + "\" slot " + p.Slot);
            connection.Core.PlayerLeft += p => Log("leave " + p.Id + " \"" + p.Name + "\"");
        }

        void OnEnable()
        {
            if (connectOnEnable) Connect();
        }

        void OnDisable()
        {
            connection.Close();
        }

        void Update()
        {
            connection.Pump();
        }

        void OnValidate()
        {
            connection.Url = url;
            connection.AutoReconnect = autoReconnect;
        }

        void Log(string message)
        {
            if (logEvents) Debug.Log("[Phone Wand] " + message, this);
        }

        // ------------------------------------------------------------------ connection

        /// <summary>Connect (and keep reconnecting, if AutoReconnect is on).</summary>
        public void Connect()
        {
            connection.Url = url;
            connection.AutoReconnect = autoReconnect;
            connection.Smoothing = SmoothingFromSettings();
            connection.Connect();
        }

        /// <summary>Disconnect and stop reconnecting. PlayerLeft and Disconnected fire before this returns.</summary>
        public void Disconnect()
        {
            connection.Close();
        }

        Smoothing SmoothingFromSettings()
        {
            switch (smoothing)
            {
                case SmoothingMode.Custom: return new Smoothing(minCutoff, beta, dCutoff);
                case SmoothingMode.Raw: return Smoothing.Off;
                default: return null;
            }
        }

        // ------------------------------------------------------------------ app -> relay

        /// <summary>
        /// Set the One Euro filter for this app's poses (kept across reconnects). Lower minCutoff is
        /// steadier when still; higher beta is quicker when moving.
        /// </summary>
        public void ConfigureSmoothing(float minCutoff = 1f, float beta = 5f, float dCutoff = 1f)
        {
            smoothing = SmoothingMode.Custom;
            this.minCutoff = minCutoff;
            this.beta = beta;
            this.dCutoff = dCutoff;
            connection.Smoothing = SmoothingFromSettings();
        }

        /// <summary>Turn smoothing off: raw poses (kept across reconnects).</summary>
        public void ConfigureRaw()
        {
            smoothing = SmoothingMode.Raw;
            connection.Smoothing = Smoothing.Off;
        }

        /// <summary>Change a player's colour and/or label (shown on their phone). Null leaves a field unchanged.</summary>
        public void Style(string id, string colour = null, string label = null)
        {
            connection.Core.Style(id, colour, label);
        }

        /// <summary>Change a player's colour and optionally their label.</summary>
        public void Style(string id, Color colour, string label = null)
        {
            connection.Core.Style(id, "#" + ColorUtility.ToHtmlStringRGB(colour).ToLowerInvariant(), label);
        }

        /// <summary>
        /// Show text on one phone, or every phone when id is null. duration in ms (relay default 3000),
        /// 0 keeps it up until the next prompt. Empty text clears it.
        /// </summary>
        public void Prompt(string text, string id = null, int? duration = null)
        {
            connection.Core.Prompt(text, id, duration);
        }

        /// <summary>Vibrate (Android only). pattern alternates on and off milliseconds. Null id means everyone.</summary>
        public void Haptic(int[] pattern, string id = null)
        {
            connection.Core.Haptic(pattern, id);
        }

        /// <summary>Vibrate once for this many milliseconds (Android only). Null id means everyone.</summary>
        public void Haptic(int milliseconds, string id = null)
        {
            connection.Core.Haptic(milliseconds, id);
        }

        /// <summary>Ask a player (or everyone, when id is null) to calibrate.</summary>
        public void Calibrate(CalibrationMode mode = CalibrationMode.Screen, string id = null)
        {
            connection.Core.Calibrate(mode, id);
        }

        // ------------------------------------------------------------------ helpers

        /// <summary>The pose's pointing direction as a Unity vector (x right, y up, z forward).</summary>
        public static Vector3 Direction(PlayerPose pose) => pose.Direction.ToVector3();

        /// <summary>The phone's orientation as a Unity rotation (maps +z to the pointing direction).</summary>
        public static Quaternion Rotation(PlayerPose pose) => pose.Rotation.ToQuaternion();

        /// <summary>
        /// Where the player points, in Unity screen pixels (origin bottom-left, like
        /// Input.mousePosition), or null when they point far from the screen. With a camera, the
        /// position is within that camera's pixel rect. Values beyond the screen mean off-screen.
        /// </summary>
        public static Vector2? ScreenPosition(PlayerPose pose, Camera camera = null)
        {
            if (pose == null || !pose.Screen.HasValue) return null;
            return pose.Screen.Value.ToScreenPixels(camera);
        }

        /// <summary>
        /// Where the player points, in GUI pixels (origin top-left, for OnGUI), or null when they
        /// point far from the screen.
        /// </summary>
        public static Vector2? GuiPosition(PlayerPose pose)
        {
            if (pose == null || !pose.Screen.HasValue) return null;
            return pose.Screen.Value.ToGuiPixels();
        }
    }
}
