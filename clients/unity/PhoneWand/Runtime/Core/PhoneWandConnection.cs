// Keeps a PhoneWandCore connected to a relay: opens a transport, reconnects with backoff
// (0.5 s doubling to 5 s, as the JavaScript client does), re-sends the smoothing setting on every
// connect, and hands received messages to the core. Nothing happens between calls to Pump(), so
// all events fire on the thread that calls Pump (Unity's main thread, from Update).

using System;
using System.Diagnostics;

namespace StoryTools.PhoneWand
{
    public sealed class PhoneWandConnection
    {
        const double FirstRetry = 0.5;
        const double MaxRetry = 5.0;

        readonly Stopwatch clock = Stopwatch.StartNew();
        ITransport transport;
        bool transportOpen;
        bool wanted;
        double retryDelay = FirstRetry;
        double nextAttempt = -1;

        /// <summary>The state and events. Subscribe to its events.</summary>
        public PhoneWandCore Core { get; }

        /// <summary>The relay's app endpoint. Takes effect on the next connect.</summary>
        public string Url { get; set; }

        /// <summary>Reconnect automatically when the relay goes away. Default true.</summary>
        public bool AutoReconnect { get; set; } = true;

        /// <summary>
        /// Smoothing sent to the relay each time the connection opens. Null (the default) keeps the
        /// relay's default. Setting it while connected sends it straight away.
        /// </summary>
        public Smoothing Smoothing
        {
            get { return smoothing; }
            set
            {
                smoothing = value;
                if (value != null && transportOpen) Core.Configure(value);
            }
        }
        Smoothing smoothing;

        /// <summary>Makes the transport for each connection attempt. Default: ClientWebSocketTransport.</summary>
        public Func<ITransport> TransportFactory { get; set; } = () => new ClientWebSocketTransport();

        /// <summary>True while a WebSocket to the relay is open (the hello may not have arrived yet).</summary>
        public bool IsOpen => transportOpen;

        public PhoneWandConnection(string url = PhoneWandCore.DefaultUrl, PhoneWandCore core = null)
        {
            Url = url ?? PhoneWandCore.DefaultUrl;
            Core = core ?? new PhoneWandCore();
            Core.Sender = text =>
            {
                if (transportOpen && transport != null) transport.Send(text);
            };
        }

        double Now => clock.Elapsed.TotalSeconds;

        /// <summary>Start connecting (and keep reconnecting, if AutoReconnect is on).</summary>
        public void Connect()
        {
            wanted = true;
            if (transport == null) OpenTransport();
        }

        /// <summary>
        /// Disconnect and stop reconnecting. PlayerLeft fires for every player and Disconnected
        /// fires (if the relay had said hello) before this returns.
        /// </summary>
        public void Close()
        {
            wanted = false;
            nextAttempt = -1;
            var t = transport;
            if (t == null) return;
            transport = null;
            transportOpen = false;
            t.Close();
            Core.HandleClosed();
        }

        /// <summary>
        /// Deliver everything received since the last call, and reconnect when due. Call it often
        /// (every frame). Events fire from inside this call.
        /// </summary>
        public void Pump()
        {
            if (transport == null && wanted && nextAttempt >= 0 && Now >= nextAttempt) OpenTransport();

            TransportEvent e;
            // Re-check the transport each time: a listener may call Close() or Connect().
            while (transport != null && transport.TryReceive(out e))
            {
                switch (e.Kind)
                {
                    case TransportEventKind.Opened:
                        transportOpen = true;
                        retryDelay = FirstRetry;
                        if (smoothing != null) Core.Configure(smoothing);
                        break;
                    case TransportEventKind.Message:
                        Core.Handle(e.Text);
                        break;
                    case TransportEventKind.Closed:
                        transport = null;
                        transportOpen = false;
                        Core.HandleClosed();
                        ScheduleReconnect();
                        break;
                }
            }
        }

        void OpenTransport()
        {
            nextAttempt = -1;
            ITransport t;
            try
            {
                t = TransportFactory();
                transport = t;
                transportOpen = false;
                t.Open(Url);
            }
            catch (Exception)
            {
                transport = null;
                transportOpen = false;
                ScheduleReconnect();
            }
        }

        void ScheduleReconnect()
        {
            if (!AutoReconnect || !wanted) return;
            nextAttempt = Now + retryDelay;
            retryDelay = Math.Min(retryDelay * 2, MaxRetry);
        }
    }
}
