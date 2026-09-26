# Unreal client

The Phone Wand plugin for Unreal Engine connects your game to a running relay and turns what it
sends into Blueprint events, `FVector`, `FQuat`, `FRotator` and screen positions. It is a single
runtime module that uses only the engine's own WebSockets and Json modules, and it is built and
tested with Unreal Engine 5.7 on macOS. Windows and Linux use the same code but have not been
tested yet.

If you have not run the relay yet, start with [Getting started](../getting-started.md). No phone
to hand? `phone-wand --simulate 3` gives you three simulated players to develop against.

## Installation

Download `phone-wand-unreal-<version>.zip` from the
[latest release](https://github.com/wildwinter/phone-wand/releases/latest). It holds two folders
side by side:

```
PhoneWand/          the plugin
PhoneWandDemo/      a sample project that uses it
```

To add Phone Wand to your own project:

1. Copy the `PhoneWand` folder into your project's `Plugins` folder (create it if needed), so you
   have `YourProject/Plugins/PhoneWand/PhoneWand.uplugin`.
2. Open the project. The plugin ships as source, so Unreal asks to build it: say yes. You need a
   C++ toolchain (Xcode on macOS, Visual Studio on Windows). A Blueprint-only project can use it
   too, as long as the toolchain is installed.
3. Check **Edit > Plugins > Input > Phone Wand** is enabled.

You can also take the plugin straight from the repository: it lives in `clients/unreal/PhoneWand`.

## Quick start

The plugin adds a game instance subsystem, **Phone Wand Subsystem**. It connects to
`ws://127.0.0.1:8480/app` as soon as the game starts (in Play In Editor too) and reconnects by
itself if the relay is restarted. You only need to listen to it.

### Blueprint

1. In any Blueprint (the level Blueprint, a HUD, a player controller), add **Get Game Instance
   Subsystem** and pick **Phone Wand Subsystem**. The node **Get Phone Wand** does the same in one
   step.
2. Drag off it and add **Assign On Pose**. The event gives you the **Player** and the **Pose**.
3. Break the pose. **Screen** is the cursor position from (0, 0) top-left to (1, 1) bottom-right,
   valid when **Has Screen** is true. **Direction** and **Rotation** are the phone's aim in world
   terms. **Player** carries the **Name**, **Linear Colour** and **Slot**.
4. Add **Assign On Button** for clicks: **Button** is `primary` or `secondary`, and **Down** is
   true on press and false on release.

To draw a cursor in a HUD's **Draw HUD** event, loop over **Get Players**, and for each player
with **Has Pose** use **Pose To Viewport Pixels** to get the pixel position.

### C++

Add `"PhoneWand"` to your module's dependencies in its `.Build.cs`:

```csharp
PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "PhoneWand" });
```

Then bind the native events, which take lambdas and member functions:

```cpp
#include "PhoneWandSubsystem.h"
#include "PhoneWandLibrary.h"

void AMyHUD::BeginPlay()
{
    Super::BeginPlay();
    UPhoneWandSubsystem* Wand = GetGameInstance()->GetSubsystem<UPhoneWandSubsystem>();

    Wand->OnPlayerJoinedNative.AddLambda([](const FPhoneWandPlayer& Player)
    {
        UE_LOG(LogTemp, Log, TEXT("%s joined in slot %d"), *Player.Name, Player.Slot);
    });

    Wand->OnButtonNative.AddUObject(this, &AMyHUD::HandleButton);
}

void AMyHUD::HandleButton(const FPhoneWandPlayer& Player, const FString& Button, bool bDown)
{
    if (Button == TEXT("primary") && bDown && Player.Pose.bHasScreen)
    {
        Fire(Player.Pose.Screen);  // normalised screen position
    }
}

void AMyHUD::DrawHUD()
{
    Super::DrawHUD();
    UPhoneWandSubsystem* Wand = GetGameInstance()->GetSubsystem<UPhoneWandSubsystem>();
    for (const FPhoneWandPlayer& Player : Wand->GetPlayers())   // sorted by slot
    {
        if (Player.bHasPose && Player.Pose.bHasScreen)
        {
            const FVector2D At = UPhoneWandLibrary::ScreenToPixels(Player.Pose.Screen, FVector2D(Canvas->SizeX, Canvas->SizeY));
            DrawRect(Player.LinearColour, At.X - 8, At.Y - 8, 16, 16);
        }
    }
}
```

To aim something in the world, use the pose's `Direction` (a unit vector) or `Rotation`:

```cpp
Wand->OnPoseNative.AddLambda([this](const FPhoneWandPlayer& Player, const FPhoneWandPose& Pose)
{
    Spotlight->SetWorldRotation(Pose.Rotation);   // +X of the light follows the phone
});
```

## API reference

### UPhoneWandSubsystem

One per game instance. Blueprint: **Get Game Instance Subsystem > Phone Wand Subsystem**, or **Get
Phone Wand**. C++: `GetGameInstance()->GetSubsystem<UPhoneWandSubsystem>()`.

| Function | What it does |
|---|---|
| `Connect(Url)` | Connect to the relay. An empty `Url` uses the project setting. Retries every 0.5 s, backing off to 5 s, until it connects or you call `Disconnect`. Called for you at start-up when **Auto Connect** is on. |
| `Disconnect()` | Close the connection and stop reconnecting. Fires `OnPlayerLeft` for every player, then `OnDisconnected`. |
| `IsConnected()` | True once the relay has said hello. |
| `GetHello()` | The relay's `FPhoneWandHello`: `JoinUrl`, `QrUrl`, `MaxPlayers`, `Protocol`, `Relay`. |
| `GetUrl()` | The URL in use. |
| `SetAutoReconnect(bEnabled)` | Turn reconnecting on or off. |
| `GetPlayers()` | Every player, sorted by slot. |
| `GetPlayer(Id, Player)` | One player by id. Returns false if there is none. |
| `GetPlayerInSlot(Slot, Player)` | The player in a slot. Returns false if it is empty. |
| `GetPlayerCount()` | Number of players. |
| `IsButtonHeld(Id, Button)` | True while the player holds `primary` (the default) or `secondary`. |
| `FindPlayer(Id)` | C++ only: a pointer to the live player, or null. |
| `SetSmoothing(MinCutoff, Beta, DCutoff)` | Set the One Euro filter the relay applies to this app's poses. Lower `MinCutoff` is steadier when still; higher `Beta` is quicker when moving. |
| `SetRaw()` | Turn smoothing off for this app. |
| `Style(Id, Colour, Label)` | Change a player's colour (`#rrggbb`) and label. An empty field is left alone. |
| `StyleColour(Id, Colour)` | Change a player's colour from an `FLinearColor`. |
| `SetLabel(Id, Label)` | Change or clear a player's label, shown under their name on the phone. |
| `Prompt(Text, Id, DurationMs)` | Show text on one phone, or every phone when `Id` is empty. `DurationMs` 0 keeps it up; empty text clears it. |
| `Haptic(Pattern, Id)` | Vibrate (Android only). `Pattern` alternates on and off milliseconds. |
| `HapticPulse(DurationMs, Id)` | One vibration. |
| `Calibrate(Mode, Id)` | Ask a player (or everyone) to calibrate: `Screen` (two corners) or `Ray` (point at the middle and press Recentre). |
| `SetStartRelay(bEnabled, RelayPath, RelayArguments)` | Start the relay from the game on the next `Connect` (see [Starting the relay from your game](#starting-the-relay-from-your-game)). Defaults to the project settings. |
| `IsRelayStartedByPlugin()` | True while a relay this subsystem started is running. |
| `StopRelay()` | Stop the relay this subsystem started, if any. `Disconnect` and shutting down do this for you. A relay it did not start is never stopped. |
| `HandleMessage(Json)` | Feed in one relay message as a JSON string, as if it came from the socket. Used by the tests; also lets you drive the client from a recording or another transport. |

Smoothing set with `SetSmoothing` or `SetRaw` is sent again each time the connection opens.

### Events

Each event is a Blueprint-assignable delegate (`OnPose`) with a native twin for C++
(`OnPoseNative`). Both fire, on the game thread, in the order the relay's messages arrive.

| Event | Parameters | When |
|---|---|---|
| `OnConnected` | `Hello` | The relay said hello. Players already present follow as `OnPlayerJoined`. |
| `OnDisconnected` | | The connection was lost or closed, after `OnPlayerLeft` for every player. |
| `OnPlayerJoined` | `Player` | A player took a slot. |
| `OnPlayerLeft` | `Player` | A player left (60 seconds after their phone disconnected, or when the relay went away). |
| `OnPlayerChanged` | `Player` | State, name, colour, label, calibration or transport changed. |
| `OnPose` | `Player`, `Pose` | A new pose, typically 60 a second per player. |
| `OnButton` | `Player`, `Button`, `bDown` | A button went down or up. Every down is followed by an up. |
| `OnCalibrating` | `Player`, `Step` | The player is pointing at `TopLeft` or `BottomRight` during screen calibration, or `Cancelled` it. |
| `OnCalibrated` | `Player`, `Calibration` | The player pressed Recentre (`Ray`) or finished screen calibration (`Screen`). |
| `OnStats` | `Player`, `Stats` | Once a second per player: `Rtt` (ms), `Rate` (poses a second), `Dropped`. |

A `pose`, `button`, `calibrating`, `calibrated` or `stats` message for a player the client does
not know fires nothing. A player whose state stops being `Active` has their held buttons cleared.

### FPhoneWandPlayer

| Field | Meaning |
|---|---|
| `Id` | Unique while the relay runs. A phone that reconnects keeps its id and slot. |
| `Slot` | 0-based player number, lowest free first. |
| `Name` | Chosen on the phone. |
| `Colour`, `LinearColour` | The player's colour as `#rrggbb` and as an `FLinearColor`. |
| `Label` | Extra text set with `Style` or `SetLabel`. |
| `State` | `Waiting` (has not allowed motion access yet), `Active` or `Paused` (tab hidden, phone locked, or no data for half a second). |
| `Calibration` | `None`, `Ray` or `Screen`. |
| `Calibrating` | The corner being calibrated right now, or `None`. |
| `Platform`, `Sensor`, `Transport` | `iOS`/`Android`/`other`; `relative-orientation-sensor`/`deviceorientation`; `ws`/`http`. |
| `bHasPose`, `Pose` | The latest pose, once one has arrived. |
| `Buttons` | Buttons held now, sorted. |
| `bHasStats`, `Stats` | The latest stats. |

### FPhoneWandPose

| Field | Meaning |
|---|---|
| `Id` | The player's id. |
| `Seq` | The phone's sample counter. Gaps mean dropped samples. Restarts at 0 when the phone reconnects. |
| `Time` | When the relay received it, in milliseconds since the Unix epoch. |
| `Yaw`, `Pitch`, `Roll` | Degrees. Yaw is positive to the right, pitch positive upwards, roll positive when the phone turns clockwise as seen from behind. |
| `Direction` | Unit pointing direction in Unreal's frame. |
| `Rotation`, `Rotator` | The phone's orientation in Unreal's frame. Rotating +X gives `Direction`; +Z points out of the phone's screen. |
| `bHasScreen`, `Screen` | Normalised screen position, (0, 0) top-left to (1, 1) bottom-right. Values outside 0..1 mean the player is pointing off the screen. `bHasScreen` is false when the phone points more than about 87 degrees away from forward. |
| `RigDirection`, `RigQuat` | The raw rig-frame values from the relay, for anyone who needs them. |

### UPhoneWandLibrary

Blueprint function library, also callable from C++.

| Function | What it does |
|---|---|
| `GetPhoneWand(WorldContext)` | The subsystem for this world's game instance. |
| `RigToUnrealVector(Rig)` / `UnrealToRigVector(V)` | Convert vectors between the rig frame and Unreal. |
| `RigToUnrealQuat(RigQuat)` | C++: rig quaternion (x, y, z, w) to `FQuat`. |
| `RigToUnrealRotator(X, Y, Z, W)` | Rig quaternion to `FRotator`. |
| `DirectionFromYawPitch(Yaw, Pitch)` | Unit direction in Unreal's frame from yaw and pitch in degrees. |
| `ScreenToPixels(Screen, ViewportSize)` | Normalised screen position to pixels. |
| `PoseToViewportPixels(WorldContext, Pose, Pixels)` | A pose's screen position in pixels of the game viewport. |
| `IsOnScreen(Pose)` | True when the pose has a screen position inside 0..1. |
| `ColourFromHex(Hex)` / `ColourToHex(Colour)` | `#rrggbb` to `FLinearColor` and back (sRGB). |

### Project settings

**Project Settings > Plugins > Phone Wand**, stored in `Config/DefaultGame.ini` under
`[/Script/PhoneWand.PhoneWandSettings]`:

| Setting | Default | Meaning |
|---|---|---|
| **Url** | `ws://127.0.0.1:8480/app` | The relay's app endpoint. |
| **Auto Connect** | on | Connect when the game instance starts. Turn it off to call `Connect` yourself. |
| **Auto Reconnect** | on | Keep retrying when the relay is not there or goes away. |
| **Start Relay** | off | Start the relay from the game when none is running, and stop it when the game stops. See [Starting the relay from your game](#starting-the-relay-from-your-game). |
| **Relay Path** | empty | The `phone-wand-relay` folder or the relay executable. Empty uses `Resources/Relay/phone-wand-relay` in the plugin. A relative path is relative to the project folder. |
| **Relay Arguments** | empty | Extra relay options, such as `--max-players 8 --key party`. |
| **Smoothing** | Relay Default | `Relay Default`, `Custom` (uses **Min Cutoff**, **Beta**, **D Cutoff**) or `Raw`. |

Command-line switches: `-PhoneWandUrl=ws://host:port/app` overrides the URL,
`-PhoneWandNoConnect` stops the automatic connection, `-PhoneWandStartRelay` turns on **Start
Relay**, and `-PhoneWandRelayPath=<path>` and `-PhoneWandRelayArgs="<options>"` override **Relay
Path** and **Relay Arguments**.

## Starting the relay from your game

When you ship a game, players shouldn't have to start a separate program. With **Start Relay** on
(Project Settings, Plugins, Phone Wand), the plugin starts the relay itself, hidden, when the game
connects, and stops it when the game stops. This works in Windows, macOS and Linux builds, in Play
In Editor and in packaged games. On other platforms (phones, consoles) the setting is ignored, with
a message in the log.

**1. Put the binaries in the plugin.** Download `phone-wand-relay-<version>-embed.zip` from the
[releases page](https://github.com/wildwinter/phone-wand/releases), same version as the plugin, and
put its `phone-wand-relay` folder in the plugin's `Resources/Relay` folder:

```
Plugins/PhoneWand/Resources/Relay/phone-wand-relay/
  macos/phone-wand-relay
  windows-x64/phone-wand-relay.exe
  linux-x64/phone-wand-relay
  linux-arm64/phone-wand-relay
```

Leave out platforms you don't ship; each binary is about 100 MB. To keep them somewhere else, set
**Relay Path** to that `phone-wand-relay` folder, or to the executable itself.

**2. Turn on Start Relay.** Add relay options in **Relay Arguments** if you need them, for example
`--max-players 8`. If you give the relay another app port, change **Url** instead: the plugin
passes the URL's port as `--app-port`.

**3. Package as usual.** The plugin's build rules (`PhoneWand.Build.cs`) add the binary for the
platform you are packaging to the game's runtime dependencies, so it is copied into the packaged
game next to the plugin (for example
`YourGame.app/Contents/UE/YourGame/Plugins/PhoneWand/Resources/Relay/phone-wand-relay/macos/`).
Only that platform's binary is staged, and nothing is staged if it isn't there, so projects without
the binaries still build.

What happens when the subsystem connects, as in every Phone Wand client (see
[What the client libraries do](../shipping.md#what-the-client-libraries-do)):

1. If **Url** isn't on this computer (`127.0.0.1`, `localhost` or `[::1]`), nothing is started.
2. The plugin asks `http://127.0.0.1:<port>/status.json`, waiting up to a second without holding up
   the game. If a relay answers (the Phone Wand app you run while developing, say), it uses that
   one and will never stop it.
3. Otherwise it starts `phone-wand-relay/<platform>/phone-wand-relay` with
   `--lifeline --no-open --app-port <port> --log <log>` and your **Relay Arguments**, with no window
   and a pipe as its standard input. On macOS and Linux it makes the file executable first. If the
   binary isn't there, it logs a warning saying where it looked and connects as usual.
4. It connects as usual; reconnecting covers the moment the relay takes to start.
5. When the game instance shuts down (or you call `Disconnect` or `StopRelay`), it closes the
   relay's standard input, which stops the relay, and ends the process if it is still there two
   seconds later. If the game crashes, the pipe closes anyway and the relay stops by itself.

The relay writes its output to `phone-wand-relay.log` in the project's log folder
(`FPaths::ProjectLogDir()`): `Saved/Logs` on Windows and Linux, `~/Library/Logs/<Project>` on macOS
(inside the app's container, `~/Library/Containers/<bundle id>/Data/Library/Logs/<Project>`, for a
sandboxed build). The plugin logs the full command it ran to `LogPhoneWand`.

A sandboxed macOS build runs the relay inside the game's sandbox, so the relay needs the
`com.apple.security.network.server` entitlement (Unreal's default sandbox entitlements have it),
and a `--data-dir` in **Relay Arguments** must be inside the container. Before you sign and
notarize a macOS game, sign the relay with the relay's entitlements: see
[Signing on macOS](../shipping.md#signing-on-macos). On Windows, see
[Windows](../shipping.md#windows) for the firewall prompt.

## Frames and conversions

The relay sends vectors in its **rig frame** as `[right, up, forward]`, and quaternions as
`[x, y, z, w]` in the same frame (see the [protocol](../protocol.md#frames-and-units)). Unreal is
X forward, Y right, Z up. Both frames are left-handed, so the conversion is a reordering of axes
with no mirroring:

| Rig | Unreal |
|---|---|
| vector `[r, u, f]` | `FVector(f, r, u)` |
| quaternion `[x, y, z, w]` | `FQuat(z, x, y, w)` |
| forward (the pointing direction) | +X |
| up (out of the phone's screen) | +Z |

The plugin does this for you: `Direction`, `Rotation` and `Rotator` are already in Unreal's frame.
Directions are unit vectors, so scale them for distances (Unreal units are centimetres).

"Forward" is wherever the player pointed when they pressed **Recentre**, or the middle of the
screen after screen calibration. To aim things in a 3D scene, treat the camera's forward as the
rig's forward: `Camera->GetComponentRotation().RotateVector(Pose.Direction)` gives a world
direction from the camera. For cursors, use `Screen`, which already accounts for calibration.

## The demo

`PhoneWandDemo` (next to the plugin in the release zip, `clients/unreal/PhoneWandDemo` in the
repository) is a small C++ project with no content of its own. It opens the engine's built-in
`Template_Default` map, and its game mode, `APhoneWandDemoGameMode`, adds `APhoneWandDemoHUD`,
which draws:

- a disc in each player's colour at their screen position, with their name,
- a ripple when a player presses the primary button,
- an arrow at the edge of the screen, pointing the right way, when a player points off the screen,
- a line for each player who hasn't set up their aim yet ("Player 2, Bea: set up your aim on your
  phone"), since they have no cursor until they do,
- the join URL, the QR code (fetched from the relay's `qrUrl`) and a player list.

To run it: start the relay, open `PhoneWandDemo.uproject`, let it build, and press **Play**. Its
`.uproject` finds the plugin through `AdditionalPluginDirectories: [".."]`, so keep the two
folders side by side.

Two command-line switches help when running the demo from a script: `-PhoneWandUrl=` points it at
another relay, and `-PhoneWandDemoShot=<file.png>` with `-PhoneWandDemoShotDelay=<seconds>` takes
one screenshot after the delay (default 5 s) and quits.

## Troubleshooting

**It never connects.** Check the relay is running and prints `Apps connect to: ws://127.0.0.1:8480/app`
(or the port you gave with `--app-port`), and that **Url** in the project settings matches. The plugin
logs to the `LogPhoneWand` category; for every connection attempt, add
`[Core.Log] LogPhoneWand=Verbose` to `DefaultEngine.ini`.

**The relay says "Refused an app connection".** Unreal's WebSocket sends an `Origin` header made
from the URL's host (`http://127.0.0.1` for `ws://127.0.0.1:8480/app`). The relay accepts local
origins and origins naming the address the game connected to, so this should not happen with a
current relay. To connect from another computer, start the relay with `--app-host 0.0.0.0`.

**Players join but never move.** Their state is `Waiting` until they tap **Tap to start** on the
phone and allow motion access. `Paused` means the phone is locked or the page is hidden.

**The cursor is off to one side.** Ask the player to point at the middle of the screen and press
**Recentre**, or run screen calibration (`Calibrate(Screen, Id)`) for accuracy. See
[Calibration and precision](../calibration.md).

**"The following modules are missing or built with a different engine version".** The plugin is
source only; Unreal offers to rebuild it, so say yes. If that fails, rebuild it yourself from a
terminal:

```sh
# macOS (Windows: Engine\Build\BatchFiles\RunUAT.bat with the same arguments)
"/path/to/UE_5.7/Engine/Build/BatchFiles/RunUAT.sh" BuildPlugin \
  -Plugin="$PWD/Plugins/PhoneWand/PhoneWand.uplugin" -Package="$PWD/PhoneWandBuilt"
```

Then replace `Plugins/PhoneWand` with the contents of `PhoneWandBuilt`. Or delete
`Plugins/PhoneWand/Binaries` and `Plugins/PhoneWand/Intermediate` and build your project's editor
target from your IDE. The plugin targets Unreal 5.7.

**Blueprint events stop firing after a level change.** The subsystem lives as long as the game
instance, but Blueprint bindings belong to the object that made them. Bind again in the new
level's actors, or bind from a game instance Blueprint.

## Testing

The plugin has automation tests, all named `PhoneWand.*`:

| Test | What it checks |
|---|---|
| `PhoneWand.Conformance.Session.<name>` | Replays each recorded session in `conformance/app/` through `HandleMessage`, and compares the event log with `<name>.events.txt` line for line and the final players with `<name>.state.json`. |
| `PhoneWand.Conformance.Conversions` | Every case in `conformance/conversions.json`: vector and quaternion conversion, and that rotating +X and +Z by the converted quaternion gives the expected direction and up. |
| `PhoneWand.Library` | Colour, screen, direction and pose helpers. |
| `PhoneWand.Client.ConnectionLost` | Leave and disconnect events, partial player updates, sorting, and ignoring unknown messages. |
| `PhoneWand.Live.Relay` | Connects to a running relay and passes only if it sees the hello, joins, poses and stats. Skipped unless `PHONEWAND_LIVE_URL` (or `-PhoneWandLiveUrl=`) is set. |
| `PhoneWand.ManagedRelay.Paths` | Which URLs count as this computer, and where **Relay Path** points. |
| `PhoneWand.ManagedRelay.Missing` | With no relay binary, a warning says where it looked and the client keeps connecting. |
| `PhoneWand.ManagedRelay.Live` | With no relay on the port, starts the relay, connects, and after shutdown checks that `status.json` no longer answers and the process is gone; then, with a relay already running, checks that it starts nothing and leaves that relay running. Uses app port 26480 and phone port 26443 (`PHONEWAND_RELAY_TEST_PORTS=<app>,<phone>` to change them). Skipped unless `PHONEWAND_RELAY_DIR` (or `-PhoneWandRelayDir=`) names a `phone-wand-relay` folder. |

Run them in the editor from **Tools > Session Frontend > Automation** (filter on `PhoneWand`), or
from the repository root with:

```sh
scripts/check-unreal.sh
```

The script finds Unreal 5.7 (under `/Volumes/Data/Unreal`, `/Users/Shared/Epic Games` or
`/Applications/Epic Games`; set `UE_ROOT` to use another), builds `PhoneWandDemoEditor`, runs the
tests headless with `UnrealEditor-Cmd`, and fails if any test fails or none ran. `SKIP_BUILD=1`
skips the build. To include the live test, start a relay with simulated players and pass its URL:

```sh
phone-wand --simulate 3 --no-open &
PHONEWAND_LIVE_URL=ws://127.0.0.1:8480/app scripts/check-unreal.sh
```

To include the managed relay test, point it at the relay binaries (for example after
`bun scripts/dist.ts --only=relay,embed`, which builds them in `dist/embed`, laid out as
`phone-wand-relay/` expects):

```sh
PHONEWAND_RELAY_DIR=dist/embed scripts/check-unreal.sh
```

The tests find the conformance suite relative to the plugin (`clients/unreal/PhoneWand` to
`conformance`). If the plugin lives elsewhere, set `PHONEWAND_CONFORMANCE_DIR` or pass
`-PhoneWandConformance=<dir>`.
