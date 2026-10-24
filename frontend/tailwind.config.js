/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        teal: { 50: "#EEF8F7", 100: "#D5EFED", 200: "#A9DEDA", 400: "#5CBDB7", 500: "#3EADA7", 600: "#2F8E89", 700: "#25716D", 800: "#1D5754", 900: "#143D3B" },
        amber: { 50: "#FFF8EB", 100: "#FDECC8", 400: "#F6B53F", 500: "#F2A116", 600: "#C97F0A" },
        coral: { 50: "#FFF1EE", 100: "#FFDCD4", 400: "#F7826A", 500: "#F0644A", 600: "#C9482F" },
        ink: { 900: "#16211F", 700: "#33413F", 500: "#5E6C6A", 300: "#A6B1AF", 100: "#E6EBEA", 50: "#F5F7F7" },
      },
      fontFamily: { sans: ['"Segoe UI"', "Inter", "system-ui", '"Noto Sans Devanagari"', "sans-serif"] },
      boxShadow: { card: "0 1px 2px rgba(22,33,31,.06), 0 4px 16px rgba(22,33,31,.06)" },
    },
  },
  plugins: [],
};
