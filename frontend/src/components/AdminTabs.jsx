// Extra admin tabs: Shelters, Briefing (for emergency authorities) and Data (imports, terrain grid).
import { useEffect, useState } from "react";
import { Download, FileUp, Printer, RefreshCw } from "lucide-react";
import { api, formatTime, roadCondition } from "../api";
import { ConditionBadge, Empty, ErrorBox, Loading, RiskBadge } from "./Common";

// Downloads a file that needs the login token (a normal link can't send the token)
async function downloadWithToken(url, filename) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
  if (!response.ok) throw Object.assign(new Error("Download failed"), { status: response.status });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(await response.blob());
  link.download = filename;
  link.click();
}

// ---------------- Shelters ----------------
export function SheltersTab({ onError }) {
  const empty = { name: "", latitude: "", longitude: "", capacity: "", source: "" };
  const [form, setForm] = useState(empty);
  const [shelters, setShelters] = useState([]);
  const [error, setError] = useState("");

  const load = () => api("/api/shelters").then(setShelters).catch((e) => onError(e, setError));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function create(e) {
    e.preventDefault();
    setError("");
    try {
      await api("/api/admin/shelters", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, latitude: Number(form.latitude), longitude: Number(form.longitude),
                               capacity: form.capacity ? Number(form.capacity) : null }),
      });
      setForm(empty);
      load();
    } catch (err) {
      onError(err, setError);
    }
  }

  async function remove(id) {
    try {
      await api(`/api/admin/shelters/${id}`, { method: "DELETE" });
      load();
    } catch (err) {
      onError(err, setError);
    }
  }

  const field = (key, placeholder, type = "text", required = true) => (
    <input className="input" type={type} step="any" placeholder={placeholder} aria-label={placeholder} required={required}
           value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
  );

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <form onSubmit={create} className="card space-y-3">
        <h2 className="font-display font-bold text-navy-900">Add relief shelter</h2>
        <p className="text-xs text-slate-500">Copy shelters from an official relief-centre list (e.g. Greater Chennai Corporation). Used for evacuation routes.</p>
        {field("name", "Shelter name, e.g. Corporation School, Velachery")}
        <div className="grid grid-cols-2 gap-2">
          {field("latitude", "Latitude", "number")}
          {field("longitude", "Longitude", "number")}
        </div>
        {field("capacity", "Capacity (optional)", "number", false)}
        {field("source", "Source, e.g. GCC relief centre list, Nov 2026")}
        {error && <ErrorBox message={error} />}
        <button className="btn">Add shelter</button>
      </form>
      <div className="space-y-2">
        {shelters.length === 0 && <Empty text="No shelters yet. Evacuation routing needs at least one." />}
        {shelters.map((s) => (
          <div key={s.id} className="card">
            <p className="font-semibold text-navy-900">{s.name}</p>
            <p className="text-xs text-slate-500">{s.capacity ? `Capacity ${s.capacity} · ` : ""}{s.source} · {formatTime(s.created_at)}</p>
            <button className="text-sm text-red-600 underline" onClick={() => remove(s.id)}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Briefing for emergency authorities ----------------
export function BriefingTab({ onError }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const load = () => {
    setData(null);
    api("/api/admin/briefing").then(setData).catch((e) => onError(e, setError));
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function downloadCsv() {
    try {
      await downloadWithToken("/api/admin/briefing.csv", "floodwatch-briefing.csv");
    } catch (err) {
      onError(err, setError);
    }
  }

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!data) return <Loading lines={5} />;

  const Section = ({ title, count, children }) => (
    <section className="card">
      <h3 className="mb-3 font-display font-bold text-navy-900">{title} <span className="text-slate-400">({count})</span></h3>
      {count === 0 ? <p className="text-sm text-slate-400">None.</p> : children}
    </section>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">Situation summary for emergency authorities · {formatTime(data.generated_at)}</p>
        <div className="flex gap-2 print:hidden">
          <button className="btn-ghost" onClick={load}><RefreshCw className="h-4 w-4" /> Refresh</button>
          <button className="btn-ghost" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</button>
          <button className="btn" onClick={downloadCsv}><Download className="h-4 w-4" /> Download CSV</button>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Dangerous streets (verified)" count={data.dangerous_streets.length}>
          {data.dangerous_streets.map((s) => (
            <p key={s.street_name + s.latitude} className="flex flex-wrap items-center gap-2 border-b border-slate-100 py-2 text-sm last:border-0">
              <ConditionBadge condition={roadCondition(s)} /> <strong>{s.street_name}</strong> · {s.area} · {s.max_depth_cm} cm
            </p>
          ))}
        </Section>
        <Section title="Likely flooded (3+ people, not verified yet)" count={data.likely_flooded_streets.length}>
          {data.likely_flooded_streets.map((s) => (
            <p key={s.street_name + s.latitude} className="border-b border-slate-100 py-2 text-sm last:border-0">
              <strong>{s.street_name}</strong> · {s.area} · {s.independent_reporters} people
            </p>
          ))}
        </Section>
        <Section title="High-risk areas (experimental model)" count={data.high_risk_areas.length}>
          {data.high_risk_areas.map((a) => (
            <p key={a.area_id} className="flex items-center gap-2 border-b border-slate-100 py-2 text-sm last:border-0">
              <RiskBadge level={a.risk_level} /> {a.name}
            </p>
          ))}
        </Section>
        <Section title="Road closures" count={data.road_closures.length}>
          {data.road_closures.map((c) => (
            <p key={c.id} className="border-b border-slate-100 py-2 text-sm last:border-0"><strong>{c.road_name}</strong> · {c.source}</p>
          ))}
        </Section>
        <Section title="Relief shelters" count={data.shelters.length}>
          {data.shelters.map((s) => (
            <p key={s.id} className="border-b border-slate-100 py-2 text-sm last:border-0"><strong>{s.name}</strong>{s.capacity ? ` · capacity ${s.capacity}` : ""}</p>
          ))}
        </Section>
        <Section title="Active alerts" count={data.active_alerts.length}>
          {data.active_alerts.map((a) => (
            <p key={a.id} className="border-b border-slate-100 py-2 text-sm last:border-0"><strong>{a.title}</strong> · {a.area_name || "All of Chennai"}</p>
          ))}
        </Section>
      </div>
      <p className="text-xs text-slate-400">{data.disclaimer}</p>
    </div>
  );
}

// ---------------- Data: known waterlogging spots + terrain grid ----------------
export function DataTab({ onError }) {
  const [points, setPoints] = useState([]);
  const [file, setFile] = useState(null);
  const [source, setSource] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [terrainStatus, setTerrainStatus] = useState(null);

  const load = () => {
    api("/api/waterlogging").then(setPoints).catch((e) => onError(e, setError));
    api("/api/admin/terrain/status").then(setTerrainStatus).catch(() => {});
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function upload(e) {
    e.preventDefault();
    setError("");
    setMessage("");
    const data = new FormData();
    data.append("file", file);
    data.append("source", source);
    try {
      const result = await api("/api/admin/waterlogging/import", { method: "POST", body: data });
      setMessage(`Imported ${result.added} spot(s).` +
        (result.skipped_lines.length ? ` Skipped lines ${result.skipped_lines.join(", ")} (missing or invalid coordinates, or outside Chennai).` : ""));
      load();
    } catch (err) {
      onError(err, setError);
    }
  }

  async function removePoint(id) {
    try {
      await api(`/api/admin/waterlogging/${id}`, { method: "DELETE" });
      load();
    } catch (err) {
      onError(err, setError);
    }
  }

  async function rebuild() {
    try {
      const result = await api("/api/admin/terrain/rebuild", { method: "POST" });
      setMessage(result.message);
      setTimeout(load, 2000);
    } catch (err) {
      onError(err, setError);
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-4">
        <form onSubmit={upload} className="card space-y-3">
          <h2 className="flex items-center gap-2 font-display font-bold text-navy-900"><FileUp className="h-4 w-4" /> Import known waterlogging spots</h2>
          <p className="text-xs text-slate-500">
            CSV file with the columns <code>name,latitude,longitude</code>, typed in from an official list (e.g. Greater Chennai
            Corporation vulnerable locations). These raise street-level predictions nearby and appear on the map as historical
            data. Rows without valid coordinates are skipped, never guessed.
          </p>
          <input type="file" accept=".csv,text/csv" required onChange={(e) => setFile(e.target.files[0])} aria-label="CSV file" />
          <input className="input" placeholder="Source, e.g. GCC vulnerable locations list 2025" required minLength={2}
                 value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source" />
          <button className="btn" disabled={!file}>Import</button>
        </form>

        <div className="card space-y-2">
          <h2 className="font-display font-bold text-navy-900">Terrain grid</h2>
          <p className="text-xs text-slate-500">
            Rebuilds the street-level terrain susceptibility from OpenStreetMap rivers/lakes and ground heights. Takes a few minutes.
          </p>
          {terrainStatus && <p className="text-sm text-slate-600">Status: <strong>{terrainStatus.running ? "building..." : terrainStatus.message}</strong></p>}
          <button className="btn-ghost" onClick={rebuild} disabled={terrainStatus?.running}><RefreshCw className="h-4 w-4" /> Rebuild terrain grid</button>
        </div>
        {message && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
        {error && <ErrorBox message={error} />}
      </div>

      <div className="space-y-2">
        <h2 className="font-display font-bold text-navy-900">Known waterlogging spots ({points.length})</h2>
        {points.length === 0 && <Empty text="None imported yet." />}
        {points.map((p) => (
          <div key={p.id} className="card p-4">
            <p className="font-semibold text-navy-900">{p.name}</p>
            <p className="text-xs text-slate-500">{p.latitude.toFixed(5)}, {p.longitude.toFixed(5)} · {p.source}</p>
            <button className="text-sm text-red-600 underline" onClick={() => removePoint(p.id)}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}
