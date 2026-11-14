# TradeSync MT5 — Portable Windows Setup, Multi-MT5 Farm & PC Migration Guide

Run the complete TradeSync MT5 copy-trading platform **100% free and locally** on your Windows 10/11 PC or laptop at **`http://127.0.0.1:3000`** with zero paid cloud APIs or subscriptions. On first launch, create your **Operator Password** to lock local APIs, WebSocket streams, and MT5 Farm controls.

---

## 1. Graphical One-Click Installation (`windows\1-Install-TradeSync.bat`)
1. Extract the TradeSync ZIP package to a permanent folder (e.g., `C:\TradeSyncMT5\`).
2. Double-click **`windows\1-Install-TradeSync.bat`** to open the **Graphical Setup Wizard (`TradeSync-Setup-Wizard.ps1`)**.
   *(Or run `windows\1-Install-TradeSync.bat /cli` for console-only mode.)*
3. The Setup Wizard automatically:
   - Checks Windows version, CPU cores, free RAM, disk space, and safe concurrent MT5 capacity (~165 MB RAM per terminal)
   - Verifies **Node.js LTS** (with one-click `winget` install button if missing)
   - Detects installed **MetaTrader 5** folders (or opens the official MetaTrader 5 / Exness download page)
   - Installs dependencies (`npm install`) and builds the production dashboard (`npm run build`)
   - Creates **Desktop & Start Menu shortcuts** (`TradeSync MT5`, `Stop TradeSync`, `Uninstall TradeSync`)
   - Optionally registers **Task Scheduler** auto-start (`--headless`) and configures **24/7 AC Power Sleep = Never**
   - Starts TradeSync bound to `127.0.0.1` and opens **`http://127.0.0.1:3000`**

### Management Scripts
- **`windows\Start-TradeSync.bat`** — Starts server bound to `127.0.0.1:3000` with automatic crash recovery and opens `http://127.0.0.1:3000` (use `--headless` for background boot).
- **`windows\Stop-TradeSync.bat`** — Cleanly stops the backend and supervisor.
- **`windows\Update-TradeSync.bat`** — Safe in-place update preserving `data\`, `data\vault\`, `data\mt5-instances\`, and `.env`.
- **`windows\Uninstall-TradeSync.bat`** — Stops server, removes scheduled task and shortcuts, and prompts before deleting saved data/vault files.

---

## 2. Standard & Standard Cent Accounts — Exact 1:1 Lot Copying
TradeSync strictly preserves exact numerical lot sizes across **Standard** (`USD`, `XAUUSD`) and **Standard Cent** (`USC`, `XAUUSDc`) accounts unless you explicitly configure a different rule:
- Master `XAUUSD` **BUY 0.01** → Cent Follower `XAUUSDc` **BUY 0.01**
- Master `XAUUSD` **BUY 0.10** → Cent Follower `XAUUSDc` **BUY 0.10**
- Master `XAUUSDc` **SELL 0.05** → Standard Follower `XAUUSD` **SELL 0.05**

### Broker Symbol Mapping & Exact Volume Protection
- `TradeSync_Follower.mq5` (**v2.30**) automatically resolves broker-specific symbol suffixes (`c`, `m`, `.c`, `.pro`, `.raw`, `_i`), uses header-only `x-bridge-token` auth, and persists account-scoped Master→Follower mappings (`MQL5/Files/tradesync_map_<LOGIN>.dat`) plus executed command IDs (`tradesync_cmds_<LOGIN>.dat`) so unrelated manual tickets are never touched and retries never duplicate orders.
- Before executing, the EA verifies `SYMBOL_TRADE_MODE`, `SYMBOL_VOLUME_MIN`, `SYMBOL_VOLUME_MAX`, and `SYMBOL_VOLUME_STEP`.
- If a broker rejects an exact requested lot size, TradeSync reports the **actual broker retcode/error** without silently rescaling your lot.
- When Standard ↔ Cent or differing contract sizes are detected, a non-blocking exposure warning is logged while keeping your **1:1** volume intact.

---

## 3. Automatic Multi-MT5 Follower Manager (How Retail MT5 Works)
Standard retail Exness MT5 accounts require local `terminal64.exe` sessions to hold active trade connections—TradeSync **does not falsely claim** terminal-free retail MT5 execution. Instead, the **MT5 Farm** tab automates the entire multi-terminal lifecycle:
1. **Individual or Bulk CSV Import**: Add Follower accounts directly from the UI or CSV (`login,password,server,mode,lotMultiplier,tier`).
2. **Windows DPAPI Credential Vault**: Passwords are encrypted immediately using `.NET ProtectedData::Protect (CurrentUser)` into `data\vault\`. Passwords are never saved in plaintext `.ini` files, logs, or PC migration exports. Temporary startup `.ini` files are zero-filled and shredded ~12 seconds after MT5 launch.
3. **One-Click Provisioning**: Click **Provision All & Verify EAs** to create isolated `data\mt5-instances\follower_<login>\` directories containing MT5 binaries, DLLs, `MQL5/Include`, broker `.srv` configs, `config/common.ini`, `TradeSync_Follower.set` preset, Default `chart01.chr` auto-attach profile, and compiled `.ex5` via `metaeditor64.exe`.
4. **Controlled Batch Startup**: **Start All Followers** launches minimized `/portable` terminals in batches (default `3` concurrent starts, `1800ms` delay) so 20–50 terminals never freeze CPU/logins.
5. **Auto-Reconnect & Crash Recovery**: Monitors exited follower PIDs, tracks live `EA Heartbeat Verified` status, and safely restarts crashed terminals with persistent account-scoped mapping & command-ID deduplication.

---

## 4. Moving to Another Windows PC
1. On your old PC, open **MT5 Farm → Export PC Config (.json)** (`GET /api/config/export`).
   - Exports account logins, servers, Standard/Cent tiers, symbol mappings, and risk rules.
   - **Zero passwords, DPAPI blobs, password hashes, or Bridge Tokens** are exported.
2. Install TradeSync on the new Windows PC via `windows\1-Install-TradeSync.bat`.
3. Open **MT5 Farm → Import Config Bundle** and select `tradesync-pc-migration.json`.
   - Real-money execution stays **LOCKED** automatically.
4. Click **Enter Password** on each imported account to encrypt passwords into the new PC's Windows DPAPI Vault, then click **Provision All & Verify EAs**.

---

## 5. Recommended Exness Demo Verification Sequence (1 → 5 → 10 → 20+ Accounts)
Complete every Demo check before unlocking **Real-Money Execution**:
1. **Stage 1 (1 Master + 1 Cent Follower)**: Verify `XAUUSD` `0.01` BUY on Standard Master copies to `XAUUSDc` `0.01` BUY on Cent Follower (and vice versa `0.05` `XAUUSDc` → `0.05` `XAUUSD`), plus SL/TP modify, 50% partial close, full close, and Dashboard direct BUY/SELL.
2. **Stage 2 (5 Followers)**: Import 5 Exness Demo Followers (mixed Standard & Cent), run **Provision All**, then **Start All Followers** and check RAM/CPU telemetry in **MT5 Farm**.
3. **Stage 3 (10–20+ Followers)**: Scale gradually according to your host RAM (~165 MB per terminal; 16 GB RAM comfortably hosts ~35–50 terminals depending on background apps). Test **Restart All** during open positions to confirm zero duplicate orders.
4. Only after Demo stages pass cleanly, toggle **Real-Money Execution Armed** when ready for live trading.
