import { useEffect, useState } from "react";
import { CircleMarker, Popup, LayerGroup, Rectangle, useMap } from "react-leaflet";
import { Crosshair, Layers, Search, ChevronDown } from "lucide-react";
import { api, useApi, formatTime, formatLocal, RISK_COLORS, CONDITIONS, TERRAIN_COLORS } from "../api";
import { ErrorBox, StatusBadge } from "../components/Common";
import BaseMap, { FitToPoints } from "../components/BaseMap";
import StreetLines from "../components/StreetLines";

// Helper component: moves the map when "target" changes
function FlyTo({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, 15);
  }, [target, map]);
  return null;
}

export default function FloodMap() {
  const risk = useApi("/api/risk");
  const weather = useApi("/api/weather");
  const reports = useApi("/api/reports");
  const closures = useApi("/api/road-closures");
  const streets = useApi("/api/streets");
  const terrain = useApi("/api/terrain");
  const waterlogging = useApi("/api/waterlogging");
  const shelters = useApi("/api/shelters");

  const [search, setSearch] = useState("");
  const [target, setTarget] = useState(null);
  const [message, setMessage] = useState("");
  const [panelOpen, setPanelOpen] = useState(true);

  // Which layers are switched on
  const [show, setShow] = useState({
    risk: true, streets: true, verified: true, unverified: true, closures: true, rainfall: false, elevation: false, historical: true, terrain: false, shelters: true,
  });
  const toggle = (key) => setShow({ ...show, [key]: !show[key] });

  const verified = (reports.data || []).filter((r) => r.status === "VERIFIED");
  const unverified = (reports.data || []).filter((r) => r.status === "PENDING");

  // The list of layer switches. Each has a colour swatch and a count.
  const LAYERS = [
    { key: "risk", label: "A. Predicted risk", note: "experimental", count: risk.data?.areas.length, swatch: "ring", color: RISK_COLORS.HIGH },
    { key: "verified", label: "B. Verified flooding", count: verified.length, swatch: "dot", color: "#dc2626" },
    { key: "unverified", label: "C. Unverified reports", note: "not confirmed", count: unverified.length, swatch: "dashed", color: "#64748b" },
    { key: "historical", label: "D. Known waterlogging spots", note: waterlogging.data?.length ? "historical - not current" : "none imported yet", count: waterlogging.data?.length, swatch: "square", color: "#a855f7", disabled: !waterlogging.data?.length },
    { key: "terrain", label: "Terrain susceptibility", note: terrain.data?.built ? "low confidence" : "grid not built yet", count: terrain.data?.cells.length, swatch: "square", color: TERRAIN_COLORS.HIGH, disabled: !terrain.data?.built },
    { key: "shelters", label: "Relief shelters", count: shelters.data?.length, swatch: "dot", color: "#16a34a" },
    { key: "streets", label: "Affected streets", count: streets.data?.streets.length, swatch: "line", color: CONDITIONS.DANGEROUS.color },
    { key: "closures", label: "Road closures", count: closures.data?.length, swatch: "dot", color: "#f97316" },
    { key: "rainfall", label: "Rainfall (24 h)", count: weather.data?.areas.length, swatch: "ring", color: "#2a78d6" },
    { key: "elevation", label: "Elevation", count: weather.data?.areas.filter((a) => a.elevation_m !== null).length, swatch: "dot", color: "#6250d6" },
  ];

  async function doSearch(e) {
    e.preventDefault();
    setMessage("Searching...");
    try {
      const place = await api(`/api/geocode?q=${encodeURIComponent(search)}`);
      setTarget([place.latitude, place.longitude]);
      setMessage("");
    } catch (err) {
      setMessage(err.message);
    }
  }

  function myLocation() {
    if (!navigator.geolocation) return setMessage("Your browser does not support location.");
    setMessage("Finding your location...");
    navigator.geolocation.getCurrentPosition(
      (pos) => { setTarget([pos.coords.latitude, pos.coords.longitude]); setMessage(""); },
      () => setMessage("Location permission was denied."),
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">Detect</p>
          <h1 className="title">Live Flood Map</h1>
        </div>
        {weather.data && <p className="text-xs text-slate-500">Weather data {formatLocal(weather.data.updated_at)} IST · Open-Meteo</p>}
      </div>
      {risk.error && <ErrorBox message={risk.error} />}
      {reports.error && <ErrorBox message={reports.error} />}

      <div className="relative h-[calc(100vh-11rem)] min-h-[520px] overflow-hidden rounded-3xl border border-slate-200 shadow-lift">
        <BaseMap zoomPosition="bottomright" preferCanvas>
          <FitToPoints points={(risk.data?.areas || []).map((a) => [a.latitude, a.longitude])} maxZoom={12} />
          <FlyTo target={target} />

          {show.terrain && terrain.data && (
            <LayerGroup>
              {terrain.data.cells.map((c) => {
                const h = terrain.data.cell_size_deg / 2;
                return (
                  <Rectangle key={`${c.latitude},${c.longitude}`} bounds={[[c.latitude - h, c.longitude - h], [c.latitude + h, c.longitude + h]]}
                             pathOptions={{ stroke: false, fillColor: TERRAIN_COLORS[c.level], fillOpacity: c.level === "LOW" ? 0.06 : c.level === "MEDIUM" ? 0.22 : 0.32 }}>
                    <Popup>Terrain susceptibility: <strong>{c.level}</strong> (score {c.score})<br />Ground {c.elevation_m} m<br /><small>Low confidence · {terrain.data.source}</small></Popup>
                  </Rectangle>
                );
              })}
            </LayerGroup>
          )}

          {show.risk && (
            <LayerGroup>
              {(risk.data?.areas || []).map((a) => (
                <CircleMarker key={a.area_id} center={[a.latitude, a.longitude]} radius={22}
                              pathOptions={{ color: RISK_COLORS[a.risk_level] || "#94a3b8", weight: 2, fillOpacity: 0.18 }}>
                  <Popup>
                    <strong>{a.name}</strong><br />
                    Predicted risk: {a.risk_level || "no data"} (EXPERIMENTAL)<br />
                    {a.reason}<br />
                    <small>Data time: {formatLocal(risk.data.updated_at)} IST · Source: Open-Meteo</small>
                  </Popup>
                </CircleMarker>
              ))}
            </LayerGroup>
          )}

          {show.rainfall && (
            <LayerGroup>
              {(weather.data?.areas || []).map((a) => (
                <CircleMarker key={a.area_id} center={[a.latitude, a.longitude]} radius={6 + Math.min(a.rain_last_24h || 0, 100) / 4}
                              pathOptions={{ color: "#2a78d6", weight: 1.5, fillOpacity: 0.35 }}>
                  <Popup>
                    <strong>{a.name}</strong><br />Rain last 24 h: {a.rain_last_24h ?? "missing"} mm<br />
                    <small>Open-Meteo model data · {formatLocal(a.data_time)} IST</small>
                  </Popup>
                </CircleMarker>
              ))}
            </LayerGroup>
          )}

          {show.elevation && (
            <LayerGroup>
              {(weather.data?.areas || []).filter((a) => a.elevation_m !== null).map((a) => (
                <CircleMarker key={a.area_id} center={[a.latitude, a.longitude]} radius={6} pathOptions={{ color: "#6250d6", fillOpacity: 0.85 }}>
                  <Popup>{a.name}: {a.elevation_m} m above sea level<br /><small>Copernicus DEM via Open-Meteo</small></Popup>
                </CircleMarker>
              ))}
            </LayerGroup>
          )}

          {show.streets && <LayerGroup><StreetLines streets={streets.data?.streets || []} /></LayerGroup>}

          {show.verified && (
            <LayerGroup>
              {verified.map((r) => (
                <CircleMarker key={r.id} center={[r.latitude, r.longitude]} radius={8}
                              pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#dc2626", fillOpacity: 1 }}>
                  <Popup><ReportPopup r={r} /></Popup>
                </CircleMarker>
              ))}
            </LayerGroup>
          )}

          {show.unverified && (
            <LayerGroup>
              {unverified.map((r) => (
                <CircleMarker key={r.id} center={[r.latitude, r.longitude]} radius={7}
                              pathOptions={{ color: "#64748b", dashArray: "4", fillOpacity: 0.25 }}>
                  <Popup><ReportPopup r={r} /></Popup>
                </CircleMarker>
              ))}
            </LayerGroup>
          )}

          {show.historical && (
            <LayerGroup>
              {(waterlogging.data || []).map((p) => (
                <Rectangle key={p.id} bounds={[[p.latitude - 0.0006, p.longitude - 0.0006], [p.latitude + 0.0006, p.longitude + 0.0006]]}
                           pathOptions={{ color: "#a855f7", weight: 1.5, fillOpacity: 0.3 }}>
                  <Popup><strong>{p.name}</strong><br />Known waterlogging spot (HISTORICAL - not current flooding)<br /><small>Source: {p.source}</small></Popup>
                </Rectangle>
              ))}
            </LayerGroup>
          )}

          {show.shelters && (
            <LayerGroup>
              {(shelters.data || []).map((s) => (
                <CircleMarker key={s.id} center={[s.latitude, s.longitude]} radius={8}
                              pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#16a34a", fillOpacity: 1 }}>
                  <Popup><strong>🏠 {s.name}</strong><br />Relief shelter{s.capacity ? ` · capacity ${s.capacity}` : ""}<br /><small>Source: {s.source}</small></Popup>
                </CircleMarker>
              ))}
            </LayerGroup>
          )}

          {show.closures && (
            <LayerGroup>
              {(closures.data || []).map((c) => (
                <CircleMarker key={c.id} center={[c.latitude, c.longitude]} radius={8}
                              pathOptions={{ color: "#0b1730", weight: 2, fillColor: "#f97316", fillOpacity: 1 }}>
                  <Popup>
                    <strong>⛔ {c.road_name}</strong><br />{c.reason}<br />
                    <small>Source: {c.source} · {formatTime(c.created_at)}</small>
                  </Popup>
                </CircleMarker>
              ))}
            </LayerGroup>
          )}
        </BaseMap>

        {/* Floating control panel (outside the map so clicks don't move the map) */}
        <div className="absolute left-3 top-3 z-[1000] w-[calc(100%-1.5rem)] max-w-xs space-y-2">
          <form onSubmit={doSearch} className="flex gap-2 rounded-2xl bg-white/95 p-2 shadow-lift ring-1 ring-slate-200 backdrop-blur">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input className="input border-0 py-2 pl-9 shadow-none focus:ring-2" placeholder="Search a place, e.g. Velachery"
                     value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search location" />
            </div>
            <button className="btn px-3 py-2" disabled={search.length < 2} aria-label="Search">Go</button>
            <button type="button" className="btn-ghost px-2.5 py-2" onClick={myLocation} title="My location" aria-label="My location">
              <Crosshair className="h-4 w-4" />
            </button>
          </form>
          {message && <p className="rounded-xl bg-white/95 px-3 py-2 text-xs text-slate-600 shadow-soft">{message}</p>}

          <div className="rounded-2xl bg-white/95 shadow-lift ring-1 ring-slate-200 backdrop-blur">
            <button className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-navy-900"
                    onClick={() => setPanelOpen(!panelOpen)} aria-expanded={panelOpen}>
              <span className="flex items-center gap-2"><Layers className="h-4 w-4" /> Map layers</span>
              <ChevronDown className={`h-4 w-4 transition ${panelOpen ? "rotate-180" : ""}`} />
            </button>
            {panelOpen && (
              <div className="max-h-[50vh] space-y-0.5 overflow-y-auto px-2 pb-2">
                {LAYERS.map((layer) => (
                  <label key={layer.key}
                         className={`flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-slate-50 ${layer.disabled ? "cursor-not-allowed opacity-50" : ""}`}>
                    <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={show[layer.key]} disabled={layer.disabled}
                           onChange={() => toggle(layer.key)} />
                    <Swatch type={layer.swatch} color={layer.color} />
                    <span className="flex-1 text-sm leading-tight text-slate-700">
                      {layer.label}
                      {layer.note && <span className="block text-[11px] text-slate-400">{layer.note}</span>}
                    </span>
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-500">{layer.count ?? "–"}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Verified = checked by an admin. Unverified = not checked yet, may be wrong. Layer D shows known waterlogging spots imported
        by admins from official lists: they are historical and never shown as current flooding.
      </p>
    </div>
  );
}

// The little coloured sign next to each layer name
function Swatch({ type, color }) {
  if (type === "line") return <span className="h-1.5 w-5 rounded-full" style={{ background: color }} />;
  if (type === "dashed") return <span className="h-0 w-5 border-t-2 border-dashed" style={{ borderColor: color }} />;
  if (type === "square") return <span className="h-3.5 w-3.5 rounded-[3px]" style={{ background: color, opacity: 0.8 }} />;
  if (type === "ring") return <span className="h-4 w-4 rounded-full border-2" style={{ borderColor: color, background: `${color}30` }} />;
  return <span className="h-3 w-3 rounded-full ring-2 ring-white" style={{ background: color }} />;
}

function ReportPopup({ r }) {
  return (
    <div>
      <StatusBadge status={r.status} />
      <p className="mt-1.5 font-semibold">{r.location_text}</p>
      {r.street_name && <p className="text-xs text-slate-500">{r.street_name}{r.locality ? `, ${r.locality}` : ""}</p>}
      <p>Water depth: {r.water_depth_cm} cm · Severity: {r.severity}</p>
      {r.description && <p>{r.description}</p>}
      {r.photo_url && <img src={r.photo_url} alt="Flood" className="mt-1 w-44 rounded-lg" />}
      <small>Reported {formatTime(r.created_at)} · Source: citizen report</small>
    </div>
  );
}
