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
| `Style(id, colour, label)` | Change a player's colour (a `Color`, or a `"#rrggbb"` string) and label. Both show on their phone. Pass null to leave one alone. |
| `Prompt(text, id, duration)` | Show text on a phone, or on every phone when `id` is null. `duration` in ms (relay default 3000); 0 keeps it until the next prompt; empty text clears it. |
| `Haptic(ms, id)`, `Haptic(int[] pattern, id)` | Vibrate one phone, or all when `id` is null. The pattern alternates on and off milliseconds. Android only: iPhones do not allow it. |
| `Calibrate(mode, id)` | Ask a player (or everyone) to calibrate: `CalibrationMode.Screen` (two corners) or `CalibrationMode.Ray` (point at the middle and press Recentre). |
| `PhoneWandCore Core` | The engine-free core behind the component (see below). |

Static helpers:

| Helper | Returns |
|---|---|
| `PhoneWandClient.Direction(pose)` | The pointing direction as a `Vector3` (x right, y up, z forward). |
| `PhoneWandClient.Rotation(pose)` | The phone's orientation as a `Quaternion`. `Rotation(pose) * Vector3.forward` is the pointing direction. |
| `PhoneWandClient.ScreenPosition(pose, camera = null)` | `Vector2?` in Unity screen pixels, origin bottom-left (the same space as `Input.mousePosition` and `Camera.ScreenPointToRay`). With a camera, the position is within that camera's pixel rect. Null when there is no pose or the phone points far from the screen. Values outside the screen mean the player is pointing off it. |
| `PhoneWandClient.GuiPosition(pose)` | `Vector2?` in GUI pixels, origin top-left, for `OnGUI`. |

### Events

| Event | Arguments | When |
|---|---|---|
| `Connected` | `RelayHello` | The relay said hello. `PlayerJoined` follows for each player already there. |
| `Disconnected` | | The connection closed, after `PlayerLeft` for every player. |
| `PlayerJoined` | `Player` | A player took a slot (or was already there when you connected). |
| `PlayerLeft` | `Player` | A player's slot is free again, or the connection closed. |
| `PlayerChanged` | `Player` | State, name, colour, label, calibration or transport changed. |
| `Pose` | `PlayerPose, Player` | A new orientation sample, typically 60 a second per player. |
| `Button` | `ButtonEvent, Player` | A button went down or up. Every down is followed by an up, even if the phone disconnects. |
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
| `Buttons`, `IsHeld(PhoneButton)` | The buttons held down now. Cleared when the player stops being active. |
| `Stats` | The latest `PlayerStats`, or null. |

### PlayerPose

| Property | Description |
|---|---|
| `Seq` | The phone's sample counter. Gaps mean dropped samples; it restarts when the phone reconnects. |
| `Time` | When the relay received it, in ms since the Unix epoch. |
| `Rotation` | `RigQuaternion`: calibrated orientation. `.ToQuaternion()` for Unity. |
| `Direction` | `RigVector3`: calibrated unit pointing direction. `.ToVector3()` for Unity. |
| `Yaw`, `Pitch`, `Roll` | Degrees. Yaw is positive to the right, pitch upwards, roll clockwise as seen from behind. |
| `Screen` | `ScreenPoint?`: normalised position, `(0, 0)` top-left to `(1, 1)` bottom-right, or null. `IsOnScreen` checks the 0..1 range. |

Other extension methods in `PhoneWandExtensions`: `ScreenPoint.ToScreenPixels(camera)`,
`ScreenPoint.ToGuiPixels()`, `ScreenPoint.ToVector2()`, and `PlayerPose.ToRay(origin, frame)`, which
makes a world-space `Ray` from `origin` along the pointing direction turned by `frame` (pass a
camera's `transform.rotation` so that forward means into the scene).

### The engine-free core

The component is a thin wrapper around two plain C# classes in `Runtime/Core`, which have no
UnityEngine references:

- `PhoneWandCore` holds the players and fires the events. `Handle(string json)` processes one relay
  message, which is how the conformance tests replay recorded sessions. It also builds the outgoing
  messages (`Configure`, `Style`, `Prompt`, `Haptic`, `Calibrate`).
- `PhoneWandConnection` owns the WebSocket and the reconnect timer. Nothing happens until you call
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
main button, and an arrow at the screen edge when they point off it. It uses `OnGUI` only, so it
needs no canvas. Open `Cursors.unity` and press Play, or add the **Cursors Sample** component to any
GameObject.

The repository also has a demo project, `clients/unity/PhoneWandDemo`, which references the package
from the repository folder. Open it in Unity 6000.4 or newer, open `Assets/Demo/Demo.unity` and
press Play. As well as cursors it shows the join QR code, the player list with their stats, and
sends a welcome prompt and a buzz on every click. Press **C** to ask everyone to calibrate the
screen, **R** to recentre, and **Tab** to hide the panel. A built player accepts
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
