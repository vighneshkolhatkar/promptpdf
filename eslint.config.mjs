import nextConfig from "eslint-config-next";

const config = [
  ...nextConfig,
  {
    ignores: ["scripts/smoke-test.mjs"],
  },
];

export default config;
