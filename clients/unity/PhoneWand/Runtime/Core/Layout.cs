// Layouts: the controls a phone shows. An app picks a template and lists the controls to put in
// it; the phone places them for the player's thumb. See docs/layouts.md and the Layouts section of
// docs/protocol.md.
//
//   wand.SetLayout(Layout.PrimaryRow(
//       Control.Button("shoot", "Shoot"),
//       Control.Button("reload", "Reload"),
//       Control.Toggle("zoom", "Zoom"),
//       Control.TextLabel("ammo", "Ammo", "12")));

using System;
using System.Collections.Generic;

namespace StoryTools.PhoneWand
{
    /// <summary>The layout templates, as the protocol names them.</summary>
    public static class LayoutTemplate
    {
        /// <summary>One big button. 1 control, a button, dpad or crawl.</summary>
        public const string Primary = "primary";
        /// <summary>A big button and a smaller control below it. 2 controls, the first a button, dpad or crawl. The default.</summary>
        public const string PrimarySecondary = "primary-secondary";
        /// <summary>Two equal controls side by side. 2 controls.</summary>
        public const string Pair = "pair";
        /// <summary>A big button with up to three smaller controls in a row below. 1 to 4 controls, the first a button, dpad or crawl.</summary>
        public const string PrimaryRow = "primary-row";
        /// <summary>Two columns. 1 to 6 controls.</summary>
        public const string Grid = "grid";
    }

    /// <summary>The control types, as the protocol names them.</summary>
    public static class ControlType
    {
        /// <summary>Presses arrive as Button events with the control's id.</summary>
        public const string Button = "button";
        /// <summary>On or off: a bool.</summary>
        public const string Toggle = "toggle";
        /// <summary>A position from 0 to 1: a double.</summary>
        public const string Slider = "slider";
        /// <summary>One of 2 to 4 options: the option index, as a double.</summary>
        public const string Choice = "choice";
        /// <summary>Text only the app changes: a string.</summary>
        public const string Label = "label";
        /// <summary>Four arrows, each a button named Control.ButtonFor(id, DpadDirection.Up) and so on. No value.</summary>
        public const string Dpad = "dpad";
        /// <summary>Dungeon-crawler keys, each a button named Control.ButtonFor(id, CrawlDirection.Forward) and so on. No value.</summary>
        public const string Crawl = "crawl";
    }

    /// <summary>A d-pad's directions. Each is pressed as the button "&lt;control id&gt;.&lt;direction&gt;".</summary>
    public static class DpadDirection
    {
        public const string Up = "up";
        public const string Down = "down";
        public const string Left = "left";
        public const string Right = "right";

        /// <summary>All four, in the protocol's order.</summary>
        public static readonly string[] All = { Up, Down, Left, Right };
    }

    /// <summary>A crawl pad's directions. Each is pressed as the button "&lt;control id&gt;.&lt;direction&gt;".</summary>
    public static class CrawlDirection
    {
        public const string Forward = "forward";
        public const string Back = "back";
        public const string StepLeft = "step-left";
        public const string StepRight = "step-right";
        public const string TurnLeft = "turn-left";
        public const string TurnRight = "turn-right";

        /// <summary>All six, in the protocol's order.</summary>
        public static readonly string[] All = { Forward, Back, StepLeft, StepRight, TurnLeft, TurnRight };
    }

    /// <summary>A slider's direction.</summary>
    public static class SliderOrientation
    {
        public const string Horizontal = "horizontal";
        public const string Vertical = "vertical";
    }

    /// <summary>One control in a layout. Build one with Control.Button, Toggle, Slider, Choice, TextLabel, Dpad or Crawl.</summary>
    public sealed class Control
    {
        /// <summary>1 to 32 letters, digits, _, . or -, unique in the layout.</summary>
        public string Id;
        /// <summary>A ControlType: "button", "toggle", "slider", "choice", "label", "dpad" or "crawl".</summary>
        public string Type;
        /// <summary>Text on the control (up to 24 characters), or null for none.</summary>
        public string Label;
        /// <summary>"#rrggbb", or null for the player's colour.</summary>
        public string Colour;
        /// <summary>
        /// The starting value, or null for the default: bool for a toggle, double (0 to 1) for a
        /// slider, double (the option index) for a choice. Labels use Text instead.
        /// </summary>
        public object Value;
        /// <summary>A slider's SliderOrientation, or null for horizontal.</summary>
        public string Orientation;
        /// <summary>Where a slider returns when let go (0 to 1), or null to stay put.</summary>
        public double? Spring;
        /// <summary>A choice's 2 to 4 options (up to 16 characters each).</summary>
        public List<string> Options;
        /// <summary>A label's text (up to 80 characters).</summary>
        public string Text;

