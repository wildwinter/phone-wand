// The data the relay sends, as C# types. Mirrors packages/client-js/src/index.ts.

using System;
using System.Collections.Generic;

namespace StoryTools.PhoneWand
{
    /// <summary>What the player's phone is doing.</summary>
    public enum PlayerState
    {
        /// <summary>Joined, but has not yet allowed motion access.</summary>
        Waiting,
        /// <summary>Sending poses.</summary>
        Active,
        /// <summary>Tab hidden, phone locked, or no data for half a second.</summary>
        Paused,
    }

    /// <summary>How the player has calibrated.</summary>
    public enum Calibration
    {
        /// <summary>Not calibrated.</summary>
        None,
        /// <summary>Recentre pressed: forward is where they pointed.</summary>
        Ray,
        /// <summary>Two-corner screen calibration done.</summary>
        Screen,
    }

    /// <summary>A step of screen calibration, as reported by the calibrating event.</summary>
    public enum CalibrationStep
    {
        TopLeft,
        BottomRight,
        Cancelled,
    }

    /// <summary>What to ask a player to calibrate with Calibrate().</summary>
    public enum CalibrationMode
    {
        /// <summary>Two corners of the screen.</summary>
        Screen,
        /// <summary>Point at the middle of the screen and press Recentre.</summary>
        Ray,
    }

    /// <summary>
    /// The ids of the default layout's two buttons. Buttons are identified by string ids: these
    /// two by default, or the ids of the buttons in a layout you send with SetLayout.
    /// </summary>
    public static class PhoneButton
    {
        /// <summary>The big button of the default layout: "primary".</summary>
        public const string Primary = "primary";
        /// <summary>The smaller button of the default layout: "secondary".</summary>
        public const string Secondary = "secondary";
    }

    /// <summary>Conversions between the protocol's strings and the enums above.</summary>
    public static class ProtocolNames
    {
        public static string Of(PlayerState state)
        {
            switch (state)
            {
                case PlayerState.Active: return "active";
                case PlayerState.Paused: return "paused";
                default: return "waiting";
            }
        }

        public static string Of(Calibration calibration)
        {
            switch (calibration)
            {
                case Calibration.Ray: return "ray";
                case Calibration.Screen: return "screen";
                default: return "none";
            }
        }

        public static string Of(CalibrationStep step)
        {
            switch (step)
            {
                case CalibrationStep.TopLeft: return "top-left";
                case CalibrationStep.BottomRight: return "bottom-right";
                default: return "cancelled";
            }
        }

        public static string Of(CalibrationMode mode)
        {
            return mode == CalibrationMode.Ray ? "ray" : "screen";
        }

        public static bool TryParse(string s, out PlayerState state)
        {
            switch (s)
            {
                case "waiting": state = PlayerState.Waiting; return true;
                case "active": state = PlayerState.Active; return true;
                case "paused": state = PlayerState.Paused; return true;
                default: state = PlayerState.Waiting; return false;
            }
        }

        public static bool TryParse(string s, out Calibration calibration)
        {
            switch (s)
            {
                case "none": calibration = Calibration.None; return true;
                case "ray": calibration = Calibration.Ray; return true;
                case "screen": calibration = Calibration.Screen; return true;
                default: calibration = Calibration.None; return false;
            }
        }

        public static bool TryParse(string s, out CalibrationStep step)
        {
            switch (s)
            {
                case "top-left": step = CalibrationStep.TopLeft; return true;
                case "bottom-right": step = CalibrationStep.BottomRight; return true;
                case "cancelled": step = CalibrationStep.Cancelled; return true;
                default: step = CalibrationStep.Cancelled; return false;
            }
        }

    }

    /// <summary>The relay's hello, received once per connection.</summary>
    public sealed class RelayHello
    {
        /// <summary>Protocol version (0).</summary>
        public int Protocol { get; internal set; }
        /// <summary>Relay version string.</summary>
        public string Relay { get; internal set; } = "";
        /// <summary>The URL phones open to join (what the QR code holds).</summary>
        public string JoinUrl { get; internal set; } = "";
        /// <summary>A PNG of the join QR code. Append ?size=512 for a size in pixels.</summary>
        public string QrUrl { get; internal set; } = "";
        public int MaxPlayers { get; internal set; }
    }

