//+------------------------------------------------------------------+
//| Asim_TV_TL_Prob_Alligator.mq5                                    |
//| MT5 port of the TradingView script "TL + Prob + Alligator"       |
//|  - Trendlines with Breaks   (c) LuxAlgo     CC BY-NC-SA 4.0      |
//|  - Breakout Probability     (c) Zeiierman   CC BY-NC-SA 4.0      |
//|  - Bill Williams Alligator, Fractals, Support/Resistance         |
//| Personal, non-commercial use only (share-alike licence).         |
//| Ported from the Pine source in Combined_TradingView_Indicators   |
//+------------------------------------------------------------------+
#property copyright "Asim - personal MT5 port"
#property version   "1.00"
#property description "TradingView look: Trendlines+Breaks, Breakout Probability, Alligator, Fractals, S/R, WIN/LOSS box"
#property indicator_chart_window
#property indicator_buffers 9
#property indicator_plots   9

#define PFX "ATV_"

input group "=== Chart theme (TradingView dark) ==="
input bool   InpApplyTheme  = true;              // Apply TradingView chart colours
input color  InpBg          = C'19,23,34';       // Background
input color  InpFg          = C'209,212,220';    // Text / scale
input color  InpGrid        = C'42,46,57';       // Grid
input color  InpBull        = C'8,153,129';      // Up candle
input color  InpBear        = C'242,54,69';      // Down candle
input int    InpMaxBars     = 2000;              // Max history bars used (lower = faster)

input group "=== Trendlines with Breaks ==="
input bool   InpShowTL      = true;              // Show trendlines and B labels
input int    InpTLLen       = 14;                // Swing detection lookback
input double InpTLMult      = 1.0;               // Slope (ATR based)
input bool   InpBackpaint   = true;              // Backpainting
input bool   InpShowExt     = true;              // Show extended dashed lines
input color  InpTLUp        = C'8,153,129';      // Up trendline / break colour
input color  InpTLDn        = C'242,54,69';      // Down trendline / break colour

input group "=== Breakout Probability ==="
input bool   InpShowProb    = true;              // Show probability levels
input double InpProbStep    = 1.0;               // Percentage step
input int    InpProbCount   = 5;                 // Number of lines per side (1-5)
input bool   InpHideZero    = true;              // Hide 0.00%
input color  InpProbUp      = C'76,175,80';      // Upper level colour
input color  InpProbDn      = C'242,54,69';      // Lower level colour

input group "=== Alligator ==="
input bool   InpShowAlli    = true;              // Show Alligator
input int    InpJawLen      = 13;                // Jaw length
input int    InpTeethLen    = 8;                 // Teeth length
input int    InpLipsLen     = 5;                 // Lips length
input int    InpJawOff      = 8;                 // Jaw offset
input int    InpTeethOff    = 5;                 // Teeth offset
input int    InpLipsOff     = 3;                 // Lips offset
input int    InpAlliOpacity = 25;                // Line opacity % (TradingView = 25)

input group "=== Fractals and Support/Resistance ==="
input bool   InpShowFrac    = true;              // Show fractals
input int    InpFracN       = 2;                 // Fractal period
input bool   InpShowSR      = true;              // Show support/resistance
input int    InpSRLen       = 13;                // S/R length

input group "=== WIN / LOSS box ==="
input bool   InpShowBox     = true;              // Show WIN/LOSS/Profitability box

double JawBuf[], TeethBuf[], LipsBuf[], TLUBuf[], TLLBuf[], SRHBuf[], SRLBuf[], FUBuf[], FDBuf[];
datetime gLastBar = 0;
bool     gReady = false;
uint     gLastLiveMs = 0;
int      gHits[20];
int      gGreen = 0, gRed = 0, gWins = 0, gLosses = 0;

//--------------------------------------------------------------------
color Blend(const color fg,const color bg,const int opacityPct)
  {
   double a = MathMax(0,MathMin(100,opacityPct))/100.0;
   int fr=(int)(fg&0xFF), fgc=(int)((fg>>8)&0xFF), fb=(int)((fg>>16)&0xFF);
   int br=(int)(bg&0xFF), bgc=(int)((bg>>8)&0xFF), bb=(int)((bg>>16)&0xFF);
   int r=(int)MathRound(fr*a+br*(1.0-a));
   int g=(int)MathRound(fgc*a+bgc*(1.0-a));
   int b=(int)MathRound(fb*a+bb*(1.0-a));
   return (color)(r|(g<<8)|(b<<16));
  }

