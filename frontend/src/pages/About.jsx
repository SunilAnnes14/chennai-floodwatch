import { BellRing, Radar, ScanEye, TriangleAlert } from "lucide-react";
import { PageHeader } from "../components/Common";

const STEPS = [
  [Radar, "Predict", "Rain forecasts, rain so far and ground height give each area an experimental risk level."],
  [ScanEye, "Detect", "Citizens report flooding with photo and GPS. Admins verify reports, and each street is classed as dangerous, moderate risk or unverified."],
  [BellRing, "Alert", "Clearly labelled alerts (official / verified / prediction), road closures, and routes that avoid known problems."],
];

const SOURCES = [
  ["Weather", "Open-Meteo.com", "CC BY 4.0", "Weather-model values, not rain-gauge readings"],
  ["Elevation", "Copernicus DEM 90 m (via Open-Meteo)", "Free with attribution", ""],
  ["Maps, streets, roads", "OpenStreetMap contributors", "ODbL", ""],
  ["Routing", "OSRM", "Open source", "Public demo server"],
  ["Place search", "Nominatim", "ODbL", "Max 1 request per second"],
  ["Flood reports", "Citizens", "", "Only 'verified' after an admin checks them"],
];

export default function About() {
  return (
    <div className="max-w-4xl">
      <PageHeader eyebrow="About" title="About Chennai FloodWatch"
                  subtitle="A student project that brings together rainfall, citizen flood reports and road information for Chennai, Tamil Nadu." />

      <div className="mb-6 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <p><strong>This is not an official government service.</strong> In an emergency call 112 and follow instructions from the
          Greater Chennai Corporation, IMD and the police.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {STEPS.map(([Icon, title, text], i) => (
          <div key={title} className="card">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy-900 text-white"><Icon className="h-5 w-5" /></span>
            <h2 className="mt-3 font-display text-lg font-bold text-navy-900">{i + 1}. {title}</h2>
            <p className="mt-1 text-sm text-slate-500">{text}</p>
          </div>
        ))}
      </div>

      <div className="card mt-6 overflow-x-auto p-0">
        <h2 className="px-5 pt-5 font-display text-lg font-bold text-navy-900">Data sources</h2>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-y border-slate-100 bg-slate-50/70 text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="px-5 py-2.5 font-semibold">Data</th><th className="font-semibold">Source</th><th className="font-semibold">Licence</th><th className="pr-5 font-semibold">Note</th>
            </tr>
          </thead>
          <tbody>
            {SOURCES.map(([data, source, licence, note]) => (
              <tr key={data} className="border-b border-slate-100 last:border-0">
                <td className="px-5 py-3 font-semibold text-navy-900">{data}</td><td>{source}</td><td>{licence}</td><td className="pr-5 text-slate-500">{note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card mt-6">
        <h2 className="font-display text-lg font-bold text-navy-900">Limitations</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>Risk levels come from a simple rule, not a validated machine-learning model, and they are per area, not per street.</li>
          <li>No historical flood dataset has been added yet.</li>
          <li>Many flooded roads are never reported, so a route with "no known problems" can still be flooded.</li>
          <li>We never label a road "safe": a road with no reports only has "no known issues".</li>
        </ul>
      </div>
    </div>
  );
}
