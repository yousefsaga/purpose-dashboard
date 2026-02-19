import { useState, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, AreaChart, Area, LineChart, Line, CartesianGrid } from "recharts";

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
  const r = await fetch(`/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

function MethodologySection() {
  const [open, setOpen] = useState(false);
  const rows = [
    ["Churn Rate",        "(cancellations + expirations) ÷ (purchases + renewals)"],
    ["Renewal Rate",      "renewals ÷ (renewals + cancellations + expirations)"],
    ["Trial Conv.",       "rc_trial_converted ÷ rc_trial_started"],
    ["Trial Cancel",      "rc_trial_cancelled ÷ rc_trial_started"],
    ["End-to-End Conv.",  "rc_initial_purchase ÷ paywall_shown"],
    ["Billing Issue Rate","rc_billing_issue ÷ (purchases + renewals)"],
    ["▲▼ 7D delta",       "vs previous 7 days · 4-week avg shown below"],
    ["▲▼ Other ranges",   "vs previous identical period (e.g. 90D vs prior 90D)"],
    ["Cohort conv. rate", "trial conversions ÷ trial starts, grouped by start week"],
    ["Day N retention",   "users who opened app on day N ÷ users who first opened on day 0"],
    ["Time to churn",     "days between rc_trial_started and rc_cancellation per user"],
    ["Revenue estimate",  "purchase + renewal event counts — price not in PostHog"],
  ];
  return (
    <div style={{ marginBottom:24 }}>
      <button onClick={()=>setOpen(o=>!o)} style={{ width:"100%",background:"transparent",border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",fontFamily:"inherit" }}>
        <span style={{ fontSize:11,color:C.muted,fontWeight:600,letterSpacing:1,textTransform:"uppercase" }}>How metrics are calculated</span>
        <span style={{ fontSize:12,color:C.muted,opacity:.6 }}>{open?"▲ collapse":"▼ expand"}</span>
      </button>
      {open && (
        <div style={{ border:`1px solid ${C.border}`,borderTop:"none",borderRadius:"0 0 10px 10px",padding:"4px 16px 12px",background:C.surface }}>
          {rows.map(([k,v])=>(
            <div key={k} style={{ display:"flex",gap:16,padding:"7px 0",borderBottom:`1px solid ${C.border}` }}>
              <div style={{ width:160,flexShrink:0,fontSize:11,fontWeight:700,color:C.navy }}>{k}</div>
              <div style={{ fontSize:11,color:C.muted }}>{v}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [view,    setView]    = useState("mobile"); // "mobile" | "web"
  const [range,setRange]     = useState(DEFAULT);
  const [d,setD]             = useState({});
  const [status,setStatus]   = useState("idle");
  const [err,setErr]         = useState("");
  const [updated,setUpdated] = useState(null);
  const [wd,setWd]           = useState({});
  const [wStatus,setWStatus] = useState("idle");

  async function loadWeb(r) {
    setWStatus("loading");
    try {
      const WEB_EVENTS = [
        "web_funnel_page_view","web_funnel_quiz_start","web_funnel_quiz_complete",
        "web_funnel_results_view","web_funnel_pricing_view","web_funnel_checkout_start",
        "web_funnel_checkout_created","web_funnel_checkout_session_created",
        "web_funnel_checkout_redirect_initiated","web_funnel_trial_start",
        "web_funnel_sign_up_complete","web_funnel_subscription_renewed",
        "web_funnel_success_view","web_funnel_success_error",
        "web_funnel_checkout_redirect_failed","web_funnel_account_activation_error",
        "web_funnel_subscription_cancelled",
      ];
      const evList = WEB_EVENTS.map(e=>`'${e}'`).join(",");
      const interval = r.interval;
      const trunc = interval==="month"?"toStartOfMonth(timestamp)":interval==="week"?"toStartOfWeek(timestamp)":"toDate(timestamp)";

      const [counts, trend, quizSteps] = await Promise.all([
        hogql(`SELECT event, count() as cnt, count(distinct distinct_id) as users FROM events WHERE event IN (${evList}) AND timestamp >= now() - INTERVAL ${toInterval(r.value)} GROUP BY event`),
        hogql(`SELECT ${trunc} as period, event, count(distinct distinct_id) as users FROM events WHERE event IN ('web_funnel_page_view','web_funnel_quiz_start','web_funnel_quiz_complete','web_funnel_pricing_view','web_funnel_checkout_start','web_funnel_trial_start') AND timestamp >= now() - INTERVAL ${toInterval(r.value)} GROUP BY period, event ORDER BY period ASC`),
        hogql(`SELECT count(distinct distinct_id) as users FROM events WHERE event = 'web_funnel_quiz_step' AND timestamp >= now() - INTERVAL ${toInterval(r.value)}`),
      ]);

      const c = {};
      for (const [event,,users] of counts) c[event] = Number(users);

      // Build main funnel steps
      const funnelSteps = [
        { key:"web_funnel_page_view",                    label:"Page View",          icon:"🌐" },
        { key:"web_funnel_quiz_start",                   label:"Quiz Start",         icon:"📋" },
        { key:"web_funnel_quiz_complete",                label:"Quiz Complete",      icon:"✅" },
        { key:"web_funnel_results_view",                 label:"Results View",       icon:"📊" },
        { key:"web_funnel_pricing_view",                 label:"Pricing View",       icon:"💰" },
        { key:"web_funnel_checkout_start",               label:"Checkout Start",     icon:"🛒" },
        { key:"web_funnel_checkout_created",             label:"Checkout Created",   icon:"📝" },
        { key:"web_funnel_checkout_session_created",     label:"Session Created",    icon:"🔗" },
        { key:"web_funnel_checkout_redirect_initiated",  label:"Redirect",           icon:"↗️" },
        { key:"web_funnel_trial_start",                  label:"Trial Start",        icon:"🎉" },
        { key:"web_funnel_success_view",                 label:"Success View",       icon:"🏆" },
      ].map((s,i,arr) => {
        const users = c[s.key]||0;
        const prev  = i>0 ? c[arr[i-1].key]||0 : null;
        const fromPrev = prev!=null && prev>0 ? users/prev*100 : null;
        const fromTop  = (c["web_funnel_page_view"]||0)>0 ? users/(c["web_funnel_page_view"]||1)*100 : null;
        return { ...s, users, fromPrev, fromTop };
      });

      // Errors
      const errors = [
        { label:"Checkout redirect failed", users:c["web_funnel_checkout_redirect_failed"]||0, color:C.red },
        { label:"Success error",            users:c["web_funnel_success_error"]||0,             color:C.orange },
        { label:"Account activation error", users:c["web_funnel_account_activation_error"]||0,  color:C.amber },
      ];

      // Trend by period
      const byPeriod = {};
      for (const [period, event, users] of trend) {
        const key = interval==="month" ? String(period).slice(0,7) : String(period).slice(5,10);
        if (!byPeriod[key]) byPeriod[key] = { period:key, pageViews:0, quizStarts:0, quizCompletes:0, pricingViews:0, checkoutStarts:0, trialStarts:0 };
        const map = { "web_funnel_page_view":"pageViews","web_funnel_quiz_start":"quizStarts","web_funnel_quiz_complete":"quizCompletes","web_funnel_pricing_view":"pricingViews","web_funnel_checkout_start":"checkoutStarts","web_funnel_trial_start":"trialStarts" };
        if (map[event]) byPeriod[key][map[event]] = Number(users);
      }
      const trendData = Object.values(byPeriod).sort((a,b)=>a.period.localeCompare(b.period));

      // Sign-up breakdown
      const signupMethods = [
        { label:"Email", users:(c["web_funnel_sign_up_email_success"]||0), color:C.purple },
        { label:"OAuth", users:(c["web_funnel_sign_up_oauth_submit"]||0),  color:C.orange },
      ];

      setWd({ funnelSteps, trendData, errors, signupMethods,
        totalPageViews:c["web_funnel_page_view"]||0,
        totalTrials:c["web_funnel_trial_start"]||0,
        totalRenewals:c["web_funnel_subscription_renewed"]||0,
        totalCancelled:c["web_funnel_subscription_cancelled"]||0,
        quizCompRate: (c["web_funnel_quiz_start"]||0)>0 ? (c["web_funnel_quiz_complete"]||0)/(c["web_funnel_quiz_start"]||1)*100 : null,
        pricingRate:  (c["web_funnel_quiz_complete"]||0)>0 ? (c["web_funnel_pricing_view"]||0)/(c["web_funnel_quiz_complete"]||1)*100 : null,
        checkoutRate: (c["web_funnel_pricing_view"]||0)>0 ? (c["web_funnel_checkout_start"]||0)/(c["web_funnel_pricing_view"]||1)*100 : null,
        trialRate:    (c["web_funnel_page_view"]||0)>0 ? (c["web_funnel_trial_start"]||0)/(c["web_funnel_page_view"]||1)*100 : null,
      });
      setWStatus("done");
    } catch(e) { setWStatus("error"); setErr(e.message); }
  }

  async function load(r) {
    setStatus("loading"); setErr("");
    try {
      const [currTrend,prevTrend,currCount,prevCount,churnDailyRaw,featureRaw,ttcRaw,cohortRaw,retentionRaw,featureAdoptionRaw,revenueRaw] = await Promise.all([
        multiTrend(r.value, r.interval),
        multiTrend(r.prevValue, r.prevInterval),
        multiCount(r.value),
        multiCount(r.prevValue),
        hogql(`SELECT toDate(timestamp) as day, event, count() as cnt FROM events WHERE event IN ('rc_cancellation_event','rc_expiration_event') AND timestamp >= now() - INTERVAL ${toInterval(r.value)} GROUP BY day, event ORDER BY day ASC`),
        hogql(`SELECT event, count() as cnt FROM events WHERE event NOT LIKE '$%' AND event NOT LIKE 'appsflyer%' AND event NOT LIKE 'rc_%' AND event != 'paywall_shown' AND event NOT LIKE 'Application%' AND event NOT IN ('connectivity_issue','posthog_identify') AND timestamp >= now() - INTERVAL ${toInterval(r.value)} GROUP BY event ORDER BY cnt DESC LIMIT 8`),
        hogql(`SELECT dateDiff('day', trial.ts, cancel.ts) as days_to_cancel, count() as users FROM (SELECT distinct_id, min(timestamp) as ts FROM events WHERE event = 'rc_trial_started_event' AND timestamp >= now() - INTERVAL ${toInterval(r.value)} GROUP BY distinct_id) trial JOIN (SELECT distinct_id, min(timestamp) as ts FROM events WHERE event = 'rc_cancellation_event' AND timestamp >= now() - INTERVAL ${toInterval(r.value)} GROUP BY distinct_id) cancel ON trial.distinct_id = cancel.distinct_id WHERE days_to_cancel >= 0 AND days_to_cancel <= 60 GROUP BY days_to_cancel ORDER BY days_to_cancel ASC`),
        hogql(`SELECT toStartOfWeek(t.ts) as cohort_week, count(distinct t.distinct_id) as trial_starts, countIf(c.distinct_id IS NOT NULL) as conversions FROM (SELECT distinct_id, min(timestamp) as ts FROM events WHERE event = 'rc_trial_started_event' AND timestamp >= now() - INTERVAL ${toInterval(r.value)} GROUP BY distinct_id) t LEFT JOIN (SELECT distinct_id, min(timestamp) as ts FROM events WHERE event = 'rc_trial_converted_event' AND timestamp >= now() - INTERVAL ${toInterval(r.value)} GROUP BY distinct_id) c ON t.distinct_id = c.distinct_id GROUP BY cohort_week ORDER BY cohort_week ASC`),
        hogql(`SELECT toStartOfWeek(first.ts) as cohort_week, count(distinct first.distinct_id) as users, countIf(dateDiff('day',first.ts,ret.ts) BETWEEN 1 AND 2) as day1, countIf(dateDiff('day',first.ts,ret.ts) BETWEEN 6 AND 8) as day7, countIf(dateDiff('day',first.ts,ret.ts) BETWEEN 28 AND 32) as day30 FROM (SELECT distinct_id, min(timestamp) as ts FROM events WHERE event = 'Application Opened' AND timestamp >= now() - INTERVAL ${toInterval(r.value)} GROUP BY distinct_id) first LEFT JOIN (SELECT distinct_id, timestamp as ts FROM events WHERE event = 'Application Opened' AND timestamp >= now() - INTERVAL ${toInterval(r.value)}) ret ON first.distinct_id = ret.distinct_id GROUP BY cohort_week ORDER BY cohort_week ASC`),
        hogql(`SELECT chat_users.used_chat, count(distinct chat_users.distinct_id) as users, countIf(conv.distinct_id IS NOT NULL) as converted FROM (SELECT distinct_id, countIf(event='chat_message_sent')>0 as used_chat FROM events WHERE timestamp >= now() - INTERVAL ${toInterval(r.value)} AND event IN ('rc_trial_started_event','chat_message_sent') GROUP BY distinct_id) chat_users LEFT JOIN (SELECT distinct_id FROM events WHERE event='rc_trial_converted_event' AND timestamp >= now() - INTERVAL ${toInterval(r.value)} GROUP BY distinct_id) conv ON chat_users.distinct_id = conv.distinct_id GROUP BY chat_users.used_chat`),
        hogql(`SELECT toStartOfWeek(timestamp) as week, countIf(event='rc_initial_purchase_event') as purchases, countIf(event='rc_renewal_event') as renewals FROM events WHERE event IN ('rc_initial_purchase_event','rc_renewal_event') AND timestamp >= now() - INTERVAL ${toInterval(r.value)} GROUP BY week ORDER BY week ASC`),
      ]);

      const series  = parseTrend(currTrend, r.interval);
      const prevAll = parseTrend(prevTrend, r.prevInterval);
      const counts  = parseCount(currCount);
      const prevRows = r.value==="-7d" ? prevAll.slice(0,7) : prevAll.slice(0,Math.floor(prevAll.length/2));

      // Churn trend — daily cancellations + expirations
      const churnByDay = {};
      for (const [day, event, cnt] of churnDailyRaw) {
        if (!churnByDay[day]) churnByDay[day] = { day:String(day).slice(5,10), cancellations:0, expirations:0 };
        if (event==="rc_cancellation_event") churnByDay[day].cancellations = Number(cnt);
        if (event==="rc_expiration_event")   churnByDay[day].expirations   = Number(cnt);
      }
      const churnTrend = Object.values(churnByDay).sort((a,b)=>a.day.localeCompare(b.day));

      // Feature usage
      const featureUsage = featureRaw.map(([event, cnt]) => ({
        name: event.replace(/_/g," ").replace("event","").trim(),
        count: Number(cnt),
      })).reverse();

      // Time to churn — days 0-60 histogram, group into buckets
      const ttcBuckets = [
        { label:"Day 0-1", days:[0,1], count:0 },
        { label:"Day 2-6", days:[2,6], count:0 },
        { label:"Day 7",   days:[7,7], count:0 },
        { label:"Day 8-14",days:[8,14], count:0 },
        { label:"Day 15-30",days:[15,30], count:0 },
        { label:"Day 31-60",days:[31,60], count:0 },
      ];
      for (const [day, users] of ttcRaw) {
        const d2 = Number(day), u = Number(users);
        for (const b of ttcBuckets) {
          if (d2 >= b.days[0] && d2 <= b.days[1]) { b.count += u; break; }
        }
      }
      const timeToChurn = ttcBuckets;

      // Cohort analysis
      const cohortData = cohortRaw.map(([week, trials, conversions]) => ({
        week: String(week).slice(5,10),
        trials: Number(trials),
        conversions: Number(conversions),
        convRate: Number(trials)>0 ? Number(conversions)/Number(trials)*100 : 0,
      }));

      // Retention by cohort
      const retentionData = retentionRaw.map(([week, users, day1, day7, day30]) => ({
        week: String(week).slice(5,10),
        users: Number(users),
        d1:  Number(users)>0 ? Number(day1)/Number(users)*100  : 0,
        d7:  Number(users)>0 ? Number(day7)/Number(users)*100  : 0,
        d30: Number(users)>0 ? Number(day30)/Number(users)*100 : 0,
      }));

      // Feature adoption vs conversion
      const featureAdoption = featureAdoptionRaw.map(([usedChat, users, converted]) => ({
        usedChat: Boolean(Number(usedChat)),
        users: Number(users),
        converted: Number(converted),
      }));

      // Revenue data
      const revenueData = revenueRaw.map(([week, purchases, renewals]) => ({
        week: String(week).slice(5,10),
        purchases: Number(purchases),
        renewals: Number(renewals),
      }));

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
        fourWeekAvg,dlLabel,compLabel,churnTrend,featureUsage,timeToChurn,cohortData,retentionData,featureAdoption,revenueData });
      setUpdated(new Date().toLocaleTimeString());
      setStatus("done");
    } catch(e) { setErr(e.message); setStatus("error"); }
  }

  useEffect(() => { load(range); }, [range]);
  useEffect(() => { loadWeb(range); }, [range]);

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
          <span style={{ color:C.lavender,fontSize:12,opacity:.55,marginLeft:4 }}>/ {view==="mobile"?"Retention":"Web Funnel"}</span>
        </div>
        {/* View toggle — prominent in center */}
        <div style={{ display:"flex",background:"rgba(255,255,255,0.08)",borderRadius:10,padding:3,gap:2 }}>
          {[{id:"mobile",label:"📱 Mobile"},{id:"web",label:"🌐 Web Funnel"}].map(({id,label})=>{
            const on=view===id;
            return <button key={id} onClick={()=>setView(id)} style={{ background:on?C.purple:"transparent",color:on?"#fff":C.lavender,border:"none",borderRadius:8,padding:"5px 18px",fontSize:12,fontWeight:on?700:500,cursor:"pointer",fontFamily:"inherit",transition:"all .15s",letterSpacing:on?.2:0 }}>{label}</button>;
          })}
        </div>
        <div style={{ display:"flex",alignItems:"center",gap:12 }}>
          {updated && <span style={{ fontSize:11,color:C.lavender,opacity:.5 }}>Updated {updated}</span>}
          {err     && <span style={{ fontSize:11,color:"#ff9b9b" }}>⚠ {err}</span>}
          <button onClick={()=>view==="mobile"?load(range):loadWeb(range)} disabled={loading||wStatus==="loading"} style={{ background:(loading||wStatus==="loading")?"transparent":C.purple,color:"#fff",border:`1px solid ${(loading||wStatus==="loading")?C.lavender+"30":C.purple}`,borderRadius:8,padding:"6px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",opacity:(loading||wStatus==="loading")?.4:1,transition:"opacity .2s" }}>{(loading||wStatus==="loading")?"Loading…":"↺ Refresh"}</button>
        </div>
      </div>


      <div style={{ padding:"32px 32px 52px" }}>
        {/* ── Range picker always visible ── */}
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:28,animation:"fadeUp .35s ease" }}>
          <div>
            <h1 style={{ margin:0,fontSize:30,fontWeight:700,letterSpacing:-.5,fontFamily:"'Erode',serif" }}>
              {view==="mobile" ? "Retention & Churn" : "Web Funnel"}
            </h1>
            <p style={{ margin:"5px 0 0",fontSize:13,color:C.muted }}>
              {range.display} · {view==="mobile" ? "RevenueCat via PostHog" : "PostHog web events"}
              {view==="mobile"&&compLabel&&!loading&&<span style={{ marginLeft:8,color:C.purple,fontWeight:600 }}>· ▲▼ vs {compLabel}</span>}
            </p>
          </div>
          <RangePicker active={range} onChange={r=>setRange(r)} />
        </div>

        {view==="web" ? (
          /* ════════════════ WEB FUNNEL VIEW ════════════════ */
          <div style={{ animation:"fadeUp .3s ease" }}>
            {wStatus==="loading" && (
              <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:24 }}>
                {[1,2,3,4].map(i=><div key={i} style={{ height:100,background:C.surface,border:`1px solid ${C.border}`,borderRadius:16,animation:"pulse 1.5s infinite" }}/>)}
              </div>
            )}

            {/* KPI row */}
            <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:24 }}>
              {[
                { label:"Page Views",    value:fmt(wd.totalPageViews),  color:C.purple, sub:"web_funnel_page_view" },
                { label:"Trial Starts",  value:fmt(wd.totalTrials),     color:C.green,  sub:"web_funnel_trial_start" },
                { label:"Quiz → Pricing",value:pct(wd.pricingRate),     color:C.orange, sub:"of quiz completers saw pricing" },
                { label:"Page → Trial",  value:pct(wd.trialRate),       color:wd.trialRate>5?C.green:C.amber, sub:"end-to-end web conversion" },
              ].map(k=>(
                <div key={k.label} style={{ background:C.surface,border:`1px solid ${C.border}`,borderRadius:16,padding:"20px 22px",position:"relative",overflow:"hidden",boxShadow:"0 1px 4px rgba(23,24,48,0.05)" }}>
                  <div style={{ position:"absolute",top:0,left:0,right:0,height:3,background:k.color,borderRadius:"16px 16px 0 0" }}/>
                  <div style={{ fontSize:10,color:C.muted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:10,fontWeight:600 }}>{k.label}</div>
                  <div style={{ fontSize:34,fontWeight:700,color:k.color,letterSpacing:-1,fontFamily:"'Erode',serif",lineHeight:1 }}>{k.value}</div>
                  <div style={{ fontSize:11,color:C.muted,marginTop:6 }}>{k.sub}</div>
                </div>
              ))}
            </div>

            {/* Main funnel waterfall */}
            <div style={{ marginBottom:16 }}>
              <Card title="Conversion Funnel · Step by Step" badge={{ label:"WEB", color:C.purple }}>
                <div style={{ display:"flex",flexDirection:"column",gap:4,marginBottom:16 }}>
                  {(wd.funnelSteps||[]).map((step,i)=>{
                    const pct2 = wd.funnelSteps && wd.funnelSteps[0] ? step.users / (wd.funnelSteps[0].users||1) : 0;
                    const dropFromPrev = step.fromPrev!=null ? 100-step.fromPrev : null;
                    const isChoke = dropFromPrev!=null && dropFromPrev > 30;
                    return (
                      <div key={step.key}>
                        <div style={{ display:"flex",alignItems:"center",gap:12,padding:"10px 14px",background:C.surface,border:`1px solid ${isChoke?C.red+"40":C.border}`,borderRadius:10,position:"relative",overflow:"hidden" }}>
                          {/* fill bar */}
                          <div style={{ position:"absolute",left:0,top:0,bottom:0,width:`${pct2*100}%`,background:i===0?C.purple+"18":C.green+"12",transition:"width .4s ease",borderRadius:10 }}/>
                          <span style={{ fontSize:16,zIndex:1,flexShrink:0 }}>{step.icon}</span>
                          <div style={{ flex:1,zIndex:1 }}>
                            <div style={{ fontSize:12,fontWeight:700,color:C.navy }}>{step.label}</div>
                            <div style={{ fontSize:10,color:C.muted }}>{step.key}</div>
                          </div>
                          <div style={{ textAlign:"right",zIndex:1 }}>
                            <div style={{ fontSize:20,fontWeight:800,color:C.navy,fontFamily:"'Erode',serif" }}>{fmt(step.users)}</div>
                            <div style={{ fontSize:11,color:C.muted }}>{step.fromTop!=null?pct(step.fromTop)+" of top":""}</div>
                          </div>
                          {i>0 && step.fromPrev!=null && (
                            <div style={{ textAlign:"right",minWidth:72,zIndex:1 }}>
                              <div style={{ fontSize:13,fontWeight:700,color:isChoke?C.red:C.green }}>{isChoke?"⚠ ":""}{pct(step.fromPrev)}</div>
                              <div style={{ fontSize:10,color:C.muted }}>from prev</div>
                            </div>
                          )}
                        </div>
                        {/* drop arrow between steps */}
                        {i < (wd.funnelSteps||[]).length-1 && dropFromPrev!=null && dropFromPrev>5 && (
                          <div style={{ display:"flex",alignItems:"center",gap:6,padding:"2px 46px" }}>
                            <div style={{ width:1,height:14,background:C.border }}/>
                            <span style={{ fontSize:10,color:isChoke?C.red:C.muted }}>↓ {dropFromPrev.toFixed(0)}% drop</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize:11,color:C.muted }}>⚠ = drop &gt;30% — likely choke points worth investigating</div>
              </Card>
            </div>

            {/* Trend + errors side by side */}
            <div style={{ display:"grid",gridTemplateColumns:"2fr 1fr",gap:16,marginBottom:16 }}>
              <Card title="Funnel Trend Over Time" badge={{ label:range.display, color:C.purple }}>
                <div style={{ height:220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={wd.trendData||[]} margin={{ top:5,right:10,bottom:0,left:-25 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
                      <XAxis dataKey="period" tick={{ fill:C.muted,fontSize:10 }} axisLine={false} tickLine={false}/>
                      <YAxis tick={{ fill:C.muted,fontSize:10 }} axisLine={false} tickLine={false}/>
                      <Tooltip content={<TT/>}/>
                      <Line type="monotone" dataKey="pageViews"     name="Page Views"    stroke={C.lavender} strokeWidth={2} dot={false}/>
                      <Line type="monotone" dataKey="quizStarts"    name="Quiz Starts"   stroke={C.purple}   strokeWidth={2} dot={false}/>
                      <Line type="monotone" dataKey="quizCompletes" name="Quiz Complete" stroke={C.orange}   strokeWidth={2} dot={false}/>
                      <Line type="monotone" dataKey="pricingViews"  name="Pricing View"  stroke={C.amber}    strokeWidth={2} dot={false}/>
                      <Line type="monotone" dataKey="checkoutStarts"name="Checkout"      stroke={C.green}    strokeWidth={2} dot={false}/>
                      <Line type="monotone" dataKey="trialStarts"   name="Trial"         stroke={C.red}      strokeWidth={2} dot={false}/>
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <Legend items={[{color:C.lavender,label:"Page views"},{color:C.purple,label:"Quiz starts"},{color:C.orange,label:"Quiz complete"},{color:C.amber,label:"Pricing"},{color:C.green,label:"Checkout"},{color:C.red,label:"Trial"}]}/>
              </Card>

              <div style={{ display:"flex",flexDirection:"column",gap:16 }}>
                <Card title="Errors & Drop-offs" badge={{ label:"ISSUES", color:C.red }}>
                  {(wd.errors||[]).map(e=>(
                    <div key={e.label} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:`1px solid ${C.border}` }}>
                      <span style={{ fontSize:12,color:C.muted }}>{e.label}</span>
                      <span style={{ fontSize:16,fontWeight:800,color:e.color,fontFamily:"'Erode',serif" }}>{fmt(e.users)}</span>
                    </div>
                  ))}
                  <div style={{ marginTop:12,padding:"8px 12px",background:C.red+"08",border:`1px solid ${C.red}20`,borderRadius:8,fontSize:11,color:C.muted }}>
                    Errors represent users who started but couldn't complete checkout
                  </div>
                </Card>

                <Card title="Sign-up Method">
                  {(wd.signupMethods||[]).map(s=>(
                    <div key={s.label} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:`1px solid ${C.border}` }}>
                      <span style={{ fontSize:12,color:C.muted }}>{s.label}</span>
                      <span style={{ fontSize:16,fontWeight:800,color:s.color,fontFamily:"'Erode',serif" }}>{fmt(s.users)}</span>
                    </div>
                  ))}
                  <div style={{ marginTop:10,fontSize:11,color:C.muted }}>Email vs OAuth signup split</div>
                </Card>
              </div>
            </div>

            {/* Key rates summary */}
            <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:24 }}>
              {[
                { label:"Quiz Completion Rate",  value:pct(wd.quizCompRate),  color:C.purple, sub:"quiz_start → quiz_complete" },
                { label:"Pricing View Rate",      value:pct(wd.pricingRate),   color:C.orange, sub:"quiz_complete → pricing_view" },
                { label:"Checkout Rate",          value:pct(wd.checkoutRate),  color:C.green,  sub:"pricing_view → checkout_start" },
              ].map(k=>(
                <div key={k.label} style={{ background:C.surface,border:`1px solid ${C.border}`,borderRadius:16,padding:"18px 20px",position:"relative",overflow:"hidden" }}>
                  <div style={{ position:"absolute",top:0,left:0,right:0,height:3,background:k.color,borderRadius:"16px 16px 0 0" }}/>
                  <div style={{ fontSize:10,color:C.muted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:8,fontWeight:600 }}>{k.label}</div>
                  <div style={{ fontSize:32,fontWeight:700,color:k.color,fontFamily:"'Erode',serif",lineHeight:1 }}>{k.value}</div>
                  <div style={{ fontSize:11,color:C.muted,marginTop:6 }}>{k.sub}</div>
                </div>
              ))}
            </div>

            <div style={{ background:C.navy,borderRadius:14,padding:"18px 26px",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
              <div style={{ display:"flex",alignItems:"center",gap:10 }}>
                <svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 2L13.5 9.5L21 8L15.5 13L19 20L12 16.5L5 20L8.5 13L3 8L10.5 9.5Z" fill={C.cream}/></svg>
                <span style={{ color:C.cream,fontWeight:700,fontSize:14,fontFamily:"'Erode',serif" }}>Purpose</span>
                <span style={{ color:C.lavender,fontSize:12,opacity:.5,marginLeft:4 }}>Web Funnel</span>
              </div>
              <span style={{ color:C.lavender,fontSize:11,opacity:.5 }}>PostHog · {range.display} · {new Date().getFullYear()}</span>
            </div>
          </div>
        ) : (
          /* ════════════════ MOBILE VIEW ════════════════ */
          <div>

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

        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16,animation:"fadeUp .35s ease .25s both" }}>
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
          <Card title="Paywall Funnel Summary">
            <StatRow label="Paywall impressions" value={fmt(fPaywall)}/>
            <StatRow label="Trial starts"        value={fmt(fTrial)}        color={C.purple} mono/>
            <StatRow label="Trial conversions"   value={fmt(fConverted)}    color={C.green}  mono/>
            <StatRow label="Initial purchases"   value={fmt(fPurchased)}    color={C.green}  mono/>
            <StatRow label="Paywall → Trial"     value={pct(paywallTrialRate)} color={C.orange} mono/>
            <StatRow label="Trial → Paid"        value={pct(trialConvRate)}    color={C.purple} mono/>
            <StatRow label="End-to-End Conv."    value={pct(overallConv)}      color={C.green}  mono/>
          </Card>
        </div>

        {/* Churn Detail + Feature Usage */}
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16,marginBottom:16,animation:"fadeUp .35s ease .28s both" }}>
          <Card title="Churn Over Time" badge={{ label:"DAILY TREND", color:C.red }}>
            <div style={{ height:180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={d.churnTrend||[]} margin={{ top:5,right:5,bottom:0,left:-25 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
                  <XAxis dataKey="day" tick={{ fill:C.muted,fontSize:10 }} axisLine={false} tickLine={false} interval="preserveStartEnd"/>
                  <YAxis tick={{ fill:C.muted,fontSize:10 }} axisLine={false} tickLine={false}/>
                  <Tooltip content={<TT/>}/>
                  <Line type="monotone" dataKey="cancellations" name="Cancellations" stroke={C.red}   strokeWidth={2} dot={false}/>
                  <Line type="monotone" dataKey="expirations"   name="Expirations"   stroke={C.amber} strokeWidth={2} dot={false}/>
                </LineChart>
              </ResponsiveContainer>
            </div>
            <Legend items={[{color:C.red,label:"Cancellations"},{color:C.amber,label:"Expirations"}]}/>
            {(d.churnTrend||[]).length > 0 && (() => {
              const total = d.churnTrend.reduce((a,r)=>a+r.cancellations+r.expirations,0);
              const peak  = d.churnTrend.reduce((a,r)=>r.cancellations+r.expirations>a.cancellations+a.expirations?r:a, d.churnTrend[0]);
              const days  = d.churnTrend.length;
              return (
                <div style={{ display:"flex",gap:16,marginTop:12,padding:"10px 14px",background:C.red+"08",border:`1px solid ${C.red}20`,borderRadius:8 }}>
                  <div><div style={{ fontSize:18,fontWeight:800,color:C.red,fontFamily:"'Erode',serif" }}>{fmt(total)}</div><div style={{ fontSize:10,color:C.muted }}>total churned</div></div>
                  <div><div style={{ fontSize:18,fontWeight:800,color:C.amber,fontFamily:"'Erode',serif" }}>{fmt(Math.round(total/days))}</div><div style={{ fontSize:10,color:C.muted }}>avg/day</div></div>
                  <div><div style={{ fontSize:14,fontWeight:800,color:C.navy,fontFamily:"'Erode',serif" }}>{peak.day}</div><div style={{ fontSize:10,color:C.muted }}>peak churn day</div></div>
                </div>
              );
            })()}
          </Card>

          <Card title="Time to Churn" badge={{ label:"WHEN THEY LEAVE", color:C.orange }}>
            <div style={{ height:180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.timeToChurn||[]} margin={{ top:5,right:5,bottom:0,left:-25 }}>
                  <XAxis dataKey="label" tick={{ fill:C.muted,fontSize:10 }} axisLine={false} tickLine={false}/>
                  <YAxis tick={{ fill:C.muted,fontSize:10 }} axisLine={false} tickLine={false}/>
                  <Tooltip content={<TT/>}/>
                  <Bar dataKey="count" name="Users" radius={[4,4,0,0]}>
                    {(d.timeToChurn||[]).map((b,i)=><Cell key={i} fill={b.label==="Day 7"?C.red:b.label==="Day 0-1"?C.orange:C.amber}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ marginTop:10,padding:"8px 12px",background:C.orange+"10",border:`1px solid ${C.orange}20`,borderRadius:8,fontSize:11,color:C.muted }}>
              💡 <strong style={{ color:C.navy }}>Day 7 spike</strong> = trial end. Most cancellations happen exactly when the free trial expires.
            </div>
          </Card>

          <Card title="Feature Usage · Top Events" badge={{ label:range.display, color:C.purple }}>
            <div style={{ height:210 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.featureUsage||[]} layout="vertical" margin={{ top:0,right:40,bottom:0,left:0 }}>
                  <XAxis type="number" tick={{ fill:C.muted,fontSize:10 }} axisLine={false} tickLine={false} tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k`:v}/>
                  <YAxis type="category" dataKey="name" tick={{ fill:C.muted,fontSize:10 }} axisLine={false} tickLine={false} width={130}/>
                  <Tooltip content={<TT/>}/>
                  <Bar dataKey="count" name="Events" radius={[0,4,4,0]}>
                    {(d.featureUsage||[]).map((_,i)=><Cell key={i} fill={[C.purple,C.green,C.orange,C.amber,C.red,C.navy][i%6]}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ marginTop:8,fontSize:11,color:C.muted }}>Excludes system & attribution events</div>
          </Card>
        </div>

        {/* ── Section: Trial-to-Paid Cohort Analysis ── */}
        <div style={{ marginBottom:8,marginTop:8 }}>
          <div style={{ fontSize:11,fontWeight:800,color:C.muted,letterSpacing:2,textTransform:"uppercase",marginBottom:12 }}>Trial-to-Paid Cohort Analysis</div>
        </div>
        <div style={{ marginBottom:16,animation:"fadeUp .35s ease .3s both" }}>
          <Card title="Weekly Trial Cohorts · Conversion Rate" badge={{ label:"COHORT VIEW", color:C.purple }}>
            <div style={{ height:220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.cohortData||[]} margin={{ top:5,right:20,bottom:0,left:-25 }}>
                  <XAxis dataKey="week" tick={{ fill:C.muted,fontSize:10 }} axisLine={false} tickLine={false}/>
                  <YAxis yAxisId="left" tick={{ fill:C.muted,fontSize:10 }} axisLine={false} tickLine={false}/>
                  <YAxis yAxisId="right" orientation="right" tick={{ fill:C.purple,fontSize:10 }} axisLine={false} tickLine={false} tickFormatter={v=>`${v.toFixed(0)}%`}/>
                  <Tooltip content={<TT/>}/>
                  <Bar yAxisId="left" dataKey="trials" name="Trial Starts" fill={C.lavender} radius={[3,3,0,0]}/>
                  <Bar yAxisId="left" dataKey="conversions" name="Conversions" fill={C.purple} radius={[3,3,0,0]}/>
                  <Line yAxisId="right" type="monotone" dataKey="convRate" name="Conv %" stroke={C.orange} strokeWidth={2} dot={{ fill:C.orange, r:3 }}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Legend items={[{color:C.lavender,label:"Trial starts"},{color:C.purple,label:"Conversions"},{color:C.orange,label:"Conv rate %"}]}/>
            {(d.cohortData||[]).length > 1 && (() => {
              const valid = (d.cohortData||[]).filter(c=>c.trials>50);
              if (!valid.length) return null;
              const best  = valid.reduce((a,b)=>b.convRate>a.convRate?b:a);
              const worst = valid.reduce((a,b)=>b.convRate<a.convRate?b:a);
              const trend = valid.length >= 2 ? valid[valid.length-1].convRate - valid[0].convRate : null;
              return (
                <div style={{ display:"flex",gap:12,marginTop:12,flexWrap:"wrap" }}>
                  <div style={{ flex:1,padding:"10px 14px",background:C.green+"10",border:`1px solid ${C.green}20`,borderRadius:8 }}>
                    <div style={{ fontSize:10,color:C.muted,marginBottom:2 }}>Best cohort</div>
                    <div style={{ fontSize:16,fontWeight:800,color:C.green,fontFamily:"'Erode',serif" }}>{best.week} · {best.convRate.toFixed(1)}%</div>
                  </div>
                  <div style={{ flex:1,padding:"10px 14px",background:C.red+"10",border:`1px solid ${C.red}20`,borderRadius:8 }}>
                    <div style={{ fontSize:10,color:C.muted,marginBottom:2 }}>Worst cohort</div>
                    <div style={{ fontSize:16,fontWeight:800,color:C.red,fontFamily:"'Erode',serif" }}>{worst.week} · {worst.convRate.toFixed(1)}%</div>
                  </div>
                  {trend !== null && (
                    <div style={{ flex:1,padding:"10px 14px",background:C.purple+"10",border:`1px solid ${C.purple}20`,borderRadius:8 }}>
                      <div style={{ fontSize:10,color:C.muted,marginBottom:2 }}>Trend (first → last)</div>
                      <div style={{ fontSize:16,fontWeight:800,color:trend>=0?C.green:C.red,fontFamily:"'Erode',serif" }}>{trend>=0?"▲":"▼"} {Math.abs(trend).toFixed(1)}pp</div>
                    </div>
                  )}
                </div>
              );
            })()}
          </Card>
        </div>

        {/* ── Section: Retention ── */}
        <div style={{ marginBottom:8 }}>
          <div style={{ fontSize:11,fontWeight:800,color:C.muted,letterSpacing:2,textTransform:"uppercase",marginBottom:12 }}>Retention</div>
        </div>
        <div style={{ marginBottom:16,animation:"fadeUp .35s ease .33s both" }}>
          <Card title="Day 1 / Day 7 / Day 30 Retention by Cohort" badge={{ label:"APP OPENS", color:C.green }}>
            <div style={{ height:220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={d.retentionData||[]} margin={{ top:5,right:20,bottom:0,left:-25 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
                  <XAxis dataKey="week" tick={{ fill:C.muted,fontSize:10 }} axisLine={false} tickLine={false}/>
                  <YAxis tick={{ fill:C.muted,fontSize:10 }} axisLine={false} tickLine={false} tickFormatter={v=>`${v.toFixed(0)}%`}/>
                  <Tooltip content={<TT/>}/>
                  <Line type="monotone" dataKey="d1" name="Day 1 %" stroke={C.green}  strokeWidth={2} dot={{ fill:C.green,r:3 }}/>
                  <Line type="monotone" dataKey="d7" name="Day 7 %" stroke={C.purple} strokeWidth={2} dot={{ fill:C.purple,r:3 }}/>
                  <Line type="monotone" dataKey="d30" name="Day 30 %" stroke={C.orange} strokeWidth={2} dot={{ fill:C.orange,r:3 }} strokeDasharray="4 2"/>
                </LineChart>
              </ResponsiveContainer>
            </div>
            <Legend items={[{color:C.green,label:"Day 1 retention"},{color:C.purple,label:"Day 7 retention"},{color:C.orange,label:"Day 30 retention (dashed = incomplete)"}]}/>
            {(d.retentionData||[]).length > 0 && (() => {
              const valid = (d.retentionData||[]).filter(r=>r.users>100);
              if (!valid.length) return null;
              const avgD1  = valid.reduce((a,r)=>a+r.d1,0)/valid.length;
              const avgD7  = valid.reduce((a,r)=>a+r.d7,0)/valid.length;
              const avgD30 = valid.filter(r=>r.d30>0).reduce((a,r)=>a+r.d30,0) / (valid.filter(r=>r.d30>0).length||1);
              return (
                <div style={{ display:"flex",gap:12,marginTop:12 }}>
                  {[{label:"Avg Day 1",val:avgD1,color:C.green},{label:"Avg Day 7",val:avgD7,color:C.purple},{label:"Avg Day 30",val:avgD30,color:C.orange}].map(({label,val,color})=>(
                    <div key={label} style={{ flex:1,padding:"10px 14px",background:color+"10",border:`1px solid ${color}20`,borderRadius:8 }}>
                      <div style={{ fontSize:10,color:C.muted,marginBottom:2 }}>{label}</div>
                      <div style={{ fontSize:20,fontWeight:800,color,fontFamily:"'Erode',serif" }}>{val.toFixed(1)}%</div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </Card>
        </div>

        {/* ── Section: Feature Adoption vs Conversion ── */}
        <div style={{ marginBottom:8 }}>
          <div style={{ fontSize:11,fontWeight:800,color:C.muted,letterSpacing:2,textTransform:"uppercase",marginBottom:12 }}>Feature Adoption vs Conversion</div>
        </div>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16,animation:"fadeUp .35s ease .36s both" }}>
          <Card title="Chat Usage vs Trial Conversion" badge={{ label:"ENGAGEMENT SIGNAL", color:C.purple }}>
            {(d.featureAdoption||[]).length > 0 && (() => {
              const noChat = d.featureAdoption.find(f=>!f.usedChat)||{users:0,converted:0};
              const chat   = d.featureAdoption.find(f=>f.usedChat)||{users:0,converted:0};
              const noChatRate = noChat.users>0 ? noChat.converted/noChat.users*100 : 0;
              const chatRate   = chat.users>0   ? chat.converted/chat.users*100     : 0;
              const lift = chatRate - noChatRate;
              return (
                <>
                  <div style={{ display:"flex",gap:12,marginBottom:16 }}>
                    {[{label:"Used Chat",users:chat.users,conv:chat.converted,rate:chatRate,color:C.purple},{label:"No Chat",users:noChat.users,conv:noChat.converted,rate:noChatRate,color:C.muted}].map(({label,users,conv,rate,color})=>(
                      <div key={label} style={{ flex:1,padding:"14px",background:color+"12",border:`1px solid ${color}25`,borderRadius:10 }}>
                        <div style={{ fontSize:10,color:C.muted,marginBottom:4,fontWeight:600 }}>{label}</div>
                        <div style={{ fontSize:26,fontWeight:800,color,fontFamily:"'Erode',serif" }}>{rate.toFixed(1)}%</div>
                        <div style={{ fontSize:11,color:C.muted,marginTop:4 }}>{fmt(conv)} / {fmt(users)} converted</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ padding:"12px 14px",background:lift>0?C.green+"10":C.red+"10",border:`1px solid ${lift>0?C.green:C.red}25`,borderRadius:8 }}>
                    <div style={{ fontSize:12,fontWeight:700,color:lift>0?C.green:C.red }}>
                      {lift>0?"✅":"⚠️"} Chat users convert at <strong>{Math.abs(lift).toFixed(1)}pp {lift>0?"higher":"lower"}</strong> rate
                    </div>
                    <div style={{ fontSize:11,color:C.muted,marginTop:4 }}>
                      {lift>0
                        ? "Strong signal — getting users to chat earlier could improve trial conversion"
                        : "Chat engagement doesn't correlate with conversion in this period"}
                    </div>
                  </div>
                </>
              );
            })()}
          </Card>

          <Card title="Feature Engagement Breakdown" badge={{ label:"90D", color:C.green }}>
            <div style={{ height:220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.featureUsage||[]} layout="vertical" margin={{ top:0,right:50,bottom:0,left:0 }}>
                  <XAxis type="number" tick={{ fill:C.muted,fontSize:10 }} axisLine={false} tickLine={false} tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k`:v}/>
                  <YAxis type="category" dataKey="name" tick={{ fill:C.muted,fontSize:10 }} axisLine={false} tickLine={false} width={130}/>
                  <Tooltip content={<TT/>}/>
                  <Bar dataKey="count" name="Events" radius={[0,4,4,0]}>
                    {(d.featureUsage||[]).map((_,i)=><Cell key={i} fill={[C.purple,C.green,C.orange,C.amber,C.red,C.navy][i%6]}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        {/* ── Section: Revenue Estimate ── */}
        <div style={{ marginBottom:8 }}>
          <div style={{ fontSize:11,fontWeight:800,color:C.muted,letterSpacing:2,textTransform:"uppercase",marginBottom:12 }}>Revenue Estimate</div>
        </div>
        <div style={{ marginBottom:32,animation:"fadeUp .35s ease .39s both" }}>
          <Card title="New Purchases Over Time" badge={{ label:"ESTIMATED FROM RC EVENTS", color:C.green }}>
            <div style={{ height:200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={d.revenueData||[]} margin={{ top:5,right:20,bottom:0,left:-25 }}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={C.green} stopOpacity={0.2}/>
                      <stop offset="95%" stopColor={C.green} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false}/>
                  <XAxis dataKey="week" tick={{ fill:C.muted,fontSize:10 }} axisLine={false} tickLine={false}/>
                  <YAxis tick={{ fill:C.muted,fontSize:10 }} axisLine={false} tickLine={false}/>
                  <Tooltip content={<TT/>}/>
                  <Area type="monotone" dataKey="purchases" name="New Purchases" stroke={C.green} fill="url(#revGrad)" strokeWidth={2} dot={false}/>
                  <Line type="monotone" dataKey="renewals" name="Renewals" stroke={C.purple} strokeWidth={2} dot={false}/>
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <Legend items={[{color:C.green,label:"New purchases"},{color:C.purple,label:"Renewals"}]}/>
            {(d.revenueData||[]).length > 0 && (() => {
              const total = d.revenueData.reduce((a,w)=>a+w.purchases,0);
              const totalRen = d.revenueData.reduce((a,w)=>a+w.renewals,0);
              const peak = d.revenueData.reduce((a,w)=>w.purchases>a.purchases?w:a,d.revenueData[0]);
              const recent = d.revenueData.slice(-4);
              const avgRecent = recent.reduce((a,w)=>a+w.purchases,0)/recent.length;
              return (
                <div style={{ display:"flex",gap:12,marginTop:12,flexWrap:"wrap" }}>
                  <div style={{ flex:1,padding:"10px 14px",background:C.green+"10",border:`1px solid ${C.green}20`,borderRadius:8 }}>
                    <div style={{ fontSize:10,color:C.muted,marginBottom:2 }}>Total new purchases</div>
                    <div style={{ fontSize:20,fontWeight:800,color:C.green,fontFamily:"'Erode',serif" }}>{fmt(total)}</div>
                  </div>
                  <div style={{ flex:1,padding:"10px 14px",background:C.purple+"10",border:`1px solid ${C.purple}20`,borderRadius:8 }}>
                    <div style={{ fontSize:10,color:C.muted,marginBottom:2 }}>Total renewals</div>
                    <div style={{ fontSize:20,fontWeight:800,color:C.purple,fontFamily:"'Erode',serif" }}>{fmt(totalRen)}</div>
                  </div>
                  <div style={{ flex:1,padding:"10px 14px",background:C.amber+"10",border:`1px solid ${C.amber}20`,borderRadius:8 }}>
                    <div style={{ fontSize:10,color:C.muted,marginBottom:2 }}>Peak week</div>
                    <div style={{ fontSize:16,fontWeight:800,color:C.amber,fontFamily:"'Erode',serif" }}>{peak.week} · {fmt(peak.purchases)}</div>
                  </div>
                  <div style={{ flex:1,padding:"10px 14px",background:C.navy+"08",border:`1px solid ${C.border}`,borderRadius:8 }}>
                    <div style={{ fontSize:10,color:C.muted,marginBottom:2 }}>Avg last 4 weeks</div>
                    <div style={{ fontSize:20,fontWeight:800,color:C.navy,fontFamily:"'Erode',serif" }}>{fmt(Math.round(avgRecent))}/wk</div>
                  </div>
                </div>
              );
            })()}
            <div style={{ marginTop:10,fontSize:11,color:C.muted }}>💡 Price data not in PostHog — showing purchase volume as revenue proxy. Connect RevenueCat webhooks for exact MRR.</div>
          </Card>
        </div>

        {/* Collapsible methodology */}
        <MethodologySection />

        <div style={{ background:C.navy,borderRadius:14,padding:"18px 26px",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
          <div style={{ display:"flex",alignItems:"center",gap:10 }}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 2L13.5 9.5L21 8L15.5 13L19 20L12 16.5L5 20L8.5 13L3 8L10.5 9.5Z" fill={C.cream}/></svg>
            <span style={{ color:C.cream,fontWeight:700,fontSize:14,fontFamily:"'Erode',serif" }}>Purpose</span>
            <span style={{ color:C.lavender,fontSize:12,opacity:.5,marginLeft:4 }}>Retention Dashboard</span>
          </div>
          <span style={{ color:C.lavender,fontSize:11,opacity:.5 }}>RevenueCat · PostHog · {range.display} · {new Date().getFullYear()}</span>
        </div>
        </div>
        )}
      </div>
    </div>
  );
}
