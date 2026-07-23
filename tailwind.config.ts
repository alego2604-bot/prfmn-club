import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        canvas: "var(--bg-canvas)",
        surface: "var(--bg-surface)",
        "surface-raised": "var(--bg-surface-raised)",
        border: {
          subtle: "var(--border-subtle)",
          DEFAULT: "var(--border-default)",
        },
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          tertiary: "var(--text-tertiary)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          contrast: "var(--accent-contrast)",
        },
        danger: "var(--danger)",
        warning: "var(--warning)",
        success: "var(--success)",
        info: "var(--info)",
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      borderRadius: {
        xl: "14px",
        "2xl": "20px",
      },
    },
  },
  plugins: [],
} satisfies Config;
