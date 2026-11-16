# Production startup and database recovery

Use a supported Node.js LTS release and MySQL 8.4. Set the variables in `.env.example` through the service environment or a restricted, untracked `.env` file. Set `NODE_ENV=production`, `APP_URL` to the public HTTPS origin, `API_HOST=127.0.0.1` and `TRUST_PROXY_HOPS=1`. Leave `WEB_ORIGINS` empty for same-origin operation. Enable `DB_TLS=true` for a remote database. Configure both SMTP variables for account recovery and email reminders. Use a dedicated application database account and a separate migration account where possible.

Terminate HTTPS at one reverse proxy on the same host. Forward requests to the loopback port, overwrite `X-Forwarded-For` and `X-Forwarded-Proto`, preserve the public Host, and redirect HTTP at the proxy. Serve both the SPA and API through that HTTPS origin. Keep the backend port private.

Confirm the MySQL host and schema with `SELECT @@hostname, DATABASE(), VERSION();` before applying migrations. Take a consistent backup to restricted, encrypted storage:

```text
mysqldump --defaults-extra-file=<restricted-client-options> --single-transaction --no-tablespaces --set-gtid-purged=OFF --result-file=<restricted-backup-path> <confirmed-schema>
mysql --defaults-extra-file=<restricted-client-options> <isolated-restore-schema>
```

At the MySQL prompt for the second command, execute `SOURCE <restricted-backup-path>`. Restore into a separate schema first and compare key record counts, foreign keys, and migration versions against the source. Verify account access and planner records against the restored schema before any cutover. Define retention, backup cadence and operational contacts before launch.

Run `npm ci`, `npm run lint`, `npm run test`, `npm run build`, then `npm run db:migrate` with the confirmed migration credentials. Start with `npm run start` under a supervisor that sends SIGTERM and allows up to 35 seconds for shutdown. Startup checks the build and recorded migration checksums. Use `GET /api/v1/health` for liveness and verify the deployed HTTPS frontend and a private authenticated workflow. Confirm live SMTP using a designated test mailbox before enabling production email.
