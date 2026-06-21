/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b1020",
        panel: "#0f1629",
        edge: "#1e293b",
      },
    },
  },
  plugins: [],
};
