import { useState } from "react";
import { CloudRain, Droplets, Gauge, Thermometer, Umbrella, Wind } from "lucide-react";
import { useApi, formatLocal } from "../api";
import { Loading, ErrorBox, PageHeader, StatCard } from "../components/Common";
import TideCard from "../components/TideCard";

// Chart colours (checked for colour-blind safety): past hours = blue, forecast = orange
const PAST_COLOR = "#2a78d6";
const FORECAST_COLOR = "#eb6834";

export default function Weather() {
  const { data, error, loading, reload } = useApi("/api/weather");
  const [selected, setSelected] = useState(0); // which area is shown

  if (loading) return <div><PageHeader eyebrow="Predict" title="Weather Monitoring" /><Loading text="Loading live weather..." lines={6} /></div>;
  if (error) return (
    <div>
      <PageHeader eyebrow="Predict" title="Weather Monitoring" />
      <ErrorBox message={`Weather service unavailable. ${error}`} onRetry={reload} />
      <p className="text-sm text-slate-500">We do not show made-up numbers when the weather service is down.</p>
    </div>
  );

  const area = data.areas[selected];

  return (
    <div>
      <PageHeader eyebrow="Predict" title="Weather Monitoring"
                  subtitle={`Last updated ${formatLocal(data.updated_at)} IST · ${data.source}`} />

      {/* Area picker */}
      <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Choose area">
        {data.areas.map((a, i) => (
          <button key={a.area_id} role="tab" aria-selected={i === selected} onClick={() => setSelected(i)}
                  className={`chip px-4 py-2 text-sm ${i === selected ? "chip-active" : ""}`}>{a.name}</button>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard icon={Thermometer} label="Temperature" value={`${area.temperature_c ?? "–"} °C`} hint={`Humidity ${area.humidity ?? "–"}%`} tone="amber" />
        <StatCard icon={Droplets} label="Last 1 h" value={mm(area.rain_last_1h)} tone="blue" />
        <StatCard icon={CloudRain} label="Last 3 h" value={mm(area.rain_last_3h)} tone="blue" />
        <StatCard icon={Gauge} label="Last 24 h" value={mm(area.rain_last_24h)} tone="blue" />
        <StatCard icon={Umbrella} label="Next 24 h" value={mm(area.rain_next_24h)} hint={`Max chance ${area.max_chance_next_24h ?? "–"}%`} tone="red" />
        <StatCard icon={Wind} label="Wind" value={`${area.wind_kmh ?? "–"} km/h`} hint={`Ground ${area.elevation_m ?? "–"} m`} tone="slate" />
      </div>

      <RainChart area={area} />
      <TideCard />

      {/* Table view of all areas (also useful for screen readers) */}
      <div className="card mt-6 overflow-x-auto p-0">
        <h2 className="px-5 pt-5 font-display text-lg font-bold text-navy-900">All areas</h2>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-y border-slate-100 bg-slate-50/70 text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="px-5 py-2.5 font-semibold">Area</th><th className="font-semibold">Temp °C</th><th className="font-semibold">Last 1 h</th>
              <th className="font-semibold">Last 3 h</th><th className="font-semibold">Last 24 h</th><th className="font-semibold">Next 24 h</th>
              <th className="pr-5 font-semibold">Max chance</th>
            </tr>
          </thead>
          <tbody>
            {data.areas.map((a, i) => (
              <tr key={a.area_id} onClick={() => setSelected(i)}
                  className={`cursor-pointer border-b border-slate-100 transition last:border-0 hover:bg-blue-50/50 ${i === selected ? "bg-blue-50/70" : ""}`}>
                <td className="px-5 py-3 font-semibold text-navy-900">{a.name}</td>
                <td>{a.temperature_c ?? "–"}</td>
                <td className="tabular-nums">{mm(a.rain_last_1h)}</td>
                <td className="tabular-nums">{mm(a.rain_last_3h)}</td>
                <td className="tabular-nums">{mm(a.rain_last_24h)}</td>
                <td className="tabular-nums">{mm(a.rain_next_24h)}</td>
                <td className="pr-5 tabular-nums">{a.max_chance_next_24h ?? "–"}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-5 py-3 text-xs text-slate-400">Click a row to see its chart. "–" means the value was missing.</p>
      </div>
    </div>
  );
}

function mm(value) {
  return value === null || value === undefined ? "–" : `${value} mm`;
}

// Bar chart: one bar per hour. Hover a bar to see its exact values.
function RainChart({ area }) {
  const [hover, setHover] = useState(null);
  const now = area.data_time.slice(0, 13) + ":00";
  const hours = area.hourly;
  const biggest = Math.max(...hours.map((h) => h.rain_mm || 0));
  const top = biggest <= 1 ? 1 : Math.ceil(biggest / 2) * 2; // round the top of the scale to an even number
  const nowIndex = hours.findIndex((h) => h.time > now);
  const shown = hover !== null ? hours[hover] : null;

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-navy-900">Hourly rainfall · {area.name}</h2>
          <p className="text-xs text-slate-500">Millimetres of rain per hour (Open-Meteo model data)</p>
        </div>
        <div className="flex gap-4 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: PAST_COLOR }} />Past hours</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: FORECAST_COLOR }} />Forecast</span>
        </div>
      </div>

      <div className="mt-6 flex gap-2">
        {/* y-axis labels */}
        <div className="flex h-48 flex-col justify-between pb-0 text-right text-[10px] tabular-nums text-slate-400">
          <span>{top}</span><span>{top / 2}</span><span>0</span>
        </div>

        <div className="relative flex-1">
          {/* faint grid lines */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-48">
            {[0, 50, 100].map((p) => <div key={p} className="absolute inset-x-0 border-t border-slate-100" style={{ top: `${p}%` }} />)}
          </div>

          {/* "now" marker */}
          {nowIndex > 0 && (
            <div className="pointer-events-none absolute top-0 h-48 border-l border-dashed border-slate-400"
                 style={{ left: `${(nowIndex / hours.length) * 100}%` }}>
              <span className="absolute -top-4 -translate-x-1/2 text-[10px] font-semibold text-slate-500">now</span>
            </div>
          )}

          {/* bars: each column is a big invisible hover target */}
          <div className="relative flex h-48 items-end" onMouseLeave={() => setHover(null)}>
            {hours.map((h, i) => (
              <div key={h.time} className="flex h-full flex-1 items-end px-[1px]" onMouseEnter={() => setHover(i)}
                   aria-label={`${h.time}: ${h.rain_mm ?? "missing"} mm`}>
                <div className="w-full rounded-t-[4px] transition-opacity"
                     style={{
                       height: `${((h.rain_mm || 0) / top) * 100}%`, minHeight: h.rain_mm ? 2 : 0,
                       background: h.time <= now ? PAST_COLOR : FORECAST_COLOR,
                       opacity: hover === null || hover === i ? 1 : 0.45,
                     }} />
              </div>
            ))}
          </div>

          {/* tooltip */}
          {shown && (
            <div className="pointer-events-none absolute -top-2 z-10 rounded-xl bg-navy-950 px-3 py-2 text-xs text-white shadow-lift"
                 style={{ left: `${((hover + 0.5) / hours.length) * 100}%`, transform: `translate(${hover > hours.length * 0.7 ? "-100%" : hover < hours.length * 0.3 ? "0" : "-50%"}, -100%)` }}>
              <p className="font-semibold">{formatLocal(shown.time)}</p>
              <p>{shown.rain_mm ?? "missing"} mm · {shown.chance ?? "?"}% chance</p>
              <p className="text-slate-400">{shown.time <= now ? "past hour" : "forecast"}</p>
            </div>
          )}

          {/* x-axis: label every 12 hours */}
          <div className="relative mt-2 h-4 text-[10px] text-slate-400">
            {hours.map((h, i) => (i % 12 === 0 ? (
              <span key={h.time} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${((i + 0.5) / hours.length) * 100}%` }}>
                {formatLocal(h.time)}
              </span>
            ) : null))}
          </div>
        </div>
      </div>
    </div>
  );
}
