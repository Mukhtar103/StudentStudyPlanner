import { env } from 'node:process';

const backend = env.PLANNER_BACKEND_ORIGIN && new URL(env.PLANNER_BACKEND_ORIGIN);
if (backend && (backend.protocol !== 'https:' || backend.href !== backend.origin + '/')) {
  throw new Error('PLANNER_BACKEND_ORIGIN must be an HTTPS origin without credentials or a path');
}
if (!backend && env.VERCEL_ENV === 'production') {
  throw new Error('Set PLANNER_BACKEND_ORIGIN to the deployed Express backend HTTPS origin');
}

export const config = {
  framework: 'vite',
  buildCommand: 'npm run build',
  outputDirectory: 'client/dist',
  rewrites: [
    ...(backend ? [{ source: '/api/:path*', destination: backend.origin + '/api/:path*' }] : []),
    { source: '/((?!api(?:/|$)|assets(?:/|$)).*)', destination: '/index.html' },
  ],
};
