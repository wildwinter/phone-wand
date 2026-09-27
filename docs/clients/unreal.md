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
[latest release](https://github.com/wildwinter/phone-wand/releases/latest). It holds:

```
Plugins/PhoneWand/  the plugin
PhoneWandDemo/      a sample project that uses it
```

To add Phone Wand to your own project:

1. Copy the `Plugins/PhoneWand` folder into your project's `Plugins` folder (create it if needed),
   so you have `YourProject/Plugins/PhoneWand/PhoneWand.uplugin`.
2. Open the project. The plugin ships as source, so Unreal asks to build it: say yes. You need a
   C++ toolchain (Xcode on macOS, Visual Studio on Windows). A Blueprint-only project can use it
   too, as long as the toolchain is installed.
3. Check **Edit > Plugins > Input > Phone Wand** is enabled.

You can also take the plugin straight from the repository: it lives in
`clients/unreal/Plugins/PhoneWand`.

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
4. Add **Assign On Button** for clicks: **Button** is the button's id (`primary` or `secondary`
   by default, or the ids in your [layout](#layouts)), and **Down** is true on press and false on
   release.

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

## Layouts

By default every phone shows a big **Primary** button and a smaller **Secondary** one. Your game
can choose other controls, for every phone or for each player: pick a template and list the
controls. Buttons, toggles, sliders, choices, labels, dpads and crawl keys are available; the phone
places them for the player's thumb. [Layouts](../layouts.md) explains the templates and controls.

Button ids are plain strings (`FString`) everywhere in the plugin: `primary` and `secondary` in the
default layout, or the ids you give your buttons. `UPhoneWandLibrary::PrimaryButton()` and
`SecondaryButton()` (Blueprint: **Primary Button**, **Secondary Button**), or
`PhoneWand::PrimaryButton` and `PhoneWand::SecondaryButton` in C++, spell the default two.

A **dpad** (four arrows) and a **crawl** control (dungeon-crawler keys: forward, back, step left
and right, turn left and right) carry no value. Each arrow or key is an ordinary button named
`<id>.<direction>`, so presses arrive through `OnButton` and `IsButtonHeld` like any other button:

| Control | Buttons (for id `move` or `walk`) |
|---|---|
| Dpad | `move.up`, `move.down`, `move.left`, `move.right` |
| Crawl | `walk.forward`, `walk.back`, `walk.step-left`, `walk.step-right`, `walk.turn-left`, `walk.turn-right` |

**Dpad Button** (`UPhoneWandLibrary::DpadButton(ControlId, EPhoneWandDpadDirection)`) and **Crawl
Button** (`CrawlButton(ControlId, EPhoneWandCrawlDirection)`) spell these names, so you need not
type them. In the Primary templates the big first control may be a button, a dpad or a crawl.

### Blueprint

1. Build the controls with **Make Button**, **Make Toggle**, **Make Slider**, **Make Choice**,
   **Make Label**, **Make Dpad** and **Make Crawl** (in **Phone Wand > Layouts**), and give one its
   own colour with **With Colour**.
2. Put them in an array, in order, and pass it with a template to **Make Layout**.
3. Call **Set Layout** on the subsystem. Leave **Id** empty for every phone, or give a player's id.
   **Reset Layout** goes back to the default.
4. Bind **Assign On Button** for the buttons (the **Button** is your id, or a dpad or crawl
   direction: compare it with **Dpad Button** or **Crawl Button**) and **Assign On Control
   Changed** for the rest: it gives the **Player**, the **Control Id** and the **Value**. Break the
   value: **Type** says which field holds it (**Value** for a toggle, **Number** for a slider,
   **Index** for a choice, **Text** for a label).
5. Change a value on the phone with **Set Control Bool**, **Set Control Number**, **Set Control
   Choice** or **Set Control Text** (a label's text, such as a score).

If a layout or value doesn't fit (too many controls for the template, a toggle set to text), the
relay changes nothing and sends an error. Bind **Assign On Relay Error** to handle it; with nothing
bound, the plugin logs it as a warning in `LogPhoneWand`.

### C++

```cpp
#include "PhoneWandLibrary.h"
#include "PhoneWandSubsystem.h"

void AMyGame::BeginPlay()
{
    Super::BeginPlay();
    UPhoneWandSubsystem* Wand = GetGameInstance()->GetSubsystem<UPhoneWandSubsystem>();

    // A shooter: a big Shoot button, then Reload, a Zoom toggle and an ammo count below.
    Wand->SetLayout(UPhoneWandLibrary::MakeLayout(EPhoneWandTemplate::PrimaryRow, {
        UPhoneWandLibrary::MakeButton(TEXT("shoot"), TEXT("Shoot")),
        UPhoneWandLibrary::MakeButton(TEXT("reload"), TEXT("Reload")),
        UPhoneWandLibrary::MakeToggle(TEXT("zoom"), TEXT("Zoom")),
        UPhoneWandLibrary::MakeLabel(TEXT("ammo"), TEXT("Ammo"), TEXT("12")),
    }));

    Wand->OnButtonNative.AddLambda([this](const FPhoneWandPlayer& Player, const FString& Button, bool bDown)
    {
        if (Button == TEXT("shoot") && bDown) Shoot(Player);
        if (Button == TEXT("reload") && bDown) Reload(Player);
    });
    Wand->OnControlChangedNative.AddLambda([this](const FPhoneWandPlayer& Player, const FString& Control, const FPhoneWandControlValue& Value)
    {
        if (Control == TEXT("zoom")) SetZoom(Player, Value.bValue);
    });
    Wand->OnRelayErrorNative.AddLambda([](const FString& Message)
    {
        UE_LOG(LogTemp, Warning, TEXT("Phone Wand: %s"), *Message);
    });
}

// Later, for one player:
Wand->SetControlText(TEXT("ammo"), TEXT("11"), Player.Id);
```

A dungeon crawler: crawl keys as the big control, with a Use button beside them.

```cpp
Wand->SetLayout(UPhoneWandLibrary::MakeLayout(EPhoneWandTemplate::PrimaryRow, {
    UPhoneWandLibrary::MakeCrawl(TEXT("walk"), TEXT("Walk")),
    UPhoneWandLibrary::MakeButton(TEXT("use"), TEXT("Use")),
}));

Wand->OnButtonNative.AddLambda([this](const FPhoneWandPlayer& Player, const FString& Button, bool bDown)
{
    if (!bDown) return;
    if (Button == UPhoneWandLibrary::CrawlButton(TEXT("walk"), EPhoneWandCrawlDirection::Forward)) StepForward(Player);
    if (Button == UPhoneWandLibrary::CrawlButton(TEXT("walk"), EPhoneWandCrawlDirection::TurnLeft)) TurnLeft(Player);
    // ... and Back, StepLeft, StepRight, TurnRight.
});
```

In Blueprint: **Make Crawl** and **Make Button** into **Make Layout**, then in **On Button** compare
**Button** with **Crawl Button** (Control Id `walk`, Direction `Forward`) using **Equal (String)**.

### Rows and columns

For a shape the fixed templates don't cover, the `Rows` and `Columns` templates take the number of
controls in each row (top, the pointing end, to bottom) or column (left to right, mirrored for left
hands): 1 to 4 rows or columns of 1 to 4 controls each, adding up to exactly the number of
controls, at most 8. Any control type may go in any position. Relative heights or widths are
optional (equal when left empty); the relay raises any under a tenth of the biggest to a tenth.

**Make Rows Layout** (`MakeRowsLayout(Rows, Controls, Heights)`) and **Make Columns Layout**
(`MakeColumnsLayout(Columns, Controls, Widths)`) build them. They fill `FPhoneWandLayout::Counts`
and `Sizes`, which the plugin sends as `rows` and `heights` or `columns` and `widths`.

A crawl pad in front, taking three fifths of the phone, and three controls behind it:

```cpp
Wand->SetLayout(UPhoneWandLibrary::MakeRowsLayout({ 1, 3 }, {
    UPhoneWandLibrary::MakeCrawl(TEXT("walk")),
    UPhoneWandLibrary::MakeButton(TEXT("use"), TEXT("Use")),
    UPhoneWandLibrary::MakeToggle(TEXT("torch"), TEXT("Torch")),
    UPhoneWandLibrary::MakeLabel(TEXT("gold"), TEXT("Gold"), TEXT("0")),
}, { 3.0, 2.0 }));
```

In Blueprint: the four controls into **Make Rows Layout**, with **Rows** an array of 1 and 3 and
**Heights** an array of 3 and 2 (or left unconnected for equal rows), then **Set Layout**.

A player that joins later gets the layout you sent to everyone only if you send it again: the
relay stores a layout per player, so send it from `OnPlayerJoinedNative` too if players come and
go. Each player's current layout and values are in `FPhoneWandPlayer::Layout` and `Controls`, and
`GetControlValue(Id, ControlId, Value)` reads one value.

## Gestures

Players can also flick the phone towards the screen, pull it back, flick it sideways, up or down,
shake it or twist their wrist. The relay spots these movements and the subsystem fires
`OnGesture`; see [Gestures](../gestures.md) for what each one is and what works well.

### Blueprint

Bind **Assign On Gesture** on the subsystem. It gives the **Player** and a **Gesture**
(`FPhoneWandGesture`): break it, **Switch on EPhoneWandGesture** on its **Gesture** field, and use
**Is Button Held (Gesture)** for combinations such as "hold Primary and pull back". **Set Gesture
Sensitivity** and **Set Gestures Enabled** (in **Phone Wand > Gestures**) change the sensitivity
for this app.

### C++

```cpp
#include "PhoneWandSubsystem.h"

void AMyGame::BeginPlay()
{
    Super::BeginPlay();
    UPhoneWandSubsystem* Wand = GetGameInstance()->GetSubsystem<UPhoneWandSubsystem>();
    Wand->SetGestureSensitivity(9.0);   // needs a firmer flick than the default 7

    Wand->OnGestureNative.AddLambda([this](const FPhoneWandPlayer& Player, const FPhoneWandGesture& Gesture)
    {
        switch (Gesture.Gesture)
        {
        case EPhoneWandGesture::Pull:
            if (Gesture.IsButtonHeld(TEXT("primary"))) DrawBow(Player, Gesture.Strength);
            break;
        case EPhoneWandGesture::Push:
            Throw(Player, Gesture.Direction * Gesture.Speed * 100.0);   // m/s to cm/s, Unreal's frame
            break;
        case EPhoneWandGesture::Shake:
            Shuffle(Player);
            break;
        default:
            break;
        }
    });
}
```

`FPhoneWandGesture` holds:

| Field | Meaning |
|---|---|
| `Gesture` | Movements: `Push` (towards the screen), `Pull`, `Left`, `Right`, `Up`, `Down`, `Shake`. Fast rotations: `FlickUp`, `FlickDown`, `FlickLeft`, `FlickRight`, `TwistLeft`, `TwistRight`. `Unknown` for a gesture from a newer relay that this plugin doesn't know. |
| `GestureName` | The protocol name (`push`, `twist-left`, ...), set even for `Unknown`. |
| `Strength` | 0 to 1: how vigorous, relative to a strong flick, shake or twist. |
| `Speed` | Movements and shakes: peak speed in m/s (0 for flicks and twists). |
| `Angle` | Flicks and twists: how far the phone turned, in degrees (0 for movements). |
| `Direction` | Movements: unit direction in Unreal's frame, so a push is about +X; zero otherwise. |
| `RawDirection` | The same in the rig frame (`[right, up, forward]`) as sent by the relay. |
| `Duration` | How long it took, in milliseconds. |
| `Time` | Relay time it started, in milliseconds since the Unix epoch. |
| `Buttons` | Ids of the buttons held when it started, sorted. `IsButtonHeld(Button)` in C++, **Is Button Held (Gesture)** in Blueprint. |
| `Id` | The player's id. |

Sensitivity is per app: **Gestures**, **Gesture Threshold**, **Gesture Min Speed**, **Gesture Flick
Rate** and **Gesture Twist Rate** in the [project settings](#project-settings), or
`SetGestureSensitivity(Threshold, MinSpeed, TwistRate, FlickRate)` and `SetGesturesEnabled(false)`
at run time. The subsystem sends them in its
`configure` message, with the smoothing, when it connects and again after every reconnect. Left at
the defaults, nothing is sent and the relay uses its own defaults.

To recognise movements yourself, read `Pose.Accel` on each pose: the phone's acceleration in m/s²,
gravity removed, in Unreal's frame (`bHasAccel` is false if the phone didn't send it).

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
| `IsButtonHeld(Id, Button)` | True while the player holds the button: `primary` (the default), `secondary`, or a button id from your layout. |
| `GetControlValue(Id, ControlId, Value)` | A toggle, slider, choice or label's current value for a player. Returns false if there is no such player or control. |
| `FindPlayer(Id)` | C++ only: a pointer to the live player, or null. |
| `SetSmoothing(MinCutoff, Beta, DCutoff)` | Set the One Euro filter the relay applies to this app's poses. Lower `MinCutoff` is steadier when still; higher `Beta` is quicker when moving. |
| `SetRaw()` | Turn smoothing off for this app. |
| `SetGestureSensitivity(Threshold, MinSpeed, TwistRate, FlickRate)` | Set this app's gesture sensitivity and turn gestures on (see [Gestures](#gestures)). Defaults 7, 0.35, 360 and 250. |
| `SetGesturesEnabled(bEnabled)` | Turn `OnGesture` on or off for this app. |
| `AreGesturesEnabled()` | False once gestures have been turned off. |
| `GetConfigureJson()` | C++ only: the `configure` message the subsystem sends when it connects, or empty when it sends none. |
| `Style(Id, Colour, Label)` | Change a player's colour (`#rrggbb`) and label. An empty field is left alone. |
| `StyleColour(Id, Colour)` | Change a player's colour from an `FLinearColor`. |
| `SetLabel(Id, Label)` | Change or clear a player's label, shown under their name on the phone. |
| `Prompt(Text, Id, DurationMs)` | Show text on one phone, or every phone when `Id` is empty. `DurationMs` 0 keeps it up; empty text clears it. |
| `Haptic(Pattern, Id)` | Vibrate (Android only). `Pattern` alternates on and off milliseconds. |
| `HapticPulse(DurationMs, Id)` | One vibration. |
| `Calibrate(Mode, Id)` | Ask a player (or everyone) to calibrate: `Screen` (two corners) or `Ray` (point at the middle and press Recentre). |
| `SetLayout(Layout, Id)` | Choose the controls a phone shows, or every phone when `Id` is empty (see [Layouts](#layouts)). The relay remembers it per player and sends `OnPlayerChanged` with the new layout. Held buttons that aren't in the new layout are released. An invalid layout fires `OnRelayError` and changes nothing. |
| `ResetLayout(Id)` | Back to the default layout (Primary and Secondary), for one phone or every phone. |
| `SetControl(ControlId, Value, Id)` | Change a control's value on a phone (or every phone): a toggle's Bool, a slider's Number (0 to 1), a choice's option index (Number) or a label's Text. Every app then gets `OnControlChanged`. |
| `SetControlBool` / `SetControlNumber` / `SetControlChoice` / `SetControlText` `(ControlId, Value, Id)` | The same, one per kind of value. |
| `SetSendOverride(Send)` | C++ only: send messages to the relay through a function instead of the socket. Used by the tests; with `HandleMessage`, lets you drive the client over another transport. |
| `SetStartRelay(bEnabled, RelayPath, RelayArguments)` | Start the relay from the game on the next `Connect` (see [Starting the relay from your game](#starting-the-relay-from-your-game)). Defaults to the project settings. |
| `IsRelayStartedByPlugin()` | True while a relay this subsystem started is running. |
| `StopRelay()` | Stop the relay this subsystem started, if any. `Disconnect` and shutting down do this for you. A relay it did not start is never stopped. |
| `HandleMessage(Json)` | Feed in one relay message as a JSON string, as if it came from the socket. Used by the tests; also lets you drive the client from a recording or another transport. |

Smoothing set with `SetSmoothing` or `SetRaw`, and gesture settings, are sent again each time the
connection opens.

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
| `OnButton` | `Player`, `Button`, `bDown` | A button went down or up. `Button` is its id: `primary` or `secondary` by default, or an id from your layout. Every down is followed by an up, including when a new layout removes a held button. |
| `OnControlChanged` | `Player`, `ControlId`, `Value` | A toggle, slider, choice or label changed, on the phone or because an app set it. `Player.Controls` already holds the new value. |
| `OnGesture` | `Player`, `Gesture` | The player moved the phone deliberately: a flick, shake or twist. `Gesture.Buttons` says which buttons were held as it started. See [Gestures](#gestures). |
| `OnRelayError` | `Message` | The relay couldn't use something this app sent, such as an invalid layout; the message says why. With nothing bound (Blueprint or native), it is logged as a warning instead. |
| `OnCalibrating` | `Player`, `Step` | The player is pointing at `TopLeft` or `BottomRight` during screen calibration, or `Cancelled` it. |
| `OnCalibrated` | `Player`, `Calibration` | The player pressed Recentre (`Ray`) or finished screen calibration (`Screen`). |
| `OnStats` | `Player`, `Stats` | Once a second per player: `Rtt` (ms), `Rate` (poses a second), `Dropped`. |

A `pose`, `button`, `control`, `gesture`, `calibrating`, `calibrated` or `stats` message for a player the
client does not know fires nothing. A player whose state stops being `Active` has their held
buttons cleared. A player message carrying a layout replaces the player's `Layout` and `Controls`
entirely.

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
| `Buttons` | Ids of the buttons held now, sorted. |
| `Layout` | The `FPhoneWandLayout` the phone shows. The default until an app sends one. |
| `Controls` | Current values of the layout's toggles, sliders, choices and labels, by control id (`TMap<FString, FPhoneWandControlValue>`). Buttons, dpads and crawls have none. `GetControl(ControlId)` in C++. |
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
| `bHasAccel`, `Accel` | The phone's acceleration in m/s², gravity removed, in Unreal's frame. Not smoothed. `bHasAccel` is false when the phone sends none (for example if motion access was refused). |
| `RigDirection`, `RigQuat`, `RigAccel` | The raw rig-frame values from the relay, for anyone who needs them. |

### FPhoneWandLayout and FPhoneWandControl

`FPhoneWandLayout` is a `Template` (`Primary`, `PrimarySecondary`, `Pair`, `PrimaryRow`, `Grid`,
`Rows` or `Columns`) and `Controls`, an array of `FPhoneWandControl` in order. `FindControl(Id)`
finds one in C++. For `Rows` and `Columns` only, `Counts` (`TArray<int32>`) holds how many controls
are in each row or column, and `Sizes` (`TArray<double>`) their relative heights or widths, empty
for equal (see [Rows and columns](#rows-and-columns)); players' layouts from the relay carry them
too.

| `FPhoneWandControl` field | Meaning |
|---|---|
| `Id` | Your name for it: 1 to 32 letters, digits, `_`, `.` or `-`, unique in the layout. |
| `Type` | `Button`, `Toggle`, `Slider`, `Choice`, `Label`, `Dpad` or `Crawl`. Dpad and crawl have no value; their directions are buttons named `<Id>.<direction>`. |
| `Label` | Text on the control (up to 24 characters). Optional. |
| `bHasColour`, `Colour` | The control's own colour (sent as `#rrggbb`); the player's colour when `bHasColour` is false. |
| `bValue` | Toggle: its starting state. |
| `Value` | Slider: its starting position, 0 to 1. |
| `bVertical` | Slider: vertical instead of horizontal. |
| `bSpring`, `Spring` | Slider: returns to `Spring` (0 to 1) when let go. Otherwise it stays put. |
| `Options`, `Index` | Choice: 2 to 4 options (up to 16 characters each) and the starting index. |
| `Text` | Label: its text, up to 80 characters. |

Only the fields for the control's type are sent. `PhoneWand::LayoutToJson` and `LayoutFromJson`
convert to and from the protocol's JSON in C++.

### FPhoneWandControlValue

| Field | Meaning |
|---|---|
| `Type` | `None`, `Bool` (a toggle), `Number` (a slider's 0 to 1, or a choice's option index) or `Text` (a label). |
| `bValue` | The toggle's state. |
| `Number` | The slider's position or the choice's index. |
| `Index` | `Number` rounded: the choice's option index. |
| `Text` | The label's text. |

In C++, `FPhoneWandControlValue::MakeBool`, `MakeNumber` and `MakeText` build one, and `ToString()`
gives `true`, `0.8`, `2` or the text.

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
| `PrimaryButton()` / `SecondaryButton()` | `primary` and `secondary`, the default layout's button ids. |
| `MakeButton(Id, Label)` | A button control. |
| `MakeToggle(Id, Label, bValue)` | A toggle control. |
| `MakeSlider(Id, Label, Value, bVertical, bSpring, Spring)` | A slider control. |
| `MakeChoice(Id, Options, Label, Index)` | A choice control. |
| `MakeLabel(Id, Label, Text)` | A label control. |
| `MakeDpad(Id, Label)` | A dpad: four arrow buttons, `<Id>.up`, `.down`, `.left`, `.right`. |
| `MakeCrawl(Id, Label)` | Crawl keys: six buttons, `<Id>.forward`, `.back`, `.step-left`, `.step-right`, `.turn-left`, `.turn-right`. |
| `DpadButton(ControlId, Direction)` | The button name of a dpad arrow (`EPhoneWandDpadDirection`: `Up`, `Down`, `Left`, `Right`), such as `move.up`. |
| `CrawlButton(ControlId, Direction)` | The button name of a crawl key (`EPhoneWandCrawlDirection`: `Forward`, `Back`, `StepLeft`, `StepRight`, `TurnLeft`, `TurnRight`), such as `walk.turn-left`. |
| `WithColour(Control, Colour)` | The control with a colour of its own. |
| `MakeLayout(Template, Controls)` | A layout. |
| `MakeRowsLayout(Rows, Controls, Heights)` | A `Rows` layout: controls per row, top to bottom, and relative heights (empty for equal). |
| `MakeColumnsLayout(Columns, Controls, Widths)` | A `Columns` layout: controls per column, left to right, and relative widths (empty for equal). |
| `DefaultLayout()` | The default layout. |
| `LayoutToJson(Layout)` | The layout as the JSON the relay receives, for logs. |
| `MakeControlBool` / `MakeControlNumber` / `MakeControlText` | Values for `SetControl`. |
| `TemplateToString(Template)` / `ControlValueToString(Value)` | Text for display. |
| `IsGestureButtonHeld(Gesture, Button)` | **Is Button Held (Gesture)**: true when the button was held as the gesture started. |
| `GestureToString(Gesture)` | A gesture's protocol name (`push`, `twist-left`, ...). |

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
| **Gestures** | on | Send this app `OnGesture` events. |
| **Gesture Threshold** | 7 | Acceleration in m/s² that starts a movement. Lower is more sensitive. |
| **Gesture Min Speed** | 0.35 | Peak speed in m/s a movement must reach. |
| **Gesture Flick Rate** | 250 | Turning speed in degrees per second that makes a flick. |
| **Gesture Twist Rate** | 360 | Roll speed in degrees per second that makes a twist. |

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
- a ripple when a player presses a button,
- an arrow at the edge of the screen, pointing the right way, when a player points off the screen,
- a line for each player who hasn't set up their aim yet ("Player 2, Bea: set up your aim on your
  phone"), since they have no cursor until they do,
- the join URL, the QR code (fetched from the relay's `qrUrl`) and a player list,
- the latest control change or gesture (with any held buttons), briefly, at the top of the screen,
  in the player's colour.

Press **L** to cycle every phone through three sample layouts: the default, a `primary-row` with a
Fire button, a Zoom toggle and a label, and a `grid` with every kind of control.

To run it: start the relay, open `PhoneWandDemo.uproject`, let it build, and press **Play**. Its
`.uproject` finds the plugin through `AdditionalPluginDirectories: ["../Plugins"]`, so keep
`PhoneWandDemo` and `Plugins` side by side, as they are in the zip and the repository. The demo
packages as it is (**Platforms**, **Mac** or **Windows**, **Package Project**).

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
| `PhoneWand.Layouts.Json` | The exact `layout` and `set` messages the plugin sends (every control type, including dpad and crawl), compared field by field with the protocol's shape, layouts read back from JSON, and the dpad and crawl button names. |
| `PhoneWand.Layouts.Client` | Layouts and control values from `player` and `control` messages (dpad and crawl controls kept, their direction buttons held and released), the default layout, and `error` going to `OnRelayError` or a warning. |
| `PhoneWand.Gestures.Configure` | The `configure` message: gesture sensitivity and `gestures: false`, alone and with smoothing, and what a reconnect sends. |
| `PhoneWand.Gestures.Client` | `gesture` messages to `OnGesture` (fields, frame conversion, sorted buttons, unknown gestures and players) and `accel` on poses. |
| `PhoneWand.Client.ConnectionLost` | Leave and disconnect events, partial player updates, sorting, and ignoring unknown messages. |
| `PhoneWand.Live.Relay` | Connects to a running relay and passes only if it sees the hello, joins, poses and stats. Skipped unless `PHONEWAND_LIVE_URL` (or `-PhoneWandLiveUrl=`) is set. |
| `PhoneWand.Live.Layouts` | Sends a layout through a running relay to a scripted phone, which presses a custom `fire` button and moves a slider; checks the events and held values, sets a label, checks an invalid layout fires `OnRelayError`, and resets the layout. Skipped unless `PHONEWAND_LAYOUT_LIVE_URL` (or `-PhoneWandLayoutLiveUrl=`) is set. |
| `PhoneWand.Live.Gestures` | A scripted phone flicks towards the screen while holding Primary through a running relay; passes when `OnGesture` gives a push with `primary` held and poses carry acceleration. Skipped unless `PHONEWAND_GESTURE_LIVE_URL` (or `-PhoneWandGestureLiveUrl=`) is set. |
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

To include the live layouts test, start a relay and the scripted phone in
`clients/unreal/Scripts/fake-phone.ts`, which joins over the relay's plain HTTP port:

```sh
bun scripts/build-assets.ts
bun packages/relay/src/main.ts --no-open --no-key --port 32443 --app-port 32480 --http-port 32080 --no-landing &
bun clients/unreal/Scripts/fake-phone.ts ws://127.0.0.1:32080/phone &
PHONEWAND_LAYOUT_LIVE_URL=ws://127.0.0.1:32480/app scripts/check-unreal.sh
```

For the live gestures test, use `clients/unreal/Scripts/gesture-phone.ts` the same way:

```sh
bun clients/unreal/Scripts/gesture-phone.ts ws://127.0.0.1:32080/phone &
PHONEWAND_GESTURE_LIVE_URL=ws://127.0.0.1:32480/app scripts/check-unreal.sh
```

To include the managed relay test, point it at the relay binaries (for example after
`bun scripts/dist.ts --only=relay,embed`, which builds them in `dist/embed`, laid out as
`phone-wand-relay/` expects):

```sh
PHONEWAND_RELAY_DIR=dist/embed scripts/check-unreal.sh
```

The tests find the conformance suite relative to the plugin (`clients/unreal/Plugins/PhoneWand` to
`conformance`). If the plugin lives elsewhere, set `PHONEWAND_CONFORMANCE_DIR` or pass
`-PhoneWandConformance=<dir>`.
