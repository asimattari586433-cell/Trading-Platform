//+------------------------------------------------------------------+
//|                                              TradeSync_Master.mq5 |
//|   TradeSync MT5 Local Master Bridge Expert Advisor (v2.30)       |
//|   - Loopback default http://127.0.0.1:3000                       |
//|   - Sends Bridge Token via x-bridge-token HTTP header ONLY       |
//|   - Supports Exness Standard & Standard Cent Master accounts     |
//|   - Executes Dashboard BUY/SELL/MODIFY/CLOSE orders via CTrade   |
//|   - Detects ALL manual & bot/EA trades via OnTradeTransaction    |
//|   - Streams live broker ticks, contractSize & equity sync        |
//+------------------------------------------------------------------+
#property copyright "TradeSync MT5"
#property version   "2.30"
#property strict
#include <Trade/Trade.mqh>

input string InpServerBaseUrl = "http://127.0.0.1:3000";
input string InpBridgeToken   = "PASTE_YOUR_BRIDGE_TOKEN_HERE";
input int    InpPollMs        = 250;
input int    InpSyncSec       = 2;
input ulong  InpMagicNumber   = 55001;
input int    InpMaxSlippage   = 30;

CTrade masterTrade;
datetime g_lastSyncAt = 0;

string JsonEscape(string s)
{
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   StringReplace(s, "\r", " ");
   StringReplace(s, "\n", " ");
   return s;
}

string ExtractField(string obj, string key)
{
   string pattern = "\"" + key + "\":";
   int pos = StringFind(obj, pattern);
   if(pos < 0) return "";
   int start = pos + StringLen(pattern);
   if(StringSubstr(obj, start, 1) == "\"")
   {
      start++;
      int endQ = StringFind(obj, "\"", start);
      return (endQ > start) ? StringSubstr(obj, start, endQ - start) : "";
   }
   int endC = StringFind(obj, ",", start);
   int endB = StringFind(obj, "}", start);
   int stop = (endC >= 0 && (endB < 0 || endC < endB)) ? endC : endB;
   if(stop < 0) return "";
   string raw = StringSubstr(obj, start, stop - start);
   return (raw == "null") ? "" : raw;
}

int VolumeDigits(string sym)
{
   double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   if(step <= 0.0) return 2;
   int digits = 0;
   double v = step;
   while(digits < 8 && MathAbs(v - MathRound(v)) > 1e-6)
   {
      v *= 10.0;
      digits++;
   }
   return MathMax(2, digits);
}

string FormatLots(double lots, string sym = "")
{
   int d = (sym != "") ? VolumeDigits(sym) : 4;
   string s = DoubleToString(lots, d);
   while(StringLen(s) > 0 && StringFind(s, ".") >= 0)
   {
      int len = StringLen(s);
      int dot = StringFind(s, ".");
      if(len - dot <= 3) break;
      if(StringSubstr(s, len - 1, 1) == "0")
         s = StringSubstr(s, 0, len - 1);
      else
         break;
   }
   return s;
}

bool IsMasterCentAccount()
{
   string cur = AccountInfoString(ACCOUNT_CURRENCY);
   StringToUpper(cur);
   if(StringFind(cur, "USC") >= 0 || StringFind(cur, "CENT") >= 0) return true;
   string srv = AccountInfoString(ACCOUNT_SERVER);
   StringToLower(srv);
   return (StringFind(srv, "cent") >= 0);
}

string ResolveMasterSymbol(string requestedSym)
{
   if(SymbolSelect(requestedSym, true)) return requestedSym;
   string candidates[5] = {
      requestedSym + (IsMasterCentAccount() ? "c" : "m"),
      requestedSym + "c",
      requestedSym + "m",
      requestedSym + ".pro",
      requestedSym + "_i"
   };
   for(int i = 0; i < 5; i++)
   {
      if(SymbolSelect(candidates[i], true)) return candidates[i];
   }
   int total = SymbolsTotal(false);
   for(int i = 0; i < total; i++)
   {
      string s = SymbolName(i, false);
      if(StringFind(s, requestedSym) == 0 && SymbolSelect(s, true)) return s;
   }
   return requestedSym;
}

