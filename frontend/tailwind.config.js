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
        bg: "#0d0d0d",
        panel: "#121212",
        surface: "#161e1a",
        "surface-2": "#1a3a2a",
        border: "#1f2b25",
        muted: {
          DEFAULT: "#8a9a91",
          foreground: "#8a9a91",
        },
        brand: {
          DEFAULT: "#00c853",
          strong: "#00e676",
          soft: "rgba(0, 200, 83, 0.14)",
        },
        danger: "#ff5252",
        amber: "#ffb300",

        background: "#0d0d0d",
        foreground: "#ffffff",
        card: {
          DEFAULT: "#161e1a",
          foreground: "#ffffff",
        },
        primary: {
          DEFAULT: "#00c853",
          foreground: "#000000",
        },
        secondary: {
          DEFAULT: "#1a3a2a",
          foreground: "#ffffff",
        },
        accent: {
          DEFAULT: "#00c853",
          foreground: "#000000",
        },
        input: "#1f2b25",
        ring: "#00c853",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
