// The Phone Wand client as a Unity component. Add it to a GameObject, press Play with the relay
// running, and subscribe to its events or read Players each frame.
//
//   var wand = GetComponent<PhoneWandClient>();
//   wand.Pose += (pose, player) => cursor.position = wand.ScreenPosition(pose) ?? offscreen;
//   wand.Button += (e, player) => { if (e.Button == PhoneButton.Primary && e.Down) Fire(player); };
//
// SetLayout chooses the controls each phone shows (see docs/layouts.md); their changes arrive as
// ControlChanged, and presses of your buttons as Button with your ids.
//
// Gesture fires when a player flicks, shakes or twists the phone (see docs/gestures.md):
//
//   wand.Gesture += (g, player) => { if (g.Is(GestureName.Pull) && g.WasHeld(PhoneButton.Primary)) DrawBow(player, g.Strength); };
//
// Messages arrive on a background thread and are delivered in Update, so every event fires on
// the main thread and you can touch the scene from any handler.
//
// With Start Relay on, the client starts the relay itself (hidden) unless one is already running,
// and stops it when the client stops: see docs/shipping.md.

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

        [Header("Gestures")]
        [Tooltip("Send this app gesture events (flicks, shakes and twists). See docs/gestures.md.")]
        [SerializeField] bool gesturesEnabled = true;

        [Tooltip("Acceleration in m/s^2 that starts a movement. Lower is more sensitive. Relay default 7.")]
        [SerializeField, Min(0f)] float gestureThreshold = (float)GestureSensitivity.DefaultThreshold;

        [Tooltip("Peak speed in m/s a movement must reach. Relay default 0.35.")]
        [SerializeField, Min(0f)] float gestureMinSpeed = (float)GestureSensitivity.DefaultMinSpeed;

        [Tooltip("Roll rate in degrees per second that makes a twist. Relay default 360.")]
        [SerializeField, Min(0f)] float gestureTwistRate = (float)GestureSensitivity.DefaultTwistRate;

        [Header("Managed relay")]
        [Tooltip("Start the relay, hidden, when connecting (unless one is already running) and stop it when this client stops. " +
            "Windows, macOS and Linux only. See docs/shipping.md.")]
        [SerializeField] bool startRelay = false;

        [Tooltip("A phone-wand-relay folder, or the relay program itself. Empty means StreamingAssets/phone-wand-relay.")]
        [SerializeField] string relayPath = "";

        [Tooltip("Extra relay options, for example: --max-players 8 --key party")]
        [SerializeField] string relayArguments = "";

        readonly PhoneWandConnection connection = new PhoneWandConnection();
        ManagedRelay relay;
        bool warnedRelayPlatform;

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

        /// <summary>
        /// Start the relay when connecting, unless one is already running, and stop it when this
        /// client stops. Windows, macOS and Linux only. Takes effect on the next connect.
        /// </summary>
        public bool StartRelay
        {
            get { return startRelay; }
            set { startRelay = value; }
        }

        /// <summary>A phone-wand-relay folder or the relay program. Null or empty means DefaultRelayPath.</summary>
        public string RelayPath
        {
            get { return relayPath; }
            set { relayPath = value; }
        }

        /// <summary>Extra relay options, as on a command line, e.g. "--max-players 8 --key party".</summary>
        public string RelayArguments
        {
            get { return relayArguments; }
            set { relayArguments = value; }
        }

        /// <summary>Where the client looks for the relay by default: StreamingAssets/phone-wand-relay.</summary>
        public static string DefaultRelayPath => Application.streamingAssetsPath + "/phone-wand-relay";

        /// <summary>The log file of a relay the client starts: persistentDataPath/phone-wand-relay.log.</summary>
        public static string RelayLogFile => Application.persistentDataPath + "/phone-wand-relay.log";

        /// <summary>The relay this client started, or null if it started none (or has stopped it).</summary>
        public ManagedRelay Relay => relay;

        /// <summary>True while a relay this client started is running.</summary>
        public bool StartedRelay => relay != null && relay.IsRunning;

        /// <summary>
        /// Send this app gesture events. Kept across reconnects; changing it while connected tells
        /// the relay straight away.
        /// </summary>
        public bool GesturesEnabled
        {
            get { return gesturesEnabled; }
            set { gesturesEnabled = value; connection.Gestures = GesturesFromSettings(); }
        }

        /// <summary>Acceleration in m/s^2 that starts a movement; lower is more sensitive. Default 7.</summary>
        public float GestureThreshold
        {
            get { return gestureThreshold; }
            set { gestureThreshold = value; connection.Gestures = GesturesFromSettings(); }
        }

        /// <summary>Peak speed in m/s a movement must reach. Default 0.35.</summary>
        public float GestureMinSpeed
        {
            get { return gestureMinSpeed; }
            set { gestureMinSpeed = value; connection.Gestures = GesturesFromSettings(); }
        }

        /// <summary>Roll rate in degrees per second that makes a twist. Default 360.</summary>
        public float GestureTwistRate
        {
            get { return gestureTwistRate; }
            set { gestureTwistRate = value; connection.Gestures = GesturesFromSettings(); }
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

        /// <summary>State, name, colour, label, calibration, transport or layout changed.</summary>
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

        /// <summary>
        /// A toggle, slider, choice or label changed, on the phone or because an app set it. The
        /// player's Controls already hold the new value.
        /// </summary>
        public event Action<ControlEvent, Player> ControlChanged
        {
            add { connection.Core.ControlChanged += value; }
            remove { connection.Core.ControlChanged -= value; }
        }

        /// <summary>
        /// The player moved the phone deliberately: a push, pull, sideways or vertical flick, shake
        /// or twist. GestureDirection(g) gives its direction as a Vector3. See docs/gestures.md.
        /// </summary>
        public event Action<GestureEvent, Player> Gesture
        {
            add { connection.Core.Gesture += value; }
            remove { connection.Core.Gesture -= value; }
        }

        /// <summary>
        /// The relay could not use something this app sent (a bad layout or value); the message says
        /// why. With no listener, the client logs it as a warning.
        /// </summary>
        public event Action<string> Error
        {
            add { connection.Core.Error += value; }
            remove { connection.Core.Error -= value; }
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
            connection.Core.UnhandledError = message => Debug.LogWarning("[Phone Wand] The relay says: " + message, this);
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
            StopRelay();
        }

        void OnDestroy()
        {
            StopRelay();
        }

        void OnApplicationQuit()
        {
            StopRelay();
        }

        void Update()
        {
            connection.Pump();
        }

        void OnValidate()
        {
            connection.Url = url;
            connection.AutoReconnect = autoReconnect;
            // While playing, inspector changes reach the relay at once, for tuning with a phone in hand.
            connection.Gestures = GesturesFromSettings();
        }

        void Log(string message)
        {
            if (logEvents) Debug.Log("[Phone Wand] " + message, this);
        }

        // ------------------------------------------------------------------ connection

        /// <summary>Connect (and keep reconnecting, if AutoReconnect is on).</summary>
        public void Connect()
        {
            if (startRelay) EnsureRelay();
            connection.Url = url;
            connection.AutoReconnect = autoReconnect;
            connection.Smoothing = SmoothingFromSettings();
            connection.Gestures = GesturesFromSettings();
            connection.Connect();
        }

        /// <summary>Disconnect and stop reconnecting. PlayerLeft and Disconnected fire before this returns.</summary>
        public void Disconnect()
        {
            connection.Close();
        }

        /// <summary>
        /// Stop the relay this client started, if any: close its input, wait up to two seconds, then
        /// end it. A relay the client didn't start is never stopped. Disabling or destroying the
        /// component, or quitting, calls this.
        /// </summary>
        public void StopRelay()
        {
            var r = relay;
            relay = null;
            if (r == null) return;
            r.Stop();
            Log("stopped the relay");
        }

        // Start the relay for the current Url unless one is running (see docs/shipping.md).
        void EnsureRelay()
        {
            if (!CanStartRelay)
            {
                if (!warnedRelayPlatform)
                    Debug.LogWarning("[Phone Wand] Start Relay is ignored on " + Application.platform +
                        ": only Windows, macOS and Linux can run the relay. Run it separately.", this);
                warnedRelayPlatform = true;
                return;
            }
            int port = ManagedRelay.AppPortOf(url);
            if (relay != null && relay.IsRunning && relay.AppPort == port) return;
            StopRelay();
            relay = ManagedRelay.Start(new ManagedRelayOptions
            {
                Url = url,
                Path = string.IsNullOrEmpty(relayPath) ? DefaultRelayPath : relayPath,
                Arguments = relayArguments,
                LogFile = RelayLogFile,
            }, message => Debug.LogWarning("[Phone Wand] " + message, this));
            if (relay != null) Log("started the relay on app port " + port + "; its log is " + RelayLogFile);
        }

        static bool CanStartRelay
        {
            get
            {
                switch (Application.platform)
                {
                    case RuntimePlatform.WebGLPlayer:
                    case RuntimePlatform.IPhonePlayer:
                    case RuntimePlatform.Android:
                    case RuntimePlatform.tvOS:
                    case RuntimePlatform.VisionOS:
                        return false;
                    default:
                        return true;
                }
            }
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

        GestureSensitivity GesturesFromSettings()
        {
            if (!gesturesEnabled) return GestureSensitivity.Off;
            return new GestureSensitivity(Tidy(gestureThreshold), Tidy(gestureMinSpeed), Tidy(gestureTwistRate));
        }

        // A float as the double it was typed as (0.35f as 0.35, not 0.3499999940395355), via decimal.
        static double Tidy(float value)
        {
            if (float.IsNaN(value) || float.IsInfinity(value)) return 0;
            return Math.Abs(value) < 1e9f ? (double)(decimal)value : value;
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

        /// <summary>
        /// Set this app's gesture sensitivity and turn gestures on (kept across reconnects). Lower
        /// threshold is more sensitive. The defaults are the relay's.
        /// </summary>
        public void ConfigureGestures(float threshold = (float)GestureSensitivity.DefaultThreshold,
            float minSpeed = (float)GestureSensitivity.DefaultMinSpeed, float twistRate = (float)GestureSensitivity.DefaultTwistRate)
        {
            gesturesEnabled = true;
            gestureThreshold = threshold;
            gestureMinSpeed = minSpeed;
            gestureTwistRate = twistRate;
            connection.Gestures = GesturesFromSettings();
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

        /// <summary>
        /// Choose the controls a phone shows, or every phone when playerId is null. Null goes back to
        /// the default Primary and Secondary buttons. See docs/layouts.md.
        /// </summary>
        public void SetLayout(Layout layout, string playerId = null)
        {
            connection.Core.SetLayout(layout, playerId);
        }

        /// <summary>Turn a toggle on or off, on one phone or every phone when playerId is null.</summary>
        public void SetControl(string controlId, bool value, string playerId = null)
        {
            connection.Core.SetControl(controlId, value, playerId);
        }

        /// <summary>Move a slider (0 to 1) or pick a choice's option (its index), on one phone or every phone.</summary>
        public void SetControl(string controlId, double value, string playerId = null)
        {
            connection.Core.SetControl(controlId, value, playerId);
        }

        /// <summary>Change a label's text, on one phone or every phone when playerId is null.</summary>
        public void SetControl(string controlId, string value, string playerId = null)
        {
            connection.Core.SetControl(controlId, value, playerId);
        }

        // ------------------------------------------------------------------ helpers

        /// <summary>The pose's pointing direction as a Unity vector (x right, y up, z forward).</summary>
        public static Vector3 Direction(PlayerPose pose) => pose.Direction.ToVector3();

        /// <summary>The phone's orientation as a Unity rotation (maps +z to the pointing direction).</summary>
        public static Quaternion Rotation(PlayerPose pose) => pose.Rotation.ToQuaternion();

        /// <summary>
        /// The phone's acceleration in m/s^2, gravity removed, as a Unity vector (x right, y up,
        /// z forward), or null when the pose has none (motion access refused).
        /// </summary>
        public static Vector3? Accel(PlayerPose pose)
        {
            if (pose == null || !pose.Accel.HasValue) return null;
            return pose.Accel.Value.ToVector3();
        }

        /// <summary>A gesture's direction of movement as a Unity unit vector (zero for shakes and twists).</summary>
        public static Vector3 GestureDirection(GestureEvent gesture) => gesture.Dir.ToVector3();

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
