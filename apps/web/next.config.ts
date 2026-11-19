import type { NextConfig } from 'next';

const WORKER_URL = process.env.WORKER_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  transpilePackages: ['@calmling/core'],
  reactStrictMode: true,
  // don't generate AGENTS.md in the app folder
  ...({ agentRules: false } as object),
  // the website never talks to the database: every read/write goes through the simulation service
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${WORKER_URL}/api/:path*` },
      { source: '/health', destination: `${WORKER_URL}/health` },
    ];
  },
};

export default config;
