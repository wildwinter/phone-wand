// Phone Wand.exe: a small Windows tray app around the relay, so it is obvious the relay is running.
// It shows an icon in the notification area while the relay runs, opens the dashboard when the
// icon is clicked, and stops the relay when it quits. When the relay stops by itself (the
// dashboard's Stop relay button, or another relay taking over), the tray app goes too.
//
// Built by scripts/dist.ts against .NET Framework 4.8, which every Windows 10 and 11 machine has, so
// it needs no runtime installing. The relay sits beside it as phone-wand-relay.exe.

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading;
using System.Windows.Forms;

static class Program
{
    public const string DashboardUrl = "http://127.0.0.1:8480/";
    public const string DocsUrl = "https://github.com/wildwinter/phone-wand#readme";

    public static string LogPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Phone Wand", "relay.log");

    [STAThread]
    static void Main()
    {
        using (var mutex = new Mutex(true, @"Local\PhoneWandTray", out bool first))
        {
            // Already running: starting it again just brings the dashboard back.
            if (!first)
            {
                Open(DashboardUrl);
                return;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new TrayContext());
        }
    }

    public static void Open(string target)
    {
        try
        {
            Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
        }
        catch (Exception e)
        {
            MessageBox.Show($"Could not open {target}:\n\n{e.Message}", "Phone Wand", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }
}

sealed class TrayContext : ApplicationContext
{
    private readonly NotifyIcon icon;
    private readonly Control ui = new Control();
    private Process relay;
    private bool quitting;

    public TrayContext()
    {
        ui.CreateControl(); // for marshalling the relay's exit back to this thread

        var menu = new ContextMenuStrip();
        var open = menu.Items.Add("Open Dashboard", null, (s, e) => Program.Open(Program.DashboardUrl));
        open.Font = new Font(open.Font, FontStyle.Bold);
        menu.Items.Add("Show Log", null, (s, e) => Program.Open(Program.LogPath));
        menu.Items.Add("Documentation", null, (s, e) => Program.Open(Program.DocsUrl));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Quit Phone Wand (stops the relay)", null, (s, e) => Quit());

        icon = new NotifyIcon
        {
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath),
            Text = "Phone Wand relay",
            ContextMenuStrip = menu,
            Visible = true,
        };
        icon.MouseClick += (s, e) =>
        {
            if (e.Button == MouseButtons.Left) Program.Open(Program.DashboardUrl);
        };

        StartRelay();
    }

    private void StartRelay()
    {
        var exe = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "phone-wand-relay.exe");
        if (!File.Exists(exe))
        {
            Fail("The relay, phone-wand-relay.exe, is missing. Keep it in the same folder as Phone Wand.exe.");
            return;
        }
        var start = new ProcessStartInfo(exe)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            // The relay's stdin is a lifeline: when this app goes, even if it is killed, the pipe
            // closes and the relay stops, so it never runs on invisibly.
            RedirectStandardInput = true,
            WorkingDirectory = AppDomain.CurrentDomain.BaseDirectory,
        };
        start.EnvironmentVariables["PHONE_WAND_APP"] = "1";
        relay = new Process { StartInfo = start, EnableRaisingEvents = true };
        relay.Exited += (s, e) => ui.BeginInvoke(new Action(OnRelayExited));
        try
        {
            relay.Start();
        }
        catch (Exception e)
        {
            Fail($"The relay could not start:\n\n{e.Message}");
            return;
        }
        icon.ShowBalloonTip(5000, "Phone Wand is running",
            "The dashboard is opening in your browser. Click the Phone Wand icon to open it again, or right-click it to quit.",
            ToolTipIcon.Info);
    }

    private void OnRelayExited()
    {
        if (quitting) return;
        if (relay.ExitCode != 0)
        {
            MessageBox.Show(
                $"The relay stopped with an error:\n\n{LogTail()}\n\nThe full log is in {Program.LogPath}",
                "Phone Wand", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        Exit();
    }

    private static string LogTail()
    {
        try
        {
            var lines = File.ReadAllLines(Program.LogPath).Where(l => l.Trim().Length > 0).ToArray();
            return string.Join("\n", lines.Skip(Math.Max(0, lines.Length - 6)));
        }
        catch
        {
            return "(no log)";
        }
    }

    private void Fail(string message)
    {
        MessageBox.Show(message, "Phone Wand could not start", MessageBoxButtons.OK, MessageBoxIcon.Error);
        icon.Visible = false;
        Environment.Exit(1);
    }

    private void Quit()
    {
        quitting = true;
        try
        {
            if (relay != null && !relay.HasExited)
            {
                relay.StandardInput.Close();
                if (!relay.WaitForExit(3000)) relay.Kill();
            }
        }
        catch
        {
            // already gone
        }
        Exit();
    }

    private void Exit()
    {
        icon.Visible = false;
        icon.Dispose();
        ExitThread();
    }
}
