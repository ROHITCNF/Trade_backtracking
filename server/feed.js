// Wraps the Fyers data socket. Lite mode gives {symbol, ltp} which is all the
// candle builder needs, and keeps bandwidth down across 39 symbols.

const { fyersDataSocket } = require("fyers-api-v3");
const path = require("path");

function startFeed({ token, symbols, onTick, onOpen, onClose, onError }) {
  const skt = fyersDataSocket.getInstance(
    token,
    path.join(__dirname, "..", "logs"),
    false,
  );
  console.log("feed", skt);

  skt.on("connect", () => {
    skt.subscribe(symbols);
    skt.mode(skt.LiteMode);
    onOpen?.();
  });

  skt.on("message", (msg) => {
    // Lite mode sends one symbol per message.
    console.log("message", msg);
    if (!msg || typeof msg.ltp !== "number" || !msg.symbol) return;
    // The feed does not always stamp a time; our own clock is close enough to
    // bucket a minute and is never missing.
    onTick(msg.symbol, msg.ltp, Math.floor(Date.now() / 1000));
  });

  skt.on("error", (e) => onError?.(e));
  skt.on("close", () => onClose?.());

  // The README documents autoReconnect(); the shipped SDK exposes autoreconnect().
  // Guarded so a rename degrades to "no auto-reconnect" instead of killing the run.
  if (typeof skt.autoreconnect === "function") skt.autoreconnect(10);
  else if (typeof skt.autoReconnect === "function") skt.autoReconnect(10);
  else console.log("  (no auto-reconnect method on this SDK version)");

  skt.connect();
  return skt;
}

module.exports = { startFeed };
