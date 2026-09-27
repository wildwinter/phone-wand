# Unity client

The Phone Wand package for Unity connects your game to a running relay and turns what it sends
into C# events, `Vector3`, `Quaternion` and screen positions. It has no dependencies on other
packages. It targets Unity 6.4 (6000.4), and is tested in the editor and in a macOS build. It
includes WebGL support, which has not yet been tested in a WebGL build.

If you have not run the relay yet, start with [Getting started](../getting-started.md). No phone
to hand? `phone-wand --simulate 3` gives you three simulated players to develop against.

## Installation

Either:

- **From Git.** In Unity, open **Window > Package Manager**, press **+**, choose **Add package from
  git URL**, and enter:

  ```
  https://github.com/wildwinter/phone-wand.git?path=clients/unity/PhoneWand
  ```

  Add `#v0.1.0` to the end to pin a release. You can also add it to `Packages/manifest.json`
  yourself:

  ```json
  "se.storytools.phonewand": "https://github.com/wildwinter/phone-wand.git?path=clients/unity/PhoneWand#v0.1.0"
  ```

- **From a release.** Download `phone-wand-unity-<version>.zip` from the
  [latest release](https://github.com/wildwinter/phone-wand/releases/latest) and unzip it into your
  project's `Packages` folder, so that the package's `package.json` is at
  `Packages/<folder>/package.json`. Unity picks it up as an embedded package.

The package is called **Phone Wand** (`se.storytools.phonewand`) and everything in it is in the
`StoryTools.PhoneWand` namespace.

## Quick start

1. Add a **Phone Wand Client** component to a GameObject (**Add Component > Phone Wand > Phone
   Wand Client**). It connects to `ws://127.0.0.1:8480/app` when enabled, and reconnects by itself
   if the relay is restarted.
2. Subscribe to its events, or read its `Players` each frame.

```csharp
using System.Collections.Generic;
using StoryTools.PhoneWand;
using UnityEngine;

public class Pointers : MonoBehaviour
{
    public PhoneWandClient wand;
    public RectTransform cursorPrefab;   // an image under a Screen Space Overlay canvas

    readonly Dictionary<string, RectTransform> cursors = new Dictionary<string, RectTransform>();

    void OnEnable()
    {
        wand.PlayerJoined += OnJoined;
        wand.PlayerLeft += OnLeft;
        wand.Button += OnButton;
    }

    void OnDisable()
    {
        wand.PlayerJoined -= OnJoined;
        wand.PlayerLeft -= OnLeft;
        wand.Button -= OnButton;
    }

    void OnJoined(Player player)
    {
        var cursor = Instantiate(cursorPrefab, cursorPrefab.parent);
        cursor.GetComponent<UnityEngine.UI.Image>().color = player.UnityColour();
        cursors[player.Id] = cursor;
        wand.Prompt("Welcome, " + player.Name, player.Id);
    }

    void OnLeft(Player player)
    {
        if (!cursors.TryGetValue(player.Id, out var cursor)) return;
        Destroy(cursor.gameObject);
        cursors.Remove(player.Id);
    }

    void Update()
    {
        foreach (var player in wand.Players)
        {
            // Screen pixels, origin bottom-left, like Input.mousePosition. Null when the phone
            // points far away from the screen.
            Vector2? at = PhoneWandClient.ScreenPosition(player.Pose);
            if (!cursors.TryGetValue(player.Id, out var cursor)) continue;
            cursor.gameObject.SetActive(at.HasValue);
            if (at.HasValue) cursor.position = at.Value;
        }
    }

    void OnButton(ButtonEvent e, Player player)
    {
        if (e.Button != PhoneButton.Primary || !e.Down) return;
        Vector2? at = PhoneWandClient.ScreenPosition(player.Pose);
        if (!at.HasValue) return;
        if (Physics.Raycast(Camera.main.ScreenPointToRay(at.Value), out var hit))
            Debug.Log(player.Name + " hit " + hit.collider.name);
        wand.Haptic(40, player.Id);
    }
}
```

All events fire on the main thread, from the client's `Update`, so handlers can touch the scene
freely. The client runs early (execution order -1000), so poses received this frame are already
in `Players` when your own `Update` runs.

## Layouts: choosing the phone's controls

By default every phone shows a big **Primary** button and a smaller **Secondary** one. Your game
can choose other controls, for every phone or for each player separately: pick a template and list
the controls to put in it, and the phone places them for the player's thumb. See
[Layouts](../layouts.md) for the templates, the control types and their limits.

```csharp
// A shooter: a big Shoot button, then Reload, a Zoom toggle and an ammo count below.
wand.SetLayout(Layout.PrimaryRow(
    Control.Button("shoot", "Shoot"),
    Control.Button("reload", "Reload"),
    Control.Toggle("zoom", "Zoom"),
    Control.TextLabel("ammo", "Ammo", "12")));

wand.Button += (e, player) =>
{
    if (e.Button == "shoot" && e.Down) Shoot(player);
    if (e.Button == "reload" && e.Down) Reload(player);
};
wand.ControlChanged += (e, player) =>
{
    if (e.Control == "zoom") SetZoom(player, e.AsBool);
};
wand.Error += message => Debug.LogWarning("Phone Wand: " + message);

// Later, for one player:
wand.SetControl("ammo", "11", player.Id);
```

Pass a player id to `SetLayout` for one phone, or leave it out for every phone.
`SetLayout(null)` goes back to the default. The relay remembers each player's layout and values,
so a phone that reconnects comes back as it was, and it sends a `PlayerChanged` with the new
layout. You can read a player's layout and values at any time: `player.Layout`, `player.Controls`,
or `player.GetToggle("zoom")` and friends.

If a layout or value doesn't fit (an unknown template, too many controls, a toggle set to text),
the relay changes nothing and the client raises `Error` with the reason. With no `Error` handler,
it logs the reason as a warning.

Button ids are strings. `PhoneButton.Primary` and `PhoneButton.Secondary` are the constants
`"primary"` and `"secondary"`, the ids of the default layout's buttons. (Before layouts,
`PhoneButton` was an enum. Code such as `e.Button == PhoneButton.Primary` and
`player.IsHeld(PhoneButton.Primary)` still compiles and works; code that declared a variable of
type `PhoneButton`, or called `ProtocolNames.Of` on one, now uses `string`.)

