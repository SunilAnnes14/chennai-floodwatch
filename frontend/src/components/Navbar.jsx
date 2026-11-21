import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Menu, X, Waves, Camera, ShieldCheck } from "lucide-react";

const LINKS = [
  ["/", "Home"],
  ["/map", "Flood Map"],
  ["/streets", "Affected Streets"],
  ["/weather", "Weather"],
  ["/forecast", "Forecast Map"],
  ["/predictions", "Predictions"],
  ["/routes", "Safe Routes"],
  ["/alerts", "Alerts"],
];

export default function Navbar() {
  const [open, setOpen] = useState(false); // mobile menu open?
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]); // close the menu after navigating

  const linkStyle = ({ isActive }) =>
    `relative rounded-lg px-3 py-2 text-sm font-medium transition ${
      isActive ? "text-navy-900 bg-navy-100/70" : "text-slate-500 hover:text-navy-900 hover:bg-slate-100"}`;

  return (
    <nav className="sticky top-0 z-[1100] border-b border-slate-200/70 bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <NavLink to="/" className="flex items-center gap-2.5" aria-label="CR7 Flows home">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-navy-900 to-blue-600 text-white shadow-md shadow-blue-900/20">
            <Waves className="h-5 w-5" />
          </span>
          <span className="leading-tight">
            <span className="block font-display text-[15px] font-extrabold text-navy-900">CR7 Flows</span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Chennai</span>
          </span>
        </NavLink>

        <div className="hidden items-center gap-1 xl:flex">
          {LINKS.map(([to, text]) => <NavLink key={to} to={to} end className={linkStyle}>{text}</NavLink>)}
        </div>

        <div className="flex items-center gap-2">
          <NavLink to="/admin" className="hidden rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-navy-900 sm:inline-flex" title="Admin" aria-label="Admin">
            <ShieldCheck className="h-5 w-5" />
          </NavLink>
          <NavLink to="/report" className="btn hidden sm:inline-flex"><Camera className="h-4 w-4" /> Report flooding</NavLink>
          <button className="rounded-lg p-2 text-navy-900 hover:bg-slate-100 xl:hidden" onClick={() => setOpen(!open)}
                  aria-label="Toggle menu" aria-expanded={open}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="animate-fade-up border-t border-slate-200/70 bg-white px-4 pb-4 pt-2 xl:hidden">
          {[...LINKS, ["/report", "Report flooding"], ["/admin", "Admin"]].map(([to, text]) => (
            <NavLink key={to} to={to} end className={({ isActive }) =>
              `block rounded-lg px-3 py-2.5 text-sm font-medium ${isActive ? "bg-navy-100/70 text-navy-900" : "text-slate-600"}`}>
              {text}
            </NavLink>
          ))}
        </div>
      )}
    </nav>
  );
}
