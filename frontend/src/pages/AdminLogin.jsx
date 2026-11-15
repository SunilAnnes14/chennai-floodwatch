import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LockKeyhole } from "lucide-react";
import { api } from "../api";
import { ErrorBox } from "../components/Common";

export default function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function login(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = await api("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      localStorage.setItem("token", data.token); // remember the login
      localStorage.setItem("adminEmail", data.email);
      navigate("/admin/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <form onSubmit={login} className="card w-full max-w-sm space-y-5 p-7">
        <div className="text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-navy-900 text-white shadow-md"><LockKeyhole className="h-5 w-5" /></span>
          <h1 className="mt-4 font-display text-2xl font-bold text-navy-900">Admin Login</h1>
          <p className="mt-1 text-sm text-slate-500">For FloodWatch moderators only</p>
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" type="password" required className="input" value={password}
                 onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <ErrorBox message={error} />}
        <button className="btn w-full py-3" disabled={busy}>{busy ? "Logging in..." : "Log in"}</button>
      </form>
    </div>
  );
}
