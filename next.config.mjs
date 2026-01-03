// 檔案路徑: next.config.mjs

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // 解決 pdfjs-dist 在 Node.js 環境中的 worker 問題
      config.resolve.alias = {
        ...config.resolve.alias,
        canvas: false,
      };
    }
    return config;
  },
};

export default nextConfig;