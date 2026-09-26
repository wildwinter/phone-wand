// Phone Wand for Unity WebGL builds: the browser's WebSocket, polled from C# (WebGLTransport.cs).
// Each socket queues its events as strings: "o" (opened), "m<text>" (message), "c" (closed).

var PhoneWandLibrary = {
  $PhoneWandSockets: { next: 1, all: {} },

  PhoneWand_Open: function (urlPtr) {
    var url = UTF8ToString(urlPtr);
    var id = PhoneWandSockets.next++;
    var entry = { queue: [], ws: null };
    PhoneWandSockets.all[id] = entry;
    try {
      var ws = new WebSocket(url);
      entry.ws = ws;
      ws.onopen = function () { entry.queue.push("o"); };
      ws.onmessage = function (e) { if (typeof e.data === "string") entry.queue.push("m" + e.data); };
      ws.onclose = function () { entry.queue.push("c"); };
      ws.onerror = function () { /* onclose follows */ };
    } catch (e) {
      entry.queue.push("c");
    }
    return id;
  },

  PhoneWand_Send: function (id, textPtr) {
    var entry = PhoneWandSockets.all[id];
    if (entry && entry.ws && entry.ws.readyState === 1) entry.ws.send(UTF8ToString(textPtr));
  },

  PhoneWand_Close: function (id) {
    var entry = PhoneWandSockets.all[id];
    if (!entry) return;
    delete PhoneWandSockets.all[id];
    if (entry.ws) {
      entry.ws.onopen = entry.ws.onmessage = entry.ws.onclose = entry.ws.onerror = null;
      try { entry.ws.close(); } catch (e) {}
    }
  },

  PhoneWand_Poll: function (id) {
    var entry = PhoneWandSockets.all[id];
    if (!entry || entry.queue.length === 0) return 0;
    var text = entry.queue.shift();
    var size = lengthBytesUTF8(text) + 1;
    var buffer = _malloc(size);
    stringToUTF8(text, buffer, size);
    return buffer;
  }
};

autoAddDeps(PhoneWandLibrary, "$PhoneWandSockets");
mergeInto(LibraryManager.library, PhoneWandLibrary);
