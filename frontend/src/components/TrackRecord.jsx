// Track record: were past predictions followed by verified flooding?
import { History } from "lucide-react";
import { useApi } from "../api";
import { RiskBadge } from "./Common";

export default function TrackRecord() {
  const { data, error } = useApi("/api/risk/track-record");
  if (error) return null;

  return (
    <section className="card mt-8">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold text-navy-900">
        <History className="h-5 w-5 text-blue-600" /> Track record
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Every prediction is saved. After 24 hours we check whether flooding was verified in that area.
      </p>

      {data && data.total_predictions === 0 && (
        <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
          No predictions are old enough to check yet. The record fills up as the system runs.
        </p>
      )}

      {data && data.total_predictions > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="py-2 font-semibold">Predicted level</th>
                <th className="font-semibold">Predictions</th>
                <th className="font-semibold">Followed by verified flooding</th>
                <th className="font-semibold">Rate</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.levels).map(([level, row]) => (
                <tr key={level} className="border-b border-slate-100 last:border-0">
                  <td className="py-2.5"><RiskBadge level={level} /></td>
                  <td className="tabular-nums">{row.predictions}</td>
                  <td className="tabular-nums">{row.followed_by_flooding}</td>
                  <td className="tabular-nums">{row.rate === null ? "–" : `${Math.round(row.rate * 100)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <p className="mt-3 text-xs text-slate-400">{data.note}</p>}
    </section>
  );
}