void ApplyTheme()
  {
   long id=0;
   ChartSetInteger(id,CHART_MODE,CHART_CANDLES);
   ChartSetInteger(id,CHART_COLOR_BACKGROUND,InpBg);
   ChartSetInteger(id,CHART_COLOR_FOREGROUND,InpFg);
   ChartSetInteger(id,CHART_COLOR_GRID,InpGrid);
   ChartSetInteger(id,CHART_SHOW_GRID,true);
   ChartSetInteger(id,CHART_COLOR_CANDLE_BULL,InpBull);
   ChartSetInteger(id,CHART_COLOR_CANDLE_BEAR,InpBear);
   ChartSetInteger(id,CHART_COLOR_CHART_UP,InpBull);
   ChartSetInteger(id,CHART_COLOR_CHART_DOWN,InpBear);
   ChartSetInteger(id,CHART_COLOR_CHART_LINE,InpBull);
   ChartSetInteger(id,CHART_COLOR_VOLUME,Blend(InpFg,InpBg,35));
   ChartSetInteger(id,CHART_COLOR_BID,InpBear);
   ChartSetInteger(id,CHART_COLOR_ASK,C'41,98,255');
   ChartSetInteger(id,CHART_COLOR_LAST,InpFg);
   ChartSetInteger(id,CHART_COLOR_STOP_LEVEL,InpBear);
   ChartSetInteger(id,CHART_SHOW_PERIOD_SEP,false);
  }