        public Control()
        {
        }

        public Control(string id, string type, string label = null)
        {
            Id = id;
            Type = type;
            Label = label;
        }

        /// <summary>A button. Presses arrive as Button events with this id.</summary>
        public static Control Button(string id, string label = null) => new Control(id, ControlType.Button, label);

        /// <summary>A toggle, on or off.</summary>
        public static Control Toggle(string id, string label = null, bool on = false) =>
            new Control(id, ControlType.Toggle, label) { Value = on };

        /// <summary>
        /// A slider from 0 to 1, starting at value (null: at the spring, or 0). spring is where it
        /// returns when let go (a throttle), or null to stay put. vertical for an up and down track.
        /// </summary>
        public static Control Slider(string id, string label = null, double? value = null, bool vertical = false, double? spring = null) =>
            new Control(id, ControlType.Slider, label)
            {
                Value = value.HasValue ? (object)value.Value : null,
                Orientation = vertical ? SliderOrientation.Vertical : SliderOrientation.Horizontal,
                Spring = spring,
            };

        /// <summary>A choice of 2 to 4 options; selected is the starting option's index.</summary>
        public static Control Choice(string id, string label, IEnumerable<string> options, int selected = 0) =>
            new Control(id, ControlType.Choice, label) { Options = new List<string>(options ?? new string[0]), Value = (double)selected };

        /// <summary>A label showing text, which only the app changes (with SetControl).</summary>
        public static Control TextLabel(string id, string label = null, string text = "") =>
            new Control(id, ControlType.Label, label) { Text = text ?? "" };

        /// <summary>
        /// A d-pad: four arrows. Each is a button, so presses arrive as Button events named
        /// ButtonFor(id, DpadDirection.Up) ("move.up" for a d-pad "move") and so on.
        /// </summary>
        public static Control Dpad(string id, string label = null) => new Control(id, ControlType.Dpad, label);

        /// <summary>
        /// A crawl pad: dungeon-crawler keys to step forward, back, left and right and turn left and
        /// right. Each is a button, so presses arrive as Button events named ButtonFor(id,
        /// CrawlDirection.Forward) ("walk.forward" for a crawl pad "walk") and so on.
        /// </summary>
        public static Control Crawl(string id, string label = null) => new Control(id, ControlType.Crawl, label);

        /// <summary>
        /// The button a d-pad or crawl pad presses for a direction: "&lt;controlId&gt;.&lt;direction&gt;",
        /// e.g. ButtonFor("walk", CrawlDirection.TurnLeft) is "walk.turn-left".
        /// </summary>
        public static string ButtonFor(string controlId, string direction) => controlId + "." + direction;

        /// <summary>Set the colour ("#rrggbb") and return this control, for chaining.</summary>
        public Control WithColour(string colour)
        {
            Colour = colour;
            return this;
        }

        /// <summary>The control as the protocol's JSON object (dictionaries and lists, for Json.Write).</summary>
        public Dictionary<string, object> ToJsonValue()
        {
            var o = new Dictionary<string, object> { { "id", Id ?? "" }, { "type", Type ?? "" } };
            if (Label != null) o["label"] = Label;
            if (Colour != null) o["colour"] = Colour;
            switch (Type)
            {
                case ControlType.Toggle:
                case ControlType.Slider:
                case ControlType.Choice:
                    if (Value != null) o["value"] = Value;
                    break;
            }
            if (Type == ControlType.Slider)
            {
                if (Orientation != null) o["orientation"] = Orientation;
                if (Spring.HasValue) o["spring"] = Spring.Value;
            }
            if (Options != null) o["options"] = new List<object>(Options);
            if (Text != null) o["text"] = Text;
            return o;
        }

