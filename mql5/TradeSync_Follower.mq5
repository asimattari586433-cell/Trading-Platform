//+------------------------------------------------------------------+
//|                                            TradeSync_Follower.mq5 |
//|   TradeSync MT5 Local Follower Bridge Expert Advisor (v2.30)     |
//|   - Loopback default http://127.0.0.1:3000                       |
//|   - Sends Bridge Token via x-bridge-token HTTP header ONLY       |
//|   - Supports Exness Standard & Standard Cent accounts 1:1        |
//|   - Account-scoped & persistent Master->Follower ticket mapping  |
//|     (never selects unrelated or manual positions)                |
//|   - Persistent commandId deduplication across retries & restarts |
//|   - Exact volume checks (never silently rounds/alters requested) |
//+------------------------------------------------------------------+
#property copyright "TradeSync MT5"
#property version   "2.30"
#property strict
#include <Trade/Trade.mqh>

input string InpServerBaseUrl = "http://127.0.0.1:3000";
input string InpBridgeToken   = "PASTE_YOUR_BRIDGE_TOKEN_HERE";
input int    InpPollMs        = 250;
input int    InpMaxSlippage   = 30;
input ulong  InpMagicNumber   = 66001;

CTrade followerTrade;

struct TicketMapEntry
{
   string posId;
   ulong  ticket;
   string symbol;
   string side;
};

TicketMapEntry g_ticketMap[];
string g_executedCommandIds[];

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
   // Trim trailing zeros beyond 2 decimal places so 0.01 stays 0.01 and 0.005 stays 0.005
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

bool IsCentAccount()
{
   string cur = AccountInfoString(ACCOUNT_CURRENCY);
   StringToUpper(cur);
   if(StringFind(cur, "USC") >= 0 || StringFind(cur, "CENT") >= 0) return true;
   string srv = AccountInfoString(ACCOUNT_SERVER);
   StringToLower(srv);
   return (StringFind(srv, "cent") >= 0);
}

string MapFilePath()
{
   return "tradesync_map_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + ".dat";
}

string CmdFilePath()
{
   return "tradesync_cmds_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + ".dat";
}

string BuildGvMapKey(string posId)
{
   return "TS_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "_" + posId;
}

