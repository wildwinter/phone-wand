// WebSocket transports. A transport opens one connection and queues what happens to it; the
// owner drains the queue on its own thread (Unity's main thread) with TryReceive. A transport is
// used for one connection attempt only: PhoneWandConnection makes a new one to reconnect.

using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace StoryTools.PhoneWand
{
    public enum TransportEventKind
    {
        Opened,
        Message,
        Closed,
    }

    public readonly struct TransportEvent
    {
        public TransportEventKind Kind { get; }
        /// <summary>The message text, for Message events.</summary>
        public string Text { get; }

        public TransportEvent(TransportEventKind kind, string text = null)
        {
            Kind = kind;
            Text = text;
        }
    }

    public interface ITransport
    {
        /// <summary>Start connecting. Opened (then Messages) or Closed follow through TryReceive.</summary>
        void Open(string url);
        /// <summary>Send a text message. Dropped when not open.</summary>
        void Send(string text);
        /// <summary>Close the connection. No further events need be delivered.</summary>
        void Close();
        /// <summary>Take the next queued event, if any.</summary>
        bool TryReceive(out TransportEvent e);
    }

    /// <summary>
    /// A transport on System.Net.WebSockets.ClientWebSocket. Works in the Unity editor, desktop
    /// and mobile players, and plain .NET. Not on WebGL (the Unity assembly uses the browser's
    /// WebSocket there). Receives on a background task.
    /// </summary>
    public sealed class ClientWebSocketTransport : ITransport
    {
        readonly ConcurrentQueue<TransportEvent> events = new ConcurrentQueue<TransportEvent>();
        readonly CancellationTokenSource cancel = new CancellationTokenSource();
        readonly object sendLock = new object();
        ClientWebSocket socket;
        Task sendChain = Task.CompletedTask;
        volatile bool open;
        int started;

        public void Open(string url)
        {
            if (Interlocked.Exchange(ref started, 1) != 0) throw new InvalidOperationException("A transport opens once.");
            Uri uri;
            try
            {
                uri = new Uri(url);
                socket = new ClientWebSocket();
            }
            catch (Exception)
            {
                events.Enqueue(new TransportEvent(TransportEventKind.Closed));
                return;
            }
            Task.Run(() => Run(uri));
        }

        async Task Run(Uri uri)
        {
            var ws = socket;
            try
            {
                await ws.ConnectAsync(uri, cancel.Token).ConfigureAwait(false);
                open = true;
                events.Enqueue(new TransportEvent(TransportEventKind.Opened));
                var buffer = new byte[16 * 1024];
                var message = new MemoryStream();
                while (!cancel.IsCancellationRequested && ws.State == WebSocketState.Open)
                {
                    var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), cancel.Token).ConfigureAwait(false);
                    if (result.MessageType == WebSocketMessageType.Close) break;
                    message.Write(buffer, 0, result.Count);
                    if (!result.EndOfMessage) continue;
                    if (result.MessageType == WebSocketMessageType.Text)
                    {
                        var text = Encoding.UTF8.GetString(message.GetBuffer(), 0, (int)message.Length);
                        events.Enqueue(new TransportEvent(TransportEventKind.Message, text));
                    }
                    message.SetLength(0);
                }
            }
            catch (Exception)
            {
                // Refused, dropped or cancelled: all end the same way.
            }
            finally
            {
                open = false;
                events.Enqueue(new TransportEvent(TransportEventKind.Closed));
                if (!cancel.IsCancellationRequested)
                {
                    try { ws.Abort(); } catch (Exception) { }
                }
            }
        }

        public void Send(string text)
        {
            if (!open || text == null) return;
            var bytes = new ArraySegment<byte>(Encoding.UTF8.GetBytes(text));
            var ws = socket;
            var token = cancel.Token;
            // ClientWebSocket allows one send at a time, so sends are chained.
            lock (sendLock)
            {
                sendChain = sendChain.ContinueWith(async _ =>
                {
                    try
                    {
                        if (ws.State == WebSocketState.Open)
                            await ws.SendAsync(bytes, WebSocketMessageType.Text, true, token).ConfigureAwait(false);
                    }
                    catch (Exception)
                    {
                        // The receive loop notices a dead socket and reports Closed.
                    }
                }, CancellationToken.None, TaskContinuationOptions.None, TaskScheduler.Default).Unwrap();
            }
        }

        public void Close()
        {
            var ws = socket;
            if (ws == null || cancel.IsCancellationRequested) return;
            if (open)
            {
                // A polite close frame, then stop waiting. Bounded so quitting is never held up.
                try { ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None).Wait(250); }
                catch (Exception) { }
            }
            open = false;
            try { cancel.Cancel(); } catch (Exception) { }
            try { ws.Abort(); } catch (Exception) { }
        }

        public bool TryReceive(out TransportEvent e) => events.TryDequeue(out e);
    }
}
