/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "monospace"],
      },
      borderRadius: {
        xl: "0.75rem",
        "2xl": "0.85rem",
      },
      colors: {
        panel: "#f8f9fa",
        surface: "#f8f9fa",
        border: "#e5e7eb",
        muted: {
          DEFAULT: "#6b7280",
          foreground: "#6b7280",
        },
        brand: {
          DEFAULT: "#1a5c38",
          strong: "#00c853",
          deep: "#0f3d24",
          soft: "#e8f4ec",
        },
        danger: "#dc2626",
        amber: "#d97706",

        background: "#ffffff",
        foreground: "#1a1a1a",
        card: {
          DEFAULT: "#f8f9fa",
          foreground: "#1a1a1a",
        },
        primary: {
          DEFAULT: "#1a5c38",
          foreground: "#ffffff",
        },
        secondary: {
          DEFAULT: "#f3f4f6",
          foreground: "#1a1a1a",
        },
        accent: {
          DEFAULT: "#1a5c38",
          foreground: "#ffffff",
        },
        input: "#e5e7eb",
        ring: "#1a5c38",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
