/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  transpilePackages: ['@xyflow/react', '@xyflow/system'],
  devIndicators: false,
  // Turbopack: .wasm 파일 처리 시 생성되는 loader가 'wbg' 모듈을 참조하므로 stub으로 대체
  turbopack: {
    resolveAlias: {
      wbg: './lib/wbg-stub.js',
    },
  },
  webpack: (config) => {
    config.resolve.alias.wbg = false;
    return config;
  },
  async rewrites() {
    const apiUrl = process.env.INTERNAL_API_URL || 'http://backend:8000';
    return [
      {
        source: '/api/uploads/:path*',
        destination: `${apiUrl}/api/uploads/:path*`,
      },
    ];
  },
};

export default nextConfig;
