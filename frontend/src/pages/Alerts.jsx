import { useState } from "react";
import { Bell, BellOff, BellRing, Bot, Construction, Landmark, MapPin, Radar, Users } from "lucide-react";
import { useApi, formatTime, getMyAreas, setMyAreas } from "../api";
import { Loading, ErrorBox, Empty, PageHeader } from "../components/Common";
import { checkForNewAlerts, notificationsOn } from "../components/AlertWatcher";

// Each alert type gets its own clear label so people know how trustworthy it is
const TYPES = {
  OFFICIAL: { label: "Official warning", icon: Landmark, color: "#dc2626", note: "Copied from a government source" },
  VERIFIED_REPORT: { label: "Verified citizen report", icon: Users, color: "#f97316", note: "Checked by an admin" },
  PREDICTION: { label: "Model prediction", icon: Radar, color: "#ca8a04", note: "Not official" },
};

export default function Alerts() {
  const alerts = useApi("/api/alerts");
  const closures = useApi("/api/road-closures");
  const areas = useApi("/api/areas");
  const [filter, setFilter] = useState("ALL");
  const [myAreas, setMine] = useState(getMyAreas());
  const [onlyMine, setOnlyMine] = useState(false);
  const [notifying, setNotifying] = useState(notificationsOn());
  const [notifyMessage, setNotifyMessage] = useState("");

  const list = (alerts.data || [])
    .filter((a) => filter === "ALL" || a.alert_type === filter)
    .filter((a) => !onlyMine || !myAreas.length || a.area_id === null || myAreas.includes(a.area_id));

  function toggleArea(id) {
    const next = myAreas.includes(id) ? myAreas.filter((x) => x !== id) : [...myAreas, id];
    setMine(next);
    setMyAreas(next);
  }

  // Browser notifications (opt-in). New alerts are checked every minute while the site is open.
  async function toggleNotifications() {
    if (notifying) {
      localStorage.setItem("notify", "off");
      setNotifying(false);
      return setNotifyMessage("Notifications are off.");
    }
    if (!("Notification" in window)) return setNotifyMessage("Your browser does not support notifications.");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return setNotifyMessage("Notifications were not allowed by the browser.");
    localStorage.setItem("notify", "on");
    await checkForNewAlerts({ silent: true }).catch(() => {}); // don't notify about alerts that already exist
    setNotifying(true);
    setNotifyMessage(`Notifications are on for ${myAreas.length ? "your areas" : "all of Chennai"}. Keep this site open in a tab.`);
  }

  return (
    <div>
      <PageHeader eyebrow="Alert" title="Alerts"
                  subtitle="Every alert says where it came from, so you know how much to trust it."
                  actions={
                    <button className={notifying ? "btn" : "btn-ghost"} onClick={toggleNotifications} aria-pressed={notifying}>
                      {notifying ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                      {notifying ? "Notifications on" : "Turn on notifications"}
                    </button>
                  } />
      {notifyMessage && <p className="-mt-3 mb-4 text-sm text-slate-500">{notifyMessage}</p>}

      {/* My areas */}
      <section className="card mb-6">
        <p className="flex items-center gap-2 text-sm font-semibold text-navy-900"><MapPin className="h-4 w-4 text-blue-600" /> My areas</p>
        <p className="text-xs text-slate-500">Choose the areas you care about. Saved only in this browser. None chosen = all of Chennai.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(areas.data || []).map((a) => (
            <button key={a.id} onClick={() => toggleArea(a.id)} aria-pressed={myAreas.includes(a.id)}
                    className={`chip ${myAreas.includes(a.id) ? "chip-active" : ""}`}>{a.name}</button>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <section>
          <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filter alerts">
            {[["ALL", "All"], ...Object.entries(TYPES).map(([k, t]) => [k, t.label])].map(([key, label]) => (
              <button key={key} onClick={() => setFilter(key)} aria-pressed={filter === key}
                      className={`chip ${filter === key ? "chip-active" : ""}`}>{label}</button>
            ))}
            <label className="ml-auto flex items-center gap-2 text-xs font-semibold text-slate-600">
              <input type="checkbox" className="accent-blue-600" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
              Only my areas
            </label>
          </div>
          {alerts.loading && <Loading />}
          {alerts.error && <ErrorBox message={alerts.error} onRetry={alerts.reload} />}
          {alerts.data && list.length === 0 && <Empty text="There are no active alerts right now." icon={BellOff} />}

          {/* timeline */}
          <ol className="relative space-y-4 border-l border-slate-200 pl-6">
            {list.map((a) => {
              const type = TYPES[a.alert_type] || TYPES.OFFICIAL;
              const Icon = type.icon;
              return (
                <li key={a.id} className="relative">
                  <span className="absolute -left-[37px] top-4 flex h-7 w-7 items-center justify-center rounded-full text-white ring-4 ring-[#f5f7fb]"
                        style={{ background: type.color }}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="card">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: type.color }}>
                        {type.label} <span className="font-medium normal-case tracking-normal text-slate-400">· {type.note}</span>
                      </p>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                        {a.area_name || "All of Chennai"}
                      </span>
                      {a.is_automatic === 1 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                          <Bot className="h-3 w-3" /> Automatic
                        </span>
                      )}
                    </div>
                    <h2 className="mt-1 font-display text-lg font-bold text-navy-900">{a.title}</h2>
                    <p className="mt-1 whitespace-pre-line text-slate-600">{a.message}</p>
                    <p className="mt-3 text-xs text-slate-400">
                      Source: {a.source} · {formatTime(a.created_at)}{a.expires_at && ` · until ${formatTime(a.expires_at)}`}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <section>
          <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold text-navy-900">
            <Construction className="h-5 w-5 text-orange-500" /> Road closures
          </h2>
          {closures.loading && <Loading />}
          {closures.error && <ErrorBox message={closures.error} />}
          {closures.data?.length === 0 && <Empty text="No confirmed road closures are recorded." icon={Construction} />}
          <div className="space-y-2.5">
            {closures.data?.map((c) => (
              <div key={c.id} className="card relative overflow-hidden p-4 pl-5">
                <span className="absolute inset-y-0 left-0 w-1.5 bg-orange-500" />
                <p className="font-semibold text-navy-900">{c.road_name}</p>
                {c.reason && <p className="text-sm text-slate-600">{c.reason}</p>}
                <p className="mt-1 text-xs text-slate-400">Source: {c.source} · {formatTime(c.created_at)}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
