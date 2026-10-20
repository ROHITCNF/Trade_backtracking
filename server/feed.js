// Wraps the Fyers data socket. Only `symbol` and `ltp` are used, so lite and full
// mode both work — full just carries extra fields the candle builder ignores.
// Set DEBUG_TICKS=1 in .env to see every frame.

const { fyersDataSocket } = require("fyers-api-v3");
const path = require("path");

const DEBUG = process.env.DEBUG_TICKS === "1";

function startFeed({ token, symbols, onTick, onOpen, onClose, onError }) {
  const skt = fyersDataSocket.getInstance(
    token,
    path.join(__dirname, "..", "logs"),
    false,
  );
  if (DEBUG) console.log("feed", skt);

  skt.on("connect", () => {
    skt.subscribe(symbols);
    // skt.mode(skt.LiteMode);
    onOpen?.();
  });

  skt.on("message", (msg) => {
    if (DEBUG) console.log("message", msg);
    // Status frames (cn/sub/lit/cp/cr) carry no price; only 'sf' ticks do.
    if (!msg || typeof msg.ltp !== "number" || !msg.symbol) return;
    // Prefer the exchange's own timestamp. Outside market hours the feed replays
    // the last snapshot, and stamping that with Date.now() would invent a candle
    // at the current wall-clock minute.
    const ts = Number(msg.last_traded_time) || Math.floor(Date.now() / 1000);
    onTick(msg.symbol, msg.ltp, ts);
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
