// Phone Wand.app: a small native wrapper around the relay, so the relay behaves like a Mac app.
// It shows a Dock icon while the relay runs, offers Open Dashboard in its menus, reopens the
// dashboard when the Dock icon is clicked, and stops the relay on Quit. When the relay stops by
// itself (the dashboard's Stop relay button, or another relay taking over), the app quits too, so
// the Dock icon always tells you whether the relay is running.
//
// Built by scripts/dist.ts with swiftc; the relay itself sits beside it as phone-wand-relay.

import AppKit

let dashboardURL = URL(string: "http://127.0.0.1:8480/")!

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var relay: Process?
    // The relay's stdin. The relay stops when it closes, so it never outlives this app, even if
    // the app is force-quit.
    private var lifeline: Pipe?
    private var quitting = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.mainMenu = mainMenu()
        startRelay()
    }

    private func startRelay() {
        guard let exe = Bundle.main.url(forAuxiliaryExecutable: "phone-wand-relay") else {
            fail("The relay is missing from the app. Try downloading Phone Wand again.")
            return
        }
        let process = Process()
        process.executableURL = exe
        var env = ProcessInfo.processInfo.environment
        env["PHONE_WAND_APP"] = "1"
        process.environment = env
        let pipe = Pipe()
        process.standardInput = pipe
        process.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                guard let self = self, !self.quitting else { return }
                NSApp.terminate(nil)
            }
        }
        do {
            try process.run()
            relay = process
            lifeline = pipe
        } catch {
            fail("The relay could not start: \(error.localizedDescription)")
        }
    }

    private func fail(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Phone Wand could not start"
        alert.informativeText = message
        alert.alertStyle = .critical
        alert.runModal()
        NSApp.terminate(nil)
    }

    @objc func openDashboard(_ sender: Any?) {
        NSWorkspace.shared.open(dashboardURL)
    }

    @objc func openDocs(_ sender: Any?) {
        NSWorkspace.shared.open(URL(string: "https://github.com/wildwinter/phone-wand#readme")!)
    }

    @objc func openLog(_ sender: Any?) {
        let log = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/Phone Wand/relay.log")
        NSWorkspace.shared.open(log)
    }

    // Clicking the Dock icon while running brings the dashboard back.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        openDashboard(nil)
        return false
    }

    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Open Dashboard", action: #selector(openDashboard(_:)), keyEquivalent: ""))
        return menu
    }

    func applicationWillTerminate(_ notification: Notification) {
        quitting = true
        if let relay = relay, relay.isRunning {
            relay.terminate()
            relay.waitUntilExit()
        }
    }

    private func mainMenu() -> NSMenu {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let app = NSMenu(title: "Phone Wand")
        app.addItem(NSMenuItem(title: "About Phone Wand", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: ""))
        app.addItem(.separator())
        app.addItem(NSMenuItem(title: "Open Dashboard", action: #selector(openDashboard(_:)), keyEquivalent: "d"))
        app.addItem(NSMenuItem(title: "Show Log", action: #selector(openLog(_:)), keyEquivalent: "l"))
        app.addItem(NSMenuItem(title: "Documentation", action: #selector(openDocs(_:)), keyEquivalent: ""))
        app.addItem(.separator())
        app.addItem(NSMenuItem(title: "Hide Phone Wand", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"))
        app.addItem(.separator())
        app.addItem(NSMenuItem(title: "Quit Phone Wand (stops the relay)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        appItem.submenu = app
        return main
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