        /// <summary>A control from the protocol's JSON object (as Json.Parse returns it), or null.</summary>
        public static Control FromJsonValue(Dictionary<string, object> o)
        {
            if (o == null) return null;
            object v;
            var c = new Control
            {
                Id = o.TryGetValue("id", out v) ? v as string : null,
                Type = o.TryGetValue("type", out v) ? v as string : null,
                Label = o.TryGetValue("label", out v) ? v as string : null,
                Colour = o.TryGetValue("colour", out v) ? v as string : null,
                Orientation = o.TryGetValue("orientation", out v) ? v as string : null,
                Text = o.TryGetValue("text", out v) ? v as string : null,
            };
            if (o.TryGetValue("value", out v) && (v is bool || v is double)) c.Value = v;
            if (o.TryGetValue("spring", out v) && v is double spring) c.Spring = spring;
            if (o.TryGetValue("options", out v) && v is List<object> options)
            {
                c.Options = new List<string>();
                foreach (var option in options)
                    if (option is string s) c.Options.Add(s);
            }
            return c;
        }

        public override string ToString() => Json.Write(ToJsonValue());
    }

    /// <summary>
    /// A template and its controls, in order. Build one with the constructor or with Layout.Primary,
    /// PrimarySecondary, Pair, PrimaryRow or Grid.
    /// </summary>
    public sealed class Layout
    {
        /// <summary>A LayoutTemplate: "primary", "primary-secondary", "pair", "primary-row" or "grid".</summary>
        public string Template;
        /// <summary>The controls, in order. In the primary templates the first is the big one: a button, dpad or crawl.</summary>
        public List<Control> Controls = new List<Control>();

        public Layout()
        {
        }

        public Layout(string template, params Control[] controls)
        {
            Template = template;
            if (controls != null) Controls.AddRange(controls);
        }

        /// <summary>What a phone shows until an app sends a layout: a big Primary button and a smaller Secondary one.</summary>
        public static Layout Default => new Layout(LayoutTemplate.PrimarySecondary,
            Control.Button(PhoneButton.Primary, "Primary"), Control.Button(PhoneButton.Secondary, "Secondary"));

        /// <summary>One big button (or a Control.Dpad or Crawl).</summary>
        public static Layout Primary(Control button) => new Layout(LayoutTemplate.Primary, button);

        /// <summary>A big button (or a Control.Dpad or Crawl), and a smaller control below it.</summary>
        public static Layout PrimarySecondary(Control button, Control secondary) =>
            new Layout(LayoutTemplate.PrimarySecondary, button, secondary);

        /// <summary>Two equal controls side by side.</summary>
        public static Layout Pair(Control left, Control right) => new Layout(LayoutTemplate.Pair, left, right);

        /// <summary>A big button (or a Control.Dpad or Crawl), with up to three smaller controls in a row below.</summary>
        public static Layout PrimaryRow(Control button, params Control[] row)
        {
            var layout = new Layout(LayoutTemplate.PrimaryRow, button);
            if (row != null) layout.Controls.AddRange(row);
            return layout;
        }

        /// <summary>Up to six controls in two columns.</summary>
        public static Layout Grid(params Control[] controls) => new Layout(LayoutTemplate.Grid, controls);

        /// <summary>The control with this id, or null.</summary>
        public Control Find(string id)
        {
            foreach (var c in Controls)
                if (c != null && c.Id == id) return c;
            return null;
        }

        /// <summary>The layout as the protocol's JSON object (dictionaries and lists, for Json.Write).</summary>
        public Dictionary<string, object> ToJsonValue()
        {
            var controls = new List<object>();
            foreach (var c in Controls)
                if (c != null) controls.Add(c.ToJsonValue());
            return new Dictionary<string, object> { { "template", Template ?? "" }, { "controls", controls } };
        }

        /// <summary>The layout as JSON text, as the protocol expects it.</summary>
        public string ToJson() => Json.Write(ToJsonValue());

        /// <summary>A layout from the protocol's JSON object (as Json.Parse returns it), or null.</summary>
        public static Layout FromJsonValue(Dictionary<string, object> o)
        {
            if (o == null) return null;
            object v;
            var layout = new Layout { Template = o.TryGetValue("template", out v) ? v as string ?? "" : "" };
            if (o.TryGetValue("controls", out v) && v is List<object> list)
            {
                foreach (var item in list)
                {
                    var c = Control.FromJsonValue(item as Dictionary<string, object>);
                    if (c != null) layout.Controls.Add(c);
                }
            }
            return layout;
        }

        public override string ToString() => ToJson();
    }
}
