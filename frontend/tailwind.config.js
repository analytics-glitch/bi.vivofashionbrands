/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', "system-ui", "sans-serif"],
      },
      borderRadius: {
        "2xl": "1rem",
        xl: "0.85rem",
      },
      colors: {
        bg: "#fafaf7",
        panel: "#ffffff",
        surface: "#ffffff",
        "surface-2": "#f1f6f2",
        border: "#e6ebe7",
        muted: {
          DEFAULT: "#6e7b74",
          foreground: "#6e7b74",
        },
        brand: {
          DEFAULT: "#00a34a",
          strong: "#00c853",
          deep: "#0f4a2b",
          soft: "#e2f6e9",
        },
        danger: "#e53935",
        amber: "#f59e0b",

        background: "#fafaf7",
        foreground: "#0a1a12",
        card: {
          DEFAULT: "#ffffff",
          foreground: "#0a1a12",
        },
        primary: {
          DEFAULT: "#00a34a",
          foreground: "#ffffff",
        },
        secondary: {
          DEFAULT: "#f1f6f2",
          foreground: "#0a1a12",
        },
        accent: {
          DEFAULT: "#00a34a",
          foreground: "#ffffff",
        },
        input: "#e6ebe7",
        ring: "#00a34a",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
