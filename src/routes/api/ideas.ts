import { createFileRoute } from "@tanstack/react-router";
import { readQuery } from "@viktorbarzin/runtime";
import { z } from "zod";
import { appAuth } from "#/server/auth.server";
import { pool } from "#/server/db.server";
import { listIdeas } from "#/server/ideas.server";
import { ideaView } from "#/server/week.server";

const query = z.object({
	limit: z.coerce.number().int().min(1).max(500).default(100),
	status: z.enum(["open", "dismissed", "booked", "repeat"]).default("open"),
});

/** GET /api/ideas for members' CLIs and agents (bearer tokens); Muse uses /api/muse. */
export const Route = createFileRoute("/api/ideas")({
	server: {
		handlers: {
			GET: ({ request }) =>
				appAuth.handleApi(request, async () => {
					const { limit, status } = readQuery(request, query);
					const rows = await listIdeas(pool.getDb(), status, limit);
					return Response.json({ ideas: rows.map(ideaView) });
				}),
		},
	},
});
