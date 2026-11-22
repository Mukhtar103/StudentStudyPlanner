export function readConfig(env = process.env) {
  const render = env.RENDER === 'true';
  const port = Number(env.API_PORT || (render && env.PORT) || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('API_PORT must be a valid port');
  const secure = env.NODE_ENV === 'production';
  const host = env.API_HOST || (render ? '0.0.0.0' : '127.0.0.1');
  const trustProxy = Number(env.TRUST_PROXY_HOPS || 0);
  if (!Number.isSafeInteger(trustProxy) || trustProxy < 0) throw new Error('TRUST_PROXY_HOPS must be a non-negative integer');
  let origins = (env.WEB_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(value => value.trim()).filter(Boolean);
  if (secure) {
    for (const key of ['APP_URL','DB_HOST','DB_NAME','DB_USER','DB_PASSWORD']) {
      if (!env[key]?.trim()) throw new Error(key + ' is required in production');
    }
    const dbPort = Number(env.DB_PORT || 3306);
    if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535) throw new Error('DB_PORT must be a valid port');
    const appUrl = httpsOrigin(env.APP_URL);
    origins = [...new Set([appUrl,...(env.WEB_ORIGINS ?? '').split(',').map(value=>value.trim()).filter(Boolean).map(httpsOrigin)])];
    // Render terminates HTTPS at its managed proxy and requires a public bind.
    const managedProxy = render && host === '0.0.0.0';
    if (trustProxy !== 1 || (!managedProxy && !['127.0.0.1','::1'].includes(host))) {
      throw new Error('Production requires one HTTPS reverse proxy and a loopback API_HOST');
    }
    if (!['127.0.0.1','::1','localhost'].includes(env.DB_HOST) && env.DB_TLS !== 'true') {
      throw new Error('DB_TLS=true is required for a remote production database');
    }
    if (Boolean(env.SMTP_URL) !== Boolean(env.SMTP_FROM)) throw new Error('Configure SMTP_URL and SMTP_FROM together');
    if (env.SMTP_URL) {
      let protocol;
      try { protocol = new URL(env.SMTP_URL).protocol; } catch { throw new Error('SMTP_URL is invalid'); }
      if (!['smtp:','smtps:'].includes(protocol)) throw new Error('SMTP_URL must use smtp or smtps');
    }
  }
  return {port,host,origins,secure,trustProxy};
}

function httpsOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Production web URLs must be valid HTTPS origins'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Production web URLs must be valid HTTPS origins');
  }
  return url.origin;
}