int OnInit()
  {
   SetIndexBuffer(0,JawBuf,  INDICATOR_DATA);
   SetIndexBuffer(1,TeethBuf,INDICATOR_DATA);
   SetIndexBuffer(2,LipsBuf, INDICATOR_DATA);
   SetIndexBuffer(3,TLUBuf,  INDICATOR_DATA);
   SetIndexBuffer(4,TLLBuf,  INDICATOR_DATA);
   SetIndexBuffer(5,SRHBuf,  INDICATOR_DATA);
   SetIndexBuffer(6,SRLBuf,  INDICATOR_DATA);
   SetIndexBuffer(7,FUBuf,   INDICATOR_DATA);
   SetIndexBuffer(8,FDBuf,   INDICATOR_DATA);
   for(int p=0;p<9;p++)
      PlotIndexSetDouble(p,PLOT_EMPTY_VALUE,EMPTY_VALUE);

   color bgc = InpApplyTheme ? InpBg : (color)ChartGetInteger(0,CHART_COLOR_BACKGROUND);
   int alli = InpShowAlli ? DRAW_LINE : DRAW_NONE;

   PlotIndexSetInteger(0,PLOT_DRAW_TYPE,alli);
   PlotIndexSetInteger(0,PLOT_LINE_COLOR,Blend(C'41,98,255',bgc,InpAlliOpacity));
   PlotIndexSetInteger(0,PLOT_SHIFT,InpJawOff);
   PlotIndexSetString (0,PLOT_LABEL,"Alligator Jaw");
   PlotIndexSetInteger(1,PLOT_DRAW_TYPE,alli);
   PlotIndexSetInteger(1,PLOT_LINE_COLOR,Blend(C'242,54,69',bgc,InpAlliOpacity));
   PlotIndexSetInteger(1,PLOT_SHIFT,InpTeethOff);
   PlotIndexSetString (1,PLOT_LABEL,"Alligator Teeth");
   PlotIndexSetInteger(2,PLOT_DRAW_TYPE,alli);
   PlotIndexSetInteger(2,PLOT_LINE_COLOR,Blend(C'76,175,80',bgc,InpAlliOpacity));
   PlotIndexSetInteger(2,PLOT_SHIFT,InpLipsOff);
   PlotIndexSetString (2,PLOT_LABEL,"Alligator Lips");

   int tl = InpShowTL ? DRAW_LINE : DRAW_NONE;
   int tlShift = InpBackpaint ? -InpTLLen : 0;
   PlotIndexSetInteger(3,PLOT_DRAW_TYPE,tl);
   PlotIndexSetInteger(3,PLOT_LINE_COLOR,InpTLUp);
   PlotIndexSetInteger(3,PLOT_SHIFT,tlShift);
   PlotIndexSetString (3,PLOT_LABEL,"Upper Trendline");
   PlotIndexSetInteger(4,PLOT_DRAW_TYPE,tl);
   PlotIndexSetInteger(4,PLOT_LINE_COLOR,InpTLDn);
   PlotIndexSetInteger(4,PLOT_SHIFT,tlShift);
   PlotIndexSetString (4,PLOT_LABEL,"Lower Trendline");

   int sr = InpShowSR ? DRAW_LINE : DRAW_NONE;
   PlotIndexSetInteger(5,PLOT_DRAW_TYPE,sr);
   PlotIndexSetInteger(5,PLOT_LINE_COLOR,Blend(C'128,128,0',bgc,75));
   PlotIndexSetString (5,PLOT_LABEL,"Resistance");
   PlotIndexSetInteger(6,PLOT_DRAW_TYPE,sr);
   PlotIndexSetInteger(6,PLOT_LINE_COLOR,Blend(C'136,14,79',bgc,75));
   PlotIndexSetString (6,PLOT_LABEL,"Support");

   int fr = InpShowFrac ? DRAW_ARROW : DRAW_NONE;
   PlotIndexSetInteger(7,PLOT_DRAW_TYPE,fr);
   PlotIndexSetInteger(7,PLOT_ARROW,217);
   PlotIndexSetInteger(7,PLOT_ARROW_SHIFT,-10);
   PlotIndexSetInteger(7,PLOT_LINE_COLOR,Blend(C'128,128,0',bgc,75));
   PlotIndexSetString (7,PLOT_LABEL,"Up Fractal");
   PlotIndexSetInteger(8,PLOT_DRAW_TYPE,fr);
   PlotIndexSetInteger(8,PLOT_ARROW,218);
   PlotIndexSetInteger(8,PLOT_ARROW_SHIFT,10);
   PlotIndexSetInteger(8,PLOT_LINE_COLOR,Blend(C'136,14,79',bgc,75));
   PlotIndexSetString (8,PLOT_LABEL,"Down Fractal");

   IndicatorSetString(INDICATOR_SHORTNAME,"TL + Prob + Alligator");
   IndicatorSetInteger(INDICATOR_DIGITS,_Digits);

   if(InpApplyTheme) ApplyTheme();
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   ObjectsDeleteAll(0,PFX);
   ChartRedraw();
  }

//--------------------------------------------------------------------
datetime TimeAt(const datetime &t[],const int n,int idx)
  {
   if(idx<0) idx=0;
   if(idx<n) return t[idx];
   return t[n-1]+(datetime)((idx-(n-1))*PeriodSeconds());
  }

void PutTrend(const string name,const datetime t1,const double p1,const datetime t2,const double p2,
              const color c,const int w,const ENUM_LINE_STYLE st,const bool ray)
  {
   if(ObjectFind(0,name)<0)
     {
      ObjectCreate(0,name,OBJ_TREND,0,t1,p1,t2,p2);
      ObjectSetInteger(0,name,OBJPROP_SELECTABLE,false);
      ObjectSetInteger(0,name,OBJPROP_HIDDEN,true);
      ObjectSetInteger(0,name,OBJPROP_BACK,false);
     }
   else
     {
      ObjectMove(0,name,0,t1,p1);
      ObjectMove(0,name,1,t2,p2);
     }
   ObjectSetInteger(0,name,OBJPROP_COLOR,c);
   ObjectSetInteger(0,name,OBJPROP_WIDTH,w);
   ObjectSetInteger(0,name,OBJPROP_STYLE,st);
   ObjectSetInteger(0,name,OBJPROP_RAY_RIGHT,ray);
  }

