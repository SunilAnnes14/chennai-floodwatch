// "Check your street": street-level prediction for any street the user types.
import { useState } from "react";
import { History, Mountain, Search, Target } from "lucide-react";
import { api, roadCondition } from "../api";
import { ErrorBox, RiskBadge, ConditionBadge } from "./Common";

export default function StreetCheck() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function check(e) {
    e.preventDefault();
    setError("");
    setResult(null);
    setBusy(true);
    try {
      setResult(await api(`/api/street-risk?q=${encodeURIComponent(query)}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card my-6">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold text-navy-900">
        <Target className="h-5 w-5 text-blue-600" /> Check your street
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Street-level estimate: the area&apos;s rainfall combined with the flood history and terrain of that exact spot.
      </p>
      <form onSubmit={check} className="mt-4 flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-10" placeholder="e.g. Velachery Bypass Road" value={query} minLength={3} required
                 onChange={(e) => setQuery(e.target.value)} aria-label="Street name" />
        </div>
        <button className="btn" disabled={busy}>{busy ? "Checking..." : "Check"}</button>
      </form>
      {error && <ErrorBox message={error} />}

      {result && (
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Street-level prediction</p>
            <div className="mt-2">
              {result.predicted_level ? <RiskBadge level={result.predicted_level} />
                                      : <span className="text-sm text-slate-500">Cannot estimate</span>}
            </div>
            <p className="mt-2 text-xs text-slate-500">{result.explanation}</p>
            {!result.weather_available && <p className="mt-1 text-xs text-red-600">Live rainfall unavailable, so no estimate is given.</p>}
          </div>

          <div className="rounded-xl bg-slate-50 p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <History className="h-3.5 w-3.5" /> Flood history
            </p>
            <p className="mt-2 font-display text-2xl font-bold text-navy-900">{result.flood_history}</p>
            <p className="text-xs text-slate-500">verified floods or known waterlogging spots within 300 m</p>
          </div>

          <div className="rounded-xl bg-slate-50 p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <Mountain className="h-3.5 w-3.5" /> Terrain (low confidence)
            </p>
            {result.susceptibility ? (
              <>
                <p className="mt-2 font-semibold text-navy-900">{result.susceptibility.level} susceptibility</p>
                <ul className="mt-1 text-xs text-slate-500">
                  {result.susceptibility.reasons.map((r) => <li key={r}>· {r}</li>)}
                </ul>
              </>
            ) : <p className="mt-2 text-sm text-slate-500">Outside the terrain grid (south &amp; central Chennai).</p>}
          </div>

          {result.reported_nearby.length > 0 && (
            <div className="md:col-span-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Reported right now within 300 m</p>
              {result.reported_nearby.map((s) => (
                <p key={s.street_name + s.latest_report_at} className="mt-2 flex items-center gap-2 text-sm">
                  <ConditionBadge condition={roadCondition(s)} /> {s.street_name} · {s.max_depth_cm} cm
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
