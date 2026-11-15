import { ChevronDown, Mountain, CloudRain } from "lucide-react";
import { useApi, formatLocal, RISK_COLORS, RISK_ORDER } from "../api";
import { Loading, ErrorBox, RiskBadge, ExperimentalNote, PageHeader } from "../components/Common";
import StreetCheck from "../components/StreetCheck";
import TrackRecord from "../components/TrackRecord";

const LEVELS = ["LOW", "MODERATE", "HIGH", "VERY_HIGH"];

export default function Predictions() {
  const { data, error, loading, reload } = useApi("/api/risk");
  const areas = [...(data?.areas || [])].sort((a, b) => (RISK_ORDER[b.risk_level] || 0) - (RISK_ORDER[a.risk_level] || 0));

  return (
    <div>
      <PageHeader eyebrow="Predict" title="Flood Predictions"
                  subtitle={data ? `Area-level risk from weather data of ${formatLocal(data.updated_at)} IST (Open-Meteo).` : undefined} />
      <ExperimentalNote />
      <StreetCheck />
      {loading && <Loading lines={5} />}
      {error && <ErrorBox message={error} onRetry={reload} />}

      {data && (
        <>
          {/* how many areas are at each level */}
          <div className="my-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            {LEVELS.map((level) => (
              <div key={level} className="card p-4">
                <span className="mb-2 block h-1.5 w-8 rounded-full" style={{ background: RISK_COLORS[level] }} />
                <p className="font-display text-2xl font-bold text-navy-900">{areas.filter((a) => a.risk_level === level).length}</p>
                <p className="text-xs text-slate-500">{level.replace("_", " ").toLowerCase()} risk areas</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {areas.map((a) => (
              <div key={a.area_id} className="card card-hover">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-display text-lg font-bold text-navy-900">{a.name}</h2>
                  <RiskBadge level={a.risk_level} />
                </div>
                <RiskMeter level={a.risk_level} />
                <p className="mt-3 text-sm text-slate-500">{a.reason}</p>
              </div>
            ))}
          </div>
        </>
      )}

      <TrackRecord />

      {/* Click to open: how the score is calculated */}
      <details className="card group mt-8">
        <summary className="flex cursor-pointer list-none items-center justify-between font-display text-lg font-bold text-navy-900">
          How is this calculated?
          <ChevronDown className="h-5 w-5 text-slate-400 transition group-open:rotate-180" />
        </summary>
        <div className="mt-4 grid gap-6 text-sm text-slate-600 md:grid-cols-2">
          <div>
            <p className="flex items-center gap-2 font-semibold text-navy-900"><CloudRain className="h-4 w-4 text-blue-600" /> Step 1: rain</p>
            <p className="mt-1">We add the rain from the <strong>past 24 hours</strong> and the <strong>forecast for the next 24 hours</strong>:</p>
            <ul className="mt-2 space-y-1">
              <li>Less than 64.5 mm → LOW</li>
              <li>64.5 mm or more (IMD "heavy rain") → MODERATE</li>
              <li>115.6 mm or more ("very heavy") → HIGH</li>
              <li>204.5 mm or more ("extremely heavy") → VERY HIGH</li>
            </ul>
          </div>
          <div>
            <p className="flex items-center gap-2 font-semibold text-navy-900"><Mountain className="h-4 w-4 text-blue-600" /> Step 2: ground height</p>
            <p className="mt-1">If there is heavy rain and the ground is lower than 10 m, the level goes up one step, because low ground floods first.</p>
            <p className="mt-3"><strong>Street level:</strong> the area level goes up one step on flood-prone spots: places where
              flooding was verified before, known waterlogging spots, or low ground right next to a river or lake (terrain
              data is low confidence, because the 90 m height model includes buildings).</p>
            <p className="mt-3">This is a simple rule, not a trained machine-learning model. A real model needs verified, dated records of past floods,
              which this project does not have yet. Risk is per <strong>area</strong>, because the rainfall data is not detailed enough for single streets.</p>
          </div>
        </div>
      </details>
    </div>
  );
}

// Four little bars that fill up with the risk level
function RiskMeter({ level }) {
  const filled = RISK_ORDER[level] || 0;
  return (
    <div className="mt-4 flex gap-1" aria-hidden="true">
      {LEVELS.map((l, i) => (
        <span key={l} className="h-1.5 flex-1 rounded-full" style={{ background: i < filled ? RISK_COLORS[level] : "#e2e8f0" }} />
      ))}
    </div>
  );
}
