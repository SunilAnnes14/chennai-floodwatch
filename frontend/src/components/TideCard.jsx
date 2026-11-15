// Sea level near the Adyar river mouth: when the sea is high, rivers and drains empty more slowly.
import { ArrowDown, ArrowUp, Waves } from "lucide-react";
import { useApi, formatLocal } from "../api";
import { ErrorBox, Loading } from "./Common";

export default function TideCard() {
  const { data, error, loading } = useApi("/api/tide");
  const nowHour = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" }).slice(0, 13).replace(" ", "T");
  const upcoming = (data?.turns || []).filter((t) => t.time >= nowHour).slice(0, 4);
  const current = data?.hours.find((h) => h.time.slice(0, 13) === nowHour);

  return (
    <section className="card mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-navy-900">
            <Waves className="h-5 w-5 text-blue-600" /> Sea level &amp; tides
          </h2>
          <p className="text-xs text-slate-500">
            {data?.location || "Sea near the Adyar river mouth"}. High sea level slows the drainage of rivers and canals.
          </p>
        </div>
        {current && (
          <p className="text-right">
            <span className="font-display text-2xl font-bold text-navy-900">{current.sea_level_m.toFixed(2)} m</span>
            <span className="block text-xs text-slate-500">now, relative to mean sea level</span>
          </p>
        )}
      </div>
      {loading && <Loading lines={2} />}
      {error && <ErrorBox message={error} />}
      {data && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {upcoming.map((t) => (
              <div key={t.time} className="rounded-xl bg-slate-50 p-3">
                <p className={`flex items-center gap-1 text-xs font-bold uppercase tracking-wider ${t.type === "HIGH" ? "text-blue-700" : "text-slate-500"}`}>
                  {t.type === "HIGH" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
                  {t.type === "HIGH" ? "High tide" : "Low tide"}
                </p>
                <p className="mt-1 font-semibold text-navy-900">{formatLocal(t.time)}</p>
                <p className="text-xs text-slate-500">{t.sea_level_m.toFixed(2)} m</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-400">{data.source}</p>
        </>
      )}
    </section>
  );
}
