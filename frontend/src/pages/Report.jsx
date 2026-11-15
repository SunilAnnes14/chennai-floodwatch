import { useState } from "react";
import { Link } from "react-router-dom";
import { CircleMarker, useMapEvents } from "react-leaflet";
import { CheckCircle2, Crosshair, ImagePlus, MapPin, Send, X } from "lucide-react";
import { api, SEVERITY_COLORS } from "../api";
import { ErrorBox, PageHeader } from "../components/Common";
import BaseMap from "../components/BaseMap";

// Lets the user click on the map to choose the flood location
function ClickToPick({ onPick }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

const MAX_MB = 4; // the online server (Vercel) accepts uploads up to 4.5 MB
const EMPTY_FORM = { location_text: "", water_depth_cm: "", severity: "", description: "" };
const SEVERITIES = [
  ["LOW", "Low", "Passable with care"],
  ["MODERATE", "Moderate", "Hard for two-wheelers"],
  ["HIGH", "High", "Cars cannot pass"],
  ["SEVERE", "Severe", "Water entering homes"],
];
const DEPTH_PRESETS = [["Ankle", 10], ["Knee", 50], ["Waist", 100]];

export default function Report() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [point, setPoint] = useState(null); // { lat, lon, method }
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState(null);
  const [gpsMessage, setGpsMessage] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [sending, setSending] = useState(false);

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  function useGps() {
    if (!navigator.geolocation) return setGpsMessage("Your browser does not support GPS.");
    setGpsMessage("Getting your location...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPoint({ lat: pos.coords.latitude, lon: pos.coords.longitude, method: "gps" });
        setGpsMessage(`Location found (accuracy about ${Math.round(pos.coords.accuracy)} m).`);
      },
      () => setGpsMessage("Location permission denied. Please click on the map instead."),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  function choosePhoto(e) {
    const file = e.target.files[0];
    setError("");
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      e.target.value = "";
      return setError("Photo must be a JPG, PNG or WEBP image.");
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      e.target.value = "";
      return setError(`Photo must be smaller than ${MAX_MB} MB.`);
    }
    setPhoto(file);
    setPreview(window.URL.createObjectURL ? URL.createObjectURL(file) : null);
  }

  function removePhoto() {
    setPhoto(null);
    setPreview(null);
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!point) return setError("Please choose the location: use GPS or click on the map.");
    if (!form.severity) return setError("Please choose how severe the flooding is.");

    const data = new FormData(); // FormData is needed to send a file
    Object.entries(form).forEach(([key, value]) => data.append(key, value));
    data.append("latitude", point.lat);
    data.append("longitude", point.lon);
    if (photo) data.append("photo", photo);

    setSending(true);
    try {
      setResult(await api("/api/reports", { method: "POST", body: data }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  function startAgain() {
    setResult(null);
    setPoint(null);
    removePhoto();
    setForm(EMPTY_FORM);
  }

  if (result) {
    return (
      <div className="card mx-auto max-w-lg py-10 text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <CheckCircle2 className="h-9 w-9" />
        </span>
        <h1 className="mt-4 font-display text-2xl font-bold text-navy-900">Report received</h1>
        <p className="mt-2 text-slate-600">Report number <strong>#{result.id}</strong> · Status <strong>{result.status}</strong></p>
        {result.street_name && (
          <p className="mt-1 text-slate-600">Street: <strong>{result.street_name}</strong>{result.locality && <>, {result.locality}</>}</p>
        )}
        <p className="mx-auto mt-3 max-w-sm text-sm text-slate-500">{result.message}</p>
        <div className="mt-6 flex justify-center gap-3">
          <button className="btn" onClick={startAgain}>Send another report</button>
          <Link to="/streets" className="btn-ghost">See affected streets</Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader eyebrow="Detect" title="Report Flooding"
                  subtitle="No account needed. Every report is checked by an admin before it is marked as verified." />

      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        {/* ---------- left: where? ---------- */}
        <div className="card overflow-hidden p-0 lg:sticky lg:top-24 lg:self-start">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
            <div>
              <p className="flex items-center gap-2 font-semibold text-navy-900"><MapPin className="h-4 w-4 text-blue-600" /> Exact position *</p>
              <p className="text-xs text-slate-500">Use GPS, or click on the map to choose the spot</p>
            </div>
            <button type="button" className="btn-ghost py-2" onClick={useGps}><Crosshair className="h-4 w-4" /> Use my GPS location</button>
          </div>
          <div className="h-72 cursor-crosshair lg:h-[440px]">
            <BaseMap>
              <ClickToPick onPick={(lat, lon) => setPoint({ lat, lon, method: "manual" })} />
              {point && <CircleMarker center={[point.lat, point.lon]} radius={10} pathOptions={{ color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1 }} />}
            </BaseMap>
          </div>
          <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
            {gpsMessage && <p className="mb-1">{gpsMessage}</p>}
            {point ? <p>Selected: <strong className="text-slate-700">{point.lat.toFixed(5)}, {point.lon.toFixed(5)}</strong> ({point.method})</p>
                   : <p>No position chosen yet.</p>}
          </div>
        </div>

        {/* ---------- right: what? ---------- */}
        <div className="card space-y-6">
          <div>
            <label className="label" htmlFor="loc">Location name / landmark *</label>
            <input id="loc" className="input" required minLength={3} value={form.location_text}
                   onChange={update("location_text")} placeholder="e.g. Velachery Main Road near Vijaya Nagar bus stop" />
          </div>

          <fieldset>
            <legend className="label">Severity *</legend>
            <div className="grid grid-cols-2 gap-2">
              {SEVERITIES.map(([value, name, hint]) => {
                const active = form.severity === value;
                return (
                  <label key={value} className={`cursor-pointer rounded-xl border p-3 transition ${active ? "border-transparent ring-2" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"}`}
                         style={active ? { "--tw-ring-color": SEVERITY_COLORS[value], background: `${SEVERITY_COLORS[value]}12` } : {}}>
                    <input type="radio" name="severity" value={value} checked={active} onChange={update("severity")} className="sr-only" />
                    <span className="flex items-center gap-2 text-sm font-semibold text-navy-900">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: SEVERITY_COLORS[value] }} />{name}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div>
            <label className="label" htmlFor="depth">Water depth (cm) *</label>
            <div className="flex items-center gap-3">
              <input id="depth" type="number" min="0" max="300" required className="input w-28"
                     value={form.water_depth_cm} onChange={update("water_depth_cm")} />
              <input type="range" min="0" max="150" value={form.water_depth_cm || 0} onChange={update("water_depth_cm")}
                     aria-label="Depth slider" className="flex-1 accent-blue-600" />
            </div>
            <div className="mt-2 flex gap-2">
              {DEPTH_PRESETS.map(([name, cm]) => (
                <button key={name} type="button" className={`chip ${Number(form.water_depth_cm) === cm ? "chip-active" : ""}`}
                        onClick={() => setForm({ ...form, water_depth_cm: String(cm) })}>{name} ≈ {cm} cm</button>
              ))}
            </div>
          </div>

          <div>
            <label className="label" htmlFor="desc">Description</label>
            <textarea id="desc" rows="3" maxLength={1000} className="input" value={form.description}
                      onChange={update("description")} placeholder="What do you see? Is traffic moving?" />
          </div>

          <div>
            <span className="label">Photo (optional, JPG/PNG/WEBP, max {MAX_MB} MB)</span>
            {photo ? (
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-2">
                {preview ? <img src={preview} alt="Selected" className="h-16 w-16 rounded-lg object-cover" />
                         : <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-slate-100"><ImagePlus className="h-5 w-5 text-slate-400" /></span>}
                <p className="flex-1 truncate text-sm text-slate-600">{photo.name}</p>
                <button type="button" onClick={removePhoto} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Remove photo">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <label htmlFor="photo" className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 px-4 py-6 text-center transition hover:border-blue-400 hover:bg-blue-50/40">
                <ImagePlus className="h-6 w-6 text-slate-400" />
                <span className="mt-1 text-sm font-semibold text-slate-600">Click to add a photo</span>
                <span className="text-xs text-slate-400">Hidden GPS/camera data is removed automatically</span>
              </label>
            )}
            <input id="photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} className="sr-only" aria-label="Photo" />
          </div>

          {error && <ErrorBox message={error} />}
          <button className="btn w-full py-3" disabled={sending}><Send className="h-4 w-4" />{sending ? "Sending..." : "Submit report"}</button>
          <p className="text-center text-xs text-slate-400">The time of the report is recorded automatically.</p>
        </div>
      </form>
    </div>
  );
}
