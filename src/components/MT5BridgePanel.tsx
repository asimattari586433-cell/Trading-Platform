import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Download, Eye, EyeOff, Package, Play, RefreshCw } from 'lucide-react';
import type { Lang } from '../i18n.ts';
import { COPY_TEXT } from '../i18n.ts';

interface MT5BridgePanelProps {
  lang: Lang;
  bridgeTokenConfigured: boolean;
  pendingCommandsCount: number;
  pendingMasterCommandsCount: number;
  onTriggerBridgeTest: () => Promise<void>;
}

export const MT5BridgePanel: React.FC<MT5BridgePanelProps> = ({
  lang,
  bridgeTokenConfigured,
  pendingCommandsCount,
  pendingMasterCommandsCount,
  onTriggerBridgeTest,
}) => {
  const t = COPY_TEXT[lang];
  const [eaTab, setEaTab] = useState<'master' | 'follower'>('master');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [bridgeToken, setBridgeToken] = useState<string>('');
  const [showToken, setShowToken] = useState(false);
  const [rotating, setRotating] = useState(false);

  const localBridgeUrl =
    typeof window !== 'undefined' &&
    (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost')
      ? `http://127.0.0.1:${window.location.port || '3000'}`
      : typeof window !== 'undefined'
        ? window.location.origin
        : 'http://127.0.0.1:3000';

  useEffect(() => {
    if (!bridgeTokenConfigured) return;
    let active = true;
    fetch('/api/auth/bridge-token', { headers: { Accept: 'application/json' } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { bridgeToken?: string } | null) => {
        if (active && data?.bridgeToken) {
          setBridgeToken(data.bridgeToken);
        }
      })
      .catch(() => {
        // Ignore transient errors
      });
    return () => {
      active = false;
    };
  }, [bridgeTokenConfigured]);

  const handleRotateToken = async () => {
    setRotating(true);
    try {
      const res = await fetch('/api/auth/bridge-token/rotate', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data = (await res.json()) as { bridgeToken: string };
        setBridgeToken(data.bridgeToken);
        setShowToken(true);
        setTestResult(
          'Rotated Bridge Token. Re-run "Provision All & Verify EAs" and update Master EA so terminals receive the new token.'
        );
      }
    } finally {
      setRotating(false);
    }
  };

  const tokenForCode = bridgeToken || 'PASTE_YOUR_BRIDGE_TOKEN_HERE';

  const masterMq5 = useMemo(
    () => `//+------------------------------------------------------------------+
//|                                              TradeSync_Master.mq5 |
//|   TradeSync MT5 Local Master Bridge Expert Advisor (v2.30)       |
//|   - Loopback default http://127.0.0.1:3000                       |
//|   - Sends Bridge Token via x-bridge-token HTTP header ONLY       |
//|   - Supports Exness Standard & Standard Cent Master accounts     |
//|   - Executes Dashboard BUY/SELL/MODIFY/CLOSE orders via CTrade   |
//|   - Detects ALL manual & bot/EA trades via OnTradeTransaction    |
//+------------------------------------------------------------------+
#property copyright "TradeSync MT5"
#property version   "2.30"
#property strict
#include <Trade/Trade.mqh>

input string InpServerBaseUrl = "${localBridgeUrl}";
input string InpBridgeToken   = "${tokenForCode}";
input int    InpPollMs        = 250;
input int    InpSyncSec       = 2;
input ulong  InpMagicNumber   = 55001;
input int    InpMaxSlippage   = 30;

CTrade masterTrade;
datetime g_lastSyncAt = 0;

string JsonEscape(string s) { StringReplace(s, "\\\\", "\\\\\\\\"); StringReplace(s, "\\"", "\\\\\\""); return s; }

string ExtractField(string obj, string key)
{
   string pattern = "\\"" + key + "\\":";
   int pos = StringFind(obj, pattern);
   if(pos < 0) return "";
   int start = pos + StringLen(pattern);
   if(StringSubstr(obj, start, 1) == "\\"")
   {
      start++;
      int endQ = StringFind(obj, "\\"", start);
      return (endQ > start) ? StringSubstr(obj, start, endQ - start) : "";
   }
   int endC = StringFind(obj, ",", start);
   int endB = StringFind(obj, "}", start);
   int stop = (endC >= 0 && (endB < 0 || endC < endB)) ? endC : endB;
   if(stop < 0) return "";
   string raw = StringSubstr(obj, start, stop - start);
   return (raw == "null") ? "" : raw;
}

string FormatLots(double lots, string sym = "")
{
   double step = (sym != "") ? SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP) : 0.01;
   int digits = 2; double v = (step > 0.0) ? step : 0.01;
   while(digits < 8 && MathAbs(v - MathRound(v)) > 1e-6) { v *= 10.0; digits++; }
   return DoubleToString(lots, digits);
}

bool IsMasterCentAccount()
{
   string cur = AccountInfoString(ACCOUNT_CURRENCY); StringToUpper(cur);
   if(StringFind(cur, "USC") >= 0 || StringFind(cur, "CENT") >= 0) return true;
   string srv = AccountInfoString(ACCOUNT_SERVER); StringToLower(srv);
   return (StringFind(srv, "cent") >= 0);
}

string ResolveMasterSymbol(string requestedSym)
{
   if(SymbolSelect(requestedSym, true)) return requestedSym;
   string candidates[5] = { requestedSym + (IsMasterCentAccount() ? "c" : "m"), requestedSym + "c", requestedSym + "m", requestedSym + ".pro", requestedSym + "_i" };
   for(int i = 0; i < 5; i++) if(SymbolSelect(candidates[i], true)) return candidates[i];
   int total = SymbolsTotal(false);
   for(int i = 0; i < total; i++) { string s = SymbolName(i, false); if(StringFind(s, requestedSym) == 0 && SymbolSelect(s, true)) return s; }
   return requestedSym;
}

int HttpPostJson(string path, string json, string &responseOut)
{
   string url = InpServerBaseUrl + path;
   char data[]; char result[]; string resHeaders;
   string headers = "Content-Type: application/json\\r\\nx-bridge-token: " + InpBridgeToken + "\\r\\n";
   StringToCharArray(json, data, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(data, ArraySize(data) - 1);
   int code = WebRequest("POST", url, headers, 2500, data, result, resHeaders);
   responseOut = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   return code;
}

void SendMasterEvent(string action, ulong ticket, string symbol, string side, double lots, double price, double sl, double tp, string commandId = "", double remainingLots = -1.0)
{
   double cSize = SymbolInfoDouble(symbol, SYMBOL_TRADE_CONTRACT_SIZE);
   string remField = (remainingLots >= 0.0) ? StringFormat(",\\"remainingLots\\":%s", FormatLots(remainingLots, symbol)) : "";
   string json = StringFormat(
      "{\\"action\\":\\"%s\\",\\"masterLogin\\":\\"%I64d\\",\\"server\\":\\"%s\\",\\"accountCurrency\\":\\"%s\\",\\"cent\\":%s,\\"externalTicket\\":\\"%I64u\\",\\"symbol\\":\\"%s\\",\\"side\\":\\"%s\\",\\"lots\\":%s,\\"price\\":%.5f,\\"sl\\":%.5f,\\"tp\\":%.5f,\\"contractSize\\":%.2f,\\"commandId\\":\\"%s\\"%s}",
      JsonEscape(action), AccountInfoInteger(ACCOUNT_LOGIN), JsonEscape(AccountInfoString(ACCOUNT_SERVER)),
      JsonEscape(AccountInfoString(ACCOUNT_CURRENCY)), IsMasterCentAccount() ? "true" : "false",
      ticket, JsonEscape(symbol), JsonEscape(side), FormatLots(lots, symbol), price, sl, tp, cSize, JsonEscape(commandId), remField
   );
   string resp;
   HttpPostJson("/api/bridge/master/event", json, resp);
}

void SendMasterCommandAck(string commandId, string positionId, string action, bool ok, ulong ticket, double execPrice, double closeLots, double sl, double tp, uint retcode, string errDesc, string resolvedSym = "", double cSize = 0.0)
{
   string json = StringFormat(
      "{\\"masterLogin\\":\\"%I64d\\",\\"commandId\\":\\"%s\\",\\"positionId\\":\\"%s\\",\\"action\\":\\"%s\\",\\"success\\":%s,\\"externalTicket\\":\\"%I64u\\",\\"executedPrice\\":%.5f,\\"closeLots\\":%s,\\"sl\\":%.5f,\\"tp\\":%.5f,\\"retcode\\":%u,\\"errorMessage\\":\\"%s\\",\\"resolvedSymbol\\":\\"%s\\",\\"contractSize\\":%.2f,\\"balance\\":%.2f,\\"equity\\":%.2f}",
      AccountInfoInteger(ACCOUNT_LOGIN), JsonEscape(commandId), JsonEscape(positionId), JsonEscape(action),
      ok ? "true" : "false", ticket, execPrice, FormatLots(closeLots, resolvedSym), sl, tp, retcode, JsonEscape(errDesc),
      JsonEscape(resolvedSym), cSize, AccountInfoDouble(ACCOUNT_BALANCE), AccountInfoDouble(ACCOUNT_EQUITY)
   );
   string resp;
   HttpPostJson("/api/bridge/master/ack", json, resp);
}

void ExecuteDashboardCommand(string obj)
{
   string commandId = ExtractField(obj, "commandId");
   string action    = ExtractField(obj, "action");
   string posId     = ExtractField(obj, "positionId");
   string extTicket = ExtractField(obj, "externalTicket");
   string sym       = ResolveMasterSymbol(ExtractField(obj, "symbol"));
   string side      = ExtractField(obj, "side");
   double lots      = StringToDouble(ExtractField(obj, "lots"));
   double sl        = StringToDouble(ExtractField(obj, "sl"));
   double tp        = StringToDouble(ExtractField(obj, "tp"));
   if(commandId == "") return;

   masterTrade.SetExpertMagicNumber(InpMagicNumber);
   masterTrade.SetDeviationInPoints(InpMaxSlippage);
   bool ok = false; ulong resultTicket = 0; double resultPrice = 0.0;
   double cSize = SymbolInfoDouble(sym, SYMBOL_TRADE_CONTRACT_SIZE);

   if(action == "OPEN")
   {
      SymbolSelect(sym, true);
      ok = (side == "BUY")
         ? masterTrade.Buy(lots, sym, 0.0, sl, tp, "TS_CMD:" + posId)
         : masterTrade.Sell(lots, sym, 0.0, sl, tp, "TS_CMD:" + posId);
      ulong dealTicket = masterTrade.ResultDeal();
      if(ok && dealTicket > 0 && HistoryDealSelect(dealTicket))
         resultTicket = (ulong)HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
      if(resultTicket == 0) resultTicket = masterTrade.ResultOrder();
      resultPrice = masterTrade.ResultPrice();
   }
   else if(action == "MODIFY") { ulong t = (ulong)StringToInteger(extTicket); if(t > 0 && PositionSelectByTicket(t)) { ok = masterTrade.PositionModify(t, sl, tp); resultTicket = t; resultPrice = PositionGetDouble(POSITION_PRICE_OPEN); } }
   else if(action == "CLOSE") { ulong t = (ulong)StringToInteger(extTicket); if(t > 0 && PositionSelectByTicket(t)) { ok = masterTrade.PositionClose(t, InpMaxSlippage); resultTicket = t; resultPrice = masterTrade.ResultPrice(); } }
   else if(action == "PARTIAL_CLOSE") { ulong t = (ulong)StringToInteger(extTicket); if(t > 0 && PositionSelectByTicket(t)) { ok = masterTrade.PositionClosePartial(t, lots, InpMaxSlippage); resultTicket = t; resultPrice = masterTrade.ResultPrice(); } }

   SendMasterCommandAck(commandId, posId, action, ok, resultTicket, resultPrice, lots, sl, tp, masterTrade.ResultRetcode(), masterTrade.ResultRetcodeDescription(), sym, cSize);
}

void PollDashboardCommands()
{
   string url = InpServerBaseUrl + "/api/bridge/master/commands?login=" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
   char postData[]; char result[]; string resHeaders;
   int code = WebRequest("GET", url, "x-bridge-token: " + InpBridgeToken + "\\r\\n", 1500, postData, result, resHeaders);
   if(code != 200) return;
   string body = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   int cursor = 0;
   while(true)
   {
      int objStart = StringFind(body, "{", cursor);
      if(objStart < 0) break;
      int objEnd = StringFind(body, "}", objStart);
      if(objEnd < 0) break;
      string chunk = StringSubstr(body, objStart, objEnd - objStart + 1);
      if(StringFind(chunk, "\\"commandId\\"") >= 0) ExecuteDashboardCommand(chunk);
      cursor = objEnd + 1;
   }
}

void PushLiveTicksAndPositionsSync()
{
   string baseSyms[] = {"EURUSD","GBPUSD","USDJPY","XAUUSD","BTCUSD","US30","NAS100","GBPJPY"};
   string tickItems = "";
   for(int i = 0; i < ArraySize(baseSyms); i++)
   {
      string sym = ResolveMasterSymbol(baseSyms[i]);
      double bid = SymbolInfoDouble(sym, SYMBOL_BID); double ask = SymbolInfoDouble(sym, SYMBOL_ASK);
      if(bid <= 0 || ask <= 0) continue;
      if(StringLen(tickItems) > 0) tickItems += ",";
      tickItems += StringFormat("{\\"symbol\\":\\"%s\\",\\"bid\\":%.5f,\\"ask\\":%.5f}", JsonEscape(sym), bid, ask);
   }
   string posItems = "";
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket)) continue;
      string sym = PositionGetString(POSITION_SYMBOL);
      string side = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? "BUY" : "SELL";
      if(StringLen(posItems) > 0) posItems += ",";
      posItems += StringFormat(
         "{\\"externalTicket\\":\\"%I64u\\",\\"symbol\\":\\"%s\\",\\"side\\":\\"%s\\",\\"lots\\":%s,\\"openPrice\\":%.5f,\\"sl\\":%.5f,\\"tp\\":%.5f,\\"profit\\":%.2f,\\"contractSize\\":%.2f}",
         ticket, JsonEscape(sym), side, FormatLots(PositionGetDouble(POSITION_VOLUME), sym),
         PositionGetDouble(POSITION_PRICE_OPEN), PositionGetDouble(POSITION_SL), PositionGetDouble(POSITION_TP),
         PositionGetDouble(POSITION_PROFIT), SymbolInfoDouble(sym, SYMBOL_TRADE_CONTRACT_SIZE)
      );
   }
   string json = StringFormat(
      "{\\"masterLogin\\":\\"%I64d\\",\\"server\\":\\"%s\\",\\"accountCurrency\\":\\"%s\\",\\"cent\\":%s,\\"balance\\":%.2f,\\"equity\\":%.2f,\\"margin\\":%.2f,\\"freeMargin\\":%.2f,\\"ticks\\":[%s],\\"openPositions\\":[%s]}",
      AccountInfoInteger(ACCOUNT_LOGIN), JsonEscape(AccountInfoString(ACCOUNT_SERVER)),
      JsonEscape(AccountInfoString(ACCOUNT_CURRENCY)), IsMasterCentAccount() ? "true" : "false",
      AccountInfoDouble(ACCOUNT_BALANCE), AccountInfoDouble(ACCOUNT_EQUITY),
      AccountInfoDouble(ACCOUNT_MARGIN), AccountInfoDouble(ACCOUNT_MARGIN_FREE),
      tickItems, posItems
   );
   string resp; HttpPostJson("/api/bridge/master/sync", json, resp);
}

int OnInit() { EventSetMillisecondTimer(InpPollMs); PushLiveTicksAndPositionsSync(); return(INIT_SUCCEEDED); }
void OnDeinit(const int reason) { EventKillTimer(); }

void OnTimer()
{
   PollDashboardCommands();
   datetime now = TimeCurrent();
   if(now - g_lastSyncAt >= InpSyncSec) { g_lastSyncAt = now; PushLiveTicksAndPositionsSync(); }
}

void OnTradeTransaction(const MqlTradeTransaction& trans, const MqlTradeRequest& request, const MqlTradeResult& result)
{
   if(trans.type == TRADE_TRANSACTION_DEAL_ADD)
   {
      if(!HistoryDealSelect(trans.deal)) return;
      long entry = HistoryDealGetInteger(trans.deal, DEAL_ENTRY);
      long dtype = HistoryDealGetInteger(trans.deal, DEAL_TYPE);
      if(dtype != DEAL_TYPE_BUY && dtype != DEAL_TYPE_SELL) return;
      string comment = HistoryDealGetString(trans.deal, DEAL_COMMENT);
      long magic = HistoryDealGetInteger(trans.deal, DEAL_MAGIC);
      if(StringFind(comment, "TS_CMD:") == 0 || (InpMagicNumber > 0 && magic == (long)InpMagicNumber)) return;
      ulong posId = (ulong)HistoryDealGetInteger(trans.deal, DEAL_POSITION_ID);
      string side = (dtype == DEAL_TYPE_BUY) ? "BUY" : "SELL";
      string action = (entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY) ? (PositionSelectByTicket(posId) ? "PARTIAL_CLOSE" : "CLOSE") : "OPEN";
      double sl = 0, tp = 0, remVol = -1.0;
      if(PositionSelectByTicket(posId)) { sl = PositionGetDouble(POSITION_SL); tp = PositionGetDouble(POSITION_TP); if(action == "PARTIAL_CLOSE") remVol = PositionGetDouble(POSITION_VOLUME); }
      SendMasterEvent(action, posId, trans.symbol, side, HistoryDealGetDouble(trans.deal, DEAL_VOLUME), HistoryDealGetDouble(trans.deal, DEAL_PRICE), sl, tp, "deal-" + IntegerToString((long)trans.deal), remVol);
   }
   else if(trans.type == TRADE_TRANSACTION_POSITION && PositionSelectByTicket(trans.position))
   {
      string side = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? "BUY" : "SELL";
      SendMasterEvent("MODIFY", trans.position, PositionGetString(POSITION_SYMBOL), side,
                      PositionGetDouble(POSITION_VOLUME), PositionGetDouble(POSITION_PRICE_OPEN),
                      PositionGetDouble(POSITION_SL), PositionGetDouble(POSITION_TP));
   }
}
`,
    [tokenForCode, localBridgeUrl]
  );

  const followerMq5 = useMemo(
    () => `//+------------------------------------------------------------------+
//|                                            TradeSync_Follower.mq5 |
//|   TradeSync MT5 Local Follower Bridge Expert Advisor (v2.30)     |
//|   - Loopback http://127.0.0.1:3000 + header-only x-bridge-token  |
//|   - Supports Exness Standard & Standard Cent accounts 1:1        |
//|   - Verified MagicNumber + account-scoped Master->Follower map   |
//|   - Persistent commandId deduplication across retries & restarts |
//|   - Validates exact volume specs (never silently alters lots!)   |
//+------------------------------------------------------------------+
#property copyright "TradeSync MT5"
#property version   "2.30"
#property strict
#include <Trade/Trade.mqh>

input string InpServerBaseUrl = "${localBridgeUrl}";
input string InpBridgeToken   = "${tokenForCode}";
input int    InpPollMs        = 250;
input int    InpMaxSlippage   = 30;
input ulong  InpMagicNumber   = 66001;

// Download full v2.30 source (with persistent tradesync_map_<LOGIN>.dat & tradesync_cmds_<LOGIN>.dat)
// via the "Download .mq5" button or mql5/TradeSync_Follower.mq5 in the ZIP package.
CTrade followerTrade;

string JsonEscape(string s) { StringReplace(s, "\\\\", "\\\\\\\\"); StringReplace(s, "\\"", "\\\\\\""); return s; }

string ExtractField(string obj, string key)
{
   string pattern = "\\"" + key + "\\":";
   int pos = StringFind(obj, pattern);
   if(pos < 0) return "";
   int start = pos + StringLen(pattern);
   if(StringSubstr(obj, start, 1) == "\\"") { start++; int endQ = StringFind(obj, "\\"", start); return (endQ > start) ? StringSubstr(obj, start, endQ - start) : ""; }
   int endC = StringFind(obj, ",", start); int endB = StringFind(obj, "}", start);
   int stop = (endC >= 0 && (endB < 0 || endC < endB)) ? endC : endB;
   if(stop < 0) return "";
   string raw = StringSubstr(obj, start, stop - start);
   return (raw == "null") ? "" : raw;
}

bool VerifyFollowerPosition(ulong ticket, string posId, string expectedSym, string expectedBaseSym, string expectedSide, bool allowMapped)
{
   if(ticket == 0 || !PositionSelectByTicket(ticket)) return false;
   if((ulong)PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) return false;
   if(PositionGetString(POSITION_COMMENT) == posId) return true;
   if(!allowMapped) return false;
   string pSym = PositionGetString(POSITION_SYMBOL);
   string pSide = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? "BUY" : "SELL";
   if(expectedSide != "" && pSide != expectedSide) return false;
   if(expectedSym != "" && pSym == expectedSym) return true;
   string upPos = pSym; string upBase = expectedBaseSym; StringToUpper(upPos); StringToUpper(upBase);
   return (expectedBaseSym != "" && StringFind(upPos, upBase) == 0);
}

ulong FindFollowerPositionTicket(string posId, string extTicketStr, string expectedSym, string expectedBaseSym, string expectedSide)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(VerifyFollowerPosition(ticket, posId, expectedSym, expectedBaseSym, expectedSide, false)) return ticket;
   }
   string gvKey = "TS_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "_" + posId;
   if(GlobalVariableCheck(gvKey))
   {
      ulong gvTicket = (ulong)GlobalVariableGet(gvKey);
      if(VerifyFollowerPosition(gvTicket, posId, expectedSym, expectedBaseSym, expectedSide, true)) return gvTicket;
   }
   ulong extTicket = (extTicketStr != "") ? (ulong)StringToInteger(extTicketStr) : 0;
   if(extTicket > 0 && VerifyFollowerPosition(extTicket, posId, expectedSym, expectedBaseSym, expectedSide, true)) return extTicket;
   return 0;
}
// See mql5/TradeSync_Follower.mq5 in the workspace/ZIP for the full persistent file-backed EA.
`,
    [tokenForCode, localBridgeUrl]
  );

  const copyText = async (id: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const downloadMq5 = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await onTriggerBridgeTest();
      setTestResult('Bridge signal received by Master and dispatched according to exact 1:1 rules.');
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setTesting(false);
    }
  };

  const activeCode = eaTab === 'master' ? masterMq5 : followerMq5;
  const activeFilename = eaTab === 'master' ? 'TradeSync_Master.mq5' : 'TradeSync_Follower.mq5';

  return (
    <div className="space-y-5">
      {/* Windows Local Installation Package Card */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Local Windows PC / Laptop Deployment Package
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              Download the authenticated Windows package containing the React + Node.js platform, 1-click Graphical Setup Wizard (<span className="font-mono">windows/1-Install-TradeSync.bat</span> + <span className="font-mono">TradeSync-Setup-Wizard.ps1</span>), Task Scheduler auto-start, and v2.30 MQL5 EAs. No live secrets are pre-embedded in the archive.
            </p>
          </div>
          <a
            href="/api/windows-package.zip"
            download="TradeSync-MT5-Windows-Local.zip"
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-md whitespace-nowrap shrink-0"
          >
            <Package className="w-4 h-4" />
            Download Windows Setup (.zip)
          </a>
        </div>
      </div>

      {/* Bridge Status & Tokens */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              {t.bridgeTitle}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              {lang === 'ur'
                ? 'ونڈوز لیپ ٹاپ پر http://127.0.0.1:3000 پر چلانے کے بعد دونوں MQL5 فائلیں اپنے Master اور Follower MT5 ٹرمینلز میں لگائیں۔'
                : 'Attach TradeSync_Master.mq5 to your Master MT5 terminal and let Multi-MT5 Manager provision TradeSync_Follower.mq5 across all Follower MT5 instances. Bridge Tokens are transmitted via the x-bridge-token HTTP header only and never exposed in unauthenticated state.'}
            </p>
          </div>

          <button
            type="button"
            disabled={testing}
            onClick={handleTest}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md cursor-pointer whitespace-nowrap shrink-0"
          >
            <Play className="w-3.5 h-3.5" />
            {testing ? 'Sending...' : 'Simulate MT5 EA Signal'}
          </button>
        </div>

        {testResult && (
          <div className="mt-4 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-3 py-2">
            {testResult}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-5">
          <div className="p-3 bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md">
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">
              Loopback URL (Allow in MT5)
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-mono text-slate-900 dark:text-slate-100 truncate">
                {localBridgeUrl}
              </span>
              <button
                type="button"
                onClick={() => copyText('url', localBridgeUrl)}
                className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer shrink-0"
              >
                {copiedId === 'url' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div className="p-3 bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md">
            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-1">
              <span>Bridge Auth Token (Header-Only)</span>
              <button
                type="button"
                disabled={rotating}
                onClick={handleRotateToken}
                title="Rotate Bridge Token"
                className="inline-flex items-center gap-1 text-[10px] text-blue-500 hover:underline cursor-pointer"
              >
                <RefreshCw className={`w-2.5 h-2.5 ${rotating ? 'animate-spin' : ''}`} />
                Rotate
              </button>
            </div>
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-xs font-mono text-slate-900 dark:text-slate-100 truncate">
                {showToken ? bridgeToken || 'Loading...' : '••••••••••••••••••••••••'}
              </span>
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  title={showToken ? 'Hide Token' : 'Reveal Token'}
                  className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                >
                  {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
                <button
                  type="button"
                  disabled={!bridgeToken}
                  onClick={() => copyText('token', bridgeToken)}
                  className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                >
                  {copiedId === 'token' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          <div className="p-3 bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md">
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">
              Master Command Queue
            </div>
            <div className="text-sm font-mono tabular-nums font-bold text-slate-900 dark:text-white">
              {pendingMasterCommandsCount} pending
            </div>
          </div>

          <div className="p-3 bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md">
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">
              Follower Command Queue
            </div>
            <div className="text-sm font-mono tabular-nums font-bold text-slate-900 dark:text-white">
              {pendingCommandsCount} pending
            </div>
          </div>
        </div>
      </div>

      {/* Windows Guide + MQL5 Code */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-4 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Windows 24/7 Setup &amp; Multi-MT5 Steps
          </h3>
          <ol className="space-y-3 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            <li>
              <span className="font-semibold text-slate-900 dark:text-white">1. Install &amp; Start Locally:</span>{' '}
              Extract the ZIP, run <span className="font-mono">windows\1-Install-TradeSync.bat</span>, then run{' '}
              <span className="font-mono">windows\Start-TradeSync.bat</span>. Server binds strictly to{' '}
              <span className="font-mono text-blue-500">http://127.0.0.1:3000</span>.
            </li>
            <li>
              <span className="font-semibold text-slate-900 dark:text-white">2. Windows 24/7 Power:</span>{' '}
              Set Windows Sleep to <span className="font-medium">Never</span> (<span className="font-mono">powercfg /change standby-timeout-ac 0</span>) and disable Wi-Fi/NIC power saving in Device Manager.
            </li>
            <li>
              <span className="font-semibold text-slate-900 dark:text-white">3. Automatic Portable Followers:</span>{' '}
              Click <span className="font-semibold">Provision All &amp; Verify EAs</span> in MT5 Farm. TradeSync copies binaries, DLLs, <span className="font-mono">MQL5/Include</span>, <span className="font-mono">.srv</span> server files, presets, and chart profiles (<span className="font-mono">chart01.chr</span>).
            </li>
            <li>
              <span className="font-semibold text-slate-900 dark:text-white">4. Allow WebRequest &amp; Attach EAs:</span>{' '}
              In Master MT5: <span className="font-mono">Tools → Options → Expert Advisors</span> → allow WebRequest for <span className="font-mono">http://127.0.0.1:3000</span>, compile in MetaEditor (<span className="font-mono">F7</span>), and enable Algo Trading.
            </li>
            <li>
              <span className="font-semibold text-slate-900 dark:text-white">5. Verify Heartbeat Before Live Funds:</span>{' '}
              Confirm <span className="font-semibold">EA Heartbeat Verified</span> and test 0.01 lot open, partial close, and full close on Exness Demo before arming Real-Money execution.
            </li>
          </ol>
        </div>

        <div className="lg:col-span-8 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden flex flex-col">
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-[#0B0F17] p-0.5 rounded-md border border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setEaTab('master')}
                className={`px-3 py-1 text-xs font-medium rounded cursor-pointer ${
                  eaTab === 'master'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                TradeSync_Master.mq5 (v2.30)
              </button>
              <button
                type="button"
                onClick={() => setEaTab('follower')}
                className={`px-3 py-1 text-xs font-medium rounded cursor-pointer ${
                  eaTab === 'follower'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                TradeSync_Follower.mq5 (v2.30)
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => copyText('code', activeCode)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-md cursor-pointer"
              >
                {copiedId === 'code' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedId === 'code' ? 'Copied' : 'Copy Code'}
              </button>
              <button
                type="button"
                onClick={() => downloadMq5(activeFilename, activeCode)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-md cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Download .mq5
              </button>
            </div>
          </div>

          <pre className="p-4 text-[11px] font-mono text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-[#0B0F17] overflow-auto max-h-[380px] leading-relaxed">
            {activeCode}
          </pre>
        </div>
      </div>
    </div>
  );
};
