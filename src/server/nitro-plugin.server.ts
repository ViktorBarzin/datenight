/**
 * Nitro runtime plugin: runs once when the built server starts, before it
 * listens (registered in vite.config.ts).
 *
 * - console output (Nitro's error handler, srvx's banner) becomes JSON lines,
 *   with the service fields (service.name, service.version,
 *   deployment.environment.name) on every line;
 * - server telemetry starts when a write key is configured: product events
 *   to the event pipeline, errors to GlitchTip with a DSN;
 * - /metrics is served on METRICS_PORT, which the ingress does not route;
 * - the realtime LISTEN connection opens at boot, so its gauges mean
 *   something before the first SSE subscriber, unless the connection budget
 *   turns realtime off;
 * - the Date Night scheduler starts when SCHEDULER=on;
 * - SIGTERM/SIGINT close the SSE streams and LISTEN, let in-flight requests
 *   finish, send queued telemetry, close the metrics listener and the pool,
 *   then exit.
 */
import * as Sentry from "@sentry/bun";
import { installJsonConsole, setLogService } from "@viktorbarzin/log";
import { startMetricsServer } from "@viktorbarzin/metrics";
import { installShutdown } from "@viktorbarzin/runtime";
import {
	closeAndFlush,
	initServerTelemetry,
} from "@viktorbarzin/telemetry/server";
import { definePlugin } from "nitro";

import { assertBunVersion } from "#/lib/bun-version";

import { pool } from "./db.server";
import { liveDeps } from "./deps.server";
import {
	databaseConfigured,
	dateNightSettings,
	isDevelopment,
	metricsPort,
	realtimeEnabled,
	serviceInfo,
	telemetrySettings,
} from "./env.server";
import { startScheduler, stopScheduler } from "./jobs.server";
import { realtime } from "./realtime.server";

export default definePlugin(() => {
	// Bun-only steps; `vite dev` may run the server outside Bun.
	if (typeof Bun === "undefined") return;
	assertBunVersion(Bun.version);
	setLogService(serviceInfo());
	if (!isDevelopment()) installJsonConsole();
	const telemetry = telemetrySettings();
	if (telemetry)
		initServerTelemetry({
			writeKey: telemetry.writeKey,
			host: telemetry.eventsUrl,
			release: telemetry.release,
			service: serviceInfo().name,
			environment: telemetry.environment,
			dsn: telemetry.dsn ?? undefined,
			sentry: Sentry,
		});
	const metrics = startMetricsServer({ port: metricsPort() });
	if (databaseConfigured() && realtimeEnabled())
		void realtime.start().catch(() => {});
	// The Sunday history refresh and Scout run (jobs.server.ts), on in the
	// deployed pod only.
	if (databaseConfigured() && dateNightSettings().schedulerEnabled)
		startScheduler(() => pool.getDb(), liveDeps);
	installShutdown({
		beforeDrain: [
			{ name: "scheduler", run: () => stopScheduler() },
			{ name: "realtime", run: () => realtime.stop() },
		],
		afterDrain: [
			{ name: "telemetry", run: () => closeAndFlush(2000) },
			{ name: "metrics", run: () => metrics?.stop() },
			{ name: "pool", run: () => pool.close() },
		],
	});
});