void PutText(const string name,const datetime t,const double p,const string txt,const color c,
             const string font,const int size,const ENUM_ANCHOR_POINT anchor)
  {
   if(ObjectFind(0,name)<0)
     {
      ObjectCreate(0,name,OBJ_TEXT,0,t,p);
      ObjectSetInteger(0,name,OBJPROP_SELECTABLE,false);
      ObjectSetInteger(0,name,OBJPROP_HIDDEN,true);
     }
   else
      ObjectMove(0,name,0,t,p);
   ObjectSetString (0,name,OBJPROP_TEXT,txt);
   ObjectSetString (0,name,OBJPROP_FONT,font);
   ObjectSetInteger(0,name,OBJPROP_FONTSIZE,size);
   ObjectSetInteger(0,name,OBJPROP_COLOR,c);
   ObjectSetInteger(0,name,OBJPROP_ANCHOR,anchor);
  }

void PutBoxLabel(const string name,const int x,const int y,const string txt,const color c)
  {
   if(ObjectFind(0,name)<0)
     {
      ObjectCreate(0,name,OBJ_LABEL,0,0,0);
      ObjectSetInteger(0,name,OBJPROP_CORNER,CORNER_RIGHT_UPPER);
      ObjectSetInteger(0,name,OBJPROP_ANCHOR,ANCHOR_LEFT_UPPER);
      ObjectSetInteger(0,name,OBJPROP_SELECTABLE,false);
      ObjectSetInteger(0,name,OBJPROP_HIDDEN,true);
      ObjectSetString (0,name,OBJPROP_FONT,"Trebuchet MS");
      ObjectSetInteger(0,name,OBJPROP_FONTSIZE,10);
     }
   ObjectSetInteger(0,name,OBJPROP_XDISTANCE,x);
   ObjectSetInteger(0,name,OBJPROP_YDISTANCE,y);
   ObjectSetString (0,name,OBJPROP_TEXT,txt);
   ObjectSetInteger(0,name,OBJPROP_COLOR,c);
  }

//--------------------------------------------------------------------
// cheap part: probability levels + WIN/LOSS box (uses cached counts)
void DrawLive(const datetime &time[],const double &open[],const double &high[],
              const double &low[],const double &close[],const int n)
  {
   datetime tNow=time[n-1];
   int per=PeriodSeconds();
   // probability levels (every tick, they follow the forming candle)
   bool wasGreen=(close[n-1]>open[n-1]);
   int  denom = wasGreen ? gGreen : gRed;
   int  upIdx = wasGreen ? 0 : 2;
   int  dnIdx = wasGreen ? 1 : 3;
   int  cnt   = MathMax(1,MathMin(5,InpProbCount));
   for(int s=0;s<5;s++)
     {
      double dist=close[n-1]*InpProbStep/100.0*(s+1);
      for(int side=0;side<2;side++)
        {
         string nm=PFX+"PL"+IntegerToString(s*2+side);
         bool upperSide=(side==0);
         double lvl = upperSide ? high[n-1]+dist : low[n-1]-dist;
         double pct = (denom>0) ? 100.0*gHits[s*4+(upperSide?upIdx:dnIdx)]/denom : 0.0;
         color  clr = upperSide ? InpProbUp : InpProbDn;
         bool draw = InpShowProb && s<cnt && (!InpHideZero || pct>0);
         if(draw)
           {
            PutTrend(nm,tNow,lvl,tNow+per,lvl,clr,2,STYLE_SOLID,true);
            PutText(nm+"T",tNow+per,lvl,StringFormat(" %.2f%%",pct),clr,"Trebuchet MS",9,ANCHOR_LEFT);
           }
         else
           {
            ObjectDelete(0,nm);
            ObjectDelete(0,nm+"T");
           }
        }
     }

   // WIN / LOSS / Profitability box (top right)
   string bx=PFX+"BOX";
   if(InpShowBox)
     {
      if(ObjectFind(0,bx)<0)
        {
         ObjectCreate(0,bx,OBJ_RECTANGLE_LABEL,0,0,0);
         ObjectSetInteger(0,bx,OBJPROP_CORNER,CORNER_RIGHT_UPPER);
         ObjectSetInteger(0,bx,OBJPROP_BORDER_TYPE,BORDER_FLAT);
         ObjectSetInteger(0,bx,OBJPROP_SELECTABLE,false);
         ObjectSetInteger(0,bx,OBJPROP_HIDDEN,true);
        }
      ObjectSetInteger(0,bx,OBJPROP_BGCOLOR,C'27,31,43');
      ObjectSetInteger(0,bx,OBJPROP_COLOR,C'120,123,134');
      ObjectSetInteger(0,bx,OBJPROP_XDISTANCE,12);
      ObjectSetInteger(0,bx,OBJPROP_YDISTANCE,12);
      ObjectSetInteger(0,bx,OBJPROP_XSIZE,200);
      ObjectSetInteger(0,bx,OBJPROP_YSIZE,72);
      int tot=gWins+gLosses;
      double prof=(tot>0)?100.0*gWins/tot:0.0;
      PutBoxLabel(PFX+"BX1",190,18,StringFormat("WIN: %d",gWins),C'76,175,80');
      PutBoxLabel(PFX+"BX2",190,36,StringFormat("LOSS: %d",gLosses),InpBear);
      PutBoxLabel(PFX+"BX3",190,54,StringFormat("Profitability: %.2f%%",prof),clrWhite);
     }
   else
     {
      ObjectDelete(0,bx); ObjectDelete(0,PFX+"BX1"); ObjectDelete(0,PFX+"BX2"); ObjectDelete(0,PFX+"BX3");
     }

  }