int HttpPostJson(string path, string json, string &responseOut)
{
   string url = InpServerBaseUrl + path;
   char data[];
   char result[];
   string resHeaders;
   string headers = "Content-Type: application/json\r\nx-bridge-token: " + InpBridgeToken + "\r\n";
   StringToCharArray(json, data, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(data, ArraySize(data) - 1);
   int code = WebRequest("POST", url, headers, 2500, data, result, resHeaders);
   responseOut = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   return code;
}

void SendMasterEvent(string action, ulong ticket, string symbol, string side, double lots, double price, double sl, double tp, string commandId = "", double remainingLots = -1.0)
{
   double cSize = SymbolInfoDouble(symbol, SYMBOL_TRADE_CONTRACT_SIZE);
   string remField = (remainingLots >= 0.0) ? StringFormat(",\"remainingLots\":%s", FormatLots(remainingLots, symbol)) : "";
   string json = StringFormat(
      "{\"action\":\"%s\",\"masterLogin\":\"%I64d\",\"server\":\"%s\",\"accountCurrency\":\"%s\",\"cent\":%s,\"externalTicket\":\"%I64u\",\"symbol\":\"%s\",\"side\":\"%s\",\"lots\":%s,\"price\":%.5f,\"sl\":%.5f,\"tp\":%.5f,\"contractSize\":%.2f,\"commandId\":\"%s\"%s}",
      JsonEscape(action), AccountInfoInteger(ACCOUNT_LOGIN), JsonEscape(AccountInfoString(ACCOUNT_SERVER)),
      JsonEscape(AccountInfoString(ACCOUNT_CURRENCY)), IsMasterCentAccount() ? "true" : "false",
      ticket, JsonEscape(symbol), JsonEscape(side), FormatLots(lots, symbol), price, sl, tp, cSize, JsonEscape(commandId), remField
   );
   string resp;
   int code = HttpPostJson("/api/bridge/master/event", json, resp);
   if(code < 200 || code >= 300)
      Print("TradeSync Master event error HTTP=", code, " lastErr=", GetLastError());
}

void SendMasterCommandAck(string commandId, string positionId, string action, bool ok, ulong ticket, double execPrice, double closeLots, double sl, double tp, uint retcode, string errDesc, string resolvedSym = "", double cSize = 0.0)
{
   string json = StringFormat(
      "{\"masterLogin\":\"%I64d\",\"commandId\":\"%s\",\"positionId\":\"%s\",\"action\":\"%s\",\"success\":%s,\"externalTicket\":\"%I64u\",\"executedPrice\":%.5f,\"closeLots\":%s,\"sl\":%.5f,\"tp\":%.5f,\"retcode\":%u,\"errorMessage\":\"%s\",\"resolvedSymbol\":\"%s\",\"contractSize\":%.2f,\"balance\":%.2f,\"equity\":%.2f}",
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

   bool ok = false;
   ulong resultTicket = 0;
   double resultPrice = 0.0;
   double cSize = SymbolInfoDouble(sym, SYMBOL_TRADE_CONTRACT_SIZE);

   if(action == "OPEN")
   {
      SymbolSelect(sym, true);
      string commentTag = "TS_CMD:" + posId;
      ok = (side == "BUY")
         ? masterTrade.Buy(lots, sym, 0.0, sl, tp, commentTag)
         : masterTrade.Sell(lots, sym, 0.0, sl, tp, commentTag);

      ulong dealTicket = masterTrade.ResultDeal();
      if(ok && dealTicket > 0 && HistoryDealSelect(dealTicket))
         resultTicket = (ulong)HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
      if(resultTicket == 0) resultTicket = masterTrade.ResultOrder();
      resultPrice = masterTrade.ResultPrice();
   }
   else if(action == "MODIFY")
   {
      ulong ticket = (ulong)StringToInteger(extTicket);
      if(ticket > 0 && PositionSelectByTicket(ticket))
      {
         ok = masterTrade.PositionModify(ticket, sl, tp);
         resultTicket = ticket;
         resultPrice = PositionGetDouble(POSITION_PRICE_OPEN);
      }
   }
   else if(action == "CLOSE")
   {
      ulong ticket = (ulong)StringToInteger(extTicket);
      if(ticket > 0 && PositionSelectByTicket(ticket))
      {
         ok = masterTrade.PositionClose(ticket, InpMaxSlippage);
         resultTicket = ticket;
         resultPrice = masterTrade.ResultPrice();
      }
   }
   else if(action == "PARTIAL_CLOSE")
   {
      ulong ticket = (ulong)StringToInteger(extTicket);
      if(ticket > 0 && PositionSelectByTicket(ticket))
      {
         ok = masterTrade.PositionClosePartial(ticket, lots, InpMaxSlippage);
         resultTicket = ticket;
         resultPrice = masterTrade.ResultPrice();
      }
   }

   uint retcode = masterTrade.ResultRetcode();
   string errDesc = masterTrade.ResultRetcodeDescription();
   SendMasterCommandAck(commandId, posId, action, ok, resultTicket, resultPrice, lots, sl, tp, retcode, errDesc, sym, cSize);
}

void PollDashboardCommands()
{
   string url = InpServerBaseUrl + "/api/bridge/master/commands?login=" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
   char postData[];
   char result[];
   string resHeaders;
   int code = WebRequest("GET", url, "x-bridge-token: " + InpBridgeToken + "\r\n", 1500, postData, result, resHeaders);
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
      if(StringFind(chunk, "\"commandId\"") >= 0) ExecuteDashboardCommand(chunk);
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
      double bid = SymbolInfoDouble(sym, SYMBOL_BID);
      double ask = SymbolInfoDouble(sym, SYMBOL_ASK);
      if(bid <= 0 || ask <= 0) continue;
      if(StringLen(tickItems) > 0) tickItems += ",";
      tickItems += StringFormat("{\"symbol\":\"%s\",\"bid\":%.5f,\"ask\":%.5f}", JsonEscape(sym), bid, ask);
   }

   string posItems = "";
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket)) continue;
      string sym = PositionGetString(POSITION_SYMBOL);
      string side = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? "BUY" : "SELL";
      double vol = PositionGetDouble(POSITION_VOLUME);
      double openP = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl = PositionGetDouble(POSITION_SL);
      double tp = PositionGetDouble(POSITION_TP);
      double profit = PositionGetDouble(POSITION_PROFIT);
      double cSize = SymbolInfoDouble(sym, SYMBOL_TRADE_CONTRACT_SIZE);
      if(StringLen(posItems) > 0) posItems += ",";
      posItems += StringFormat(
         "{\"externalTicket\":\"%I64u\",\"symbol\":\"%s\",\"side\":\"%s\",\"lots\":%s,\"openPrice\":%.5f,\"sl\":%.5f,\"tp\":%.5f,\"profit\":%.2f,\"contractSize\":%.2f}",
         ticket, JsonEscape(sym), side, FormatLots(vol, sym), openP, sl, tp, profit, cSize
      );
   }

   string json = StringFormat(
      "{\"masterLogin\":\"%I64d\",\"server\":\"%s\",\"accountCurrency\":\"%s\",\"cent\":%s,\"balance\":%.2f,\"equity\":%.2f,\"margin\":%.2f,\"freeMargin\":%.2f,\"ticks\":[%s],\"openPositions\":[%s]}",
      AccountInfoInteger(ACCOUNT_LOGIN), JsonEscape(AccountInfoString(ACCOUNT_SERVER)),
      JsonEscape(AccountInfoString(ACCOUNT_CURRENCY)), IsMasterCentAccount() ? "true" : "false",
      AccountInfoDouble(ACCOUNT_BALANCE), AccountInfoDouble(ACCOUNT_EQUITY),
      AccountInfoDouble(ACCOUNT_MARGIN), AccountInfoDouble(ACCOUNT_MARGIN_FREE),
      tickItems, posItems
   );
   string resp;
   HttpPostJson("/api/bridge/master/sync", json, resp);
}

