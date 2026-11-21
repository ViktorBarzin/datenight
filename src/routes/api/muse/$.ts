import { createFileRoute } from "@tanstack/react-router";

import { handleMuse } from "#/server/muse.server";

/** Every /api/muse/* call; muse.server.ts checks the token and routes it. */
const handle = ({
	request,
	params,
}: {
	request: Request;
	params: { _splat?: string };
}) => handleMuse(request, params._splat ?? "");

export const Route = createFileRoute("/api/muse/$")({
	server: {
		handlers: { GET: handle, POST: handle },
	},
});
