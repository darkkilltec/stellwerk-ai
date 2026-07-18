import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server build for the Docker image.
  output: "standalone",
  experimental: {
    serverActions: {
      // Resume upload: 5 MB file cap + multipart framing overhead.
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
