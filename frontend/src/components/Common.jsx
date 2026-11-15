// Small pieces used on many pages.
import { AlertTriangle, FlaskConical, Inbox, RotateCw } from "lucide-react";
import { RISK_COLORS, CONDITIONS } from "../api";

// The big title at the top of every page
export function PageHeader({ eyebrow, title, subtitle, actions }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="title">{title}</h1>
        {subtitle && <p className="mt-2 text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

// Grey shimmering boxes shown while data loads
export function Skeleton({ className = "h-4 w-full" }) {
  return (
    <div className={`relative overflow-hidden rounded-lg bg-slate-200/70 ${className}`}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent" />
    </div>
  );
}

export function Loading({ text = "Loading...", lines = 3 }) {
  return (
    <div role="status" aria-label={text} className="space-y-3 py-2">
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} className={`h-4 ${i === lines - 1 ? "w-2/3" : "w-full"}`} />)}
      <span className="sr-only">{text}</span>
    </div>
  );
}

export function ErrorBox({ message, onRetry }) {
  return (
    <div className="my-2 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800" role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1"><strong>Error: </strong>{message}</div>
      {onRetry && (
        <button onClick={onRetry} className="inline-flex items-center gap-1 font-semibold hover:underline">
          <RotateCw className="h-3.5 w-3.5" /> Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ text, icon: Icon = Inbox }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-8 text-center">
      <Icon className="mb-2 h-6 w-6 text-slate-400" />
      <p className="text-sm text-slate-500">{text}</p>
    </div>
  );
}

// Coloured pill with a dot, e.g. "● HIGH"
function Pill({ color, text, dark }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide"
          style={{ background: `${color}1f`, color: dark ? "#713f12" : color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {text}
    </span>
  );
}

export function RiskBadge({ level }) {
  if (!level) return <span className="text-xs text-slate-400">No data</span>;
  return <Pill color={RISK_COLORS[level]} text={level.replace("_", " ")} dark={level === "MODERATE"} />;
}

export function StatusBadge({ status }) {
  const styles = {
    PENDING: "bg-slate-100 text-slate-600 ring-slate-500/20",
    VERIFIED: "bg-red-50 text-red-700 ring-red-600/20",
    REJECTED: "bg-slate-50 text-slate-400 line-through ring-slate-300/40",
    RESOLVED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  };
  const text = status === "PENDING" ? "UNVERIFIED" : status;
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ring-1 ring-inset ${styles[status]}`}>{text}</span>;
}

export function ConditionBadge({ condition }) {
  const c = CONDITIONS[condition];
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ring-1 ring-inset ${c.soft}`}>{c.label}</span>;
}

export function ExperimentalNote() {
  return (
    <div className="my-2 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-sm text-amber-900">
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />
      <p>
        <strong>EXPERIMENTAL:</strong> risk levels come from a simple rule (rainfall + ground height).
        They are not tested against real floods and are <strong>not official warnings</strong>.
      </p>
    </div>
  );
}

// Pulsing green dot that shows data is live
export function LiveDot({ label = "Live" }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-semibold">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping2 rounded-full bg-emerald-400" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      {label}
    </span>
  );
}

// A number with an icon and a label, e.g. "12.5 mm  Rain last 24 h"
export function StatCard({ icon: Icon, label, value, hint, tone = "blue" }) {
  const tones = {
    blue: "bg-blue-50 text-blue-600", red: "bg-red-50 text-red-600", amber: "bg-amber-50 text-amber-600",
    slate: "bg-slate-100 text-slate-600", green: "bg-emerald-50 text-emerald-600",
  };
  return (
    <div className="card card-hover p-4">
      <div className="flex items-center gap-3">
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tones[tone]}`}><Icon className="h-[18px] w-[18px]" /></span>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      </div>
      <p className="mt-3 font-display text-2xl font-bold text-navy-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