### D-pads and crawl pads

`Control.Dpad(id, label)` shows four arrows, and `Control.Crawl(id, label)` shows dungeon-crawler
keys: step forward, back, left and right, and turn left and right. Neither has a value: each
direction is an ordinary button named `"<id>.<direction>"`, so presses arrive as `Button` events
(and show in `player.IsHeld`) like any other button. A d-pad `move` presses `move.up`,
`move.down`, `move.left` and `move.right`; a crawl pad `walk` presses `walk.forward`, `walk.back`,
`walk.step-left`, `walk.step-right`, `walk.turn-left` and `walk.turn-right`. The directions are
constants in `DpadDirection` (`Up`, `Down`, `Left`, `Right`) and `CrawlDirection` (`Forward`,
`Back`, `StepLeft`, `StepRight`, `TurnLeft`, `TurnRight`), each with `All`, and
`Control.ButtonFor(id, direction)` builds the button name. Either can be the big control of a
primary template.

```csharp
// A dungeon crawler: a big crawl pad, and a Use button below it.
wand.SetLayout(Layout.PrimarySecondary(Control.Crawl("walk"), Control.Button("use", "Use")));

wand.Button += (e, player) =>
{
    if (!e.Down) return;
    if (e.Button == Control.ButtonFor("walk", CrawlDirection.Forward)) Step(player, 1);
    else if (e.Button == Control.ButtonFor("walk", CrawlDirection.Back)) Step(player, -1);
    else if (e.Button == Control.ButtonFor("walk", CrawlDirection.TurnLeft)) Turn(player, -90);
    else if (e.Button == Control.ButtonFor("walk", CrawlDirection.TurnRight)) Turn(player, 90);
    else if (e.Button == "use") Use(player);
};
```

## Gestures

Players can also flick the phone towards the screen, pull it back, shake it or twist their wrist.
The relay spots these movements and the client raises `Gesture`; see [Gestures](../gestures.md)
for what each one is and what works well. `Buttons` says which buttons were held when the movement
started, so "hold Primary and pull back" is a pull that `WasHeld(PhoneButton.Primary)`:

```csharp
wand.Gesture += (g, player) =>
{
    if (g.Is(GestureName.Pull) && g.WasHeld(PhoneButton.Primary)) DrawBow(player, (float)g.Strength);
    if (g.Is(GestureName.Push)) Throw(player, PhoneWandClient.GestureDirection(g) * (float)g.Speed);
    if (g.Is(GestureName.Shake)) Shuffle(player);
};
wand.ConfigureGestures(9f);   // needs a firmer flick than the default 7
```

A `GestureEvent` has:

