// Phone Wand sample: draw every player's cursor over the game view.
//
// Each player gets a disc in their colour where they point, with their name beside it. Pressing
// the main button on the phone sends out a ripple. When a player points off the screen, an arrow
// at the edge shows which way to turn. Everything is drawn with OnGUI, so the sample needs no
// canvas, prefabs or other packages.
//
// Put this on any GameObject. It uses a PhoneWandClient on the same GameObject, adding one
// (with the default relay address) if there is none.

using System.Collections.Generic;
using UnityEngine;

namespace StoryTools.PhoneWand.Samples
{
    [AddComponentMenu("Phone Wand/Samples/Cursors Sample")]
    public class CursorsSample : MonoBehaviour
    {
        [Tooltip("Cursor diameter in pixels, at a 1080 pixel high screen.")]
        public float cursorSize = 36f;

        [Tooltip("How long a click ripple lasts, in seconds.")]
        public float rippleSeconds = 0.6f;

        [Tooltip("Show the connection status and join address in the top-left corner.")]
        public bool showStatus = true;

        struct Ripple
        {
            public Vector2 Position; // GUI pixels
            public Color Colour;
            public float Start;
        }

        PhoneWandClient wand;
        readonly List<Ripple> ripples = new List<Ripple>();
        Texture2D disc, ring, arrow;
        GUIStyle labelStyle, statusStyle;

        void Awake()
        {
            wand = GetComponent<PhoneWandClient>();
            if (wand == null) wand = gameObject.AddComponent<PhoneWandClient>();
            disc = MakeDisc(64, 0f);
            ring = MakeDisc(64, 0.82f);
            arrow = MakeArrow(64);
        }

        void OnEnable()
        {
            wand.Button += OnButton;
        }

        void OnDisable()
        {
            wand.Button -= OnButton;
        }

        void OnDestroy()
        {
            Destroy(disc);
            Destroy(ring);
            Destroy(arrow);
        }

        void OnButton(ButtonEvent e, Player player)
        {
            if (e.Button != PhoneButton.Primary || !e.Down) return;
            var at = PhoneWandClient.GuiPosition(player.Pose);
            if (!at.HasValue) return;
            ripples.Add(new Ripple { Position = at.Value, Colour = player.UnityColour(), Start = Time.unscaledTime });
        }

        float Scale => Mathf.Max(0.8f, Screen.height / 1080f);

        void OnGUI()
        {
            if (Event.current.type != EventType.Repaint && Event.current.type != EventType.Layout) return;
            if (labelStyle == null)
            {
                labelStyle = new GUIStyle(GUI.skin.label) { fontStyle = FontStyle.Bold, alignment = TextAnchor.MiddleLeft };
                statusStyle = new GUIStyle(GUI.skin.box) { alignment = TextAnchor.UpperLeft, wordWrap = true };
            }
            labelStyle.fontSize = Mathf.RoundToInt(20 * Scale);
            statusStyle.fontSize = Mathf.RoundToInt(16 * Scale);
            if (Event.current.type != EventType.Repaint) return;

            DrawRipples();
            foreach (var player in wand.Players) DrawPlayer(player);
            if (showStatus) DrawStatus();
        }

        void DrawPlayer(Player player)
        {
            var pose = player.Pose;
            if (pose == null || player.State == PlayerState.Waiting) return;
            Color colour = player.UnityColour();
            if (player.State == PlayerState.Paused) colour.a = 0.35f;
            string name = string.IsNullOrEmpty(player.Label) ? player.Name : player.Name + " (" + player.Label + ")";

            float size = cursorSize * Scale;
            var screen = new Vector2(Screen.width, Screen.height);
            Vector2? at = PhoneWandClient.GuiPosition(pose);

            if (at.HasValue && at.Value.x >= 0 && at.Value.y >= 0 && at.Value.x <= screen.x && at.Value.y <= screen.y)
            {
                // On screen: a disc, a ring while the main button is held, and the name.
                Vector2 p = at.Value;
                bool held = player.IsHeld(PhoneButton.Primary);
                float s = held ? size * 1.25f : size;
                GUI.color = colour;
                GUI.DrawTexture(new Rect(p.x - s / 2, p.y - s / 2, s, s), held ? ring : disc);
                DrawLabel(new Vector2(p.x + s * 0.7f, p.y), name, colour);
                GUI.color = Color.white;
                return;
            }

            // Off screen: an arrow on the edge, pointing where they are pointing. Without a screen
            // position (pointing far away), use the direction's right and up components instead.
            Vector2 centre = screen / 2;
            Vector2 toward;
            if (at.HasValue) toward = at.Value - centre;
            else toward = new Vector2((float)pose.Direction.Right, -(float)pose.Direction.Up);
            if (toward.sqrMagnitude < 1e-6f) return;
            toward.Normalize();

            float margin = size;
            float tx = Mathf.Abs(toward.x) > 1e-5f ? (centre.x - margin) / Mathf.Abs(toward.x) : float.MaxValue;
            float ty = Mathf.Abs(toward.y) > 1e-5f ? (centre.y - margin) / Mathf.Abs(toward.y) : float.MaxValue;
            Vector2 edge = centre + toward * Mathf.Min(tx, ty);

            float angle = Mathf.Atan2(toward.y, toward.x) * Mathf.Rad2Deg;
            Matrix4x4 saved = GUI.matrix;
            GUIUtility.RotateAroundPivot(angle, edge);
            GUI.color = colour;
            GUI.DrawTexture(new Rect(edge.x - size / 2, edge.y - size / 2, size, size), arrow);
            GUI.matrix = saved;

            // The name sits on the inside of the arrow, so it stays on screen.
            Vector2 labelAt = edge - toward * size * 1.2f;
            Vector2 textSize = labelStyle.CalcSize(new GUIContent(name));
            if (toward.x > 0.3f) labelAt.x -= textSize.x;
            else if (Mathf.Abs(toward.x) <= 0.3f) labelAt.x -= textSize.x / 2;
            DrawLabel(labelAt, name, colour);
            GUI.color = Color.white;
        }

