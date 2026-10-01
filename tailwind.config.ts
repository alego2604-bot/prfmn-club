import type { Config } from "tailwindcss";

/** Colores basados en variables CSS que admiten modificadores de opacidad (bg-accent/20) vía color-mix. */
const v = (name: string) => `color-mix(in srgb, var(${name}) calc(<alpha-value> * 100%), transparent)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: v("--canvas"),
        surface: { DEFAULT: v("--surface"), 2: v("--surface-2"), sunken: v("--surface-sunken"), inverse: v("--surface-inverse") },
        line: { DEFAULT: v("--border"), strong: v("--border-strong") },
        fg: { DEFAULT: v("--text"), 2: v("--text-2"), 3: v("--text-3"), inverse: v("--text-inverse") },
        ink: { DEFAULT: v("--ink"), hover: v("--ink-hover") },
        accent: { DEFAULT: v("--accent"), hover: v("--accent-hover"), soft: v("--accent-soft"), fg: v("--accent-text") },
        success: { DEFAULT: v("--success"), soft: v("--success-soft"), fg: v("--success-text") },
        warning: { DEFAULT: v("--warning"), soft: v("--warning-soft"), fg: v("--warning-text") },
        danger: { DEFAULT: v("--danger"), soft: v("--danger-soft"), fg: v("--danger-text") },
        info: { DEFAULT: v("--info"), soft: v("--info-soft"), fg: v("--info-text") },
        ring: v("--ring"),
      },
      fontFamily: {
        sans: ['"Inter Variable"', "Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        "2xs": ["11px", { lineHeight: "14px", letterSpacing: "0.01em" }],
        xs: ["12px", { lineHeight: "16px" }],
        sm: ["13px", { lineHeight: "20px" }],
        base: ["14px", { lineHeight: "22px" }],
        md: ["15px", { lineHeight: "22px" }],
        lg: ["17px", { lineHeight: "24px", letterSpacing: "-0.01em" }],
        xl: ["20px", { lineHeight: "28px", letterSpacing: "-0.015em" }],
        "2xl": ["24px", { lineHeight: "32px", letterSpacing: "-0.02em" }],
        "3xl": ["30px", { lineHeight: "36px", letterSpacing: "-0.025em" }],
        "4xl": ["38px", { lineHeight: "44px", letterSpacing: "-0.03em" }],
        "5xl": ["48px", { lineHeight: "52px", letterSpacing: "-0.035em" }],
        "6xl": ["60px", { lineHeight: "62px", letterSpacing: "-0.04em" }],
      },
      borderRadius: { sm: "6px", DEFAULT: "8px", md: "10px", lg: "12px", xl: "16px", "2xl": "20px" },
      boxShadow: { xs: "var(--shadow-xs)", sm: "var(--shadow-sm)", md: "var(--shadow-md)", lg: "var(--shadow-lg)" },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "pop-in": { from: { opacity: "0", transform: "translateY(4px) scale(0.985)" }, to: { opacity: "1", transform: "none" } },
        "slide-in": { from: { transform: "translateX(24px)", opacity: "0" }, to: { transform: "none", opacity: "1" } },
        "slide-up": { from: { transform: "translateY(12px)", opacity: "0" }, to: { transform: "none", opacity: "1" } },
        "rise": { from: { transform: "translateY(6px)", opacity: "0" }, to: { transform: "none", opacity: "1" } },
        "check-pop": { "0%": { transform: "scale(0.6)", opacity: "0" }, "60%": { transform: "scale(1.06)", opacity: "1" }, "100%": { transform: "scale(1)" } },
        shimmer: { from: { backgroundPosition: "-400px 0" }, to: { backgroundPosition: "400px 0" } },
        bump: { "0%": { transform: "scale(1)" }, "40%": { transform: "scale(0.96)" }, "100%": { transform: "scale(1)" } },
      },
      animation: {
        "fade-in": "fade-in 140ms ease-out",
        "pop-in": "pop-in 160ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        "slide-in": "slide-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        "slide-up": "slide-up 200ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        shimmer: "shimmer 1.2s linear infinite",
        bump: "bump 180ms ease-out",
        rise: "rise 320ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
        "check-pop": "check-pop 360ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
      },
    },
  },
  plugins: [],
} satisfies Config;
