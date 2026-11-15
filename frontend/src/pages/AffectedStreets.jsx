import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMap } from "react-leaflet";
import { Camera, Droplets, MapPin, RotateCw, Search } from "lucide-react";
import { useApi, formatTime, roadCondition, CONDITIONS } from "../api";
import { Loading, ErrorBox, Empty, ConditionBadge, PageHeader, RiskBadge } from "../components/Common";
import BaseMap, { FitToPoints } from "../components/BaseMap";
import StreetLines, { streetKey } from "../components/StreetLines";

// Moves the map to the street the user clicked
function FlyTo({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, 17);
  }, [target, map]);
  return null;
}

const FILTERS = [
  ["ALL", "All"],
  ["DANGEROUS", "Dangerous"],
  ["MODERATE", "Moderate risk"],
  ["LIKELY", "Likely flooded"],
  ["UNVERIFIED", "Unverified"],
];

export default function AffectedStreets() {
  const { data, error, loading, reload } = useApi("/api/streets");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [target, setTarget] = useState(null);
  const [hovered, setHovered] = useState(null);

  const all = data?.streets || [];
  const count = (c) => all.filter((s) => roadCondition(s) === c).length;

  // Filter the list by the search text and the chosen condition
  const text = search.trim().toLowerCase();
  const streets = all.filter((s) =>
    (filter === "ALL" || roadCondition(s) === filter) &&
    (!text || `${s.street_name} ${s.locality} ${s.area}`.toLowerCase().includes(text)));

  // Group the streets by area: { "Velachery": [...], "Adyar": [...] }
  const byArea = {};
  streets.forEach((s) => {
    byArea[s.area] = byArea[s.area] || [];
    byArea[s.area].push(s);
  });

  return (
    <div>
      <PageHeader eyebrow="Detect" title="Affected Streets"
                  subtitle="Street-by-street flooding from citizen reports. Only streets that someone has reported are shown. A street that is not listed may still be flooded."
                  actions={<>
                    <button className="btn-ghost" onClick={reload}><RotateCw className="h-4 w-4" /> Refresh</button>
                    <Link to="/report" className="btn"><Camera className="h-4 w-4" /> Report a street</Link>
                  </>} />

      {loading && <Loading lines={4} />}
      {error && <ErrorBox message={error} onRetry={reload} />}

      {data && (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.15fr]">
          {/* ---------- left: list ---------- */}
          <div className="order-2 lg:order-1">
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {["DANGEROUS", "MODERATE", "LIKELY", "UNVERIFIED"].map((c) => (
                <button key={c} onClick={() => setFilter(filter === c ? "ALL" : c)}
                        className={`card card-hover p-3 text-left ${filter === c ? "ring-2 ring-navy-900" : ""}`}>
                  <span className="mb-2 block h-1.5 w-8 rounded-full" style={{ background: CONDITIONS[c].color }} />
                  <span className="font-display text-2xl font-bold text-navy-900">{count(c)}</span>
                  <span className="block text-xs text-slate-500">{CONDITIONS[c].label}</span>
                </button>
              ))}
            </div>

            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input className="input pl-10" placeholder="Search street, locality or area..."
                     value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search streets" />
            </div>
            <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Filter by condition">
              {FILTERS.map(([key, label]) => (
                <button key={key} onClick={() => setFilter(key)} aria-pressed={filter === key}
                        className={`chip ${filter === key ? "chip-active" : ""}`}>{label}</button>
              ))}
            </div>

            {all.length === 0 && <Empty text="No flooded streets have been reported. If you see flooding, please report it." icon={MapPin} />}
            {all.length > 0 && streets.length === 0 && <Empty text="No streets match your search." icon={Search} />}

            <div className="space-y-6">
              {Object.entries(byArea).map(([area, list]) => (
                <section key={area}>
                  <h2 className="mb-2 flex items-baseline gap-2 text-sm font-bold uppercase tracking-wider text-slate-500">
                    {area} <span className="font-medium normal-case tracking-normal text-slate-400">· {list.length} street{list.length > 1 ? "s" : ""}</span>
                  </h2>
                  <div className="space-y-2.5">
                    {list.map((s) => {
                      const condition = roadCondition(s);
                      return (
                        <button key={streetKey(s)} onClick={() => setTarget([s.latitude, s.longitude])}
                                onMouseEnter={() => setHovered(streetKey(s))} onMouseLeave={() => setHovered(null)}
                                className="card card-hover relative w-full overflow-hidden p-4 pl-5 text-left">
                          <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: CONDITIONS[condition].color }} />
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-semibold text-navy-900">{s.street_name}</p>
                              {s.locality && <p className="text-xs text-slate-500">{s.locality}</p>}
                            </div>
                            <ConditionBadge condition={condition} />
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                            <span className="inline-flex items-center gap-1"><Droplets className="h-3.5 w-3.5 text-blue-500" />
                              Deepest water: <strong className="text-slate-700">{s.max_depth_cm} cm</strong></span>
                            <span>Worst: <strong className="text-slate-700">{s.worst_severity}</strong></span>
                            <span>{s.verified_reports} verified · {s.unverified_reports} unverified</span>
                            <span>{formatTime(s.latest_report_at)}</span>
                          </div>
                          {s.likely_flooded && (
                            <p className="mt-2 text-xs font-semibold text-purple-700">{s.independent_reporters} different people reported this street in the last hour</p>
                          )}
                          {s.prediction?.predicted_level && (
                            <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-2 text-xs text-slate-500">
                              Forecast risk (next 24 h) <RiskBadge level={s.prediction.predicted_level} />
                              <span className="text-slate-400">experimental</span>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
            <p className="mt-6 text-xs text-slate-400">{data.source}</p>
          </div>

          {/* ---------- right: map (stays in view while scrolling) ---------- */}
          <div className="order-1 lg:order-2">
            <div className="card overflow-hidden p-0 lg:sticky lg:top-24">
              <div className="h-[45vh] lg:h-[calc(100vh-9rem)]">
                <BaseMap zoom={12}>
                  <FitToPoints points={streets.map((s) => [s.latitude, s.longitude])} />
                  <FlyTo target={target} />
                  <StreetLines streets={streets} highlight={hovered} />
                </BaseMap>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-5 rounded-full" style={{ background: CONDITIONS.DANGEROUS.color }} />Dangerous</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-5 rounded-full" style={{ background: CONDITIONS.MODERATE.color }} />Moderate risk</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-5 border-t-2 border-dashed" style={{ borderColor: CONDITIONS.LIKELY.color }} />Likely</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-5 border-t-2 border-dashed border-slate-500" />Unverified</span>
                <span>· ~150 m highlighted per report</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
