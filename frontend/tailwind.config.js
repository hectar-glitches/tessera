/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Legacy tokens kept so the Ask Ddoski (Chat) tab stays pixel-identical.
        ink: "#0b1020",
        panel: "#0f1629",
        edge: "#1e293b",
        // Tessera premium palette (zinc-led neutral dark).
        canvas: "#0a0a0a",
        surface: "#111111",
        "surface-hover": "#1a1a1a",
        line: "rgba(255,255,255,0.06)",
        "line-strong": "rgba(255,255,255,0.12)",
        brand: "#8b5cf6",
        "brand-soft": "rgba(139,92,246,0.12)",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      letterSpacing: {
        tightish: "-0.02em",
        widelabel: "0.08em",
      },
      boxShadow: {
        card: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 1px 2px 0 rgba(0,0,0,0.4), 0 8px 24px -12px rgba(0,0,0,0.6)",
        "card-hover": "0 1px 0 0 rgba(255,255,255,0.06) inset, 0 2px 4px 0 rgba(0,0,0,0.5), 0 12px 32px -10px rgba(0,0,0,0.7)",
      },
      keyframes: {
        expand: {
          from: { opacity: "0", transform: "translateY(-4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        expand: "expand 180ms ease-out",
      },
    },
  },
  plugins: [],
};
