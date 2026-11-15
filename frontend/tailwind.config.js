/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Plus Jakarta Sans", "Inter", "system-ui", "sans-serif"],
      },
      colors: {
        // Our navy brand colours, from very dark to light
        navy: {
          DEFAULT: "#16305a",
          950: "#0b1730",
          900: "#10213f",
          800: "#16305a",
          700: "#1e3f73",
          100: "#e6edf7",
          50: "#f3f6fb",
        },
      },
      boxShadow: {
        soft: "0 1px 2px rgba(16,33,63,0.04), 0 8px 24px -12px rgba(16,33,63,0.18)",
        lift: "0 2px 4px rgba(16,33,63,0.06), 0 16px 40px -16px rgba(16,33,63,0.30)",
      },
      keyframes: {
        fadeUp: { "0%": { opacity: 0, transform: "translateY(8px)" }, "100%": { opacity: 1, transform: "none" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        ping2: { "75%, 100%": { transform: "scale(2.2)", opacity: 0 } },
      },
      animation: {
        "fade-up": "fadeUp 0.45s ease-out both",
        shimmer: "shimmer 1.4s infinite",
        ping2: "ping2 1.6s cubic-bezier(0,0,0.2,1) infinite",
      },
    },
  },
  plugins: [],
};
