import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (.next/standalone) for the Docker image.
  output: "standalone",

  // 設定 Next.js 開發指示器位置：移至右下角，避免左下角卡住首頁版面
  // Next 16 devIndicators: false 隱藏指示器，或指定位置 (bottom-left | bottom-right | top-left | top-right)
  devIndicators: {
    position: "bottom-right",
  },
};

export default nextConfig;