| Property | Meaning |
|---|---|
| `Id` | The player's id. |
| `Gesture` | Movements: `"push"` (towards the screen), `"pull"`, `"left"`, `"right"`, `"up"`, `"down"`, `"shake"`. Fast rotations: `"flick-up"`, `"flick-down"`, `"flick-left"`, `"flick-right"`, `"twist-left"`, `"twist-right"`. The `GestureName` constants (`GestureName.Push`, `GestureName.TwistLeft`, ...) hold them; `Is(name)` compares. |
| `Strength` | 0 to 1: how vigorous, relative to a strong flick, shake or twist. |
| `Speed` | Movements and shakes: peak speed in m/s (0 for flicks and twists). |
| `Angle` | Flicks and twists: how far the phone turned, in degrees (0 for movements). |
| `Dir` | `RigVector3`: movements' unit direction (zero otherwise). `PhoneWandClient.GestureDirection(g)` or `g.DirectionVector()` gives a `Vector3`, so a push is about `Vector3.forward`. |
| `Duration` | How long it took, in ms. |
| `T` | Relay time it started, in ms since the Unix epoch. |
| `Buttons`, `WasHeld(id)` | The ids of the buttons held when it started, sorted. |

Sensitivity is set per app, in the inspector under **Gestures** (Gestures Enabled, Gesture
Threshold, Gesture Min Speed, Gesture Flick Rate, Gesture Twist Rate; the defaults are the relay's:
on, 7, 0.35, 250, 360),
from code with the matching properties, or with `ConfigureGestures(threshold, minSpeed, twistRate, flickRate)`.
Set `GesturesEnabled = false` for no gesture events. The client sends the settings when it connects
and again after every reconnect, and a change while connected (including in the inspector during
Play) reaches the relay at once.

To recognise movements yourself, read each pose's acceleration: `PhoneWandClient.Accel(pose)` (or
`pose.AccelVector()`) is a `Vector3?` in m/s², gravity removed, in the same frame as the pointing
direction, and null when the phone sent none (for example if motion access was refused).

## API reference

### PhoneWandClient (component)

Inspector settings:

