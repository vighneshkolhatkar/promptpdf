/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    resolveAlias: {
      canvas: "./lib/empty-module.js",
    },
  },
};

export default nextConfig;