        void DrawLabel(Vector2 leftMiddle, string text, Color colour)
        {
            var content = new GUIContent(text);
            Vector2 textSize = labelStyle.CalcSize(content);
            var rect = new Rect(leftMiddle.x, leftMiddle.y - textSize.y / 2, textSize.x, textSize.y);
            // A dark shadow keeps names readable on any background.
            GUI.color = new Color(0, 0, 0, 0.75f * colour.a);
            GUI.Label(new Rect(rect.x + 2, rect.y + 2, rect.width, rect.height), content, labelStyle);
            GUI.color = new Color(1, 1, 1, colour.a);
            labelStyle.normal.textColor = colour;
            GUI.Label(rect, content, labelStyle);
        }

        void DrawRipples()
        {
            float now = Time.unscaledTime;
            ripples.RemoveAll(r => now - r.Start > rippleSeconds);
            foreach (var r in ripples)
            {
                float t = (now - r.Start) / rippleSeconds;
                float s = Mathf.Lerp(cursorSize, cursorSize * 4f, t) * Scale;
                Color c = r.Colour;
                c.a = 1f - t;
                GUI.color = c;
                GUI.DrawTexture(new Rect(r.Position.x - s / 2, r.Position.y - s / 2, s, s), ring);
            }
            GUI.color = Color.white;
        }

        void DrawStatus()
        {
            string text;
            if (!wand.IsConnected)
                text = "Phone Wand: waiting for the relay at " + wand.Url + "\nIs the relay running?";
            else if (wand.Players.Count == 0)
                text = "Phone Wand: connected. Phones join at\n" + wand.Hello.JoinUrl;
            else
                text = "Phone Wand: " + wand.Players.Count + " of " + wand.Hello.MaxPlayers + " players. Join at\n" + wand.Hello.JoinUrl;
            var content = new GUIContent(text);
            float width = Mathf.Min(Screen.width - 20, 520 * Scale);
            float height = statusStyle.CalcHeight(content, width);
            GUI.color = Color.white;
            GUI.Box(new Rect(10, 10, width, height), content, statusStyle);
        }

        // ------------------------------------------------------------------ textures

        // A white anti-aliased disc (hole = 0) or ring (hole = inner radius as a fraction).
        static Texture2D MakeDisc(int size, float hole)
        {
            var tex = new Texture2D(size, size, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp, hideFlags = HideFlags.HideAndDontSave };
            float r = size / 2f;
            var pixels = new Color32[size * size];
            for (int y = 0; y < size; y++)
            {
                for (int x = 0; x < size; x++)
                {
                    float d = new Vector2(x + 0.5f - r, y + 0.5f - r).magnitude;
                    float outer = Mathf.Clamp01(r - d);
                    float inner = hole > 0 ? Mathf.Clamp01(d - r * hole) : 1f;
                    pixels[y * size + x] = new Color32(255, 255, 255, (byte)(255 * Mathf.Min(outer, inner)));
                }
            }
            tex.SetPixels32(pixels);
            tex.Apply();
            return tex;
        }

        // A white triangle pointing right (+x), which RotateAroundPivot turns to face the player.
        static Texture2D MakeArrow(int size)
        {
            var tex = new Texture2D(size, size, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp, hideFlags = HideFlags.HideAndDontSave };
            var pixels = new Color32[size * size];
            for (int y = 0; y < size; y++)
            {
                for (int x = 0; x < size; x++)
                {
                    // Tip at the right middle, base along the left edge.
                    float u = (x + 0.5f) / size;
                    float v = Mathf.Abs((y + 0.5f) / size - 0.5f) * 2f;
                    float edge = (1f - u) - v; // positive inside
                    float a = Mathf.Clamp01(edge * size * 0.5f + 0.5f);
                    pixels[y * size + x] = new Color32(255, 255, 255, (byte)(255 * a));
                }
            }
            tex.SetPixels32(pixels);
            tex.Apply();
            return tex;
        }
    }
}
