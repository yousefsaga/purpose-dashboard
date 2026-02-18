import { useState, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, AreaChart, Area } from "recharts";

const API_KEY = "phx_SI39K387LgFZkR14U1Lvu3ADV7uO7r9SlPEtugu2YKwNCF3";

const RANGES = [
  { label: "7D",  value: "-7d",   display: "Last 7 days",    interval: "day",   prevValue: "-14d",  prevInterval: "day"   },
  { label: "30D", value: "-30d",  display: "Last 30 days",   interval: "week",  prevValue: "-60d",  prevInterval: "week"  },
  { label: "90D", value: "-90d",  display: "Last 90 days",   interval: "week",  prevValue: "-180d", prevInterval: "week"  },
  { label: "6M",  value: "-180d", display: "Last 6 months",  interval: "month", prevValue: "-360d", prevInterval: "month" },
  { label: "12M", value: "-365d", display: "Last 12 months", interval: "month", prevValue: "-730d", prevInterval: "month" },
];
const DEFAULT = RANGES[2];

const C = {
  cream: "#EFE5E0", navy: "#171830", purple: "#713BE7", lavender: "#D4C4F8",
  orange: "#ED5D1B", muted: "#7A6E78", green: "#2D8C5E", red: "#C0392B",
  amber: "#D97706", surface: "#FAF6F3", border: "#E0D4CE", dim: "#E8DDD8",
};

const fmt  = (n) => n == null ? "—" : n >= 1000 ? `${(n/1000).toFixed(1)}k` : String(Math.round(n));
const pct  = (n) => n == null ? "—" : `${n.toFixed(1)}%`;
const diff = (a, b) => a != null && b != null ? a - b : null;

