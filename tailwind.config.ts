import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111318",
        paper: "#faf9f6",
        accent: "#2f6f4f",
        accentSoft: "#e6f0ea",
        clay: "#c1440e",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(17,19,24,0.04), 0 8px 24px rgba(17,19,24,0.06)",
      },
    },
  },
  darkMode: "media",
  plugins: [],
};

export default config;
