import { Routes, Route, Link, useLocation } from "react-router-dom";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import AlertWatcher from "./components/AlertWatcher";
import Home from "./pages/Home";
import FloodMap from "./pages/FloodMap";
import AffectedStreets from "./pages/AffectedStreets";
import Weather from "./pages/Weather";
import ForecastMap from "./pages/ForecastMap";
import Report from "./pages/Report";
import Predictions from "./pages/Predictions";
import SafeRoutes from "./pages/SafeRoutes";
import Alerts from "./pages/Alerts";
import About from "./pages/About";
import AdminLogin from "./pages/AdminLogin";
import AdminDashboard from "./pages/AdminDashboard";

export default function App() {
  const location = useLocation();
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <AlertWatcher />
      {/* key = page address, so each page fades in when you open it */}
      <main key={location.pathname} className="page mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/map" element={<FloodMap />} />
          <Route path="/streets" element={<AffectedStreets />} />
          <Route path="/weather" element={<Weather />} />
          <Route path="/forecast" element={<ForecastMap />} />
          <Route path="/report" element={<Report />} />
          <Route path="/predictions" element={<Predictions />} />
          <Route path="/routes" element={<SafeRoutes />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/about" element={<About />} />
          <Route path="/admin" element={<AdminLogin />} />
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
          <Route path="*" element={<p>Page not found. <Link className="text-blue-600 underline" to="/">Go home</Link></p>} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
