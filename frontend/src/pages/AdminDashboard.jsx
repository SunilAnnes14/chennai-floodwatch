import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BellRing, CheckCircle2, Construction, Inbox, LogOut } from "lucide-react";
import { api, formatTime } from "../api";
import { ErrorBox, Empty, Loading, StatusBadge, PageHeader, StatCard } from "../components/Common";
import { SheltersTab, BriefingTab, DataTab } from "../components/AdminTabs";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("reports");

  // Not logged in? Go to the login page.
  useEffect(() => {
    if (!localStorage.getItem("token")) navigate("/admin");
  }, [navigate]);

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("adminEmail");
    navigate("/admin");
  }

  // If the server says our login expired, log out automatically
  function handleError(err, setError) {
    if (err.status === 401) return logout();
    setError(err.message);
  }

  // Numbers for the summary tiles (reloaded whenever you switch tabs)
  const [stats, setStats] = useState(null);
  useEffect(() => {
    if (!localStorage.getItem("token")) return;
    Promise.all([api("/api/admin/reports"), api("/api/alerts"), api("/api/road-closures")])
      .then(([reports, alerts, closures]) => setStats({
        pending: reports.filter((r) => r.status === "PENDING").length,
        verified: reports.filter((r) => r.status === "VERIFIED").length,
        alerts: alerts.length,
        closures: closures.length,
      }))
      .catch((err) => { if (err.status === 401) logout(); });
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <PageHeader eyebrow="Admin" title="Admin Dashboard" subtitle={`Signed in as ${localStorage.getItem("adminEmail") || ""}`}
                  actions={<button className="btn-ghost" onClick={logout}><LogOut className="h-4 w-4" /> Log out</button>} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon={Inbox} label="Waiting for review" value={stats?.pending ?? "–"} tone="amber" />
        <StatCard icon={CheckCircle2} label="Verified reports" value={stats?.verified ?? "–"} tone="red" />
        <StatCard icon={BellRing} label="Active alerts" value={stats?.alerts ?? "–"} tone="blue" />
        <StatCard icon={Construction} label="Road closures" value={stats?.closures ?? "–"} tone="slate" />
      </div>

      <div className="mb-5 inline-flex max-w-full overflow-x-auto rounded-xl bg-slate-200/60 p-1" role="tablist">
        {[["reports", "Citizen reports"], ["alerts", "Alerts"], ["closures", "Road closures"], ["shelters", "Shelters"],
          ["briefing", "Briefing"], ["data", "Data"]].map(([key, text]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${tab === key ? "bg-white text-navy-900 shadow-sm" : "text-slate-500 hover:text-navy-900"}`}>
            {text}
          </button>
        ))}
      </div>
      {tab === "reports" && <ReportsTab onError={handleError} />}
      {tab === "alerts" && <AlertsTab onError={handleError} />}
      {tab === "closures" && <ClosuresTab onError={handleError} />}
      {tab === "shelters" && <SheltersTab onError={handleError} />}
      {tab === "briefing" && <BriefingTab onError={handleError} />}
      {tab === "data" && <DataTab onError={handleError} />}
    </div>
  );
}

// ---------------- Reports ----------------
function ReportsTab({ onError }) {
  const [filter, setFilter] = useState("PENDING");
  const [reports, setReports] = useState(null);
  const [error, setError] = useState("");

  function load() {
    setReports(null);
    api(`/api/admin/reports${filter ? `?status=${filter}` : ""}`).then(setReports).catch((e) => onError(e, setError));
  }
  useEffect(load, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function setStatus(id, status) {
    try {
      await api(`/api/admin/reports/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      load();
    } catch (e) {
      onError(e, setError);
    }
  }

  // Retry the OpenStreetMap street lookup for a report
  async function findStreet(id) {
    try {
      await api(`/api/admin/reports/${id}/find-street`, { method: "POST" });
      load();
    } catch (e) {
      onError(e, setError);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {[["PENDING", "Pending"], ["VERIFIED", "Verified"], ["REJECTED", "Rejected"], ["RESOLVED", "Resolved"], ["", "All"]].map(([value, text]) => (
          <button key={text} onClick={() => setFilter(value)} aria-pressed={filter === value}
                  className={`chip ${filter === value ? "chip-active" : ""}`}>{text}</button>
        ))}
      </div>
      {error && <ErrorBox message={error} />}
      {!reports && !error && <Loading />}
      {reports?.length === 0 && <Empty text="No reports with this status." />}
      <div className="space-y-3">
        {reports?.map((r) => (
          <div key={r.id} className="card">
            <div className="flex flex-wrap justify-between gap-2">
              <p className="font-bold">#{r.id} {r.location_text}</p>
              <div className="flex flex-wrap gap-1.5">
                {r.independent_reporters >= 2 && (
                  <span className="rounded-full bg-purple-50 px-2.5 py-1 text-[11px] font-bold text-purple-700 ring-1 ring-inset ring-purple-600/20">
                    {r.independent_reporters} people reported nearby
                  </span>
                )}
                {r.expired && (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800 ring-1 ring-inset ring-amber-600/20">
                    Expired: re-check
                  </span>
                )}
                <StatusBadge status={r.status} />
              </div>
            </div>
            <p className="text-sm text-navy">
              🛣️ {r.street_name ? `${r.street_name}${r.locality ? `, ${r.locality}` : ""}` : "Street not identified"}
              {!r.street_name && (
                <button className="text-blue-600 underline ml-2" onClick={() => findStreet(r.id)}>Find street</button>
              )}
            </p>
            <p className="text-sm">{r.water_depth_cm} cm · {r.severity} · {r.description || "no description"}</p>
            <p className="text-xs text-slate-500">
              {formatTime(r.created_at)} ·{" "}
              <a className="text-blue-600 underline" target="_blank" rel="noreferrer"
                 href={`https://www.openstreetmap.org/?mlat=${r.latitude}&mlon=${r.longitude}#map=17/${r.latitude}/${r.longitude}`}>
                {r.latitude.toFixed(5)}, {r.longitude.toFixed(5)} (view on map)
              </a>
            </p>
            {r.has_photo && <AdminPhoto id={r.id} />}
            <div className="flex flex-wrap gap-2 mt-3">
              {r.status === "PENDING" && <button className="btn" onClick={() => setStatus(r.id, "VERIFIED")}>Verify</button>}
              {r.status !== "REJECTED" && <button className="btn-light" onClick={() => setStatus(r.id, "REJECTED")}>Reject</button>}
              {r.status === "VERIFIED" && (
                <button className={r.expired ? "btn" : "btn-light"} onClick={() => setStatus(r.id, "VERIFIED")}
                        title="Confirms the flooding again for the next 6 hours">Still flooded (re-confirm)</button>
              )}
              {r.status === "VERIFIED" && <button className="btn-light" onClick={() => setStatus(r.id, "RESOLVED")}>Mark resolved</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Images need the login token, so we download them with fetch and show them as a blob
function AdminPhoto({ id }) {
  const [url, setUrl] = useState(null);
  async function show() {
    const response = await fetch(`/api/admin/reports/${id}/photo`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    });
    if (response.ok) setUrl(URL.createObjectURL(await response.blob()));
  }
  return url ? <img src={url} alt="Reported flooding" className="max-h-60 mt-2 rounded" />
             : <button className="text-blue-600 underline text-sm mt-1" onClick={show}>Show photo</button>;
}

// ---------------- Alerts ----------------
function AlertsTab({ onError }) {
  const empty = { title: "", message: "", alert_type: "OFFICIAL", source: "", area_id: "", expires_hours: "" };
  const [form, setForm] = useState(empty);
  const [alerts, setAlerts] = useState([]);
  const [areas, setAreas] = useState([]);
  const [error, setError] = useState("");

  const load = () => api("/api/alerts").then(setAlerts).catch((e) => onError(e, setError));
  useEffect(() => {
    load();
    api("/api/areas").then(setAreas).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function create(e) {
    e.preventDefault();
    setError("");
    const body = { ...form, area_id: form.area_id ? Number(form.area_id) : null,
                   expires_hours: form.expires_hours ? Number(form.expires_hours) : null };
    try {
      await api("/api/admin/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setForm(empty);
      load();
    } catch (err) {
      onError(err, setError);
    }
  }

  async function remove(id) {
    try {
      await api(`/api/admin/alerts/${id}`, { method: "DELETE" });
      load();
    } catch (err) {
      onError(err, setError);
    }
  }

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <form onSubmit={create} className="card space-y-3">
        <h2 className="font-bold text-navy">New alert / announcement</h2>
        <input className="input" placeholder="Title" required minLength={3} value={form.title}
               onChange={(e) => setForm({ ...form, title: e.target.value })} aria-label="Title" />
        <textarea className="input" rows="4" placeholder="Message" required minLength={3} value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })} aria-label="Message" />
        <select className="input" value={form.alert_type} onChange={(e) => setForm({ ...form, alert_type: e.target.value })} aria-label="Type">
          <option value="OFFICIAL">Official warning (copied from a government source)</option>
          <option value="VERIFIED_REPORT">Based on verified citizen reports</option>
          <option value="PREDICTION">Model prediction (not official)</option>
        </select>
        <input className="input" placeholder="Source, e.g. IMD Chennai bulletin 13 Nov" required minLength={2}
               value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} aria-label="Source" />
        <div className="grid grid-cols-2 gap-2">
          <select className="input" value={form.area_id} onChange={(e) => setForm({ ...form, area_id: e.target.value })} aria-label="Area">
            <option value="">All of Chennai</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className="input" value={form.expires_hours} onChange={(e) => setForm({ ...form, expires_hours: e.target.value })} aria-label="Expires">
            <option value="">No expiry</option>
            <option value="6">Expires in 6 h</option>
            <option value="24">Expires in 24 h</option>
            <option value="72">Expires in 3 days</option>
          </select>
        </div>
        {error && <ErrorBox message={error} />}
        <button className="btn">Publish</button>
      </form>
      <div className="space-y-2">
        {alerts.length === 0 && <Empty text="No active alerts." />}
        {alerts.map((a) => (
          <div key={a.id} className="card">
            <p className="font-semibold">{a.title}</p>
            <p className="text-xs text-slate-500">{a.alert_type} · {a.source} · {formatTime(a.created_at)}</p>
            <button className="text-red-600 underline text-sm" onClick={() => remove(a.id)}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Road closures ----------------
function ClosuresTab({ onError }) {
  const empty = { road_name: "", latitude: "", longitude: "", reason: "", source: "" };
  const [form, setForm] = useState(empty);
  const [closures, setClosures] = useState([]);
  const [error, setError] = useState("");

  const load = () => api("/api/road-closures").then(setClosures).catch((e) => onError(e, setError));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function create(e) {
    e.preventDefault();
    setError("");
    try {
      await api("/api/admin/road-closures", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, latitude: Number(form.latitude), longitude: Number(form.longitude) }),
      });
      setForm(empty);
      load();
    } catch (err) {
      onError(err, setError);
    }
  }

  async function remove(id) {
    try {
      await api(`/api/admin/road-closures/${id}`, { method: "DELETE" });
      load();
    } catch (err) {
      onError(err, setError);
    }
  }

  const field = (key, placeholder, type = "text") => (
    <input className="input" type={type} step="any" placeholder={placeholder} aria-label={placeholder}
           required={key !== "reason"} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
  );

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <form onSubmit={create} className="card space-y-3">
        <h2 className="font-bold text-navy">Add road closure</h2>
        {field("road_name", "Road name")}
        <div className="grid grid-cols-2 gap-2">
          {field("latitude", "Latitude, e.g. 12.9815", "number")}
          {field("longitude", "Longitude, e.g. 80.2180", "number")}
        </div>
        {field("reason", "Reason (optional)")}
        {field("source", "Source, e.g. Chennai Traffic Police")}
        {error && <ErrorBox message={error} />}
        <button className="btn">Add closure</button>
      </form>
      <div className="space-y-2">
        {closures.length === 0 && <Empty text="No active road closures." />}
        {closures.map((c) => (
          <div key={c.id} className="card">
            <p className="font-semibold">{c.road_name}</p>
            <p className="text-xs text-slate-500">{c.source} · {formatTime(c.created_at)}</p>
            <button className="text-red-600 underline text-sm" onClick={() => remove(c.id)}>Remove (road reopened)</button>
          </div>
        ))}
      </div>
    </div>
  );
}