int OnInit()
{
   EventSetMillisecondTimer(InpPollMs);
   Print("TradeSync_Master v2.30 initialized for Login ", AccountInfoInteger(ACCOUNT_LOGIN), " Currency=", AccountInfoString(ACCOUNT_CURRENCY));
   PushLiveTicksAndPositionsSync();
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   PollDashboardCommands();
   datetime now = TimeCurrent();
   if(now - g_lastSyncAt >= InpSyncSec)
   {
      g_lastSyncAt = now;
      PushLiveTicksAndPositionsSync();
   }
}

void OnTradeTransaction(const MqlTradeTransaction& trans,
                        const MqlTradeRequest& request,
                        const MqlTradeResult& result)
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
      double vol = HistoryDealGetDouble(trans.deal, DEAL_VOLUME);
      double price = HistoryDealGetDouble(trans.deal, DEAL_PRICE);
      double sl = 0, tp = 0;

      string action = "OPEN";
      if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY)
      {
         action = PositionSelectByTicket(posId) ? "PARTIAL_CLOSE" : "CLOSE";
      }

      double remVol = -1.0;
      if(PositionSelectByTicket(posId))
      {
         sl = PositionGetDouble(POSITION_SL);
         tp = PositionGetDouble(POSITION_TP);
         if(action == "PARTIAL_CLOSE")
            remVol = PositionGetDouble(POSITION_VOLUME);
      }
      string dealCmdId = "deal-" + IntegerToString((long)trans.deal);
      SendMasterEvent(action, posId, trans.symbol, side, vol, price, sl, tp, dealCmdId, remVol);
   }
   else if(trans.type == TRADE_TRANSACTION_POSITION)
   {
      if(PositionSelectByTicket(trans.position))
      {
         string side = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? "BUY" : "SELL";
         SendMasterEvent("MODIFY", trans.position, PositionGetString(POSITION_SYMBOL), side,
                         PositionGetDouble(POSITION_VOLUME), PositionGetDouble(POSITION_PRICE_OPEN),
                         PositionGetDouble(POSITION_SL), PositionGetDouble(POSITION_TP));
      }
   }
}
