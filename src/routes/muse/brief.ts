import { createFileRoute } from "@tanstack/react-router";

import { museBrief } from "#/server/brief.server";
import { publicOrigin } from "#/server/env.server";

/** The routine Muse builds itself from. Public: it holds no names and no secrets. */
export const Route = createFileRoute("/muse/brief")({
	server: {
		handlers: {
			GET: () =>
				new Response(museBrief(publicOrigin()), {
					headers: {
						"content-type": "text/markdown; charset=utf-8",
						"cache-control": "no-store",
					},
				}),
		},
	},
});
