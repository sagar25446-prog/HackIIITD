/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Brand teal: 600 is the primary action colour (white text passes WCAG AA).
      colors: {
        teal: {
          50: "#EFFAF8",
          100: "#D3F0EC",
          200: "#A8E0D8",
          300: "#73C9BE",
          400: "#3AA99D",
          500: "#138A7E",
          600: "#0F766E",
          700: "#0D625B",
          800: "#0F4F4A",
          900: "#113F3B",
        },
        amber: {
          50: "#FFF8EB",
          100: "#FEECC6",
          200: "#FDD889",
          400: "#F5B031",
          500: "#E3920B",
          600: "#B86E06",
          700: "#8F5208",
          800: "#6F400B",
        },
        coral: {
          50: "#FFF2EF",
          100: "#FFDFD8",
          200: "#FDBCAE",
          400: "#F2765C",
          500: "#DC4F35",
          600: "#B83A24",
          700: "#93301F",
        },
        ink: {
          900: "#10201E",
          800: "#1C2D2B",
          700: "#2F3F3D",
          600: "#475654",
          500: "#5B6A68",
          400: "#687674", // 4.6:1 on white — readable metadata
          300: "#A3AFAD",
          200: "#CDD6D4",
          100: "#E4EAE9",
          50: "#F4F7F6",
        },
      },
      fontFamily: {
        sans: ['"Segoe UI"', "Inter", "system-ui", '"Noto Sans Devanagari"', "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,32,30,.05), 0 2px 10px rgba(16,32,30,.05)",
        lift: "0 2px 4px rgba(16,32,30,.06), 0 10px 28px rgba(16,32,30,.10)",
      },
    },
  },
  plugins: [],
};