int OnCalculate(const int rates_total,const int prev_calculated,const datetime &time[],
                const double &open[],const double &high[],const double &low[],const double &close[],
                const long &tick_volume[],const long &volume[],const int &spread[])
  {
   int n = rates_total;
   int L = MathMax(1,InpTLLen);
   if(n < 4*L+60) return 0;
   int start = MathMax(0,n-MathMax(300,InpMaxBars));

   // same bar and already calculated: only the cheap live part, max twice per second
   if(prev_calculated>0 && gReady && time[n-1]==gLastBar)
     {
      uint nowMs=GetTickCount();
      if(nowMs-gLastLiveMs>=500)
        {
         gLastLiveMs=nowMs;
         DrawLive(time,open,high,low,close,n);
         ChartRedraw();
        }
      return rates_total;
     }

   ArrayInitialize(JawBuf,EMPTY_VALUE);  ArrayInitialize(TeethBuf,EMPTY_VALUE); ArrayInitialize(LipsBuf,EMPTY_VALUE);
   ArrayInitialize(TLUBuf,EMPTY_VALUE);  ArrayInitialize(TLLBuf,EMPTY_VALUE);
   ArrayInitialize(SRHBuf,EMPTY_VALUE);  ArrayInitialize(SRLBuf,EMPTY_VALUE);
   ArrayInitialize(FUBuf,EMPTY_VALUE);   ArrayInitialize(FDBuf,EMPTY_VALUE);

   bool newBar = (time[n-1]!=gLastBar);
   gLastBar = time[n-1];

   //---- Alligator: Wilder smoothing (RMA) of hl2
   if(InpShowAlli)
     {
      int lens[3]; lens[0]=InpJawLen; lens[1]=InpTeethLen; lens[2]=InpLipsLen;
      for(int a=0;a<3;a++)
        {
         int len=MathMax(1,lens[a]);
         double sum=0, prev=0;
         for(int i=start;i<n;i++)
           {
            double src=(high[i]+low[i])/2.0;
            double v=EMPTY_VALUE;
            if(i-start<len-1) sum+=src;
            else if(i-start==len-1) { sum+=src; v=sum/len; prev=v; }
            else { v=(prev*(len-1)+src)/len; prev=v; }
            if(a==0) JawBuf[i]=v; else if(a==1) TeethBuf[i]=v; else LipsBuf[i]=v;
           }
        }
     }

   //---- ATR (Wilder, length L) for trendline slope and label offsets
   double atr[]; ArrayResize(atr,n); ArrayInitialize(atr,0.0);
   {
    double sum=0, prev=0;
    for(int i=start;i<n;i++)
      {
       double tr=high[i]-low[i];
       if(i>start)
         {
          tr=MathMax(tr,MathMax(MathAbs(high[i]-close[i-1]),MathAbs(low[i]-close[i-1])));
         }
       if(i-start<L-1) sum+=tr;
       else if(i-start==L-1) { sum+=tr; prev=sum/L; atr[i]=prev; }
       else { prev=(prev*(L-1)+tr)/L; atr[i]=prev; }
      }
   }

   //---- Trendlines with Breaks (LuxAlgo)
   int upBreaks[]; int dnBreaks[];
   int lastPhBar=-1,lastPlBar=-1; double lastPh=0,lastPl=0,lastSlPh=0,lastSlPl=0;
   {
    double upper=0,lower=0,slPh=0,slPl=0; int upS=0,dnS=0;
    bool haveH=false,haveL=false;
    for(int i=start+2*L;i<n;i++)
      {
       int k=i-L;
       bool isPh=true,isPl=true;
       for(int j=k-L;j<=k+L;j++)
         {
          if(j==k) continue;
          if(high[j]>high[k]) isPh=false;
          if(low[j]<low[k])   isPl=false;
         }
       double slope=atr[i]/L*InpTLMult;
       if(isPh){ slPh=slope; upper=high[k]; haveH=true; lastPhBar=i; lastPh=high[k]; lastSlPh=slope; }
       else upper-=slPh;
       if(isPl){ slPl=slope; lower=low[k];  haveL=true; lastPlBar=i; lastPl=low[k];  lastSlPl=slope; }
       else lower+=slPl;

       int pU=upS, pD=dnS;
       if(isPh) upS=0; else if(haveH && close[i]>upper-slPh*L) upS=1;
       if(isPl) dnS=0; else if(haveL && close[i]<lower+slPl*L) dnS=1;
       if(upS>pU){ int m=ArraySize(upBreaks); ArrayResize(upBreaks,m+1); upBreaks[m]=i; }
       if(dnS>pD){ int m=ArraySize(dnBreaks); ArrayResize(dnBreaks,m+1); dnBreaks[m]=i; }

       if(haveH && !isPh) TLUBuf[i]= InpBackpaint ? upper : upper-slPh*L;
       if(haveL && !isPl) TLLBuf[i]= InpBackpaint ? lower : lower+slPl*L;
      }
   }

   //---- Support / Resistance
   if(InpShowSR)
     {
      int sl=MathMax(1,InpSRLen);
      double curH=0,curL=0,prevH=0,prevL=0; bool init=false;
      for(int i=start+sl;i<n;i++)
        {
         double hh=high[i],ll=low[i];
         for(int j=i-sl+1;j<=i;j++){ if(high[j]>hh) hh=high[j]; if(low[j]<ll) ll=low[j]; }
         if(high[i]>=hh) curH=high[i];
         if(low[i]<=ll)  curL=low[i];
         if(!init){ prevH=curH; prevL=curL; init=true; }
         if(curH==prevH) SRHBuf[i]=curH;
         if(curL==prevL) SRLBuf[i]=curL;
         prevH=curH; prevL=curL;
        }
     }

   //---- Fractals (strict N bars each side), plotted on the pivot bar
   if(InpShowFrac)
     {
      int N=MathMax(2,InpFracN);
      for(int k=start+N;k<n-N;k++)
        {
         bool up=true,dn=true;
         for(int j=1;j<=N;j++)
           {
            if(!(high[k]>high[k-j] && high[k]>high[k+j])) up=false;
            if(!(low[k]<low[k-j]  && low[k]<low[k+j]))   dn=false;
           }
         if(up) FUBuf[k]=high[k];
         if(dn) FDBuf[k]=low[k];
        }
     }

   //---- Breakout probability counts (completed bars only)
   int hits[20]; ArrayInitialize(hits,0);
   int greenCnt=0, redCnt=0;
   for(int j=start+1;j<=n-2;j++)
     {
      bool pg=close[j-1]>open[j-1];
      bool pr=close[j-1]<open[j-1];
      if(pg) greenCnt++;
      if(pr) redCnt++;
      for(int s=0;s<5;s++)
        {
         double st=close[j-1]*InpProbStep/100.0*(s+1);
         if(pg && high[j]>=high[j-1]+st) hits[s*4+0]++;
         if(pg && low[j] <=low[j-1]-st)  hits[s*4+1]++;
         if(pr && high[j]>=high[j-1]+st) hits[s*4+2]++;
         if(pr && low[j] <=low[j-1]-st)  hits[s*4+3]++;
        }
     }

   //---- WIN / LOSS statistics (same method as Asim_XAU_Scalper_EA_v3)
   int wins=0,losses=0;
   {
    int tot[2],upc[2],dnc[2];
    ArrayInitialize(tot,0); ArrayInitialize(upc,0); ArrayInitialize(dnc,0);
    for(int c=start;c<=n-3;c++)
      {
       int col=(close[c]>=open[c])?1:0;
       bool hitUp=(high[c+1]>high[c]);
       bool hitDn=(low[c+1] <low[c]);
       if(tot[col]>=20)
         {
          double pu=(double)upc[col]/tot[col];
          double pd=(double)dnc[col]/tot[col];
          if(pu!=pd)
            {
             bool predUp=(pu>pd);
             if((predUp&&hitUp)||(!predUp&&hitDn)) wins++; else losses++;
            }
         }
       tot[col]++;
       if(hitUp) upc[col]++;
       if(hitDn) dnc[col]++;
      }
   }

   //================= OBJECTS =================
   datetime tNow=time[n-1];
   int per=PeriodSeconds();

   // heavy objects only once per new bar
   if(newBar || prev_calculated==0)
     {
      ObjectsDeleteAll(0,PFX+"BRK_");
      if(InpShowTL)
        {
         int off=InpBackpaint?L:0;
         if(InpShowExt && lastPhBar>=0)
           {
            int x1=lastPhBar-off, x2=x1+1;
            double y1=InpBackpaint?lastPh:lastPh-lastSlPh*L;
            double y2=InpBackpaint?lastPh-lastSlPh:lastPh-lastSlPh*(L+1);
            PutTrend(PFX+"TL_U",TimeAt(time,n,x1),y1,TimeAt(time,n,x2),y2,InpTLUp,1,STYLE_DASH,true);
           }
         if(InpShowExt && lastPlBar>=0)
           {
            int x1=lastPlBar-off, x2=x1+1;
            double y1=InpBackpaint?lastPl:lastPl+lastSlPl*L;
            double y2=InpBackpaint?lastPl+lastSlPl:lastPl+lastSlPl*(L+1);
            PutTrend(PFX+"TL_L",TimeAt(time,n,x1),y1,TimeAt(time,n,x2),y2,InpTLDn,1,STYLE_DASH,true);
           }
         int nu=ArraySize(upBreaks);
         for(int q=MathMax(0,nu-60);q<nu;q++)
           {
            int i=upBreaks[q];
            double pr=low[i]-atr[i]*0.8;
            PutText(PFX+"BRK_UB"+IntegerToString(i),time[i],pr,CharToString(110),InpTLUp,"Wingdings",14,ANCHOR_CENTER);
            PutText(PFX+"BRK_UT"+IntegerToString(i),time[i],pr,"B",clrWhite,"Arial Bold",8,ANCHOR_CENTER);
           }
         int nd=ArraySize(dnBreaks);
         for(int q=MathMax(0,nd-60);q<nd;q++)
           {
            int i=dnBreaks[q];
            double pr=high[i]+atr[i]*0.8;
            PutText(PFX+"BRK_DB"+IntegerToString(i),time[i],pr,CharToString(110),InpTLDn,"Wingdings",14,ANCHOR_CENTER);
            PutText(PFX+"BRK_DT"+IntegerToString(i),time[i],pr,"B",clrWhite,"Arial Bold",8,ANCHOR_CENTER);
           }
        }
      else
        {
         ObjectDelete(0,PFX+"TL_U");
         ObjectDelete(0,PFX+"TL_L");
        }
     }

   for(int q2=0;q2<20;q2++) gHits[q2]=hits[q2];
   gGreen=greenCnt; gRed=redCnt; gWins=wins; gLosses=losses;
   DrawLive(time,open,high,low,close,n);
   gReady=true;
   ChartRedraw();
   return rates_total;
  }
//+------------------------------------------------------------------+
