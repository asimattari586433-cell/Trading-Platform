"""
TradeSync MT5 - 100% Free Official MetaTrader5 Python Local Bridge
------------------------------------------------------------------
Connects directly to your local Windows MT5 terminal using Login, Password & Server
via the free MetaQuotes MetaTrader5 Python package (no paid APIs, no cloud tokens).

Usage:
  python tradesync_mt5_python_bridge.py --role master --login 123456 --password "secret" --server "Exness-MT5Real12"
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

try:
    import MetaTrader5 as mt5
except ImportError:
    print("Missing MetaTrader5 package. Install with: pip install MetaTrader5")
    sys.exit(1)

DEFAULT_SERVER_URL = "http://127.0.0.1:3000"
DEFAULT_BRIDGE_TOKEN = "PASTE_YOUR_BRIDGE_TOKEN_HERE"
MAGIC_MASTER_CMD = 55001
MAGIC_FOLLOWER_CMD = 66001
WATCH_SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "BTCUSD", "US30", "NAS100", "GBPJPY"]


def http_json(method: str, url: str, token: str, payload=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    req.add_header("x-bridge-token", token)
    with urllib.request.urlopen(req, timeout=3.0) as resp:
        return json.loads(resp.read().decode("utf-8"))


def find_position_by_comment(comment: str):
    positions = mt5.positions_get()
    if not positions:
        return None
    for pos in positions:
        if pos.comment == comment:
            return pos
    return None


def find_position_by_ticket(ticket: int):
    positions = mt5.positions_get(ticket=ticket)
    if positions and len(positions) > 0:
        return positions[0]
    return None


def execute_mt5_order(cmd: dict, magic: int, use_comment_lookup: bool):
    action = cmd.get("action")
    symbol = cmd.get("symbol", "")
    side = cmd.get("side", "BUY")
    lots = float(cmd.get("lots") or 0.0)
    sl = float(cmd.get("sl") or 0.0)
    tp = float(cmd.get("tp") or 0.0)
    pos_id = cmd.get("positionId", "")
    ext_ticket_raw = cmd.get("externalTicket") or ""

    sym_info = mt5.symbol_info(symbol)
    if sym_info is not None and not sym_info.visible:
        mt5.symbol_select(symbol, True)

    tick = mt5.symbol_info_tick(symbol)
    filling = mt5.ORDER_FILLING_IOC

    if action == "OPEN":
        if use_comment_lookup:
            existing = find_position_by_comment(pos_id)
            if existing is not None:
                return True, existing.ticket, existing.price_open, 10009, "Already open"
        if tick is None:
            return False, 0, 0.0, 10018, f"No tick available for {symbol}"
        order_type = mt5.ORDER_TYPE_BUY if side == "BUY" else mt5.ORDER_TYPE_SELL
        price = tick.ask if side == "BUY" else tick.bid
        comment = pos_id if use_comment_lookup else f"TS_CMD:{pos_id}"
        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": lots,
            "type": order_type,
            "price": price,
            "sl": sl,
            "tp": tp,
            "deviation": 30,
            "magic": magic,
            "comment": comment[:31],
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": filling,
        }
        res = mt5.order_send(request)
        if res is None:
            return False, 0, 0.0, -1, str(mt5.last_error())
        ok = res.retcode in (mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_PLACED)
        return ok, int(res.order or 0), float(res.price or price), int(res.retcode), str(res.comment)

    pos = None
    if use_comment_lookup:
        pos = find_position_by_comment(pos_id)
    elif str(ext_ticket_raw).isdigit():
        pos = find_position_by_ticket(int(ext_ticket_raw))

    if pos is None:
        return False, 0, 0.0, 10036, "Position not found in MT5"

    if action == "MODIFY":
        res = mt5.order_send({
            "action": mt5.TRADE_ACTION_SLTP,
            "position": pos.ticket,
            "symbol": pos.symbol,
            "sl": sl,
            "tp": tp,
        })
        if res is None:
            return False, pos.ticket, pos.price_open, -1, str(mt5.last_error())
        ok = res.retcode == mt5.TRADE_RETCODE_DONE
        return ok, int(pos.ticket), float(pos.price_open), int(res.retcode), str(res.comment)

    if action in ("CLOSE", "PARTIAL_CLOSE"):
        if tick is None:
            tick = mt5.symbol_info_tick(pos.symbol)
        close_vol = pos.volume if action == "CLOSE" else min(pos.volume, lots)
        close_type = mt5.ORDER_TYPE_SELL if pos.type == mt5.POSITION_TYPE_BUY else mt5.ORDER_TYPE_BUY
        close_price = tick.bid if close_type == mt5.ORDER_TYPE_SELL else tick.ask
        res = mt5.order_send({
            "action": mt5.TRADE_ACTION_DEAL,
            "position": pos.ticket,
            "symbol": pos.symbol,
            "volume": close_vol,
            "type": close_type,
            "price": close_price,
            "deviation": 30,
            "magic": magic,
            "comment": "TradeSync Close",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": filling,
        })
        if res is None:
            return False, pos.ticket, 0.0, -1, str(mt5.last_error())
        ok = res.retcode == mt5.TRADE_RETCODE_DONE
        return ok, int(pos.ticket), float(res.price or close_price), int(res.retcode), str(res.comment)

    return False, 0, 0.0, -1, f"Unsupported action {action}"


def run_bridge(args):
    init_kwargs = {
        "login": int(args.login),
        "password": args.password,
        "server": args.server,
    }
    if args.terminal_path:
        init_kwargs["path"] = args.terminal_path

    print(f"[TradeSync Python Bridge] Initializing MT5 for {args.login} @ {args.server} ({args.role})...")
    if not mt5.initialize(**init_kwargs):
        print(f"[ERROR] mt5.initialize() failed: {mt5.last_error()}")
        sys.exit(1)

    info = mt5.account_info()
    if info is None:
        print(f"[ERROR] Could not read MT5 account info: {mt5.last_error()}")
        mt5.shutdown()
        sys.exit(1)

    print(f"[CONNECTED] MT5 Login {info.login} | Server: {info.server} | Balance: {info.balance:.2f} {info.currency}")
    base = args.url.rstrip("/")
    token = args.token
    last_sync = 0.0

    try:
        while True:
            acct = mt5.account_info()
            if acct is None:
                time.sleep(1.0)
                continue

            if args.role == "master":
                # 1) Poll dashboard commands targeted at Master MT5
                try:
                    resp = http_json("GET", f"{base}/api/bridge/master/commands?login={acct.login}", token)
                    for cmd in resp.get("commands", []):
                        ok, ticket, exec_price, retcode, err_desc = execute_mt5_order(cmd, MAGIC_MASTER_CMD, False)
                        http_json("POST", f"{base}/api/bridge/master/ack", token, {
                            "masterLogin": str(acct.login),
                            "commandId": cmd.get("commandId"),
                            "positionId": cmd.get("positionId"),
                            "action": cmd.get("action"),
                            "success": ok,
                            "externalTicket": str(ticket),
                            "executedPrice": exec_price,
                            "closeLots": cmd.get("lots", 0),
                            "sl": cmd.get("sl") or 0,
                            "tp": cmd.get("tp") or 0,
                            "retcode": retcode,
                            "errorMessage": err_desc,
                            "balance": acct.balance,
                            "equity": acct.equity,
                        })
                except Exception as exc:
                    print(f"[WARN] Master command poll error: {exc}")

                # 2) Periodic full position & live broker tick sync (every ~1.5s)
                now = time.time()
                if now - last_sync >= 1.5:
                    last_sync = now
                    ticks = []
                    for sym in WATCH_SYMBOLS:
                        t = mt5.symbol_info_tick(sym)
                        if t and t.bid > 0 and t.ask > 0:
                            ticks.append({"symbol": sym, "bid": t.bid, "ask": t.ask})
                    open_positions = []
                    for pos in (mt5.positions_get() or []):
                        open_positions.append({
                            "externalTicket": str(pos.ticket),
                            "symbol": pos.symbol,
                            "side": "BUY" if pos.type == mt5.POSITION_TYPE_BUY else "SELL",
                            "lots": pos.volume,
                            "openPrice": pos.price_open,
                            "sl": pos.sl,
                            "tp": pos.tp,
                            "profit": pos.profit,
                        })
                    try:
                        http_json("POST", f"{base}/api/bridge/master/sync", token, {
                            "token": token,
                            "masterLogin": str(acct.login),
                            "server": acct.server,
                            "balance": acct.balance,
                            "equity": acct.equity,
                            "margin": acct.margin,
                            "freeMargin": acct.margin_free,
                            "ticks": ticks,
                            "openPositions": open_positions,
                        })
                    except Exception as exc:
                        print(f"[WARN] Master sync error: {exc}")

            else:
                # Follower loop
                try:
                    positions_count = len(mt5.positions_get() or [])
                    url = (
                        f"{base}/api/bridge/slave/commands?login={acct.login}"
                        f"&balance={acct.balance:.2f}&equity={acct.equity:.2f}&openCount={positions_count}"
                    )
                    resp = http_json("GET", url, token)
                    for cmd in resp.get("commands", []):
                        ok, ticket, exec_price, retcode, err_desc = execute_mt5_order(cmd, MAGIC_FOLLOWER_CMD, True)
                        http_json("POST", f"{base}/api/bridge/slave/ack", token, {
                            "login": str(acct.login),
                            "commandId": cmd.get("commandId"),
                            "positionId": cmd.get("positionId"),
                            "action": cmd.get("action"),
                            "requestedLots": cmd.get("lots"),
                            "success": ok,
                            "externalTicket": str(ticket),
                            "executedPrice": exec_price,
                            "retcode": retcode,
                            "errorMessage": err_desc,
                            "balance": acct.balance,
                            "equity": acct.equity,
                        })
                except Exception as exc:
                    print(f"[WARN] Follower poll error: {exc}")

            time.sleep(0.25)
    except KeyboardInterrupt:
        print("\n[TradeSync Python Bridge] Stopped cleanly.")
    finally:
        mt5.shutdown()


def main():
    parser = argparse.ArgumentParser(description="TradeSync MT5 Free Local Python Bridge")
    parser.add_argument("--url", default=DEFAULT_SERVER_URL, help="TradeSync local server URL")
    parser.add_argument("--token", default=DEFAULT_BRIDGE_TOKEN, help="TradeSync Bridge Auth Token")
    parser.add_argument("--role", choices=["master", "follower"], help="Account role")
    parser.add_argument("--login", help="MT5 Login ID")
    parser.add_argument("--password", help="MT5 Trader Password")
    parser.add_argument("--server", help="MT5 Broker Server")
    parser.add_argument("--terminal-path", dest="terminal_path", default="", help="Optional path to terminal64.exe")
    args = parser.parse_args()

    if not args.role:
        args.role = input("Role (master / follower) [master]: ").strip().lower() or "master"
    if not args.login:
        args.login = input("MT5 Login ID: ").strip()
    if not args.password:
        args.password = input("MT5 Trader Password: ").strip()
    if not args.server:
        args.server = input("MT5 Broker Server (e.g. Exness-MT5Real12): ").strip()
    if not args.terminal_path:
        path_in = input("MT5 terminal64.exe Path (Enter for default): ").strip()
        if path_in:
            args.terminal_path = path_in

    run_bridge(args)


if __name__ == "__main__":
    main()
