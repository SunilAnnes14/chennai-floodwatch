import { Link } from "react-router-dom";
import { Phone, Waves } from "lucide-react";

const NUMBERS = [
  ["All emergencies", "112"],
  ["TN Disaster Control Room", "1070"],
  ["Greater Chennai Corporation", "1913"],
  ["Ambulance", "108"],
  ["Fire", "101"],
];

export default function Footer() {
  return (
    <footer className="mt-16 bg-navy-950 text-slate-400">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-3">
        <div>
          <p className="flex items-center gap-2 font-display text-lg font-bold text-white"><Waves className="h-5 w-5 text-blue-400" /> CR7 Flows</p>
          <p className="mt-3 text-sm leading-relaxed">
            Predict → Detect → Alert. Rainfall, citizen flood reports and road information for Chennai.
            A student project, not an official government service.
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Explore</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link className="hover:text-white" to="/report">Report flooding</Link></li>
            <li><Link className="hover:text-white" to="/about">About &amp; data sources</Link></li>
            <li><Link className="hover:text-white" to="/admin">Admin login</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Emergency numbers</p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {NUMBERS.map(([name, number]) => (
              <li key={number} className="flex justify-between gap-4">
                <span>{name}</span>
                <a href={`tel:${number}`} className="inline-flex items-center gap-1 font-semibold text-white hover:text-blue-300">
                  <Phone className="h-3 w-3" />{number}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 py-4 text-center text-xs">
        Weather: Open-Meteo.com · Maps: © OpenStreetMap contributors · Routing: OSRM
      </div>
    </footer>
  );
}
