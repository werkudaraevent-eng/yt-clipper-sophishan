import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@clipper/shared"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "i.ytimg.com" }],
  },
};

export default nextConfig;
