# Production startup and database recovery

## Vercel frontend

Set the Vercel Root Directory to the folder containing `package.json`, `vite.config.js` and `vercel.js`. The checked-in config uses the Vite preset, runs `npm run build` and publishes `client/dist`. Set the Production build environment variable `PLANNER_BACKEND_ORIGIN` to the separate Express service's HTTPS origin, without a path. Use a separate test backend for previews if needed.

Run the Express service on a persistent Node.js host using the production instructions below. The service starts the reminder worker and listens behind a local HTTPS proxy. A Vite deployment serves the compiled frontend only. The rewrite forwards `/api/*` to Express and keeps browser requests and session cookies on the Vercel domain.

On the Express host, set `APP_URL` to the public Vercel HTTPS origin and add any other trusted frontend origins explicitly in `WEB_ORIGINS`. Keep MySQL and SMTP credentials on the Express host. The HTTPS proxy must forward the browser's `Origin`, cookies and request headers to Express and pass `Set-Cookie` back. For a remote MySQL instance, enable `DB_TLS=true` and confirm the backend host can connect to the existing schema with the configured credentials before starting the service.

After redeploying Vercel, open `/api/v1/health` on the Vercel domain and confirm it returns the Express JSON response. From a private browser window, confirm that account creation and sign-in succeed with a designated test account and that refreshing restores the session.

Use a supported Node.js LTS release and MySQL 8.4. Set the variables in `.env.example` through the service environment or a restricted, untracked `.env` file. Set `NODE_ENV=production`, `APP_URL` to the public HTTPS origin, `API_HOST=127.0.0.1` and `TRUST_PROXY_HOPS=1`. Leave `WEB_ORIGINS` empty for same-origin operation. Enable `DB_TLS=true` for a remote database. Configure both SMTP variables for account recovery and email reminders. Use a dedicated application database account and a separate migration account where possible.

Terminate HTTPS at one reverse proxy on the same host. Forward requests to the loopback port, overwrite `X-Forwarded-For` and `X-Forwarded-Proto`, preserve the public Host, and redirect HTTP at the proxy. Serve both the SPA and API through that HTTPS origin. Keep the backend port private.

Confirm the MySQL host and schema with `SELECT @@hostname, DATABASE(), VERSION();` before applying migrations. Take a consistent backup to restricted, encrypted storage:

```text
mysqldump --defaults-extra-file=<restricted-client-options> --single-transaction --no-tablespaces --set-gtid-purged=OFF --result-file=<restricted-backup-path> <confirmed-schema>
mysql --defaults-extra-file=<restricted-client-options> <isolated-restore-schema>
```

At the MySQL prompt for the second command, execute `SOURCE <restricted-backup-path>`. Restore into a separate schema first and compare key record counts, foreign keys, and migration versions against the source. Verify account access and planner records against the restored schema before any cutover. Define retention, backup cadence and operational contacts before launch.

Run `npm ci`, `npm run lint`, `npm run test`, `npm run build`, then `npm run db:migrate` with the confirmed migration credentials. Start with `npm run start` under a supervisor that sends SIGTERM and allows up to 35 seconds for shutdown. Startup checks the build and recorded migration checksums. Use `GET /api/v1/health` for liveness and verify the deployed HTTPS frontend and a private authenticated workflow. Confirm live SMTP using a designated test mailbox before enabling production email.
