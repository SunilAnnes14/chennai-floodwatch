import { Link } from "react-router-dom";
import { CircleMarker, Popup } from "react-leaflet";
import {
  ArrowRight, BellRing, Camera, CloudRain, Map as MapIcon, Radar, ScanEye, Thermometer, Megaphone,
} from "lucide-react";
import { useApi, formatTime, formatLocal, RISK_COLORS, RISK_ORDER, roadCondition } from "../api";
import { Loading, ErrorBox, Empty, RiskBadge, LiveDot } from "../components/Common";
import BaseMap from "../components/BaseMap";
import StreetLines from "../components/StreetLines";

export default function Home() {
  const weather = useApi("/api/weather");
  const risk = useApi("/api/risk");
  const streets = useApi("/api/streets");
  const alerts = useApi("/api/alerts");
  const closures = useApi("/api/road-closures");

  const areas = [...(risk.data?.areas || [])].sort((a, b) => (RISK_ORDER[b.risk_level] || 0) - (RISK_ORDER[a.risk_level] || 0));
  const elevated = areas.filter((a) => a.risk_level === "HIGH" || a.risk_level === "VERY_HIGH");
  const streetList = streets.data?.streets || [];
  const dangerous = streetList.filter((s) => roadCondition(s) === "DANGEROUS");
  const unverified = streetList.filter((s) => s.status !== "VERIFIED");

  // Area with the most rain in the last 24 hours
  const wettest = [...(weather.data?.areas || [])]
    .filter((a) => a.rain_last_24h !== null)
    .sort((a, b) => b.rain_last_24h - a.rain_last_24h)[0];

  return (
    <div className="space-y-10">
      {/* ---------------- Hero ---------------- */}
      <section className="relative overflow-hidden rounded-3xl bg-navy-950 px-6 py-10 text-white shadow-lift sm:px-10 sm:py-14">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-blue-600/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 left-1/3 h-80 w-80 rounded-full bg-cyan-400/10 blur-3xl" />
        <Waves />
        <div className="relative grid items-center gap-10 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-emerald-300 ring-1 ring-white/15">
              <LiveDot label={weather.data ? `Live · updated ${formatLocal(weather.data.updated_at)} IST` : "Connecting..."} />
            </div>
            <h1 className="mt-5 font-display text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl">CR7 Flows</h1>
            <p className="mt-4 max-w-xl text-lg text-slate-300">
              Chennai's flood watch: see rain coming, spot flooded streets as they are reported, and get clear alerts, neighbourhood by neighbourhood.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/report" className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-navy-900 shadow-lg transition hover:bg-blue-50 active:scale-[.98]">
                <Camera className="h-4 w-4" /> Report flooding
              </Link>
              <Link to="/map" className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white ring-1 ring-white/25 transition hover:bg-white/10">
                <MapIcon className="h-4 w-4" /> Open live map
              </Link>
            </div>
          </div>

          {/* "Right now" glass panel */}
          <div className="rounded-2xl bg-white/[0.07] p-5 ring-1 ring-white/15 backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Right now</p>
            {weather.error && <p className="mt-3 text-sm text-red-300">{weather.error}</p>}
            {!weather.data && !weather.error && <p className="mt-3 text-sm text-slate-400">Loading live weather...</p>}
            {wettest && (
              <div className="mt-3 grid grid-cols-2 gap-4">
                <HeroStat icon={CloudRain} label="Most rain, 24 h" value={`${wettest.rain_last_24h} mm`} hint={wettest.name} />
                <HeroStat icon={Thermometer} label="Temperature" value={`${weather.data.areas[0].temperature_c} °C`} hint={weather.data.areas[0].name} />
                <HeroStat icon={ScanEye} label="Dangerous streets" value={dangerous.length} hint="verified" />
                <HeroStat icon={BellRing} label="Active alerts" value={alerts.data?.length ?? "–"} hint="official & verified" />
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ---------------- Predict → Detect → Alert ---------------- */}
      <section>
        <p className="eyebrow">How it works</p>
        <h2 className="mt-1 font-display text-2xl font-bold text-navy-900">Predict → Detect → Alert</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <StepCard step="1" icon={Radar} title="Predict" to="/predictions" linkText="See risk by area" tone="from-blue-600 to-indigo-600"
                    text="Rain forecast + rain so far + ground height give each area a risk level."
                    value={risk.data ? `${elevated.length} of ${areas.length}` : "–"} valueLabel="areas at high risk"
                    error={risk.error} />
          <StepCard step="2" icon={ScanEye} title="Detect" to="/streets" linkText="See affected streets" tone="from-orange-500 to-red-600"
                    text="Citizen reports, checked by admins, show which streets are flooded right now."
                    value={streets.data ? dangerous.length : "–"} valueLabel={`dangerous streets · ${unverified.length} unverified`}
                    error={streets.error} />
          <StepCard step="3" icon={BellRing} title="Alert" to="/alerts" linkText="See alerts" tone="from-emerald-500 to-teal-600"
                    text="Official warnings, verified reports and road closures, clearly labelled."
                    value={alerts.data ? alerts.data.length : "–"} valueLabel={`active alerts · ${closures.data?.length ?? 0} road closures`}
                    error={alerts.error} />
        </div>
      </section>

      {/* ---------------- Map + area risk ---------------- */}
      <section className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="card flex flex-col overflow-hidden p-0">
          <div className="flex items-center justify-between px-5 py-4">
            <div>
              <h2 className="font-display text-lg font-bold text-navy-900">Live map</h2>
              <p className="text-xs text-slate-500">Area risk circles and reported streets</p>
            </div>
            <Link to="/map" className="btn-ghost py-2">Full map <ArrowRight className="h-4 w-4" /></Link>
          </div>
          <div className="min-h-[20rem] flex-1">
            <BaseMap scrollWheelZoom={false}>
              {areas.map((a) => (
                <CircleMarker key={a.area_id} center={[a.latitude, a.longitude]} radius={16}
                              pathOptions={{ color: RISK_COLORS[a.risk_level] || "#94a3b8", weight: 2, fillOpacity: 0.25 }}>
                  <Popup><strong>{a.name}</strong><br />Risk: {a.risk_level || "no data"} (experimental)</Popup>
                </CircleMarker>
              ))}
              <StreetLines streets={streetList} />
            </BaseMap>
          </div>
        </div>

        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-navy-900">Area risk</h2>
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">Experimental</span>
          </div>
          {risk.loading && <Loading lines={6} />}
          {risk.error && <ErrorBox message={risk.error} onRetry={risk.reload} />}
          <ul className="divide-y divide-slate-100">
            {areas.map((a) => {
              const rain = weather.data?.areas.find((w) => w.area_id === a.area_id);
              return (
                <li key={a.area_id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-navy-900">{a.name}</p>
                    <p className="text-xs text-slate-500">
                      {rain ? `${rain.rain_last_24h ?? "–"} mm past 24 h · ${rain.rain_next_24h ?? "–"} mm forecast` : a.reason}
                    </p>
                  </div>
                  <RiskBadge level={a.risk_level} />
                </li>
              );
            })}
          </ul>
          <Link to="/predictions" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:gap-2 transition-all">
            How risk is calculated <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* ---------------- Announcements ---------------- */}
      <section className="card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-navy-900"><Megaphone className="h-5 w-5 text-blue-600" /> Latest announcements</h2>
          <Link to="/alerts" className="text-sm font-semibold text-blue-600 hover:underline">See all alerts</Link>
        </div>
        {alerts.loading && <Loading />}
        {alerts.error && <ErrorBox message={alerts.error} />}
        {alerts.data?.length === 0 && <Empty text="No active alerts or announcements." icon={BellRing} />}
        <div className="grid gap-3 md:grid-cols-3">
          {alerts.data?.slice(0, 3).map((a) => (
            <div key={a.id} className="rounded-xl border border-slate-200 p-4 transition hover:border-slate-300 hover:bg-slate-50/60">
              <p className="text-[11px] font-bold uppercase tracking-wider text-blue-600">{a.alert_type.replace("_", " ")}</p>
              <p className="mt-1 font-semibold text-navy-900">{a.title}</p>
              <p className="mt-1 text-xs text-slate-500">{a.source} · {formatTime(a.created_at)}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function HeroStat({ icon: Icon, label, value, hint }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs text-slate-400"><Icon className="h-3.5 w-3.5" /> {label}</p>
      <p className="mt-1 font-display text-2xl font-bold">{value}</p>
      <p className="text-xs text-slate-400">{hint}</p>
    </div>
  );
}

function StepCard({ step, icon: Icon, title, text, value, valueLabel, to, tone, error, linkText }) {
  return (
    <Link to={to} className="card card-hover group relative block overflow-hidden">
      <div className="flex items-center justify-between">
        <span className={`flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br ${tone} text-white shadow-md`}>
          <Icon className="h-5 w-5" />
        </span>
        <span className="font-display text-5xl font-extrabold text-slate-100 transition group-hover:text-slate-200">{step}</span>
      </div>
      <h3 className="mt-4 font-display text-xl font-bold text-navy-900">{title}</h3>
      <p className="mt-1 text-sm text-slate-500">{text}</p>
      <div className="mt-5 border-t border-slate-100 pt-4">
        {error ? <p className="text-sm text-red-600">Data unavailable</p> : (
          <p><span className="font-display text-2xl font-bold text-navy-900">{value}</span>{" "}
            <span className="text-sm text-slate-500">{valueLabel}</span></p>
        )}
        <p className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-blue-600 transition-all group-hover:gap-2">
          {linkText} <ArrowRight className="h-4 w-4" />
        </p>
      </div>
    </Link>
  );
}

// Decorative wave lines in the hero background
function Waves() {
  return (
    <svg className="pointer-events-none absolute inset-x-0 bottom-0 h-40 w-full opacity-[0.12]" viewBox="0 0 1200 160" preserveAspectRatio="none" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <path key={i} d={`M0 ${60 + i * 22} C 200 ${20 + i * 22}, 400 ${100 + i * 22}, 600 ${60 + i * 22} S 1000 ${20 + i * 22}, 1200 ${60 + i * 22}`}
              fill="none" stroke="white" strokeWidth="1.5" />
      ))}
    </svg>
  );
}
