import { useEffect, useMemo, useState } from "react";
import { CircleMarker, TileLayer, useMapEvents } from "react-leaflet";
import { CloudRain, MapPin, Pause, Play, Radar, Thermometer, Wind, X } from "lucide-react";
import { useApi, formatTime } from "../api";
import { ErrorBox, Loading, PageHeader } from "../components/Common";
import BaseMap, { FitToPoints } from "../components/BaseMap";
import FieldLayer from "../forecast/FieldLayer";
import WindLayer from "../forecast/WindLayer";
import { SCALES, colourFor, compassName, currentHourIndex, formatHour, valueAt } from "../forecast/grid";

// Lets the user click anywhere on the map to see the forecast there
function ClickToPick({ onPick }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lon: e.latlng.lng }) });
  return null;
}

const LAYERS = [
  ["rain", "Rain", CloudRain],
  ["temperature", "Temperature", Thermometer],
  ["none", "None", X],
];

export default function ForecastMap() {
  const forecast = useApi("/api/forecast-grid");
  const radar = useApi("/api/radar");
  const data = forecast.data;

  const [hour, setHour] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [layer, setLayer] = useState("rain");
  const [showWind, setShowWind] = useState(true);
  const [showRadar, setShowRadar] = useState(false);
  const [point, setPoint] = useState(null);

  // Start at the current hour once the data arrives
  useEffect(() => {
    if (data) setHour(currentHourIndex(data.times));
  }, [data]);

  // Play button: move one hour forward every 0.8 seconds, and loop
  useEffect(() => {
    if (!playing || !data) return undefined;
    const timer = setInterval(() => setHour((h) => (h + 1) % data.times.length), 800);
    return () => clearInterval(timer);
  }, [playing, data]);

  // For the timeline: the heaviest rain anywhere in the area, for each hour
  const maxRainPerHour = useMemo(
    () => (data ? data.rain_mm.map((grid) => Math.max(0, ...grid.flat().map((v) => v ?? 0))) : []),
    [data],
  );
  const wettestHour = maxRainPerHour.length ? maxRainPerHour.indexOf(Math.max(...maxRainPerHour)) : -1;
  const latestRadar = radar.data?.frames.at(-1);

  return (
    <div>
      <PageHeader eyebrow="Predict" title="Forecast Map"
                  subtitle="Approximate rain, wind and temperature for the next 48 hours. Drag the timeline or press play; click the map for the forecast at any spot." />

      {forecast.loading && <Loading lines={4} text="Loading forecast..." />}
      {forecast.error && <ErrorBox message={`Forecast unavailable. ${forecast.error}`} onRetry={forecast.reload} />}

      {data && (
        <>
          <SummaryStrip data={data} maxRain={maxRainPerHour} wettestHour={wettestHour} onPick={setHour} />

          <div className="relative h-[calc(100vh-14rem)] min-h-[520px] overflow-hidden rounded-3xl border border-slate-200 shadow-lift">
            <BaseMap zoom={10} zoomPosition="bottomright">
              {/* open the map zoomed to the forecast area */}
              <FitToPoints points={[[data.lats[0], data.lons[0]], [data.lats.at(-1), data.lons.at(-1)]]} maxZoom={11} />
              {layer !== "none" && <FieldLayer data={data} hour={hour} scale={layer} />}
              {showRadar && latestRadar && (
                <TileLayer url={latestRadar.tile_url} opacity={0.75} maxNativeZoom={7} maxZoom={19}
                           attribution='Radar &copy; <a href="https://www.rainviewer.com">RainViewer</a>' />
              )}
              {showWind && <WindLayer data={data} hour={hour} />}
              <ClickToPick onPick={setPoint} />
              {point && <CircleMarker center={[point.lat, point.lon]} radius={8}
                                      pathOptions={{ color: "#fff", weight: 3, fillColor: "#10213f", fillOpacity: 1 }} />}
            </BaseMap>

            {/* ---------- layer controls (top-left) ---------- */}
            <div className="absolute left-3 top-3 z-[1000] space-y-2">
              <div className="flex rounded-2xl bg-white/95 p-1 shadow-lift ring-1 ring-slate-200 backdrop-blur" role="radiogroup" aria-label="Colour layer">
                {LAYERS.map(([key, label, Icon]) => (
                  <button key={key} role="radio" aria-checked={layer === key} onClick={() => setLayer(key)}
                          className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition ${layer === key ? "bg-navy-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                    <Icon className="h-3.5 w-3.5" /> {label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <Toggle on={showWind} onClick={() => setShowWind(!showWind)} icon={Wind} label="Wind" />
                <Toggle on={showRadar} onClick={() => setShowRadar(!showRadar)} icon={Radar} label="Radar (observed)"
                        disabled={!latestRadar} />
              </div>
              {showRadar && latestRadar && (
                <p className="max-w-[260px] rounded-xl bg-white/95 px-3 py-2 text-[11px] text-slate-600 shadow-soft">
                  Radar image from {formatTime(new Date(latestRadar.time * 1000).toISOString())}. {radar.data.note}
                </p>
              )}
              {radar.error && showRadar && <p className="rounded-xl bg-white/95 px-3 py-2 text-[11px] text-red-600 shadow-soft">{radar.error}</p>}
            </div>

            {/* ---------- legend (top-right) ---------- */}
            {layer !== "none" && <Legend scale={layer} />}

            {/* ---------- clicked point (right) ---------- */}
            {point && <PointPanel data={data} hour={hour} point={point} onClose={() => setPoint(null)} onPickHour={setHour} />}

            {/* ---------- timeline (bottom) ---------- */}
            <div className="absolute inset-x-3 bottom-3 z-[1000] rounded-2xl bg-white/95 p-3 shadow-lift ring-1 ring-slate-200 backdrop-blur md:right-16">
              <div className="flex items-center gap-3">
                <button onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play"}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-md shadow-blue-600/30 hover:bg-blue-700">
                  {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate font-display text-sm font-bold text-navy-900">{formatHour(data.times[hour])}</p>
                    <p className="hidden text-[11px] text-slate-400 sm:block">{data.source}</p>
                  </div>
                  {/* mini bars: heaviest rain in the area each hour (click a bar to jump there) */}
                  <div className="mt-1.5 flex h-6 items-end gap-px">
                    {maxRainPerHour.map((mm, i) => (
                      <button key={data.times[i]} onClick={() => setHour(i)} title={`${formatHour(data.times[i])}: up to ${mm.toFixed(1)} mm/h`}
                              className="relative flex h-full flex-1 items-end" aria-label={`Go to ${formatHour(data.times[i])}`}>
                        <span className="w-full rounded-t-[2px]"
                              style={{ height: `${Math.max(8, Math.min(100, (mm / 5) * 100))}%`,
                                       background: mm >= 0.1 ? `rgb(${colourFor("rain", mm).join(",")})` : "#e2e8f0",
                                       outline: i === hour ? "2px solid #10213f" : "none" }} />
                      </button>
                    ))}
                  </div>
                  <input type="range" min="0" max={data.times.length - 1} value={hour} onChange={(e) => setHour(Number(e.target.value))}
                         aria-label="Forecast hour" className="mt-1 w-full accent-blue-600" />
                </div>
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {data.note} Forecast points are about 5 km apart; colours in between are blended. Radar shows OBSERVED rain, not a forecast.
          </p>
        </>
      )}
    </div>
  );
}

function Toggle({ on, onClick, icon: Icon, label, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-pressed={on}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold shadow-lift ring-1 transition disabled:opacity-50 ${on ? "bg-navy-900 text-white ring-navy-900" : "bg-white/95 text-slate-600 ring-slate-200 hover:bg-white"}`}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

function Legend({ scale }) {
  const { label, stops, ticks } = SCALES[scale];
  const gradient = stops.map(([, c], i) => `rgb(${c.join(",")}) ${(i / (stops.length - 1)) * 100}%`).join(", ");
  return (
    <div className="absolute right-3 top-3 z-[1000] w-52 rounded-2xl bg-white/95 p-3 shadow-lift ring-1 ring-slate-200 backdrop-blur">
      <p className="text-[11px] font-semibold text-slate-600">{label}</p>
      <div className="mt-1.5 h-2.5 rounded-full" style={{ background: `linear-gradient(to right, ${gradient})` }} />
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-slate-500">
        {ticks.map((t) => <span key={t}>{t}</span>)}
      </div>
      {scale === "rain" && <p className="mt-1 text-[10px] text-slate-400">No colour = less than 0.1 mm/h</p>}
    </div>
  );
}

// The forecast for one clicked spot: values at the chosen hour + 48 h rain bars
function PointPanel({ data, hour, point, onClose, onPickHour }) {
  const [hovered, setHovered] = useState(null);
  const at = (table, h) => valueAt(table[h], data.lats, data.lons, point.lat, point.lon);
  const outside = point.lat < data.lats[0] || point.lat > data.lats.at(-1) || point.lon < data.lons[0] || point.lon > data.lons.at(-1);
  const rainSeries = data.times.map((_, h) => at(data.rain_mm, h));
  const top = Math.max(1, ...rainSeries);
  const shown = hovered ?? hour;

  return (
    <div className="absolute right-3 top-28 z-[1000] w-72 rounded-2xl bg-white/95 p-4 shadow-lift ring-1 ring-slate-200 backdrop-blur">
      <div className="flex items-start justify-between">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-navy-900"><MapPin className="h-4 w-4 text-blue-600" /> This spot</p>
        <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
      </div>
      <p className="text-[11px] text-slate-400">{point.lat.toFixed(4)}, {point.lon.toFixed(4)}</p>
      {outside ? (
        <p className="mt-3 text-sm text-slate-500">Outside the forecast area (greater Chennai). Click closer to the city.</p>
      ) : (
        <>
          <p className="mt-3 text-xs font-semibold text-slate-500">{formatHour(data.times[shown])}</p>
          <div className="mt-1 grid grid-cols-3 gap-2 text-center">
            <Stat label="Rain" value={`${at(data.rain_mm, shown).toFixed(1)}`} unit="mm/h" />
            <Stat label="Wind" value={`${Math.round(at(data.wind_kmh, shown))}`}
                  unit={`km/h ${compassName(data.wind_from_deg[shown][nearestIndex(data.lats, point.lat)][nearestIndex(data.lons, point.lon)] ?? 0)}`} />
            <Stat label="Temp" value={`${at(data.temperature_c, shown).toFixed(0)}`} unit="Â°C" />
          </div>
          <p className="mt-3 text-[11px] text-slate-500">Rain, next 48 h (click a bar)</p>
          <div className="mt-1 flex h-16 items-end gap-px" onMouseLeave={() => setHovered(null)}>
            {rainSeries.map((mm, h) => (
              <button key={data.times[h]} onMouseEnter={() => setHovered(h)} onClick={() => onPickHour(h)}
                      className="flex h-full flex-1 items-end" aria-label={`${formatHour(data.times[h])}: ${mm.toFixed(1)} mm`}>
                <span className="w-full rounded-t-[2px]"
                      style={{ height: `${(mm / top) * 100}%`, minHeight: mm > 0.05 ? 2 : 0,
                               background: h === hour ? "#10213f" : "#2a78d6", opacity: hovered === null || hovered === h ? 1 : 0.5 }} />
              </button>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-slate-400"><span>now</span><span>max {top.toFixed(1)} mm/h</span></div>
        </>
      )}
    </div>
  );
}

function nearestIndex(values, x) {
  return values.reduce((best, v, i) => (Math.abs(v - x) < Math.abs(values[best] - x) ? i : best), 0);
}

function Stat({ label, value, unit }) {
  return (
    <div className="rounded-xl bg-slate-50 px-1 py-2">
      <p className="text-[10px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className="font-display text-lg font-bold text-navy-900">{value}</p>
      <p className="text-[10px] text-slate-500">{unit}</p>
    </div>
  );
}

// One-line summary above the map: when is the heaviest rain expected?
function SummaryStrip({ data, maxRain, wettestHour, onPick }) {
  const peak = maxRain[wettestHour] ?? 0;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-soft">
      <CloudRain className="h-5 w-5 text-blue-600" />
      {peak < 0.1 ? (
        <p className="text-sm text-slate-600">No significant rain is forecast anywhere in the area for the next 48 hours.</p>
      ) : (
        <p className="text-sm text-slate-600">
          Heaviest rain expected around <strong className="text-navy-900">{formatHour(data.times[wettestHour])}</strong>
          {" "}(up to {peak.toFixed(1)} mm/h somewhere in the area).
          <button className="ml-2 font-semibold text-blue-600 hover:underline" onClick={() => onPick(wettestHour)}>Show on map</button>
        </p>
      )}
    </div>
  );
}
