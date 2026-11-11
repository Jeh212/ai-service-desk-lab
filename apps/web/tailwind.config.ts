import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b0f1a",
        panel: "#111726",
        panel2: "#0e1420",
        border: "#1f2a3d",
        accent: "#5b8cff",
        accent2: "#22c99a",
        warn: "#f0a84a",
        danger: "#f05a66",
        muted: "#8aa0c0",
      },
    },
  },
  plugins: [],
};
export default config;
