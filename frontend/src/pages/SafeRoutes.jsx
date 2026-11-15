import { useState } from "react";
import { Polyline, CircleMarker, Popup } from "react-leaflet";
import {
  ArrowUpDown, Clock, Crosshair, Home as HomeIcon, Navigation, Route, ShieldAlert, Shuffle, TriangleAlert,
} from "lucide-react";
import { api, formatTime } from "../api";
import { ErrorBox, Loading, PageHeader, Empty } from "../components/Common";
import BaseMap from "../components/BaseMap";

const ROUTE_COLORS = ["#2a78d6", "#6250d6", "#1baf7a", "#eb6834"];
const EXAMPLES = [["Velachery", "T. Nagar"], ["Tambaram", "Adyar"], ["Saidapet", "Perungudi"]];

export default function SafeRoutes() {
  const [mode, setMode] = useState("route"); // "route" or "evacuate"
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState(0);

  async function load(url) {
    setError("");
    setResult(null);
    setLoading(true);
    try {
      setResult(await api(url));
      setChosen(0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const findRoutes = (from, to) => load(`/api/route?start=${encodeURIComponent(from)}&end=${encodeURIComponent(to)}`);

  function submit(e) {
    e.preventDefault();
    if (mode === "route") findRoutes(start, end);
    else load(`/api/evacuate?start=${encodeURIComponent(start)}`);
  }

  function evacuateFromGps() {
    if (!navigator.geolocation) return setError("Your browser does not support GPS.");
    setError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => load(`/api/evacuate?latitude=${pos.coords.latitude}&longitude=${pos.coords.longitude}`),
      () => setError("Location permission denied. Type a place instead."),
    );
  }

  function switchMode(next) {
    setMode(next);
    setResult(null);
    setError("");
  }

  return (
    <div>
      <PageHeader eyebrow="Alert" title="Safe Routes"
                  subtitle="Routes checked against verified flooding and official road closures. If every route is blocked, we look for detours." />

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        {/* ---------- left: form + results ---------- */}
        <div className="space-y-4">
          <div className="inline-flex w-full rounded-xl bg-slate-200/60 p-1" role="tablist">
            {[["route", "Find a route", Navigation], ["evacuate", "Evacuate to shelter", HomeIcon]].map(([key, text, Icon]) => (
              <button key={key} role="tab" aria-selected={mode === key} onClick={() => switchMode(key)}
                      className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${mode === key ? "bg-white text-navy-900 shadow-sm" : "text-slate-500 hover:text-navy-900"}`}>
                <Icon className="h-4 w-4" /> {text}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="card space-y-3">
            {mode === "route" ? (
              <>
                <div className="relative space-y-3">
                  <div>
                    <label className="label" htmlFor="from">From</label>
                    <input id="from" className="input" required minLength={2} value={start}
                           onChange={(e) => setStart(e.target.value)} placeholder="e.g. Velachery" />
                  </div>
                  <button type="button" onClick={() => { setStart(end); setEnd(start); }} aria-label="Swap start and destination"
                          className="absolute right-3 top-[52px] z-10 rounded-full border border-slate-200 bg-white p-1.5 text-slate-500 shadow-sm hover:text-navy-900">
                    <ArrowUpDown className="h-3.5 w-3.5" />
                  </button>
                  <div>
                    <label className="label" htmlFor="to">To</label>
                    <input id="to" className="input" required minLength={2} value={end}
                           onChange={(e) => setEnd(e.target.value)} placeholder="e.g. T. Nagar" />
                  </div>
                </div>
                <button className="btn w-full" disabled={loading}><Navigation className="h-4 w-4" /> Find routes</button>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <span className="text-xs text-slate-400">Try:</span>
                  {EXAMPLES.map(([a, b]) => (
                    <button key={a} type="button" className="chip py-1" onClick={() => { setStart(a); setEnd(b); findRoutes(a, b); }}>{a} → {b}</button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="label" htmlFor="evac-from">Where are you?</label>
                  <input id="evac-from" className="input" required minLength={2} value={start}
                         onChange={(e) => setStart(e.target.value)} placeholder="e.g. Mudichur" />
                </div>
                <button className="btn w-full" disabled={loading}><HomeIcon className="h-4 w-4" /> Route to nearest shelter</button>
                <button type="button" className="btn-ghost w-full" onClick={evacuateFromGps} disabled={loading}>
                  <Crosshair className="h-4 w-4" /> Use my GPS location
                </button>
                <p className="text-xs text-slate-500">Shelters are added by admins from official relief-centre lists. You can also call 1070 or 1913.</p>
              </>
            )}
          </form>

          {loading && <div className="card"><Loading text="Finding routes..." /></div>}
          {error && <ErrorBox message={error} />}

          {result && (
            <>
              {result.shelter && (
                <div className="card border-emerald-200 bg-emerald-50/60">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Nearest relief shelter</p>
                  <p className="mt-1 font-display text-lg font-bold text-navy-900">{result.shelter.name}</p>
                  <p className="text-xs text-slate-600">
                    {result.shelter.capacity ? `Capacity ${result.shelter.capacity} · ` : ""}Source: {result.shelter.source}
                  </p>
                  {result.other_shelters.length > 0 && (
                    <p className="mt-2 text-xs text-slate-500">
                      Also nearby: {result.other_shelters.map((s) => `${s.name} (${s.distance_km} km)`).join(", ")}
                    </p>
                  )}
                </div>
              )}
              <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-sm text-amber-900">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  {result.warning}
                  {!result.has_road_info && <p className="mt-1 font-semibold">There is currently no verified road information. This does NOT mean the roads are clear.</p>}
                </div>
              </div>
              {result.routes.map((r, i) => (
                <RouteCard key={i} route={r} index={i} chosen={chosen === i} onClick={() => setChosen(i)} best={i === 0 && result.routes.length > 1} />
              ))}
            </>
          )}
        </div>

        {/* ---------- right: map ---------- */}
        <div className="card overflow-hidden p-0">
          <div className="relative h-[60vh] lg:h-[calc(100vh-12rem)]">
            {result ? (
              <BaseMap center={result.start} zoom={12}>
                {result.routes.map((r, i) => (
                  <Polyline key={i} positions={r.coordinates} eventHandlers={{ click: () => setChosen(i) }}
                            pathOptions={{ color: ROUTE_COLORS[i], weight: chosen === i ? 7 : 4, opacity: chosen === i ? 1 : 0.45 }} />
                ))}
                {result.routes[chosen]?.closures_on_route.map((c) => (
                  <CircleMarker key={`c${c.id}`} center={[c.latitude, c.longitude]} radius={9}
                                pathOptions={{ color: "#0b1730", weight: 2, fillColor: "#f97316", fillOpacity: 1 }}>
                    <Popup>⛔ {c.road_name}</Popup>
                  </CircleMarker>
                ))}
                <CircleMarker center={result.start} radius={8} pathOptions={{ color: "#fff", weight: 3, fillColor: "#16a34a", fillOpacity: 1 }}><Popup>Start</Popup></CircleMarker>
                <CircleMarker center={result.end} radius={8} pathOptions={{ color: "#fff", weight: 3, fillColor: result.shelter ? "#16a34a" : "#dc2626", fillOpacity: 1 }}>
                  <Popup>{result.shelter ? `Shelter: ${result.shelter.name}` : "Destination"}</Popup>
                </CircleMarker>
              </BaseMap>
            ) : (
              <div className="flex h-full items-center justify-center p-6">
                <Empty text={mode === "route" ? "Enter a start and destination to see routes here." : "Enter where you are to see the way to the nearest shelter."} icon={Navigation} />
              </div>
            )}
          </div>
          <p className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-400">Routing: OSRM with OpenStreetMap road data.</p>
        </div>
      </div>
    </div>
  );
}

function RouteCard({ route: r, index, chosen, onClick, best }) {
  const problems = r.closures_on_route.length + r.verified_floods_on_route.length;
  return (
    <button onClick={onClick} className={`card card-hover w-full text-left ${chosen ? "ring-2 ring-blue-500" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-display font-bold text-navy-900">
          <span className="h-3 w-3 rounded-full" style={{ background: ROUTE_COLORS[index] }} /> Route {index + 1}
        </p>
        <div className="flex gap-1.5">
          {r.is_detour && <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-bold text-purple-700"><Shuffle className="h-3 w-3" /> Detour</span>}
          {best && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">Fewest known problems</span>}
        </div>
      </div>
      <p className="mt-2 flex gap-4 text-sm text-slate-600">
        <span className="inline-flex items-center gap-1"><Route className="h-4 w-4" /> {r.distance_km} km</span>
        <span className="inline-flex items-center gap-1"><Clock className="h-4 w-4" /> about {r.duration_min} min</span>
      </p>
      <p className={`mt-2 text-sm font-semibold ${problems ? "text-red-700" : "text-slate-500"}`}>
        {problems ? `${problems} known problem(s) on this route` : "No known closures or verified flooding"}
      </p>
      {r.closures_on_route.map((c) => (
        <p key={c.id} className="mt-1 flex items-center gap-1 text-xs text-red-700"><TriangleAlert className="h-3 w-3" />{c.road_name} closed · {c.source} ({formatTime(c.created_at)})</p>
      ))}
      {r.verified_floods_on_route.map((f) => (
        <p key={f.id} className="mt-1 text-xs text-red-700">Flooding at {f.location_text}, {f.water_depth_cm} cm ({formatTime(f.created_at)})</p>
      ))}
    </button>
  );
}
