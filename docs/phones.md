# Phones and certificates

## Why HTTPS

Browsers only let secure (HTTPS) pages read a phone's orientation. So the relay serves the phone page
over HTTPS, which needs a certificate. The relay makes its own, so there is nothing to set up, but
phones warn about it the first time.

## Options

| Option | Setup | Result |
|---|---|---|
| Accept the warning (default) | Tap through once per phone | Works everywhere. |
| Install the relay's certificate | Once per phone | No warnings. No domain needed. |
| Your own certificate | Once, for the rig | No warnings on any phone. Needs a domain, or mkcert. |
| Plain HTTP over USB | Per Android phone | For development only. |

Tunnelling services (ngrok, Cloudflare Tunnel) also avoid certificates, but they send every movement
through the internet, adding lag and a dependency. They aren't supported.

### Accept the warning

The QR code first opens a welcome page that tells players a warning is coming and which buttons to
tap, so they aren't alarmed by it. Then the browser says the connection isn't private:

- **Safari (iPhone, iPad):** tap **Show Details**, then **visit this website**, then **Visit Website**.
- **Chrome (Android):** tap **Advanced**, then **Proceed to ... (unsafe)**.

The phone remembers this for the relay's address. If the relay's computer gets a different address
on the network, phones are asked again.

Current Safari on iPhone keeps a live WebSocket connection after the warning has been accepted.
Some older versions refused one to a server whose certificate was only accepted this way; if a
browser does, the phone page notices and switches to plain HTTP requests on the same page, so it
still works. The dashboard shows which connection each phone is using ("WebSocket" or "HTTP
fallback").

### Install the relay's certificate

The relay keeps a small certificate authority of its own (in `~/.phone-wand/ca.crt.pem`) and signs
its certificate with it. Installing that authority on a phone makes the phone trust the relay
completely, with no warnings. Only do this on phones you own, for a relay you run.

**iPhone and iPad:**

1. Open the phone page, open **Seeing a security warning?** and tap **download it here** (or visit
   `https://<relay address>:8443/ca.crt`). Allow the download.
2. Open **Settings**. Tap **Profile Downloaded** near the top (or **General**, **VPN & Device
   Management**), then **Install**.
3. Go to **Settings**, **General**, **About**, **Certificate Trust Settings**, and turn on full trust
   for "Phone Wand local CA".

**Android:** download `ca.crt` the same way, then open **Settings**, search for **CA certificate**,
and install it from the downloaded file. The exact menu differs between phone makers.

To remove it later, delete the profile (iPhone) or the user certificate (Android). Deleting the
`~/.phone-wand` folder makes the relay create a new authority, which phones then need to install
again.

### Your own certificate

**A real certificate for a local name** suits a permanent installation. Point a name you own (for
example `rig.example.com`) at the rig computer's local address in DNS, get a certificate for it
with a DNS challenge (for example with Let's Encrypt and certbot's DNS plugins), and run:

```bash
phone-wand --host rig.example.com --tls-cert fullchain.pem --tls-key privkey.pem
```

No phone ever sees a warning. Renew the certificate before it expires (Let's Encrypt certificates
last 90 days).

**mkcert** makes locally trusted certificates. Run `mkcert -install`, then
`mkcert <relay address>`, and pass the two files with `--tls-cert` and `--tls-key`. Each phone still
needs mkcert's root certificate installed, as above.

### Android over USB

For development, an Android phone connected by USB can use plain HTTP:

```bash
phone-wand --http-port 8080
adb reverse tcp:8080 tcp:8080
```

Then open `http://localhost:8080/?k=<key>` on the phone (the key is in the join address the relay
prints). Browsers treat `localhost` as secure, so orientation works.

## iPhone and iPad notes

- iOS asks for motion access the first time you tap **Tap to start**. If you tap **Don't Allow**,
  close the tab and scan the code again. If it's still refused, clear the site's data in
  **Settings**, **Apps**, **Safari**, **Advanced**, **Website Data** and try again.
- iPhones don't let web pages vibrate, so haptic messages do nothing there.
- The page keeps the screen awake while it's open (iOS 16.4 and later).
- Switching to another app, or locking the phone, pauses the player. Coming back resumes it.
- For full screen without the browser bars, use **Share**, **Add to Home Screen**, and start from
  the icon.

## Android notes

- Chrome uses the phone's orientation sensor directly (`RelativeOrientationSensor`), which gives
  the smoothest data. Other browsers use device orientation events.
- Vibration works for button presses and for haptic messages from apps.

## Holding the phone

Hold the phone like a torch or a TV remote: screen facing up, top edge pointing at the screen. The
direction the top edge points is the cursor. Tilting the phone sideways (roll) doesn't move the
cursor; apps can read it separately.

## Troubleshooting

| Problem | Try |
|---|---|
| The page doesn't load | Check the phone is on the same Wi-Fi as the relay, and that the address in the QR code is the relay computer's address on that network (use `--host` if not). On Windows, check the firewall. |
| "Scan the QR code again" | The join key changed, or the link was typed by hand. Scan the code on the screen. |
| "The game is full" | All player slots are taken. Start the relay with `--max-players`. |
| "No motion data" | Motion access was refused, or the browser doesn't support it. On iPhone, see above. Private or in-app browsers may block it; open the link in Safari or Chrome. |
| The cursor drifts sideways over time | That's gyroscope drift. Press **Recentre** while pointing at the middle of the screen. |
| The cursor is offset from where you point | Calibrate the screen from where you're standing. See [Calibration](calibration.md). |
| The cursor stutters | Look at the dashboard's rate and round-trip time. Busy Wi-Fi causes lag spikes; a dedicated router fixes most of them. |