| Setting | Default | Meaning |
|---|---|---|
| Url | `ws://127.0.0.1:8480/app` | The relay's app endpoint. Change the port if the relay runs with `--app-port`. |
| Connect On Enable | on | Connect when the component is enabled. Otherwise call `Connect()`. |
| Auto Reconnect | on | Retry when the relay goes away: after 0.5 s, doubling to at most 5 s. |
| Smoothing | Relay Default | `Relay Default`, `Custom` (uses Min Cutoff, Beta and D Cutoff) or `Raw`. |
| Min Cutoff, Beta, D Cutoff | 1, 5, 1 | One Euro filter settings for `Custom`. |
| Log Events | off | Log connections, joins and leaves to the console. |
| Gestures Enabled | on | Send this app `Gesture` events. See [Gestures](#gestures). |
| Gesture Threshold, Gesture Min Speed, Gesture Flick Rate, Gesture Twist Rate | 7, 0.35, 250, 360 | Acceleration in m/s² that starts a movement (lower is more sensitive), peak speed in m/s a movement must reach, and the turning and rolling speeds in degrees per second that make a flick and a twist. |
| Start Relay | off | Start the relay yourself, hidden, and stop it with the game. See [Starting the relay from your game](#starting-the-relay-from-your-game). |
| Relay Path | empty | A `phone-wand-relay` folder or the relay program. Empty means `Application.streamingAssetsPath/phone-wand-relay`. |
| Relay Arguments | empty | Extra relay options, for example `--max-players 8 --key party`. |

Properties and methods:

| Member | Description |
|---|---|
| `bool IsConnected` | True once the relay has said hello, until the connection closes. |
| `RelayHello Hello` | The relay's hello: `Protocol`, `Relay` (version), `JoinUrl`, `QrUrl`, `MaxPlayers`. Null when not connected. |
| `IReadOnlyList<Player> Players` | Current players, sorted by slot. |
| `Player GetPlayer(string id)`, `GetPlayerInSlot(int slot)` | Look a player up, or null. |
| `string Url`, `bool AutoReconnect` | As in the inspector. `Url` takes effect on the next connect. |
| `Connect()`, `Disconnect()` | Start connecting, or disconnect and stop retrying. `Disconnect` fires `PlayerLeft` for every player and then `Disconnected` before it returns. Disabling the component disconnects. |
| `ConfigureSmoothing(minCutoff, beta, dCutoff)` | Set the relay's One Euro filter for this app. Lower `minCutoff` is steadier when still; higher `beta` is quicker when moving. Kept across reconnects. |
| `ConfigureRaw()` | Turn smoothing off for this app. Kept across reconnects. |
| `ConfigureGestures(threshold = 7, minSpeed = 0.35, twistRate = 360, flickRate = 250)` | Set this app's gesture sensitivity and turn gestures on. Kept across reconnects. |
| `bool GesturesEnabled`, `float GestureThreshold`, `GestureMinSpeed`, `GestureFlickRate`, `GestureTwistRate` | As in the inspector. Setting one while connected sends it straight away; all are sent again on every connect. |
| `Style(id, colour, label)` | Change a player's colour (a `Color`, or a `"#rrggbb"` string) and label. Both show on their phone. Pass null to leave one alone. |
| `Prompt(text, id, duration)` | Show text on a phone, or on every phone when `id` is null. `duration` in ms (relay default 3000); 0 keeps it until the next prompt; empty text clears it. |
| `Haptic(ms, id)`, `Haptic(int[] pattern, id)` | Vibrate one phone, or all when `id` is null. The pattern alternates on and off milliseconds. Android only: iPhones do not allow it. |
| `Calibrate(mode, id)` | Ask a player (or everyone) to calibrate: `CalibrationMode.Screen` (two corners) or `CalibrationMode.Ray` (point at the middle and press Recentre). |
| `SetLayout(layout, playerId = null)` | Choose the controls a phone shows, or every phone's when `playerId` is null. `null` goes back to the default. See [Layouts](#layouts-choosing-the-phones-controls). |
| `SetControl(controlId, value, playerId = null)` | Change a control on a phone (or every phone): a toggle's `bool`, a slider's `double` from 0 to 1, a choice's option index, or a label's `string`. Every app then gets `ControlChanged`. |
| `bool StartRelay`, `string RelayPath`, `string RelayArguments` | As in the inspector. They take effect on the next `Connect()`. |
| `ManagedRelay Relay`, `bool StartedRelay` | The relay this client started (null if it started none), and whether it is still running. |
| `StopRelay()` | Stop the relay this client started, if any. Disabling or destroying the component, or quitting, does this for you. `Disconnect()` does not. |
| `PhoneWandClient.DefaultRelayPath`, `PhoneWandClient.RelayLogFile` | Where the client looks for the relay by default, and where a relay it starts writes its log. |
| `PhoneWandCore Core` | The engine-free core behind the component (see below). |

Static helpers:

| Helper | Returns |
|---|---|
| `PhoneWandClient.Direction(pose)` | The pointing direction as a `Vector3` (x right, y up, z forward). |
| `PhoneWandClient.Rotation(pose)` | The phone's orientation as a `Quaternion`. `Rotation(pose) * Vector3.forward` is the pointing direction. |
| `PhoneWandClient.ScreenPosition(pose, camera = null)` | `Vector2?` in Unity screen pixels, origin bottom-left (the same space as `Input.mousePosition` and `Camera.ScreenPointToRay`). With a camera, the position is within that camera's pixel rect. Null when there is no pose or the phone points far from the screen. Values outside the screen mean the player is pointing off it. |
| `PhoneWandClient.GuiPosition(pose)` | `Vector2?` in GUI pixels, origin top-left, for `OnGUI`. |
| `PhoneWandClient.Accel(pose)` | `Vector3?`: the phone's acceleration in m/s², gravity removed, or null when the pose has none. |
| `PhoneWandClient.GestureDirection(gesture)` | A gesture's direction of movement as a `Vector3` (zero for shakes, flicks and twists). |

### Events

| Event | Arguments | When |
|---|---|---|
| `Connected` | `RelayHello` | The relay said hello. `PlayerJoined` follows for each player already there. |
| `Disconnected` | | The connection closed, after `PlayerLeft` for every player. |
| `PlayerJoined` | `Player` | A player took a slot (or was already there when you connected). |
| `PlayerLeft` | `Player` | A player's slot is free again, or the connection closed. |
| `PlayerChanged` | `Player` | State, name, colour, label, calibration, transport or layout changed. |
| `Pose` | `PlayerPose, Player` | A new orientation sample, typically 60 a second per player. |
| `Button` | `ButtonEvent, Player` | A button went down or up: `Id` (the player), `Button` (the button's id from the layout: `"primary"` and `"secondary"` by default, or a d-pad or crawl pad direction such as `"move.up"`), `Down`. Every down is followed by an up, even if the phone disconnects or a new layout removes the button. |
| `ControlChanged` | `ControlEvent, Player` | A toggle, slider, choice or label changed, on the phone or because an app set it: `Id`, `Control` (its id), `Value` (`bool`, `double` or `string`), with `AsBool`, `AsNumber`, `AsIndex` and `AsString` to read it. The player's `Controls` already hold the new value. |
| `Gesture` | `GestureEvent, Player` | The player moved the phone deliberately: a flick, shake or twist. See [Gestures](#gestures). |
| `Error` | `string` | The relay could not use something this app sent (a bad layout or value); the message says why. With no handler, the client logs a warning instead. |
| `Calibrating` | `CalibrationStep, Player` | The player is being asked to point at `TopLeft` or `BottomRight`, or `Cancelled`. |
| `Calibrated` | `Calibration, Player` | The player pressed Recentre (`Ray`) or finished screen calibration (`Screen`). |
| `Stats` | `PlayerStats, Player` | Once a second per player: `Rtt` (ms), `Rate` (poses per second), `Dropped`. |

### Player

| Property | Description |
|---|---|
| `Id` | Unique for the lifetime of the relay. A phone that reconnects keeps its id and slot. |
| `Slot` | 0-based player number, lowest free first. |
| `Name`, `Label` | The name chosen on the phone; extra text set with `Style`. |
| `Colour` | `"#rrggbb"`. `player.UnityColour()` gives a `Color`. |
| `State` | `PlayerState.Waiting` (no motion access yet), `Active` or `Paused` (tab hidden, phone locked, or no data for half a second). |
| `Calibration` | `Calibration.None`, `Ray` or `Screen`. |
| `Calibrating` | The corner being calibrated, or null. |
| `Device` | `Platform` (`iOS`, `Android`, `other`), `Sensor`, `Transport` (`ws` or `http`). |
| `Pose` | The latest `PlayerPose`, or null before the first. |
| `Buttons`, `IsHeld(string button)` | The ids of the buttons held down now, e.g. `IsHeld(PhoneButton.Primary)` or `IsHeld("shoot")`. Cleared when the player stops being active. |
| `Layout` | The controls the phone shows: `Layout.Template` and `Layout.Controls`. The default layout until your game sends one. Replaced whole by each `PlayerChanged`. |
| `Controls` | `IReadOnlyDictionary<string, object>`: the current value of each toggle (`bool`), slider (`double`, 0 to 1), choice (`double`, the option index) and label (`string`), by control id. Buttons have no value. |
| `GetToggle(id)`, `GetSlider(id)`, `GetChoice(id)`, `GetText(id)` | One control's value as a `bool`, `double`, `int` or `string`, or a fallback (the optional second argument) if there is no such value. |
| `Stats` | The latest `PlayerStats`, or null. |

### Layout and Control

A `Layout` is a `Template` (a string; the constants are in `LayoutTemplate`: `Primary`,
`PrimarySecondary`, `Pair`, `PrimaryRow`, `Grid`) and a list of `Controls`, in order. Build one with
`new Layout(template, controls...)` or a helper:

| Helper | Template |
|---|---|
| `Layout.Primary(button)` | One big button (or a d-pad or crawl pad, as in each primary template). |
| `Layout.PrimarySecondary(button, control)` | A big button and a smaller control below it. |
| `Layout.Pair(left, right)` | Two equal controls side by side. |
| `Layout.PrimaryRow(button, up to three controls)` | A big button with a row of smaller controls below. |
| `Layout.Grid(up to six controls)` | Two columns. |
| `Layout.Default` | The default: `primary` and `secondary` buttons. |

`layout.Find(id)` finds a control, and `layout.ToJson()` gives the JSON the protocol carries.

A `Control` has an `Id`, a `Type` (the constants are in `ControlType`), an optional `Label` and
`Colour` (`"#rrggbb"`), and the fields of its type: `Value` (the starting value: a `bool` for a
toggle, a `double` for a slider or a choice's index), `Orientation` and `Spring` for sliders,
`Options` for choices, and `Text` for labels. D-pads and crawl pads have none. Build one with:

| Builder | Control |
|---|---|
| `Control.Button(id, label)` | A button. Presses arrive as `Button` events with this id. |
| `Control.Toggle(id, label, on = false)` | On or off. |
| `Control.Slider(id, label, value = null, vertical = false, spring = null)` | 0 to 1. `spring` is where it returns when let go (a throttle); null stays put. |
| `Control.Choice(id, label, options, selected = 0)` | One of 2 to 4 options. |
| `Control.TextLabel(id, label, text)` | Text that only your game changes, with `SetControl`. |
| `Control.Dpad(id, label)` | Four arrows, each a button `"<id>.up"` and so on. See [D-pads and crawl pads](#d-pads-and-crawl-pads). |
| `Control.Crawl(id, label)` | Dungeon-crawler keys, each a button `"<id>.forward"` and so on. |
| `Control.ButtonFor(id, direction)` | The button a d-pad or crawl pad presses for a direction: `ButtonFor("walk", CrawlDirection.TurnLeft)` is `"walk.turn-left"`. |

`.WithColour("#00ff88")` (or a Unity `Color`) sets a control's colour and returns it, for chaining.

### PlayerPose

| Property | Description |
|---|---|
| `Seq` | The phone's sample counter. Gaps mean dropped samples; it restarts when the phone reconnects. |
| `Time` | When the relay received it, in ms since the Unix epoch. |
| `Rotation` | `RigQuaternion`: calibrated orientation. `.ToQuaternion()` for Unity. |
| `Direction` | `RigVector3`: calibrated unit pointing direction. `.ToVector3()` for Unity. |
| `Yaw`, `Pitch`, `Roll` | Degrees. Yaw is positive to the right, pitch upwards, roll clockwise as seen from behind. |
| `Screen` | `ScreenPoint?`: normalised position, `(0, 0)` top-left to `(1, 1)` bottom-right, or null. `IsOnScreen` checks the 0..1 range. |
| `Accel` | `RigVector3?`: the phone's acceleration in m/s², gravity removed, in the same frame as `Direction`, unsmoothed. Null when the phone sends none (motion access refused). `.AccelVector()` gives a `Vector3?`. |

Other extension methods in `PhoneWandExtensions`: `ScreenPoint.ToScreenPixels(camera)`,
`ScreenPoint.ToGuiPixels()`, `ScreenPoint.ToVector2()`, `PlayerPose.AccelVector()`,
`GestureEvent.DirectionVector()`, and `PlayerPose.ToRay(origin, frame)`, which
makes a world-space `Ray` from `origin` along the pointing direction turned by `frame` (pass a
camera's `transform.rotation` so that forward means into the scene).

### The engine-free core

The component is a thin wrapper around two plain C# classes in `Runtime/Core`, which have no
UnityEngine references:

- `PhoneWandCore` holds the players and fires the events. `Handle(string json)` processes one relay
  message, which is how the conformance tests replay recorded sessions. It also builds the outgoing
  messages (`Configure` with a `Smoothing` and/or a `GestureSensitivity`, `Style`, `Prompt`, `Haptic`, `Calibrate`, `SetLayout`, `SetControl`).
  With no `Error` handler, relay errors go to its `UnhandledError` callback (the component logs
  them as warnings).
- `PhoneWandConnection` owns the WebSocket and the reconnect timer, and sends its `Smoothing` and
  `Gestures` settings each time it connects. Nothing happens until you call
  `Pump()`, and every event fires inside that call, on your thread.

Use them directly for editor tools or tests:

```csharp
var connection = new PhoneWandConnection("ws://127.0.0.1:8480/app");
connection.Core.Pose += (pose, player) => Debug.Log(player.Name + " " + pose.Direction);
connection.Connect();
// ... then call connection.Pump() regularly, for example from EditorApplication.update.
connection.Close();
```

## Frames and conversions

The relay sends vectors in the rig frame, `[right, up, forward]`, which is Unity's `x, y, z`
exactly, so no conversion is needed: `Vector3(right, up, forward)` and `Quaternion(x, y, z, w)`.
The package's `ToVector3()` and `ToQuaternion()` do just that.

- The quaternion rotates the phone's body into the rig frame. The body's forward is out of the top
  edge of the phone (the way it points), and its up is out of the screen. So
  `Rotation * Vector3.forward` is the pointing direction and `Rotation * Vector3.up` points out of
  the screen. The identity rotation is "pointing forward with the screen facing the ceiling".
- Forward is wherever the player pointed when they pressed Recentre, or the middle of the screen
  after screen calibration.
- To aim something in your scene, turn the direction into your camera's frame:
  `Camera.main.transform.rotation * PhoneWandClient.Direction(pose)`, or use
  `pose.ToRay(origin, Camera.main.transform.rotation)`.
- To show a 3D model of the phone, set its rotation to `PhoneWandClient.Rotation(pose)` (times your
  camera's rotation, if the camera turns). Model the phone with its top edge along +z and its
  screen facing +y.

The conformance suite's `conversions.json` checks these rules, both in the dotnet test host and
with UnityEngine's own `Quaternion` maths in `scripts/check-unity.sh`.

Screen positions are normalised with the origin at the top-left, like the web. Unity's screen
space has its origin at the bottom-left, which `ScreenPosition` handles. `GuiPosition` is for
`OnGUI`, which uses the top-left.

## Starting the relay from your game

For a finished game you probably don't want players to start the relay themselves. Turn on
**Start Relay** on the Phone Wand Client component (or set `StartRelay = true` before it connects)
and put the relay binaries in `Assets/StreamingAssets/phone-wand-relay/`. [Shipping the relay with
your game](../shipping.md) says where to get them, which folders to keep, and how to sign the
macOS binary when you sign your game. Then, each time the client connects:

- If the URL isn't on this computer (`127.0.0.1`, `localhost` or `[::1]`), nothing is started.
- If a relay already answers on the URL's port, for example the one you run while developing, the
  client just uses it, and never stops it.
- Otherwise it starts `phone-wand-relay/<platform>/phone-wand-relay` (`.exe` on Windows) from
  **Relay Path**, hidden, with `--lifeline --no-open --app-port <the URL's port>`, a log at
  `Application.persistentDataPath/phone-wand-relay.log`, and your **Relay Arguments**. If the
  program isn't there, the console says where it looked and the client carries on trying to
  connect as usual.
- The client connects as usual; its reconnecting covers the moment the relay takes to start.

When the component is disabled or destroyed, or the game quits, the client stops the relay it
started: it closes the relay's input, which makes it stop cleanly, and ends it if it is still
running two seconds later. If the game crashes, the relay stops by itself.

If you change the relay's ports in **Relay Arguments**, keep the Url in step: the client passes the
Url's port as `--app-port`, so set the app port through the Url, and the phones' port with
`--port`.

Start Relay works in the editor and in Windows, macOS and Linux builds. WebGL, iOS and Android
builds can't run programs, so there it logs a warning and does nothing; run the relay separately.
The demo project has Start Relay on: with the binaries in its `Assets/StreamingAssets/phone-wand-relay/`
(which git ignores) it starts its own relay, and without them it uses one you run.

The logic lives in the engine-free `ManagedRelay` class (`Runtime/Core`), which you can also call
yourself: `ManagedRelay.Start(new ManagedRelayOptions { Url = ..., Path = ..., Arguments = ..., LogFile = ... }, log)`
returns the relay it started, or null, and `relay.Stop()` stops it.

## WebGL

WebGL builds cannot use .NET's `ClientWebSocket`, so the package switches to the browser's
WebSocket there (`Runtime/Plugins/WebGL/PhoneWand.jslib`). Nothing changes in your code. Things to
know:

- The relay only accepts app connections from web pages served from this computer (`localhost`
  or `127.0.0.1`). If your build is served from anywhere else, start the relay with
  `--allow-origin https://where.your.build.is`. The relay prints a line whenever it refuses a page.
- A page served over `https` may not be allowed to open the plain `ws://127.0.0.1` address. Most
  browsers allow it for `127.0.0.1` and `localhost`; if yours does not, serve the build over `http`
  from this computer.
- Browsers slow down hidden tabs. Keep the game's tab visible while playing.

## Samples

**Cursors** (import it from the Package Manager's **Samples** tab) draws every player's cursor over
the game view: a disc in their colour where they point, their name, a ripple when they press the
main button, an arrow at the screen edge when they point off it, and a line for each player who
hasn't set up their aim yet (they have no cursor until they do). It uses `OnGUI` only, so it
needs no canvas. Open `Cursors.unity` and press Play, or add the **Cursors Sample** component to any
GameObject.

The repository also has a demo project, `clients/unity/PhoneWandDemo`, which references the package
from the repository folder. Open it in Unity 6000.4 or newer, open `Assets/Demo/Demo.unity` and
press Play. As well as cursors it shows the join QR code, the player list with their stats, and
sends a welcome prompt and a buzz on every click. Press **C** to ask everyone to calibrate the
screen, **R** to recentre, **L** to cycle every phone through sample layouts (the default, a
primary row with a toggle and a label, and a grid with every kind of control; changes show
briefly at the top of the screen), and **Tab** to hide the panel. Gestures show briefly at the top
too, in the player's colour with any held buttons (for example "Kit: pull + primary"). A built player accepts
`-phoneWandUrl ws://host:port/app` on the command line.

## Troubleshooting

- **Nothing connects.** Is the relay running? It prints `Apps connect to: ws://127.0.0.1:8480/app`
  when it starts. If it uses a different `--app-port`, set the client's Url to match. Turn on
  **Log Events** to see connections in the console.
- **Events stop when the game window loses focus.** Unity pauses a player that is not in focus
  unless **Project Settings > Player > Run In Background** is on. Turn it on for shared-screen
  games (the demo project does).
- **Cursors are offset or the wrong size.** Ask the player to press **Calibrate screen** on the
  phone and point at the corners of the actual display, or call `Calibrate()`. Without it the relay
  assumes a virtual screen 40 by 22.5 degrees around wherever they pressed Recentre.
- **Cursors are jittery or laggy.** Adjust the smoothing (see
  [Calibration and precision](../calibration.md)). Try `ConfigureSmoothing(0.5f, 5f, 1f)` for
  steadier cursors, or a higher beta for quicker ones.
- **`ScreenPosition` is null.** The phone points more than about 87 degrees away from forward.
  Show an arrow at the screen edge using the direction's x and y, as the Cursors sample does.
- **WebGL builds do not connect.** See [WebGL](#webgl) above: usually the page's origin.
- **Enter Play Mode Options with domain reload off.** Supported: the component disconnects in
  `OnDisable` and makes a fresh connection each time it is enabled.

## Testing

The package is tested three ways. See [Testing](../testing.md) for the conformance suite itself.

- **The core, without Unity.** `clients/unity/TestHost` is a dotnet console project that compiles
  `Runtime/Core` and replays every conformance session through it, checking the event log, the final
  player state and the frame conversions. It needs the .NET SDK 8 or newer.

  ```
  dotnet run --project clients/unity/TestHost
  ```

  It prints `ALL PASS`, or every difference and exits with 1. Pass a path to use another
  conformance folder. With `-- --live ws://127.0.0.1:8480/app` it instead connects to a running
  relay for three seconds and reports what arrived.

- **Compiling in Unity.** `scripts/check-unity.sh` opens the demo project in batch mode with your
  newest installed editor (or `UNITY_PATH`), with the Cursors sample copied in for the run. It
  fails on any compiler error or if any of the package, sample or demo assemblies was not freshly
  compiled, then checks `conversions.json` with UnityEngine's own maths.

- **Live, against a relay.** Start a relay with simulated players, then add `--live`:

  ```
  bun run sim                                  # in one terminal
  scripts/check-unity.sh --live                # in another
  ```

  The live check runs `PhoneWandChecks.Live` (in the demo project's `Assets/Editor`) in batch
  mode. It connects for three seconds and passes only if it saw the relay's hello, at least one
  player join and at least one pose. Pass a URL after `--live` for a relay on another port, for
  example `scripts/check-unity.sh --live ws://127.0.0.1:19480/app`.

- **Layouts, live.** `PhoneWandChecks.Layouts` drives a Phone Wand Client against a relay with one
  phone that plays along: on the grid layout it presses `fire`, sets `power` to 0.7 and turns
  `shield` on, and when the default layout comes back it presses `primary`. The check sends the
  grid, checks the events and the player's `Layout` and `Controls`, sets a label, sends an invalid
  layout (which must raise `Error`, and with no handler log a warning) and goes back to the default.

  ```
  Unity -batchmode -nographics -projectPath clients/unity/PhoneWandDemo \
    -executeMethod PhoneWandChecks.Layouts -phoneWandUrl ws://127.0.0.1:8480/app -logFile -
  ```

- **Gestures, live.** `PhoneWandChecks.Gestures` drives a Phone Wand Client against a relay with
  one phone that holds `primary` and flicks every second or two (a scripted fake phone sending
  acceleration in its poses). A gesture must arrive with buttons `["primary"]` and poses must carry
  acceleration; with `GesturesEnabled` off none may arrive, also after a reconnect (which proves the
  setting is sent again on connect); turned back on, they must return.

  ```
  Unity -batchmode -nographics -projectPath clients/unity/PhoneWandDemo \
    -executeMethod PhoneWandChecks.Gestures -phoneWandUrl ws://127.0.0.1:8480/app -logFile -
  ```

- **Start Relay.** `PhoneWandChecks.ManagedRelay` checks the whole cycle in batch mode. With no
  relay on the URL's port, the client must start one, get its hello, and stop it again
  (status.json no longer answers and the process has gone). With a relay already running there, it
  must start none and leave that one running. The easiest way to run it:

  ```
  bun scripts/dist.ts --only=relay,embed     # builds dist/embed
  scripts/check-unity.sh --managed-relay     # or --managed-relay <folder>
  ```

  The script puts the relay in the demo's `Assets/StreamingAssets/phone-wand-relay/` for the run
  (unless you already keep one there) and removes it afterwards. By hand, with the binaries in
  place:

  ```
  Unity -batchmode -nographics -projectPath clients/unity/PhoneWandDemo \
    -executeMethod PhoneWandChecks.ManagedRelay -phoneWandUrl ws://127.0.0.1:23480/app \
    -phoneWandRelayArgs "--port 23443 --no-landing" -logFile -
  ```
