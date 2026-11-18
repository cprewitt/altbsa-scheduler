import type { NextConfig } from "next";

// Tailwind runs via postcss.config.mjs (@tailwindcss/postcss) so styles
// work under both webpack and Turbopack. Avoid the Turbopack-only CSS
// loader here — next dev --webpack does not apply it.
const nextConfig: NextConfig = {};

export default nextConfig;
