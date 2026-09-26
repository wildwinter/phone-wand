// Phone Wand demo: cursors for every player, plus a panel with the join QR code, the player list
// and their connection stats. It also shows the app-to-phone messages: a welcome prompt on
// join, a buzz (Android) on every click, and keys to ask everyone to calibrate. Players have no
// cursor until they have set up their aim once (or while they calibrate), so a line at the bottom
// left says what each of them still needs to do on their phone.
//
//   C: ask every player to calibrate the screen (two corners)
//   R: ask every player to recentre (point at the middle and press Recentre)
//   Tab: show or hide the panel
//
// Start the relay first (bun run relay, or bun run sim for three simulated players), then press
// Play. The PhoneWandClient on the same GameObject holds the relay address.

using System.Collections;
using System.Collections.Generic;
using System.Text;
using StoryTools.PhoneWand;
using UnityEngine;
using UnityEngine.Networking;

public class PhoneWandDemo : MonoBehaviour
{
    [Tooltip("Cursor diameter in pixels, at a 1080 pixel high screen.")]
    public float cursorSize = 40f;

    [Tooltip("Show the panel with the QR code and players.")]
    public bool showPanel = true;

    struct Ripple
    {
        public Vector2 Position;
        public Color Colour;
        public float Start;
    }

    const float RippleSeconds = 0.6f;

    PhoneWandClient wand;
    readonly List<Ripple> ripples = new List<Ripple>();
    readonly Dictionary<string, string> calibrating = new Dictionary<string, string>();
    Texture2D disc, ring, arrow, qr;
    string qrFor;
    GUIStyle label, panel;
    readonly List<Player> waiting = new List<Player>();

    void Awake()
    {
        wand = GetComponent<PhoneWandClient>();
        if (wand == null) wand = gameObject.AddComponent<PhoneWandClient>();

        // A built player can be pointed at another relay: PhoneWandDemo -phoneWandUrl ws://host:port/app
        string[] args = System.Environment.GetCommandLineArgs();
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (args[i] != "-phoneWandUrl") continue;
            wand.Url = args[i + 1];
            wand.Disconnect();
            wand.Connect();
        }

