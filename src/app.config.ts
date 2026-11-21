/**
 * This app's names. Client-safe constants only: no secrets, nothing read from
 * the environment. `bun run rename <slug> "<Display Name>"` rewrites them.
 */
export const app = {
	slug: "datenight",
	displayName: "Date Night",
	/** Authentik groups (the Terraform app module creates them). */
	usersGroup: "Date Night Users",
	adminsGroup: "Date Night Admins",
	agentsGroup: "Date Night Agents",
	/** The Postgres NOTIFY channel for realtime events. */
	realtimeChannel: "datenight_events",
	/** How often lists refetch while realtime is off (a connection budget of 1, e.g. Cloud's nano). */
	pollMs: 10_000,
	/**
	 * Telemetry (app-kit ADR-0002, infra ADR-0041): pageviews, replay and
	 * product events go to Rybbit, errors to GlitchTip. On by default for new
	 * apps; set `enabled: false` here, or TELEMETRY=off in the environment,
	 * to opt out.
	 */
	telemetry: {
		enabled: true,
		/** The Rybbit site the first-party apps share. */
		siteId: "1",
		/** The browser sends only from this domain and its subdomains. */
		productionHosts: ["viktorbarzin.me"],
	},
	/** migrationLockKey("datenight") from @viktorbarzin/pg. */
	migrationLockKey: 634438020951230246n,
} as const;
