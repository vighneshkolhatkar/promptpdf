import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "var(--color-paper)",
        "paper-raised": "var(--color-paper-raised)",
        ink: "var(--color-ink)",
        graphite: "var(--color-graphite)",
        pen: "var(--color-pen)",
        "pen-soft": "var(--color-pen-soft)",
        redact: "var(--color-redact)",
        rule: "var(--color-rule)",
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        page: "0 1px 1px rgba(23,22,20,0.03), 0 12px 32px -8px rgba(23,22,20,0.14)",
        stamp: "0 2px 8px rgba(193,67,46,0.25)",
      },
      keyframes: {
        "stamp-down": {
          "0%": { transform: "scale(1.6) rotate(-8deg)", opacity: "0" },
          "55%": { transform: "scale(0.94) rotate(-2deg)", opacity: "1" },
          "75%": { transform: "scale(1.04) rotate(-2deg)" },
          "100%": { transform: "scale(1) rotate(-2deg)", opacity: "1" },
        },
      },
      animation: {
        "stamp-down": "stamp-down 420ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
      },
    },
  },
  darkMode: "media",
  plugins: [],
};

export default config;