        disc = Disc(64, 0f);
        ring = Disc(64, 0.82f);
        arrow = Arrow(64);
    }

    void OnEnable()
    {
        wand.Connected += OnConnected;
        wand.PlayerJoined += OnJoined;
        wand.Button += OnButton;
        wand.Calibrating += OnCalibrating;
        wand.Calibrated += OnCalibrated;
    }

    void OnDisable()
    {
        wand.Connected -= OnConnected;
        wand.PlayerJoined -= OnJoined;
        wand.Button -= OnButton;
        wand.Calibrating -= OnCalibrating;
        wand.Calibrated -= OnCalibrated;
    }

    void OnDestroy()
    {
        Destroy(disc);
        Destroy(ring);
        Destroy(arrow);
        if (qr != null) Destroy(qr);
    }

    void Update()
    {
        if (Input.GetKeyDown(KeyCode.C)) wand.Calibrate(CalibrationMode.Screen);
        if (Input.GetKeyDown(KeyCode.R)) wand.Calibrate(CalibrationMode.Ray);
        if (Input.GetKeyDown(KeyCode.Tab)) showPanel = !showPanel;
    }

    // ------------------------------------------------------------------ events

    void OnConnected(RelayHello hello)
    {
        if (qrFor != hello.QrUrl) StartCoroutine(LoadQr(hello.QrUrl));
    }

    void OnJoined(Player player)
    {
        wand.Prompt("Welcome, " + player.Name + "! Point at the screen.", player.Id, 3000);
    }

    void OnButton(ButtonEvent e, Player player)
    {
        if (!e.Down) return;
        if (e.Button == PhoneButton.Primary)
        {
            var at = PhoneWandClient.GuiPosition(player.Pose);
            if (at.HasValue) ripples.Add(new Ripple { Position = at.Value, Colour = player.UnityColour(), Start = Time.unscaledTime });
            wand.Haptic(30, player.Id);
        }
    }

    void OnCalibrating(CalibrationStep step, Player player)
    {
        if (step == CalibrationStep.Cancelled) calibrating.Remove(player.Id);
        else calibrating[player.Id] = step == CalibrationStep.TopLeft ? "top-left" : "bottom-right";
    }

    void OnCalibrated(Calibration calibration, Player player)
    {
        calibrating.Remove(player.Id);
    }

    IEnumerator LoadQr(string url)
    {
        qrFor = url;
        using (var request = UnityWebRequestTexture.GetTexture(url + "?size=256"))
        {
            yield return request.SendWebRequest();
            if (request.result != UnityWebRequest.Result.Success) yield break;
            if (qr != null) Destroy(qr);
            qr = DownloadHandlerTexture.GetContent(request);
            qr.filterMode = FilterMode.Point;
        }
    }

    // ------------------------------------------------------------------ drawing

    float Scale => Mathf.Max(0.8f, Screen.height / 1080f);

    void OnGUI()
    {
        if (label == null)
        {
            label = new GUIStyle(GUI.skin.label) { fontStyle = FontStyle.Bold, alignment = TextAnchor.MiddleLeft };
            panel = new GUIStyle(GUI.skin.box) { alignment = TextAnchor.UpperLeft, wordWrap = true, richText = true };
        }
        label.fontSize = Mathf.RoundToInt(20 * Scale);
        panel.fontSize = Mathf.RoundToInt(15 * Scale);
        if (Event.current.type != EventType.Repaint) return;

        DrawCornerMarkers();
        DrawRipples();
        foreach (var player in wand.Players) DrawPlayer(player);
        DrawWaiting();
        if (showPanel) DrawPanel();
    }

    void DrawPlayer(Player player)
    {
        var pose = player.Pose;
        if (pose == null || player.State == PlayerState.Waiting) return;
        Color colour = player.UnityColour();
        if (player.State == PlayerState.Paused) colour.a = 0.35f;
        float size = cursorSize * Scale;
        var screen = new Vector2(Screen.width, Screen.height);
        Vector2? at = PhoneWandClient.GuiPosition(pose);
        // No cursor until the player has aimed once, nor while they calibrate: DrawWaiting says why.
        if (!at.HasValue && IsWaiting(player)) return;

        if (at.HasValue && new Rect(0, 0, screen.x, screen.y).Contains(at.Value))
        {
            bool held = player.IsHeld(PhoneButton.Primary);
            float s = held ? size * 1.25f : size;
            GUI.color = colour;
            GUI.DrawTexture(new Rect(at.Value.x - s / 2, at.Value.y - s / 2, s, s), held ? ring : disc);
            Label(new Vector2(at.Value.x + s * 0.7f, at.Value.y), player.Name, colour);
            GUI.color = Color.white;
            return;
        }

        Vector2 centre = screen / 2;
        Vector2 toward = at.HasValue ? at.Value - centre : new Vector2((float)pose.Direction.Right, -(float)pose.Direction.Up);
        if (toward.sqrMagnitude < 1e-6f) return;
        toward.Normalize();
        float tx = Mathf.Abs(toward.x) > 1e-5f ? (centre.x - size) / Mathf.Abs(toward.x) : float.MaxValue;
        float ty = Mathf.Abs(toward.y) > 1e-5f ? (centre.y - size) / Mathf.Abs(toward.y) : float.MaxValue;
        Vector2 edge = centre + toward * Mathf.Min(tx, ty);

        Matrix4x4 saved = GUI.matrix;
        GUIUtility.RotateAroundPivot(Mathf.Atan2(toward.y, toward.x) * Mathf.Rad2Deg, edge);
        GUI.color = colour;
        GUI.DrawTexture(new Rect(edge.x - size / 2, edge.y - size / 2, size, size), arrow);
        GUI.matrix = saved;

        Vector2 labelAt = edge - toward * size * 1.2f;
        float width = label.CalcSize(new GUIContent(player.Name)).x;
        if (toward.x > 0.3f) labelAt.x -= width;
        else if (Mathf.Abs(toward.x) <= 0.3f) labelAt.x -= width / 2;
        Label(labelAt, player.Name, colour);
        GUI.color = Color.white;
    }

    // True for a player who still has to do something before they get a cursor.
    static bool IsWaiting(Player player)
    {
        return player.State == PlayerState.Waiting || player.Calibration == Calibration.None || player.Calibrating.HasValue;
    }

    // Lists, bottom left, what each player without a cursor still needs to do on their phone.
    void DrawWaiting()
    {
        waiting.Clear();
        foreach (var player in wand.Players)
            if (IsWaiting(player)) waiting.Add(player);
        if (waiting.Count == 0) return;
        float size = label.fontSize;
        float left = 20 * Scale;
        float bottom = Screen.height - 20 * Scale;
        for (int i = 0; i < waiting.Count; i++)
        {
            Player player = waiting[i];
            string what = player.Calibrating.HasValue ? "is calibrating: aim at the marked corner"
                : player.State == PlayerState.Waiting ? "tap Tap to start on your phone"
                : "set up your aim on your phone";
            string numbered = "Player " + (player.Slot + 1);
            string who = player.Name == numbered ? player.Name : numbered + ", " + player.Name;
            float middle = bottom - (waiting.Count - 1 - i) * size * 1.5f - size * 0.5f;
            Color colour = player.UnityColour();
            float dot = size * 0.7f;
            GUI.color = colour;
            GUI.DrawTexture(new Rect(left, middle - dot / 2, dot, dot), disc);
            Label(new Vector2(left + size, middle), who + ": " + what, colour);
        }
        GUI.color = Color.white;
    }

    void Label(Vector2 leftMiddle, string text, Color colour)
    {
        var content = new GUIContent(text);
        Vector2 size = label.CalcSize(content);
        var rect = new Rect(leftMiddle.x, leftMiddle.y - size.y / 2, size.x, size.y);
        GUI.color = new Color(0, 0, 0, 0.75f * colour.a);
        GUI.Label(new Rect(rect.x + 2, rect.y + 2, rect.width, rect.height), content, label);
        GUI.color = new Color(1, 1, 1, colour.a);
        label.normal.textColor = colour;
        GUI.Label(rect, content, label);
    }

    void DrawRipples()
    {
        float now = Time.unscaledTime;
        ripples.RemoveAll(r => now - r.Start > RippleSeconds);
        foreach (var r in ripples)
        {
            float t = (now - r.Start) / RippleSeconds;
            float s = Mathf.Lerp(cursorSize, cursorSize * 4f, t) * Scale;
            Color c = r.Colour;
            c.a = 1f - t;
            GUI.color = c;
            GUI.DrawTexture(new Rect(r.Position.x - s / 2, r.Position.y - s / 2, s, s), ring);
        }
        GUI.color = Color.white;
    }

    // While someone calibrates, mark the corner they are being asked to point at.
    void DrawCornerMarkers()
    {
        foreach (var kv in calibrating)
        {
            var player = wand.GetPlayer(kv.Key);
            if (player == null) continue;
            float s = cursorSize * 1.5f * Scale;
            Vector2 at = kv.Value == "top-left" ? new Vector2(s / 2, s / 2) : new Vector2(Screen.width - s / 2, Screen.height - s / 2);
            GUI.color = player.UnityColour();
            GUI.DrawTexture(new Rect(at.x - s / 2, at.y - s / 2, s, s), ring);
        }
        GUI.color = Color.white;
    }

    void DrawPanel()
    {
        var sb = new StringBuilder();
        if (!wand.IsConnected)
        {
            sb.Append("<b>Phone Wand</b>\nWaiting for the relay at ").Append(wand.Url).Append("\nIs it running?");
        }
        else
        {
            var hello = wand.Hello;
            sb.Append("<b>Phone Wand</b> (relay ").Append(hello.Relay).Append(")\n");
            sb.Append("Join at ").Append(hello.JoinUrl).Append("\n\n");
            if (wand.Players.Count == 0) sb.Append("No players yet.");
            foreach (var p in wand.Players)
            {
                sb.Append("<color=").Append(p.Colour).Append(">●</color> ").Append(p.Name);
                sb.Append("  ").Append(ProtocolNames.Of(p.State)).Append(", ").Append(ProtocolNames.Of(p.Calibration));
                if (p.Stats != null) sb.Append(", ").Append(p.Stats.Rate.ToString("0")).Append("/s, ").Append(p.Stats.Rtt.ToString("0")).Append(" ms");
                sb.Append('\n');
            }
            sb.Append("\nC: calibrate screen   R: recentre   Tab: hide");
        }
        var content = new GUIContent(sb.ToString());
        float width = Mathf.Min(Screen.width - 20, 420 * Scale);
        float qrSize = qr != null && wand.IsConnected ? width * 0.6f : 0;
        float height = panel.CalcHeight(content, width) + (qrSize > 0 ? qrSize + 10 : 0);
        GUI.color = Color.white;
        GUI.Box(new Rect(10, 10, width, height), content, panel);
        if (qrSize > 0) GUI.DrawTexture(new Rect(10 + (width - qrSize) / 2, 10 + height - qrSize - 8, qrSize, qrSize), qr);
    }

    // ------------------------------------------------------------------ textures

    static Texture2D Disc(int size, float hole)
    {
        var tex = new Texture2D(size, size, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp, hideFlags = HideFlags.HideAndDontSave };
        float r = size / 2f;
        var pixels = new Color32[size * size];
        for (int y = 0; y < size; y++)
            for (int x = 0; x < size; x++)
            {
                float d = new Vector2(x + 0.5f - r, y + 0.5f - r).magnitude;
                float a = Mathf.Min(Mathf.Clamp01(r - d), hole > 0 ? Mathf.Clamp01(d - r * hole) : 1f);
                pixels[y * size + x] = new Color32(255, 255, 255, (byte)(255 * a));
            }
        tex.SetPixels32(pixels);
        tex.Apply();
        return tex;
    }

    static Texture2D Arrow(int size)
    {
        var tex = new Texture2D(size, size, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp, hideFlags = HideFlags.HideAndDontSave };
        var pixels = new Color32[size * size];
        for (int y = 0; y < size; y++)
            for (int x = 0; x < size; x++)
            {
                float u = (x + 0.5f) / size;
                float v = Mathf.Abs((y + 0.5f) / size - 0.5f) * 2f;
                float a = Mathf.Clamp01(((1f - u) - v) * size * 0.5f + 0.5f);
                pixels[y * size + x] = new Color32(255, 255, 255, (byte)(255 * a));
            }
        tex.SetPixels32(pixels);
        tex.Apply();
        return tex;
    }
}
