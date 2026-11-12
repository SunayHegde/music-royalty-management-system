// /api calls are forwarded to the Express backend, so no CORS setup is needed in development.
const API_URL = process.env.API_URL || 'http://localhost:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false, // don't generate AGENTS.md in the project
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
