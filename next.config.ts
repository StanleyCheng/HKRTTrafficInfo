import type { NextConfig } from "next";

const staticExport = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  agentRules: false,
  env: { NEXT_PUBLIC_STATIC_EXPORT: staticExport ? "1" : "0", ...(staticExport ? { NEXT_PUBLIC_BASE_PATH: "/HKRTTrafficInfo" } : {}) },
  ...(staticExport && {
    output: "export",
    typescript: { tsconfigPath: "tsconfig.static.json" },
    basePath: "/HKRTTrafficInfo",
    assetPrefix: "/HKRTTrafficInfo/",
    images: { unoptimized: true },
    trailingSlash: true,
  }),
};

export default nextConfig;