async function hogql(sql) {
  const r = await fetch(`/api/projects/@current/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query: sql } }),
  });
  if (!r.ok) { const t = await r.text(); throw new Error(t.slice(0, 120)); }
  const j = await r.json();
  return j.results || [];
}

function toInterval(v) {
  const n = v.replace("-", "");
  if (n.endsWith("d")) return `${n.replace("d", "")} DAY`;
  return `${n.replace("M", "")} MONTH`;
}

const ALL_EVENTS = [
  "rc_trial_started_event","rc_trial_converted_event","rc_trial_cancelled_event",
  "rc_initial_purchase_event","rc_renewal_event","rc_cancellation_event",
  "rc_expiration_event","rc_billing_issue_event","rc_uncancellation_event","paywall_shown",
];
const EV_LIST = ALL_EVENTS.map(e => `'${e}'`).join(",");

const EVENT_MAP = {
  "rc_trial_started_event":"trials","rc_trial_converted_event":"converted",
  "rc_trial_cancelled_event":"trialCancelled","rc_initial_purchase_event":"purchases",
  "rc_renewal_event":"renewals","rc_cancellation_event":"cancellations",
  "rc_expiration_event":"expirations","rc_billing_issue_event":"billingIssues",
  "rc_uncancellation_event":"uncancellations","paywall_shown":"paywall",
};

function multiTrend(dateFrom, interval) {
  const trunc = interval === "month" ? "toStartOfMonth(timestamp)"
    : interval === "week" ? "toStartOfWeek(timestamp)" : "toDate(timestamp)";
  return hogql(`SELECT ${trunc} as period, event, count() as cnt FROM events WHERE event IN (${EV_LIST}) AND timestamp >= now() - INTERVAL ${toInterval(dateFrom)} GROUP BY period, event ORDER BY period ASC`);
}

function multiCount(dateFrom) {
  return hogql(`SELECT event, count() as cnt FROM events WHERE event IN (${EV_LIST}) AND timestamp >= now() - INTERVAL ${toInterval(dateFrom)} GROUP BY event`);
}

function parseTrend(results, interval) {
  const byPeriod = {};
  const blank = () => ({ week:"",trials:0,converted:0,trialCancelled:0,purchases:0,renewals:0,cancellations:0,expirations:0,billingIssues:0,uncancellations:0,paywall:0 });
  for (const [period, event, cnt] of results) {
    const key = interval === "month" ? String(period).slice(0,7) : String(period).slice(5,10);
    if (!byPeriod[key]) { byPeriod[key] = blank(); byPeriod[key].week = key; }
    if (EVENT_MAP[event]) byPeriod[key][EVENT_MAP[event]] = Number(cnt);
  }
  return Object.values(byPeriod).sort((a,b) => a.week.localeCompare(b.week));
}

function parseCount(results) {
  const out = {};
  for (const [event, cnt] of results) out[event] = Number(cnt);
  return out;
}

function calcRates(rows) {
  const g = k => rows.reduce((a,w) => a+(w[k]||0), 0);
  const churnD = g("purchases")+g("renewals"), churnN = g("cancellations")+g("expirations");
  const rnewD  = g("renewals")+g("cancellations")+g("expirations"), rnewN = g("renewals");
  const tT = g("trials"), billD = g("purchases")+g("renewals");
  return {
    churn:       churnD>0 ? churnN/churnD*100 : null,
    renewal:     rnewD>0  ? rnewN/rnewD*100   : null,
    trialConv:   tT>0     ? g("converted")/tT*100      : null,
    trialCancel: tT>0     ? g("trialCancelled")/tT*100 : null,
    billing:     billD>0  ? g("billingIssues")/billD*100 : null,
  };
}

function RangePicker({ active, onChange }) {
  return (
    <div style={{ display:"flex",gap:4,background:C.navy+"14",border:`1px solid ${C.border}`,borderRadius:10,padding:4 }}>
      {RANGES.map(r => {
        const on = r.value === active.value;
        return <button key={r.value} onClick={() => onChange(r)} style={{ background:on?C.navy:"transparent",color:on?C.cream:C.muted,border:"none",borderRadius:7,padding:"6px 14px",fontSize:12,fontWeight:on?700:500,cursor:"pointer",fontFamily:"inherit",transition:"all .15s" }}>{r.label}</button>;
      })}
    </div>
  );
}

function KpiCard({ label, value, sub, color=C.purple, loading, delta, deltaLabel, avg4 }) {
  return (
    <div style={{ background:C.surface,border:`1px solid ${C.border}`,borderRadius:16,padding:"20px 22px",position:"relative",overflow:"hidden",boxShadow:"0 1px 4px rgba(23,24,48,0.05)" }}>
      <div style={{ position:"absolute",top:0,left:0,right:0,height:3,background:color,borderRadius:"16px 16px 0 0" }} />
      <div style={{ fontSize:10,color:C.muted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:10,fontWeight:600 }}>{label}</div>
      {loading ? <div style={{ height:38,width:90,background:C.dim,borderRadius:8,animation:"pulse 1.5s infinite" }} />
        : <>
            <div style={{ fontSize:34,fontWeight:700,color,letterSpacing:-1,fontFamily:"'Erode',serif",lineHeight:1 }}>{value}</div>
            {delta != null && <div style={{ fontSize:11,color:delta>=0?C.green:C.red,marginTop:5,fontWeight:600 }}>{delta>=0?"▲":"▼"} {Math.abs(delta).toFixed(1)}pp {deltaLabel||"vs prev"}</div>}
            {avg4  != null && <div style={{ fontSize:11,color:C.muted,marginTop:3 }}>4w avg: <span style={{ fontWeight:700,color:C.navy }}>{avg4}</span></div>}
          </>
      }
      {sub && !loading && <div style={{ fontSize:11,color:C.muted,marginTop:6 }}>{sub}</div>}
    </div>
  );
}

function Card({ title, badge, children, height }) {
  return (
    <div style={{ background:C.surface,border:`1px solid ${C.border}`,borderRadius:16,padding:"20px 22px",boxShadow:"0 1px 4px rgba(23,24,48,0.05)" }}>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
        <div style={{ fontSize:13,fontWeight:700,color:C.navy }}>{title}</div>
        {badge && <span style={{ fontSize:10,fontWeight:600,color:badge.color,background:badge.color+"18",border:`1px solid ${badge.color}30`,borderRadius:20,padding:"2px 10px" }}>{badge.label}</span>}
      </div>
      {height ? <div style={{ height }}>{children}</div> : children}
    </div>
  );
}

const TT = ({ active, payload, label }) => {
  if (!active||!payload?.length) return null;
  return (
    <div style={{ background:C.navy,border:`1px solid ${C.purple}40`,borderRadius:10,padding:"10px 14px",fontSize:12 }}>
      <div style={{ color:C.lavender,marginBottom:6,fontWeight:600 }}>{label}</div>
      {payload.map((p,i) => <div key={i} style={{ color:"#fff",fontWeight:500 }}><span style={{ color:p.color }}>{p.name}: </span>{fmt(p.value)}</div>)}
    </div>
  );
};

function StatRow({ label, value, color=C.navy, mono }) {
  return (
    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:`1px solid ${C.border}` }}>
      <span style={{ fontSize:13,color:C.muted }}>{label}</span>
      <span style={{ fontSize:14,fontWeight:700,color,fontFamily:mono?"'Erode',serif":"inherit" }}>{value}</span>
    </div>
  );
}

function Legend({ items }) {
  return (
    <div style={{ display:"flex",gap:16,flexWrap:"wrap",marginTop:10 }}>
      {items.map(({ color,label }) => (
        <div key={label} style={{ display:"flex",alignItems:"center",gap:5 }}>
          <div style={{ width:10,height:3,borderRadius:2,background:color }} />
          <span style={{ fontSize:11,color:C.muted }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

function buildAlerts({ monthlyChurn,renewalRate,trialCancelRate,billingRate,trialConvRate,churnDelta,renewDelta }) {
  const alerts = [];
  const icon = s => s==="red"?"🔴":s==="amber"?"🟡":"🟢";
  if (monthlyChurn!=null) { const s=monthlyChurn>12?"red":monthlyChurn>7?"amber":"green"; alerts.push({ status:s,icon:icon(s),label:"Churn Rate",value:pct(monthlyChurn),message:s==="red"?"High — needs attention":s==="amber"?"Elevated — monitor":"Healthy",delta:churnDelta!=null?-churnDelta:null }); }
  if (renewalRate!=null)  { const s=renewalRate<70?"red":renewalRate<82?"amber":"green";  alerts.push({ status:s,icon:icon(s),label:"Renewal Rate",value:pct(renewalRate),message:s==="red"?"Low — investigate":s==="amber"?"Below target":"On track",delta:renewDelta }); }
  if (trialCancelRate!=null) { const s=trialCancelRate>60?"red":trialCancelRate>45?"amber":"green"; alerts.push({ status:s,icon:icon(s),label:"Trial Cancels",value:pct(trialCancelRate),message:s==="red"?"Most trials cancelling":s==="amber"?"Above average":"Normal range" }); }
  if (billingRate!=null)  { const s=billingRate>6?"red":billingRate>3?"amber":"green";    alerts.push({ status:s,icon:icon(s),label:"Billing Issues",value:pct(billingRate),message:s==="red"?"High — revenue at risk":s==="amber"?"Worth watching":"Low" }); }
  if (trialConvRate!=null){ const s=trialConvRate<30?"red":trialConvRate<50?"amber":"green"; alerts.push({ status:s,icon:icon(s),label:"Trial Conv.",value:pct(trialConvRate),message:s==="red"?"Low conversion":s==="amber"?"Room to improve":"Good" }); }
  return alerts;
}

function HealthBar({ alerts, loading }) {
  if (loading) return (
    <div style={{ background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:"14px 20px",marginBottom:24,display:"flex",gap:10 }}>
      {[120,180,150].map((w,i) => <div key={i} style={{ width:w,height:14,background:C.dim,borderRadius:6,animation:"pulse 1.5s infinite" }} />)}
    </div>
  );
  const reds=alerts.filter(a=>a.status==="red").length, ambs=alerts.filter(a=>a.status==="amber").length;
  const os=reds>0?"red":ambs>0?"amber":"green", oc=os==="red"?C.red:os==="amber"?C.amber:C.green;
  return (
    <div style={{ background:oc+"10",border:`1px solid ${oc}30`,borderLeft:`4px solid ${oc}`,borderRadius:12,padding:"12px 18px",marginBottom:24,display:"flex",alignItems:"center",flexWrap:"wrap",gap:0 }}>
      <div style={{ display:"flex",alignItems:"center",gap:8,marginRight:20,paddingRight:20,borderRight:`1px solid ${oc}30`,flexShrink:0 }}>
        <span style={{ fontSize:16 }}>{os==="red"?"🔴":os==="amber"?"🟡":"🟢"}</span>
        <div>
          <div style={{ fontSize:11,fontWeight:800,color:oc,letterSpacing:0.5,textTransform:"uppercase" }}>{os==="green"?"All Clear":os==="amber"?"Heads Up":"Action Needed"}</div>
          <div style={{ fontSize:11,color:C.muted }}>{reds>0?`${reds} metric${reds>1?"s":""} need attention`:ambs>0?`${ambs} metric${ambs>1?"s":""} to watch`:"All metrics healthy"}</div>
        </div>
      </div>
      <div style={{ display:"flex",gap:8,flexWrap:"wrap",flex:1 }}>
        {alerts.map((a,i) => {
          const ac=a.status==="red"?C.red:a.status==="amber"?C.amber:C.green;
          return (
            <div key={i} style={{ display:"flex",alignItems:"center",gap:5,background:ac+"12",border:`1px solid ${ac}30`,borderRadius:20,padding:"5px 12px" }}>
              <span style={{ fontSize:11 }}>{a.icon}</span>
              <span style={{ fontSize:11,fontWeight:700,color:C.navy }}>{a.label}</span>
              <span style={{ fontSize:12,fontWeight:800,color:ac,fontFamily:"'Erode',serif" }}>{a.value}</span>
              {a.delta!=null && <span style={{ fontSize:10,color:a.delta>=0?C.green:C.red,fontWeight:600 }}>{a.delta>=0?"▲":"▼"}{Math.abs(a.delta).toFixed(1)}%</span>}
              <span style={{ fontSize:10,color:C.muted }}>{a.message}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function JourneyMap({ data, loading }) {
  const { fPaywall,totTrials,totConverted,totCancelled,totPurchases,totRenewals,totCancels,totExpirations,totBilling,totUncancel,trialConvRate,trialCancelRate,paywallTrialRate,overallConv,renewalRate,billingRate } = data;
  const stages = [
    { icon:"📲",stage:"Download",    desc:"User installs from App Store",   color:C.navy,  metric:null,           event:"App Store install",                    arrow:true },
    { icon:"👋",stage:"Paywall",     desc:"Shown during onboarding",        color:C.purple,metric:fmt(fPaywall),  event:"paywall_shown",                         arrow:true },
    { icon:"🔑",stage:"Trial Start", desc:"7-day free trial begins",        color:C.purple,metric:fmt(totTrials), event:"rc_trial_started_event",                arrow:true, rate:paywallTrialRate,rateLabel:"of paywall views",rateGood:paywallTrialRate>40 },
    { icon:"⏳",stage:"Trial Active",desc:"User experiences product",       color:C.amber, metric:null,           event:"rc_trial_converted\nrc_trial_cancelled", arrow:true,
      split:[{val:fmt(totConverted),rate:pct(trialConvRate),label:"convert",color:C.green},{val:fmt(totCancelled),rate:pct(trialCancelRate),label:"cancel trial",color:C.red}] },
    { icon:"💳",stage:"Subscriber",  desc:"First payment processed",        color:C.green, metric:fmt(totPurchases),event:"rc_initial_purchase_event",           arrow:true, rate:overallConv,rateLabel:"end-to-end conv.",rateGood:overallConv>5 },
    { icon:"🔄",stage:"Renewal",     desc:"Recurring billing succeeds",     color:C.green, metric:fmt(totRenewals), event:"rc_renewal_event",                    arrow:true, rate:renewalRate,rateLabel:"renewal rate",rateGood:renewalRate>82 },
    { icon:"⚠️",stage:"At Risk",     desc:"Billing fail or cancellation",   color:C.orange,metric:null,           event:"rc_billing_issue\nrc_cancellation",     arrow:true,
      split:[{val:fmt(totBilling),rate:pct(billingRate),label:"billing issue",color:C.orange},{val:fmt(totCancels),rate:null,label:"cancelled",color:C.red}] },
    { icon:"🔚",stage:"End State",   desc:"Expired or won back",            color:C.red,   metric:null,           event:"rc_expiration\nrc_uncancellation",       arrow:false,
      split:[{val:fmt(totExpirations),rate:null,label:"expired",color:C.red},{val:fmt(totUncancel),rate:null,label:"win-back",color:C.green}] },
  ];

  if (loading) return <Card title="User Journey · Download to Subscriber"><div style={{ height:140,background:C.dim,borderRadius:10,animation:"pulse 1.5s infinite" }} /></Card>;

  return (
    <Card title="User Journey · Download to Subscriber">
      <div style={{ overflowX:"auto",paddingBottom:8 }}>
        <div style={{ display:"flex",alignItems:"stretch",minWidth:880,gap:0 }}>
          {stages.map((s,idx) => (
            <div key={idx} style={{ display:"flex",alignItems:"center",flex:1 }}>
              <div style={{ flex:1,background:C.cream,border:`1.5px solid ${s.color}25`,borderTop:`3px solid ${s.color}`,borderRadius:10,padding:"10px 8px",minWidth:90 }}>
                <div style={{ fontSize:16,marginBottom:3 }}>{s.icon}</div>
                <div style={{ fontSize:9,fontWeight:800,color:s.color,letterSpacing:1,textTransform:"uppercase",marginBottom:2 }}>{s.stage}</div>
                <div style={{ fontSize:9,color:C.muted,marginBottom:5,lineHeight:1.4 }}>{s.desc}</div>
                {s.metric && <div style={{ fontSize:18,fontWeight:800,color:s.color,fontFamily:"'Erode',serif",lineHeight:1 }}>{s.metric}</div>}
                {s.split && (
                  <div style={{ display:"flex",gap:4 }}>
                    {s.split.map((sp,si) => (
                      <div key={si} style={{ flex:1,background:sp.color+"12",border:`1px solid ${sp.color}25`,borderRadius:5,padding:"3px 5px" }}>
                        <div style={{ fontSize:13,fontWeight:800,color:sp.color,fontFamily:"'Erode',serif" }}>{sp.val}</div>
                        {sp.rate && <div style={{ fontSize:8,color:sp.color,fontWeight:700 }}>{sp.rate}</div>}
                        <div style={{ fontSize:8,color:C.muted }}>{sp.label}</div>
                      </div>
                    ))}
                  </div>
                )}
                {s.rate != null && (
                  <div style={{ marginTop:5,display:"inline-flex",alignItems:"center",gap:3,background:(s.rateGood?C.green:C.amber)+"15",border:`1px solid ${(s.rateGood?C.green:C.amber)}30`,borderRadius:20,padding:"2px 7px" }}>
                    <span style={{ fontSize:10,fontWeight:800,color:s.rateGood?C.green:C.amber,fontFamily:"'Erode',serif" }}>{pct(s.rate)}</span>
                    <span style={{ fontSize:8,color:C.muted }}>{s.rateLabel}</span>
                  </div>
                )}
                <div style={{ marginTop:5,fontSize:8,color:C.muted,fontFamily:"monospace",lineHeight:1.5 }}>
                  {s.event.split("\n").map((e,i) => <div key={i}>{e}</div>)}
                </div>
              </div>
              {s.arrow && (
                <div style={{ display:"flex",alignItems:"center",flexShrink:0,padding:"0 1px" }}>
                  <div style={{ width:16,height:2,background:C.border }} />
                  <div style={{ width:0,height:0,borderTop:"4px solid transparent",borderBottom:"4px solid transparent",borderLeft:`5px solid ${C.border}` }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop:14,padding:"10px 14px",background:C.lavender+"25",border:`1px solid ${C.lavender}`,borderRadius:10,display:"flex",gap:20,flexWrap:"wrap",alignItems:"center" }}>
        <div style={{ fontSize:11,fontWeight:700,color:C.navy }}>Key rates:</div>
        {[{label:"Paywall→Trial",val:paywallTrialRate,good:40,inv:false},{label:"Trial→Paid",val:trialConvRate,good:50,inv:false},{label:"Trial cancel",val:trialCancelRate,good:45,inv:true},{label:"Renewal rate",val:renewalRate,good:82,inv:false},{label:"Billing issues",val:billingRate,good:3,inv:true}].map(({ label,val,good,inv }) => {
          if (val==null) return null;
          const isGood=inv?val<=good:val>=good, col=isGood?C.green:val>good*0.7?C.amber:C.red;
          return <div key={label} style={{ display:"flex",alignItems:"center",gap:5 }}><div style={{ width:7,height:7,borderRadius:"50%",background:col }} /><span style={{ fontSize:11,color:C.muted }}>{label}</span><span style={{ fontSize:12,fontWeight:800,color:col,fontFamily:"'Erode',serif" }}>{pct(val)}</span></div>;
        })}
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const [range,setRange]     = useState(DEFAULT);
  const [d,setD]             = useState({});
  const [status,setStatus]   = useState("idle");
  const [err,setErr]         = useState("");
  const [updated,setUpdated] = useState(null);

  async function load(r) {
    setStatus("loading"); setErr("");
    try {
      const [currTrend,prevTrend,currCount,prevCount] = await Promise.all([
        multiTrend(r.value, r.interval),
        multiTrend(r.prevValue, r.prevInterval),
        multiCount(r.value),
        multiCount(r.prevValue),
      ]);

      const series  = parseTrend(currTrend, r.interval);
      const prevAll = parseTrend(prevTrend, r.prevInterval);
      const counts  = parseCount(currCount);
      const prevRows = r.value==="-7d" ? prevAll.slice(0,7) : prevAll.slice(0,Math.floor(prevAll.length/2));

      const fPaywall=counts["paywall_shown"]||0, fTrial=counts["rc_trial_started_event"]||0;
      const fConverted=counts["rc_trial_converted_event"]||0, fPurchased=counts["rc_initial_purchase_event"]||0;
      const totTrials=counts["rc_trial_started_event"]||0, totConverted=counts["rc_trial_converted_event"]||0;
      const totCancelled=counts["rc_trial_cancelled_event"]||0, totPurchases=counts["rc_initial_purchase_event"]||0;
      const totRenewals=counts["rc_renewal_event"]||0, totCancels=counts["rc_cancellation_event"]||0;
      const totExpirations=counts["rc_expiration_event"]||0, totBilling=counts["rc_billing_issue_event"]||0;
      const totUncancel=counts["rc_uncancellation_event"]||0;

      const trialConvRate   = totTrials>0 ? totConverted/totTrials*100 : null;
      const trialCancelRate = totTrials>0 ? totCancelled/totTrials*100 : null;
      const paywallTrialRate= fPaywall>0  ? fTrial/fPaywall*100 : null;
      const overallConv     = fPaywall>0  ? fPurchased/fPaywall*100 : null;
      const billingRate     = (totPurchases+totRenewals)>0 ? totBilling/(totPurchases+totRenewals)*100 : null;

      const curr=calcRates(series), prev=calcRates(prevRows);
      const monthlyChurn=curr.churn, renewalRate=curr.renewal;

      let fourWeekAvg=null;
      if (r.value==="-7d") {
        const rates=[prevAll.slice(0,7),prevAll.slice(7,14),series].map(calcRates);
        const avg=k=>{ const v=rates.map(x=>x[k]).filter(x=>x!=null); return v.length?v.reduce((a,b)=>a+b,0)/v.length:null; };
        fourWeekAvg={churn:avg("churn"),renewal:avg("renewal"),trialConv:avg("trialConv"),trialCancel:avg("trialCancel"),billing:avg("billing")};
      }

      const dlLabel  =r.value==="-7d"?"vs last week":`vs prev ${r.display.replace("Last ","")}`;
      const compLabel=r.value==="-7d"?"last week + 4w avg":`prev ${r.display.replace("Last ","")}`;

      setD({ series,fPaywall,fTrial,fConverted,fPurchased,totTrials,totConverted,totCancelled,totPurchases,totRenewals,totCancels,totExpirations,totBilling,totUncancel,trialConvRate,trialCancelRate,paywallTrialRate,overallConv,billingRate,monthlyChurn,renewalRate,
        churnDelta:diff(curr.churn,prev.churn),renewDelta:diff(curr.renewal,prev.renewal),trialConvDelta:diff(curr.trialConv,prev.trialConv),trialCancelDelta:diff(curr.trialCancel,prev.trialCancel),billingDelta:diff(curr.billing,prev.billing),
        fourWeekAvg,dlLabel,compLabel });
      setUpdated(new Date().toLocaleTimeString());
      setStatus("done");
    } catch(e) { setErr(e.message); setStatus("error"); }
  }

  useEffect(() => { load(range); }, [range]);

  const loading=status==="loading";
  const { series=[],fPaywall,fTrial,fConverted,fPurchased,totTrials,totConverted,totCancelled,totPurchases,totRenewals,totCancels,totExpirations,totBilling,totUncancel,trialConvRate,trialCancelRate,paywallTrialRate,overallConv,billingRate,monthlyChurn,renewalRate,churnDelta,renewDelta,trialConvDelta,trialCancelDelta,billingDelta,fourWeekAvg,dlLabel,compLabel } = d;

  const is7D=range.value==="-7d";
  const churnColor=monthlyChurn==null?C.purple:monthlyChurn>12?C.red:monthlyChurn>7?C.amber:C.green;
  const alerts=buildAlerts({monthlyChurn,renewalRate,trialCancelRate,billingRate,trialConvRate,churnDelta,renewDelta});
  const funnelData=[{name:"Paywall",value:fPaywall,color:C.lavender},{name:"Trial",value:fTrial,color:C.purple},{name:"Converted",value:fConverted,color:C.orange},{name:"Purchased",value:fPurchased,color:C.green}];
  const healthData=series.map(w=>({ week:w.week,Renewals:w.renewals,"New Subs":w.purchases,Cancels:-(w.cancellations+w.expirations) }));

  return (
    <div style={{ fontFamily:"'Figtree',sans-serif",background:C.cream,minHeight:"100vh",color:C.navy }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Figtree:wght@300;400;500;600;700;800&display=swap');
        @keyframes pulse{0%,100%{opacity:.5}50%{opacity:.9}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
        *{box-sizing:border-box;} button:hover{opacity:.85;}
      `}</style>

      <div style={{ background:C.navy,height:54,padding:"0 32px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100 }}>
        <div style={{ display:"flex",alignItems:"center",gap:10 }}>
          <svg width="20" height="20" viewBox="0 0 24 24"><path d="M12 2L13.5 9.5L21 8L15.5 13L19 20L12 16.5L5 20L8.5 13L3 8L10.5 9.5Z" fill={C.cream}/></svg>
          <span style={{ color:C.cream,fontWeight:700,fontSize:15,fontFamily:"'Erode',serif" }}>Purpose</span>
          <span style={{ color:C.lavender,fontSize:12,opacity:.55,marginLeft:4 }}>/ Retention</span>
        </div>
        <div style={{ display:"flex",alignItems:"center",gap:12 }}>
          {updated && <span style={{ fontSize:11,color:C.lavender,opacity:.5 }}>Updated {updated}</span>}
          {err     && <span style={{ fontSize:11,color:"#ff9b9b" }}>⚠ {err}</span>}
          <button onClick={()=>load(range)} disabled={loading} style={{ background:loading?"transparent":C.purple,color:"#fff",border:`1px solid ${loading?C.lavender+"30":C.purple}`,borderRadius:8,padding:"6px 14px",fontSize:12,fontWeight:600,cursor:loading?"not-allowed":"pointer",fontFamily:"inherit",opacity:loading?.4:1,transition:"opacity .2s" }}>{loading?"Loading…":"↺ Refresh"}</button>
        </div>
      </div>

      <div style={{ padding:"32px 32px 52px" }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:28,animation:"fadeUp .35s ease" }}>
          <div>
            <h1 style={{ margin:0,fontSize:30,fontWeight:700,letterSpacing:-.5,fontFamily:"'Erode',serif" }}>Retention & Churn</h1>
            <p style={{ margin:"5px 0 0",fontSize:13,color:C.muted }}>
              {range.display} · RevenueCat via PostHog
              {compLabel&&!loading&&<span style={{ marginLeft:8,color:C.purple,fontWeight:600 }}>· ▲▼ vs {compLabel}</span>}
            </p>
          </div>
          <RangePicker active={range} onChange={r=>setRange(r)} />
        </div>

        <HealthBar alerts={alerts} loading={loading} />

        <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:14,animation:"fadeUp .35s ease .05s both" }}>
          <KpiCard label="Churn Rate" loading={loading} value={pct(monthlyChurn)} color={churnColor} sub="(cancels + exp.) ÷ (renewals + purchases)" delta={churnDelta!=null?-churnDelta:null} deltaLabel={dlLabel} avg4={is7D&&fourWeekAvg?pct(fourWeekAvg.churn):null} />
          <KpiCard label="Renewal Rate" loading={loading} value={pct(renewalRate)} color={C.green} sub="renewals ÷ (renewals + cancels + exp.)" delta={renewDelta} deltaLabel={dlLabel} avg4={is7D&&fourWeekAvg?pct(fourWeekAvg.renewal):null} />
          <KpiCard label="Trial → Paid Conv." loading={loading} value={pct(trialConvRate)} color={C.purple} sub="rc_trial_converted ÷ rc_trial_started" delta={trialConvDelta} deltaLabel={dlLabel} avg4={is7D&&fourWeekAvg?pct(fourWeekAvg.trialConv):null} />
          <KpiCard label="Billing Issue Rate" loading={loading} value={pct(billingRate)} color={billingRate>5?C.red:C.amber} sub="billing issues ÷ total transactions" delta={billingDelta} deltaLabel={dlLabel} avg4={is7D&&fourWeekAvg?pct(fourWeekAvg.billing):null} />
        </div>

        <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:24,animation:"fadeUp .35s ease .1s both" }}>
          <KpiCard label="Paywall → Trial" loading={loading} value={pct(paywallTrialRate)} color={C.orange} sub="of paywall impressions started a trial" />
          <KpiCard label="Trial Cancel Rate" loading={loading} value={pct(trialCancelRate)} color={trialCancelRate>50?C.red:C.amber} sub="rc_trial_cancelled ÷ rc_trial_started" delta={trialCancelDelta} deltaLabel={dlLabel} avg4={is7D&&fourWeekAvg?pct(fourWeekAvg.trialCancel):null} />
          <KpiCard label="End-to-End Conv." loading={loading} value={pct(overallConv)} color={C.green} sub="paywall view → initial purchase" />
          <KpiCard label="Win-backs" loading={loading} value={fmt(totUncancel)} color={C.purple} sub="rc_uncancellation_event" />
        </div>

        <div style={{ display:"grid",gridTemplateColumns:"2fr 1fr",gap:16,marginBottom:16,animation:"fadeUp .35s ease .15s both" }}>
          <Card title="Subscription Health" badge={{ label:"LIVE RC DATA",color:C.green }}>
            <div style={{ height:200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={healthData} margin={{ top:5,right:5,bottom:0,left:-25 }}>
                  <XAxis dataKey="week" tick={{ fill:C.muted,fontSize:10 }} axisLine={false} tickLine={false}/>
                  <YAxis tick={{ fill:C.muted,fontSize:10 }} axisLine={false} tickLine={false}/>
                  <Tooltip content={<TT/>}/>
                  <Bar dataKey="Renewals" fill={C.green}  stackId="pos" radius={[0,0,0,0]}/>
                  <Bar dataKey="New Subs" fill={C.purple} stackId="pos" radius={[3,3,0,0]}/>
                  <Bar dataKey="Cancels"  fill={C.red}    stackId="neg" radius={[3,3,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Legend items={[{color:C.green,label:"Renewals"},{color:C.purple,label:"New subs"},{color:C.red,label:"Cancels + expirations"}]}/>
          </Card>
          <Card title={`Funnel · ${range.display}`} height={220}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelData} layout="vertical" margin={{ top:0,right:20,bottom:0,left:5 }}>
                <XAxis type="number" tick={{ fill:C.muted,fontSize:10 }} axisLine={false} tickLine={false}/>
                <YAxis type="category" dataKey="name" tick={{ fill:C.muted,fontSize:10 }} axisLine={false} tickLine={false} width={72}/>
                <Tooltip content={<TT/>}/>
                <Bar dataKey="value" name="Users" radius={[0,5,5,0]}>{funnelData.map((f,i)=><Cell key={i} fill={f.color}/>)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>

        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16,animation:"fadeUp .35s ease .2s both" }}>
          <Card title="Trial Funnel">
            <div style={{ height:160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top:5,right:5,bottom:0,left:-25 }}>
                  <defs>{[["tp",C.purple],["tc",C.green],["tx",C.red]].map(([id,col])=><linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={col} stopOpacity={0.18}/><stop offset="95%" stopColor={col} stopOpacity={0}/></linearGradient>)}</defs>
                  <XAxis dataKey="week" tick={{ fill:C.muted,fontSize:10 }} axisLine={false} tickLine={false}/>
                  <YAxis tick={{ fill:C.muted,fontSize:10 }} axisLine={false} tickLine={false}/>
                  <Tooltip content={<TT/>}/>
                  <Area type="monotone" dataKey="trials"         name="Started"   stroke={C.purple} fill="url(#tp)" strokeWidth={2} dot={false}/>
                  <Area type="monotone" dataKey="converted"      name="Converted" stroke={C.green}  fill="url(#tc)" strokeWidth={2} dot={false}/>
                  <Area type="monotone" dataKey="trialCancelled" name="Cancelled" stroke={C.red}    fill="url(#tx)" strokeWidth={2} dot={false}/>
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <Legend items={[{color:C.purple,label:"Trial started"},{color:C.green,label:"Converted"},{color:C.red,label:"Trial cancelled"}]}/>
          </Card>
          <Card title="Churn Signals">
            <div style={{ height:160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top:5,right:5,bottom:0,left:-25 }}>
                  <defs>{[["ca",C.red],["ex",C.amber],["bi",C.orange]].map(([id,col])=><linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={col} stopOpacity={0.18}/><stop offset="95%" stopColor={col} stopOpacity={0}/></linearGradient>)}</defs>
                  <XAxis dataKey="week" tick={{ fill:C.muted,fontSize:10 }} axisLine={false} tickLine={false}/>
                  <YAxis tick={{ fill:C.muted,fontSize:10 }} axisLine={false} tickLine={false}/>
                  <Tooltip content={<TT/>}/>
                  <Area type="monotone" dataKey="cancellations" name="Cancellations"  stroke={C.red}    fill="url(#ca)" strokeWidth={2} dot={false}/>
                  <Area type="monotone" dataKey="expirations"   name="Expirations"    stroke={C.amber}  fill="url(#ex)" strokeWidth={2} dot={false}/>
                  <Area type="monotone" dataKey="billingIssues" name="Billing Issues" stroke={C.orange} fill="url(#bi)" strokeWidth={2} dot={false}/>
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <Legend items={[{color:C.red,label:"Cancellations"},{color:C.amber,label:"Expirations"},{color:C.orange,label:"Billing issues"}]}/>
          </Card>
        </div>

        <div style={{ marginBottom:16,animation:"fadeUp .35s ease .22s both" }}>
          <JourneyMap data={d} loading={loading}/>
        </div>

        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:32,animation:"fadeUp .35s ease .25s both" }}>
          <Card title={`Event Totals · ${range.display}`}>
            <StatRow label="Trial starts"        value={fmt(totTrials)}/>
            <StatRow label="Trial conversions"   value={fmt(totConverted)}   color={C.green}  mono/>
            <StatRow label="Trial cancellations" value={fmt(totCancelled)}   color={C.red}    mono/>
            <StatRow label="Initial purchases"   value={fmt(totPurchases)}   color={C.purple} mono/>
            <StatRow label="Renewals"            value={fmt(totRenewals)}    color={C.green}  mono/>
            <StatRow label="Cancellations"       value={fmt(totCancels)}     color={C.red}    mono/>
            <StatRow label="Expirations"         value={fmt(totExpirations)} color={C.amber}  mono/>
            <StatRow label="Billing issues"      value={fmt(totBilling)}     color={C.orange} mono/>
            <StatRow label="Win-backs"           value={fmt(totUncancel)}    color={C.green}  mono/>
          </Card>
          <Card title="How Metrics Are Calculated">
            {[["Churn Rate","(cancellations+expirations) ÷ (purchases+renewals)"],["Renewal Rate","renewals ÷ (renewals+cancellations+expirations)"],["▲▼ 7D delta","vs last week · 4w avg shown below delta"],["▲▼ Other ranges","vs previous identical period"],["Trial Conv.","rc_trial_converted ÷ rc_trial_started"],["Trial Cancel","rc_trial_cancelled ÷ rc_trial_started"],["End-to-End Conv.","rc_initial_purchase ÷ paywall_shown"]].map(([k,v])=>(
              <div key={k} style={{ padding:"8px 0",borderBottom:`1px solid ${C.border}` }}>
                <div style={{ fontSize:12,fontWeight:700,color:C.navy }}>{k}</div>
                <div style={{ fontSize:11,color:C.muted,marginTop:2 }}>{v}</div>
              </div>
            ))}
          </Card>
        </div>

        <div style={{ background:C.navy,borderRadius:14,padding:"18px 26px",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
          <div style={{ display:"flex",alignItems:"center",gap:10 }}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 2L13.5 9.5L21 8L15.5 13L19 20L12 16.5L5 20L8.5 13L3 8L10.5 9.5Z" fill={C.cream}/></svg>
            <span style={{ color:C.cream,fontWeight:700,fontSize:14,fontFamily:"'Erode',serif" }}>Purpose</span>
            <span style={{ color:C.lavender,fontSize:12,opacity:.5,marginLeft:4 }}>Retention Dashboard</span>
          </div>
          <span style={{ color:C.lavender,fontSize:11,opacity:.5 }}>RevenueCat · PostHog · {range.display} · {new Date().getFullYear()}</span>
        </div>
      </div>
    </div>
  );
}
