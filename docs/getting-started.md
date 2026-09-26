# Getting started

This walks through running the relay, joining with a phone and connecting your own app.

## 1. Run the relay

Download the relay for the computer that drives your screen from the
[latest release](https://github.com/wildwinter/phone-wand/releases/latest):

| Computer | File |
|---|---|
| Mac with Apple silicon | `phone-wand-relay-<version>-macos-arm64.zip` |
| Intel Mac | `phone-wand-relay-<version>-macos-x64.zip` |
| Windows | `phone-wand-relay-<version>-windows-x64.zip` |
| Linux | `phone-wand-relay-<version>-linux-x64.tar.gz` or `-linux-arm64.tar.gz` |

Unzip it and run it:

- **macOS:** open Terminal in the folder and run `./phone-wand`, or double-click `phone-wand`.
- **Windows:** double-click `phone-wand.exe`. The first time, Windows SmartScreen may say it doesn't
  recognise the app: choose **More info**, then **Run anyway**. When Windows Firewall asks, allow
  access on **private networks**, or phones won't be able to connect.
- **Linux:** run `./phone-wand`.

The relay prints a QR code, the address phones use, and the dashboard address, then opens the
dashboard in your browser. Leave it running. Stop it with Ctrl+C.

The relay needs no installation and no internet connection. It keeps its certificates and settings
in a `.phone-wand` folder in your home folder.

## 2. Join with a phone

The phone must be on the **same network** as the relay's computer.

1. Scan the QR code, on the dashboard or in the terminal, with the phone's camera.
2. The first time, the browser warns that the connection isn't private, because the relay makes its
   own certificate. Continue anyway (Safari: **Show Details**, then **visit this website**; Chrome:
   **Advanced**, then **Proceed**). [Phones and certificates](phones.md) explains how to stop the
   warning for good.
3. Type a name if you like and tap **Tap to start**. On iPhone, allow motion access when asked.
4. Hold the phone like a torch, screen up, and point its top edge at the middle of the screen. Press
   **Recentre**.

Your cursor now appears on the dashboard's test screen. The **Primary** button is the big area in
the middle; **Secondary** is below it.

## 3. Calibrate to the screen

Recentre alone gives a cursor that crosses a 40 degree wide area. To make the cursor land exactly
where you point:

1. Make the dashboard's test screen full screen (press **F**), or run your own app full screen.
2. On the phone, press **Calibrate screen**.
3. Point at the top-left corner of the screen and tap, then the bottom-right corner and tap.

See [Calibration and precision](calibration.md) for more.

## 4. Connect your app

Pick your engine's client library:

- [JavaScript](clients/js.md), for the browser or Node
- [Unity](clients/unity.md)
- [Godot](clients/godot.md)
- [Unreal](clients/unreal.md)

Each connects to the relay at `ws://127.0.0.1:8480/app` by default and gives you players, their
cursor positions and pointing directions, and button events. Each comes with a sample that draws
coloured cursors.

The shortest possible app, in a web page on the same computer as the relay:

```html
<script src="http://127.0.0.1:8480/phone-wand.js"></script>
<script>
  const wand = new PhoneWand();
  wand.on("button", (e, player) => {
    if (e.down) console.log(`${player.name} pressed ${e.button} at`, player.pose?.screen);
  });
</script>
```

## Testing without phones

Run the relay with simulated players, which wander about and click now and then:

```bash
./phone-wand --simulate 3
```

See [Testing](testing.md) for recording real sessions and replaying them.