    /// <summary>The phone's platform and connection details.</summary>
    public sealed class DeviceInfo
    {
        /// <summary>"iOS", "Android" or "other".</summary>
        public string Platform { get; internal set; } = "";
        /// <summary>"relative-orientation-sensor" or "deviceorientation".</summary>
        public string Sensor { get; internal set; } = "";
        /// <summary>"ws" (WebSocket) or "http" (the HTTP fallback).</summary>
        public string Transport { get; internal set; } = "";
    }

    /// <summary>One orientation sample from a phone. Immutable.</summary>
    public sealed class PlayerPose
    {
        public string Id { get; }
        /// <summary>The phone's sample counter. Gaps mean dropped samples.</summary>
        public long Seq { get; }
        /// <summary>When the relay received the sample, in ms since the Unix epoch.</summary>
        public double Time { get; }
        /// <summary>Calibrated orientation in the rig frame.</summary>
        public RigQuaternion Rotation { get; }
        /// <summary>Degrees, positive to the right.</summary>
        public double Yaw { get; }
        /// <summary>Degrees, positive upwards.</summary>
        public double Pitch { get; }
        /// <summary>Degrees, positive clockwise as seen from behind.</summary>
        public double Roll { get; }
        /// <summary>Calibrated unit pointing direction.</summary>
        public RigVector3 Direction { get; }
        /// <summary>Normalised screen position, or null when pointing far away from the screen.</summary>
        public ScreenPoint? Screen { get; }

        public PlayerPose(string id, long seq, double time, RigQuaternion rotation, double yaw, double pitch, double roll,
            RigVector3 direction, ScreenPoint? screen)
        {
            Id = id;
            Seq = seq;
            Time = time;
            Rotation = rotation;
            Yaw = yaw;
            Pitch = pitch;
            Roll = roll;
            Direction = direction;
            Screen = screen;
        }
    }

    /// <summary>A button press or release.</summary>
    public readonly struct ButtonEvent
    {
        /// <summary>The player's id.</summary>
        public string Id { get; }
        /// <summary>The button's id: PhoneButton.Primary or Secondary by default, or an id from the player's layout.</summary>
        public string Button { get; }
        /// <summary>True when pressed, false when released.</summary>
        public bool Down { get; }

        public ButtonEvent(string id, string button, bool down)
        {
            Id = id;
            Button = button;
            Down = down;
        }
    }

    /// <summary>A toggle, slider, choice or label changed, on the phone or because an app set it.</summary>
    public readonly struct ControlEvent
    {
        /// <summary>The player's id.</summary>
        public string Id { get; }
        /// <summary>The control's id, from the player's layout.</summary>
        public string Control { get; }
        /// <summary>
        /// The new value: bool for a toggle, double for a slider (0 to 1) or a choice (the option
        /// index), string for a label.
        /// </summary>
        public object Value { get; }

        public ControlEvent(string id, string control, object value)
        {
            Id = id;
            Control = control;
            Value = value;
        }

        /// <summary>The value as a bool (a toggle), or false.</summary>
        public bool AsBool => Value is bool b && b;
        /// <summary>The value as a number (a slider's 0 to 1, or a choice's index), or 0.</summary>
        public double AsNumber => Value is double d ? d : 0;
        /// <summary>The value as an option index (a choice), or 0.</summary>
        public int AsIndex => Value is double d ? (int)Math.Round(d) : 0;
        /// <summary>The value as text (a label), or null.</summary>
        public string AsString => Value as string;

        public override string ToString() => Id + " " + Control + " = " + (Value is string s ? "\"" + s + "\"" : Json.Write(Value));
    }

    /// <summary>Connection statistics, sent once a second per player.</summary>
    public sealed class PlayerStats
    {
        public string Id { get; }
        /// <summary>Round trip relay to phone and back, in ms.</summary>
        public double Rtt { get; }
        /// <summary>Poses per second.</summary>
        public double Rate { get; }
        /// <summary>Samples lost or out of order in the last second.</summary>
        public int Dropped { get; }

        public PlayerStats(string id, double rtt, double rate, int dropped)
        {
            Id = id;
            Rtt = rtt;
            Rate = rate;
            Dropped = dropped;
        }
    }

