import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true
    };
    // pdf.js optionally pulls in the Node-only "canvas" package; it is unused
    // in the browser, so stub it out to avoid resolution errors.
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      canvas: false
    };
    return config;
  }
};

export default nextConfig;
