// The transport for WebGL builds, where System.Net.WebSockets is unavailable: it drives the
// browser's own WebSocket through Runtime/Plugins/WebGL/PhoneWand.jslib. The browser queues
// events in JavaScript and Poll() collects them each frame, so no callbacks cross into C#.

#if UNITY_WEBGL && !UNITY_EDITOR
using System.Runtime.InteropServices;

namespace StoryTools.PhoneWand
{
    public sealed class WebGLTransport : ITransport
    {
        [DllImport("__Internal")] static extern int PhoneWand_Open(string url);
        [DllImport("__Internal")] static extern void PhoneWand_Send(int id, string text);
        [DllImport("__Internal")] static extern void PhoneWand_Close(int id);
        [DllImport("__Internal")] static extern string PhoneWand_Poll(int id);

        int id;

        public void Open(string url)
        {
            id = PhoneWand_Open(url);
        }

        public void Send(string text)
        {
            if (id != 0 && text != null) PhoneWand_Send(id, text);
        }

        public void Close()
        {
            if (id == 0) return;
            PhoneWand_Close(id);
            id = 0;
        }

        public bool TryReceive(out TransportEvent e)
        {
            e = default(TransportEvent);
            if (id == 0) return false;
            string s = PhoneWand_Poll(id);
            if (string.IsNullOrEmpty(s)) return false;
            switch (s[0])
            {
                case 'o': e = new TransportEvent(TransportEventKind.Opened); return true;
                case 'm': e = new TransportEvent(TransportEventKind.Message, s.Substring(1)); return true;
                default: e = new TransportEvent(TransportEventKind.Closed); return true;
            }
        }
    }
}
#endif