    /// <summary>Everything known about one player.</summary>
    public sealed class Player
    {
        /// <summary>Unique for the lifetime of the relay; kept across phone reconnects.</summary>
        public string Id { get; internal set; } = "";
        /// <summary>0-based player number, lowest free first.</summary>
        public int Slot { get; internal set; }
        public string Name { get; internal set; } = "";
        /// <summary>"#rrggbb", lower case.</summary>
        public string Colour { get; internal set; } = "";
        /// <summary>Extra text set by apps with Style (a team name, say).</summary>
        public string Label { get; internal set; } = "";
        public PlayerState State { get; internal set; }
        public Calibration Calibration { get; internal set; }
        public DeviceInfo Device { get; } = new DeviceInfo();
        /// <summary>The latest pose, or null before the first one.</summary>
        public PlayerPose Pose { get; internal set; }
        /// <summary>The latest stats, or null before the first.</summary>
        public PlayerStats Stats { get; internal set; }
        /// <summary>The corner being calibrated, or null.</summary>
        public CalibrationStep? Calibrating { get; internal set; }

        /// <summary>
        /// The controls this player's phone shows. Until an app sends one, the default:
        /// primary-secondary with the buttons "primary" and "secondary". Treat it as read only; change
        /// it with SetLayout.
        /// </summary>
        public Layout Layout { get; internal set; } = Layout.Default;

        internal Dictionary<string, object> ControlValues = new Dictionary<string, object>();

        /// <summary>
        /// Current values of the layout's toggles (bool), sliders (double, 0 to 1), choices (double,
        /// the option index) and labels (string), by control id. Buttons have no value.
        /// </summary>
        public IReadOnlyDictionary<string, object> Controls => ControlValues;

        /// <summary>A toggle's state, or fallback if the player has no such toggle.</summary>
        public bool GetToggle(string controlId, bool fallback = false)
        {
            object v;
            return controlId != null && ControlValues.TryGetValue(controlId, out v) && v is bool b ? b : fallback;
        }

        /// <summary>A slider's position (0 to 1), or fallback if the player has no such slider.</summary>
        public double GetSlider(string controlId, double fallback = 0)
        {
            object v;
            return controlId != null && ControlValues.TryGetValue(controlId, out v) && v is double d ? d : fallback;
        }

        /// <summary>A choice's selected option index, or fallback if the player has no such choice.</summary>
        public int GetChoice(string controlId, int fallback = 0)
        {
            object v;
            return controlId != null && ControlValues.TryGetValue(controlId, out v) && v is double d ? (int)Math.Round(d) : fallback;
        }

        /// <summary>A label's text, or fallback if the player has no such label.</summary>
        public string GetText(string controlId, string fallback = null)
        {
            object v;
            return controlId != null && ControlValues.TryGetValue(controlId, out v) && v is string s ? s : fallback;
        }

        internal readonly HashSet<string> HeldButtons = new HashSet<string>();

        /// <summary>The ids of the buttons currently held down.</summary>
        public IReadOnlyCollection<string> Buttons => HeldButtons;

        /// <summary>True while the button with this id is held down, e.g. IsHeld(PhoneButton.Primary).</summary>
        public bool IsHeld(string button) => button != null && HeldButtons.Contains(button);

        public override string ToString() => Id + " (" + Name + ", slot " + Slot + ")";
    }

    /// <summary>
    /// One Euro filter settings for the poses this app receives. Leave a field null to keep the
    /// relay's value. Use Smoothing.Off for raw poses.
    /// </summary>
    public sealed class Smoothing
    {
        /// <summary>Lower is steadier when still.</summary>
        public double? MinCutoff;
        /// <summary>Higher is quicker when moving.</summary>
        public double? Beta;
        public double? DCutoff;

        /// <summary>True for "no smoothing" (sent as smoothing: false).</summary>
        public bool IsOff { get; private set; }

        /// <summary>No smoothing: raw poses.</summary>
        public static Smoothing Off => new Smoothing { IsOff = true };

        public Smoothing()
        {
        }

        public Smoothing(double minCutoff, double beta, double dCutoff)
        {
            MinCutoff = minCutoff;
            Beta = beta;
            DCutoff = dCutoff;
        }

        internal object ToJsonValue()
        {
            if (IsOff) return false;
            var o = new Dictionary<string, object>();
            if (MinCutoff.HasValue) o["minCutoff"] = MinCutoff.Value;
            if (Beta.HasValue) o["beta"] = Beta.Value;
            if (DCutoff.HasValue) o["dCutoff"] = DCutoff.Value;
            return o;
        }
    }
}