void SaveTicketMap()
{
   int handle = FileOpen(MapFilePath(), FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(handle == INVALID_HANDLE) return;
   int n = ArraySize(g_ticketMap);
   for(int i = 0; i < n; i++)
   {
      if(g_ticketMap[i].posId == "" || g_ticketMap[i].ticket == 0) continue;
      FileWriteString(handle, g_ticketMap[i].posId + "|" + IntegerToString((long)g_ticketMap[i].ticket) + "|" + g_ticketMap[i].symbol + "|" + g_ticketMap[i].side + "\n");
   }
   FileClose(handle);
}

void LoadTicketMap()
{
   ArrayResize(g_ticketMap, 0);
   int handle = FileOpen(MapFilePath(), FILE_READ | FILE_TXT | FILE_ANSI);
   if(handle == INVALID_HANDLE) return;
   while(!FileIsEnding(handle))
   {
      string line = FileReadString(handle);
      StringTrimRight(line);
      if(line == "") continue;
      string parts[];
      if(StringSplit(line, '|', parts) >= 4)
      {
         int idx = ArraySize(g_ticketMap);
         ArrayResize(g_ticketMap, idx + 1);
         g_ticketMap[idx].posId  = parts[0];
         g_ticketMap[idx].ticket = (ulong)StringToInteger(parts[1]);
         g_ticketMap[idx].symbol = parts[2];
         g_ticketMap[idx].side   = parts[3];
      }
   }
   FileClose(handle);
}

void UpsertTicketMapping(string posId, ulong ticket, string symbol, string side)
{
   if(posId == "" || ticket == 0) return;
   GlobalVariableSet(BuildGvMapKey(posId), (double)ticket);
   int n = ArraySize(g_ticketMap);
   for(int i = 0; i < n; i++)
   {
      if(g_ticketMap[i].posId == posId)
      {
         g_ticketMap[i].ticket = ticket;
         g_ticketMap[i].symbol = symbol;
         g_ticketMap[i].side   = side;
         SaveTicketMap();
         return;
      }
   }
   ArrayResize(g_ticketMap, n + 1);
   g_ticketMap[n].posId  = posId;
   g_ticketMap[n].ticket = ticket;
   g_ticketMap[n].symbol = symbol;
   g_ticketMap[n].side   = side;
   SaveTicketMap();
}

void RemoveTicketMapping(string posId)
{
   GlobalVariableDel(BuildGvMapKey(posId));
   int n = ArraySize(g_ticketMap);
   int writeIdx = 0;
   for(int i = 0; i < n; i++)
   {
      if(g_ticketMap[i].posId != posId)
      {
         g_ticketMap[writeIdx] = g_ticketMap[i];
         writeIdx++;
      }
   }
   if(writeIdx != n)
   {
      ArrayResize(g_ticketMap, writeIdx);
      SaveTicketMap();
   }
}

bool HasExecutedCommand(string cmdId)
{
   if(cmdId == "") return false;
   int n = ArraySize(g_executedCommandIds);
   for(int i = 0; i < n; i++)
   {
      if(g_executedCommandIds[i] == cmdId) return true;
   }
   return false;
}

void LoadExecutedCommands()
{
   ArrayResize(g_executedCommandIds, 0);
   int handle = FileOpen(CmdFilePath(), FILE_READ | FILE_TXT | FILE_ANSI);
   if(handle == INVALID_HANDLE) return;
   while(!FileIsEnding(handle))
   {
      string line = FileReadString(handle);
      StringTrimRight(line);
      if(line != "")
      {
         int idx = ArraySize(g_executedCommandIds);
         ArrayResize(g_executedCommandIds, idx + 1);
         g_executedCommandIds[idx] = line;
      }
   }
   FileClose(handle);
}

void RecordExecutedCommand(string cmdId)
{
   if(cmdId == "" || HasExecutedCommand(cmdId)) return;
   int n = ArraySize(g_executedCommandIds);
   if(n >= 400)
   {
      for(int i = 1; i < n; i++) g_executedCommandIds[i - 1] = g_executedCommandIds[i];
      g_executedCommandIds[n - 1] = cmdId;
   }
   else
   {
      ArrayResize(g_executedCommandIds, n + 1);
      g_executedCommandIds[n] = cmdId;
   }
   int handle = FileOpen(CmdFilePath(), FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(handle == INVALID_HANDLE) return;
   int total = ArraySize(g_executedCommandIds);
   for(int i = 0; i < total; i++)
      FileWriteString(handle, g_executedCommandIds[i] + "\n");
   FileClose(handle);
}

string ResolveBrokerSymbol(string requestedSym, string baseSym)
{
   if(requestedSym != "" && SymbolSelect(requestedSym, true))
      return requestedSym;

   string cleanBase = (baseSym != "") ? baseSym : requestedSym;
   StringToUpper(cleanBase);

   string candidates[7];
   if(IsCentAccount())
   {
      candidates[0] = cleanBase + "c";
      candidates[1] = cleanBase;
      candidates[2] = cleanBase + "m";
      candidates[3] = cleanBase + ".c";
      candidates[4] = cleanBase + ".pro";
      candidates[5] = cleanBase + ".raw";
      candidates[6] = cleanBase + "_i";
   }
   else
   {
      candidates[0] = cleanBase;
      candidates[1] = cleanBase + "m";
      candidates[2] = cleanBase + "c";
      candidates[3] = cleanBase + ".pro";
      candidates[4] = cleanBase + ".raw";
      candidates[5] = cleanBase + "_i";
      candidates[6] = cleanBase + ".a";
   }

   for(int i = 0; i < 7; i++)
   {
      if(SymbolSelect(candidates[i], true))
         return candidates[i];
   }

   int total = SymbolsTotal(false);
   for(int i = 0; i < total; i++)
   {
      string sym = SymbolName(i, false);
      string up = sym;
      StringToUpper(up);
      if(StringFind(up, cleanBase) == 0 && SymbolSelect(sym, true))
         return sym;
   }
   return requestedSym;
}

bool ValidateExactVolume(string sym, double lots, bool isOpen, string &errOut, double &contractSizeOut)
{
   contractSizeOut = SymbolInfoDouble(sym, SYMBOL_TRADE_CONTRACT_SIZE);
   long tradeMode = SymbolInfoInteger(sym, SYMBOL_TRADE_MODE);
   if(tradeMode == SYMBOL_TRADE_MODE_DISABLED)
   {
      errOut = "Broker trade disabled for symbol " + sym;
      return false;
   }
   if(isOpen && tradeMode == SYMBOL_TRADE_MODE_CLOSEONLY)
   {
      errOut = "Symbol " + sym + " is Close-Only on broker";
      return false;
   }

   double volMin  = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double volMax  = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
   double volStep = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);

   if(volMin > 0 && lots < volMin - 1e-6)
   {
      errOut = StringFormat("Requested %s lots < broker min %s on %s (1:1 rule preserved, not altered)", FormatLots(lots, sym), FormatLots(volMin, sym), sym);
      return false;
   }
   if(volMax > 0 && lots > volMax + 1e-6)
   {
      errOut = StringFormat("Requested %s lots > broker max %s on %s (1:1 rule preserved, not altered)", FormatLots(lots, sym), FormatLots(volMax, sym), sym);
      return false;
   }
   if(volStep > 0)
   {
      double rounded = MathRound(lots / volStep) * volStep;
      if(MathAbs(lots - rounded) > 1e-6)
      {
         errOut = StringFormat("Requested %s lots violates broker step %s on %s (not altered)", FormatLots(lots, sym), FormatLots(volStep, sym), sym);
         return false;
      }
   }
   return true;
}

void SendAck(string commandId, string positionId, string action, double requestedLots, bool ok, ulong ticket, double execPrice, uint retcode, string errDesc, string resolvedSym = "", double contractSize = 0.0)
{
   string url = InpServerBaseUrl + "/api/bridge/slave/ack";
   string json = StringFormat(
      "{\"login\":\"%I64d\",\"commandId\":\"%s\",\"positionId\":\"%s\",\"action\":\"%s\",\"requestedLots\":%s,\"success\":%s,\"externalTicket\":\"%I64u\",\"executedPrice\":%.5f,\"retcode\":%u,\"errorMessage\":\"%s\",\"resolvedSymbol\":\"%s\",\"contractSize\":%.2f,\"accountCurrency\":\"%s\",\"cent\":%s,\"balance\":%.2f,\"equity\":%.2f,\"margin\":%.2f,\"freeMargin\":%.2f}",
      AccountInfoInteger(ACCOUNT_LOGIN), JsonEscape(commandId), JsonEscape(positionId), JsonEscape(action),
      FormatLots(requestedLots, resolvedSym), ok ? "true" : "false", ticket, execPrice, retcode,
      JsonEscape(errDesc), JsonEscape(resolvedSym), contractSize, JsonEscape(AccountInfoString(ACCOUNT_CURRENCY)),
      IsCentAccount() ? "true" : "false",
      AccountInfoDouble(ACCOUNT_BALANCE), AccountInfoDouble(ACCOUNT_EQUITY),
      AccountInfoDouble(ACCOUNT_MARGIN), AccountInfoDouble(ACCOUNT_MARGIN_FREE)
   );
   char data[]; char result[]; string resHeaders;
   StringToCharArray(json, data, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(data, ArraySize(data) - 1);
   WebRequest("POST", url, "Content-Type: application/json\r\nx-bridge-token: " + InpBridgeToken + "\r\n", 2000, data, result, resHeaders);
}

// Strict verification: NEVER select a manual position or unrelated ticket.
// Ticket MUST exist on current Follower account, carry InpMagicNumber, and match comment OR expected symbol/side.
bool VerifyFollowerPosition(ulong ticket, string posId, string expectedSym, string expectedBaseSym, string expectedSide, bool allowMappedWithoutComment)
{
   if(ticket == 0 || !PositionSelectByTicket(ticket)) return false;

   long posMagic = PositionGetInteger(POSITION_MAGIC);
   if((ulong)posMagic != InpMagicNumber) return false;

   string posComment = PositionGetString(POSITION_COMMENT);
   if(posComment == posId) return true;
   if(!allowMappedWithoutComment) return false;

   string pSym = PositionGetString(POSITION_SYMBOL);
   string pSide = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? "BUY" : "SELL";
   if(expectedSide != "" && pSide != expectedSide) return false;

   if(expectedSym != "" && pSym == expectedSym) return true;
   if(expectedBaseSym != "")
   {
      string upPos = pSym;
      string upBase = expectedBaseSym;
      StringToUpper(upPos);
      StringToUpper(upBase);
      if(StringFind(upPos, upBase) == 0) return true;
   }
   return false;
}

ulong FindFollowerPositionTicket(string posId, string extTicketStr, string expectedSym, string expectedBaseSym, string expectedSide)
{
   // 1. Scan live open positions for exact Master positionId in TradeSync comment + InpMagicNumber
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(VerifyFollowerPosition(ticket, posId, expectedSym, expectedBaseSym, expectedSide, false))
      {
         UpsertTicketMapping(posId, ticket, PositionGetString(POSITION_SYMBOL), expectedSide);
         return ticket;
      }
   }

   // 2. Check persistent account-scoped map file MQL5/Files/tradesync_map_<LOGIN>.dat
   int n = ArraySize(g_ticketMap);
   for(int i = 0; i < n; i++)
   {
      if(g_ticketMap[i].posId == posId)
      {
         ulong mapped = g_ticketMap[i].ticket;
         if(VerifyFollowerPosition(mapped, posId, expectedSym, expectedBaseSym, expectedSide, true))
            return mapped;
      }
   }

   // 3. Check account-scoped GlobalVariable TS_<LOGIN>_<posId>
   string gvKey = BuildGvMapKey(posId);
   if(GlobalVariableCheck(gvKey))
   {
      ulong gvTicket = (ulong)GlobalVariableGet(gvKey);
      if(VerifyFollowerPosition(gvTicket, posId, expectedSym, expectedBaseSym, expectedSide, true))
      {
         UpsertTicketMapping(posId, gvTicket, PositionGetString(POSITION_SYMBOL), expectedSide);
         return gvTicket;
      }
   }

   // 4. Verify externalTicket ONLY if it passes strict MagicNumber + symbol + side + (optional map) verification
   ulong extTicket = (extTicketStr != "") ? (ulong)StringToInteger(extTicketStr) : 0;
   if(extTicket > 0 && VerifyFollowerPosition(extTicket, posId, expectedSym, expectedBaseSym, expectedSide, true))
   {
      UpsertTicketMapping(posId, extTicket, PositionGetString(POSITION_SYMBOL), expectedSide);
      return extTicket;
   }

   return 0;
}

void ExecuteCommand(string obj)
{
   string commandId = ExtractField(obj, "commandId");
   string action    = ExtractField(obj, "action");
   string posId     = ExtractField(obj, "positionId");
   string extTicket = ExtractField(obj, "externalTicket");
   string sym       = ExtractField(obj, "symbol");
   string baseSym   = ExtractField(obj, "baseSymbol");
   string side      = ExtractField(obj, "side");
   double lots      = StringToDouble(ExtractField(obj, "lots"));
   double sl        = StringToDouble(ExtractField(obj, "sl"));
   double tp        = StringToDouble(ExtractField(obj, "tp"));

   if(commandId == "" || posId == "") return;

   string resolvedSym = ResolveBrokerSymbol(sym, baseSym);
   double contractSize = SymbolInfoDouble(resolvedSym, SYMBOL_TRADE_CONTRACT_SIZE);

   // Persistent idempotency guard against reconnects / timed-out retries
   if(HasExecutedCommand(commandId))
   {
      ulong mapped = FindFollowerPositionTicket(posId, extTicket, resolvedSym, baseSym, side);
      double pOpen = (mapped > 0 && PositionSelectByTicket(mapped)) ? PositionGetDouble(POSITION_PRICE_OPEN) : 0.0;
      SendAck(commandId, posId, action, lots, true, mapped, pOpen, 10009, "Already executed on terminal (idempotent)", resolvedSym, contractSize);
      return;
   }

   followerTrade.SetExpertMagicNumber(InpMagicNumber);
   followerTrade.SetDeviationInPoints(InpMaxSlippage);

   bool ok = false;
   ulong resultTicket = 0;
   double resultPrice = 0.0;
   uint retcode = 0;
   string errDesc = "";

   if(action == "OPEN")
   {
      ulong existing = FindFollowerPositionTicket(posId, extTicket, resolvedSym, baseSym, side);
      if(existing > 0 && PositionSelectByTicket(existing))
      {
         RecordExecutedCommand(commandId);
         SendAck(commandId, posId, action, lots, true, existing, PositionGetDouble(POSITION_PRICE_OPEN), 10009, "Already open (idempotent)", resolvedSym, contractSize);
         return;
      }

      if(!SymbolSelect(resolvedSym, true))
      {
         SendAck(commandId, posId, action, lots, false, 0, 0.0, 10013, "Symbol unavailable on broker: " + resolvedSym, resolvedSym, 0.0);
         return;
      }

      string volErr = "";
      if(!ValidateExactVolume(resolvedSym, lots, true, volErr, contractSize))
      {
         SendAck(commandId, posId, action, lots, false, 0, 0.0, 10014, volErr, resolvedSym, contractSize);
         return;
      }

      ok = (side == "BUY")
         ? followerTrade.Buy(lots, resolvedSym, 0.0, sl, tp, posId)
         : followerTrade.Sell(lots, resolvedSym, 0.0, sl, tp, posId);

      ulong dealTicket = followerTrade.ResultDeal();
      if(ok && dealTicket > 0 && HistoryDealSelect(dealTicket))
         resultTicket = (ulong)HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
      if(resultTicket == 0)
         resultTicket = FindFollowerPositionTicket(posId, "", resolvedSym, baseSym, side);
      if(resultTicket == 0) resultTicket = followerTrade.ResultOrder();
      if(ok && resultTicket > 0)
      {
         UpsertTicketMapping(posId, resultTicket, resolvedSym, side);
         RecordExecutedCommand(commandId);
      }
      resultPrice = followerTrade.ResultPrice();
      retcode = followerTrade.ResultRetcode();
      errDesc = followerTrade.ResultRetcodeDescription();
   }
   else if(action == "MODIFY")
   {
      ulong ticket = FindFollowerPositionTicket(posId, extTicket, resolvedSym, baseSym, side);
      if(ticket > 0)
      {
         ok = followerTrade.PositionModify(ticket, sl, tp);
         if(ok) RecordExecutedCommand(commandId);
         resultTicket = ticket;
         retcode = followerTrade.ResultRetcode();
         errDesc = followerTrade.ResultRetcodeDescription();
      }
      else
      {
         retcode = 10036;
         errDesc = "Verified TradeSync Follower position not found for MODIFY (posId=" + posId + ")";
      }
   }
   else if(action == "CLOSE")
   {
      ulong ticket = FindFollowerPositionTicket(posId, extTicket, resolvedSym, baseSym, side);
      if(ticket > 0)
      {
         ok = followerTrade.PositionClose(ticket, InpMaxSlippage);
         if(ok)
         {
            RemoveTicketMapping(posId);
            RecordExecutedCommand(commandId);
         }
         resultTicket = ticket;
         resultPrice = followerTrade.ResultPrice();
         retcode = followerTrade.ResultRetcode();
         errDesc = followerTrade.ResultRetcodeDescription();
      }
      else
      {
         retcode = 10036;
         errDesc = "Verified TradeSync Follower position not found for CLOSE (posId=" + posId + ")";
      }
   }
   else if(action == "PARTIAL_CLOSE")
   {
      ulong ticket = FindFollowerPositionTicket(posId, extTicket, resolvedSym, baseSym, side);
      if(ticket > 0 && PositionSelectByTicket(ticket))
      {
         string pSym = PositionGetString(POSITION_SYMBOL);
         double curVol = PositionGetDouble(POSITION_VOLUME);
         string volErr = "";
         if(!ValidateExactVolume(pSym, lots, false, volErr, contractSize))
         {
            SendAck(commandId, posId, action, lots, false, ticket, 0.0, 10014, volErr, pSym, contractSize);
            return;
         }
         if(lots >= curVol - 1e-6)
         {
            ok = followerTrade.PositionClose(ticket, InpMaxSlippage);
            if(ok) RemoveTicketMapping(posId);
         }
         else
         {
            ok = followerTrade.PositionClosePartial(ticket, lots, InpMaxSlippage);
         }
         if(ok) RecordExecutedCommand(commandId);
         resultTicket = ticket;
         resultPrice = followerTrade.ResultPrice();
         retcode = followerTrade.ResultRetcode();
         errDesc = followerTrade.ResultRetcodeDescription();
      }
      else
      {
         retcode = 10036;
         errDesc = "Verified TradeSync Follower position not found for PARTIAL_CLOSE (posId=" + posId + ")";
      }
   }

   SendAck(commandId, posId, action, lots, ok, resultTicket, resultPrice, retcode, errDesc, resolvedSym, contractSize);
}

int OnInit()
{
   LoadTicketMap();
   LoadExecutedCommands();
   EventSetMillisecondTimer(InpPollMs);
   Print("TradeSync_Follower v2.30 initialized for Login ", AccountInfoInteger(ACCOUNT_LOGIN), " Currency=", AccountInfoString(ACCOUNT_CURRENCY), " Mapped=", ArraySize(g_ticketMap));
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   string cur = AccountInfoString(ACCOUNT_CURRENCY);
   string url = InpServerBaseUrl + "/api/bridge/slave/commands?login=" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN))
      + "&balance=" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2)
      + "&equity=" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2)
      + "&margin=" + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN), 2)
      + "&freeMargin=" + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2)
      + "&currency=" + cur
      + "&cent=" + (IsCentAccount() ? "true" : "false")
      + "&openCount=" + IntegerToString(PositionsTotal());

   char postData[]; char result[]; string resHeaders;
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
      if(StringFind(chunk, "\"commandId\"") >= 0) ExecuteCommand(chunk);
      cursor = objEnd + 1;
   }
}
