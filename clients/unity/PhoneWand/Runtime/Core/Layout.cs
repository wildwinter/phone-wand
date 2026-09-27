// Layouts: the controls a phone shows. An app picks a template and lists the controls to put in
// it; the phone places them for the player's thumb. See docs/layouts.md and the Layouts section of
// docs/protocol.md.
//
//   wand.SetLayout(Layout.PrimaryRow(
//       Control.Button("shoot", "Shoot"),
//       Control.Button("reload", "Reload"),
//       Control.Toggle("zoom", "Zoom"),
//       Control.TextLabel("ammo", "Ammo", "12")));
//
//   wand.SetLayout(Layout.InRows(new[] { 1, 3 },
//       Control.Crawl("walk"), Control.Button("attack", "Attack"),
//       Control.Button("use", "Use"), Control.Toggle("map", "Map")).WithHeights(3, 2));
//
//   wand.SetLayout(Layout.InRows(new[] { 1, 2 },
//       Control.Pad("fire", "Fire"), Control.Space(), Control.Button("reload", "Reload")));

using System;
using System.Collections.Generic;

namespace StoryTools.PhoneWand
{
    /// <summary>The layout templates, as the protocol names them.</summary>
    public static class LayoutTemplate
    {
        /// <summary>One big button. 1 control, a button, pad, dpad or crawl.</summary>
        public const string Primary = "primary";
        /// <summary>A big button and a smaller control below it. 2 controls, the first a button, pad, dpad or crawl. The default.</summary>
        public const string PrimarySecondary = "primary-secondary";
        /// <summary>Two equal controls side by side. 2 controls.</summary>
        public const string Pair = "pair";
        /// <summary>A big button with up to three smaller controls in a row below. 1 to 4 controls, the first a button, pad, dpad or crawl.</summary>
        public const string PrimaryRow = "primary-row";
        /// <summary>Two columns. 1 to 6 controls.</summary>
        public const string Grid = "grid";
        /// <summary>1 to 4 rows of 1 to 4 controls, top (the pointing end) to bottom, as Layout.Rows says. Up to 8 controls of any type.</summary>
        public const string Rows = "rows";
        /// <summary>1 to 4 columns of 1 to 4 controls, left to right (mirrored for left hands), as Layout.Columns says. Up to 8 controls of any type.</summary>
        public const string Columns = "columns";
    }

    /// <summary>The control types, as the protocol names them.</summary>
    public static class ControlType
    {
        /// <summary>Presses arrive as Button events with the control's id.</summary>
        public const string Button = "button";
        /// <summary>A big round button, like the default Primary. Presses arrive as Button events with the control's id.</summary>
        public const string Pad = "pad";
        /// <summary>An empty cell that takes up room. It needs no id, and has no value, label or colour.</summary>
        public const string Space = "space";
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

    /// <summary>One control in a layout. Build one with Control.Button, Pad, Toggle, Slider, Choice, TextLabel, Dpad, Crawl or Space.</summary>
    public sealed class Control
    {
        /// <summary>1 to 32 letters, digits, _, . or -, unique in the layout. A space may have none (null).</summary>
        public string Id;
        /// <summary>A ControlType: "button", "pad", "toggle", "slider", "choice", "label", "dpad", "crawl" or "space".</summary>
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

        /// <summary>A big round button, like the default Primary. Presses arrive as Button events with this id.</summary>
        public static Control Pad(string id, string label = null) => new Control(id, ControlType.Pad, label);

        /// <summary>An empty cell that takes up room, e.g. to leave a gap in a row. It has no id.</summary>
        public static Control Space() => new Control { Type = ControlType.Space };

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
            // A space needs no id, so it is left out when there is none.
            var o = new Dictionary<string, object>();
            if (Type != ControlType.Space || !string.IsNullOrEmpty(Id)) o["id"] = Id ?? "";
            o["type"] = Type ?? "";
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
    /// PrimarySecondary, Pair, PrimaryRow, Grid, InRows or InColumns.
    /// </summary>
    public sealed class Layout
    {
        /// <summary>A LayoutTemplate: "primary", "primary-secondary", "pair", "primary-row", "grid", "rows" or "columns".</summary>
        public string Template;
        /// <summary>The controls, in order. In the primary templates the first is the big one: a button, pad, dpad or crawl.</summary>
        public List<Control> Controls = new List<Control>();
        /// <summary>
        /// "rows" only: how many controls in each row, top (the pointing end) to bottom. 1 to 4 rows
        /// of 1 to 4, adding up to the number of controls. Null for other templates.
        /// </summary>
        public List<int> Rows;
        /// <summary>
        /// "rows" only: relative heights of the rows, one positive number each, such as [2, 1]. Null
        /// for equal rows. The relay raises any under a tenth of the biggest to a tenth.
        /// </summary>
        public List<double> Heights;
        /// <summary>
        /// "columns" only: how many controls in each column, left to right (mirrored for left hands).
        /// 1 to 4 columns of 1 to 4, adding up to the number of controls. Null for other templates.
        /// </summary>
        public List<int> Columns;
        /// <summary>"columns" only: relative widths of the columns, as Heights. Null for equal columns.</summary>
        public List<double> Widths;

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

        /// <summary>One big button (or a Control.Pad, Dpad or Crawl).</summary>
        public static Layout Primary(Control button) => new Layout(LayoutTemplate.Primary, button);

        /// <summary>A big button (or a Control.Pad, Dpad or Crawl), and a smaller control below it.</summary>
        public static Layout PrimarySecondary(Control button, Control secondary) =>
            new Layout(LayoutTemplate.PrimarySecondary, button, secondary);

        /// <summary>Two equal controls side by side.</summary>
        public static Layout Pair(Control left, Control right) => new Layout(LayoutTemplate.Pair, left, right);

        /// <summary>A big button (or a Control.Pad, Dpad or Crawl), with up to three smaller controls in a row below.</summary>
        public static Layout PrimaryRow(Control button, params Control[] row)
        {
            var layout = new Layout(LayoutTemplate.PrimaryRow, button);
            if (row != null) layout.Controls.AddRange(row);
            return layout;
        }

        /// <summary>Up to six controls in two columns.</summary>
        public static Layout Grid(params Control[] controls) => new Layout(LayoutTemplate.Grid, controls);

        /// <summary>
        /// Controls of any type in rows, top (the pointing end) to bottom: rows says how many in each,
        /// e.g. InRows(new[] { 1, 3 }, crawl, a, b, c). Set sizes with WithHeights.
        /// </summary>
        public static Layout InRows(int[] rows, params Control[] controls) =>
            new Layout(LayoutTemplate.Rows, controls) { Rows = new List<int>(rows ?? new int[0]) };

        /// <summary>
        /// Controls of any type in columns, left to right (mirrored for left hands): columns says how
        /// many in each. Set sizes with WithWidths.
        /// </summary>
        public static Layout InColumns(int[] columns, params Control[] controls) =>
            new Layout(LayoutTemplate.Columns, controls) { Columns = new List<int>(columns ?? new int[0]) };

        /// <summary>Set the rows' relative heights (null for equal) and return this layout, for chaining.</summary>
        public Layout WithHeights(params double[] heights)
        {
            Heights = heights != null ? new List<double>(heights) : null;
            return this;
        }

        /// <summary>Set the columns' relative widths (null for equal) and return this layout, for chaining.</summary>
        public Layout WithWidths(params double[] widths)
        {
            Widths = widths != null ? new List<double>(widths) : null;
            return this;
        }

        /// <summary>The control with this id, or null. Spaces without an id are never found.</summary>
        public Control Find(string id)
        {
            if (string.IsNullOrEmpty(id)) return null;
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
            var o = new Dictionary<string, object> { { "template", Template ?? "" }, { "controls", controls } };
            if (Rows != null) o["rows"] = Rows.ConvertAll(n => (object)(double)n);
            if (Heights != null) o["heights"] = Heights.ConvertAll(n => (object)n);
            if (Columns != null) o["columns"] = Columns.ConvertAll(n => (object)(double)n);
            if (Widths != null) o["widths"] = Widths.ConvertAll(n => (object)n);
            return o;
        }

        static List<double> Numbers(Dictionary<string, object> o, string key)
        {
            object v;
            if (!o.TryGetValue(key, out v) || !(v is List<object> list)) return null;
            var numbers = new List<double>();
            foreach (var item in list)
                if (item is double d) numbers.Add(d);
            return numbers;
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
            var rows = Numbers(o, "rows");
            if (rows != null) layout.Rows = rows.ConvertAll(n => (int)n);
            layout.Heights = Numbers(o, "heights");
            var columns = Numbers(o, "columns");
            if (columns != null) layout.Columns = columns.ConvertAll(n => (int)n);
            layout.Widths = Numbers(o, "widths");
            return layout;
        }

        public override string ToString() => ToJson();
    }
}
