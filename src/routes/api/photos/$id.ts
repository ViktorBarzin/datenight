import { createFileRoute } from "@tanstack/react-router";
import { errorResponse } from "@viktorbarzin/runtime";
import { z } from "zod";

import { appAuth } from "#/server/auth.server";
import { pool } from "#/server/db.server";
import { storedPhoto } from "#/server/photos.server";

/** A photo copy the app keeps (from Instagram or TikTok), for signed-in members. */
export const Route = createFileRoute("/api/photos/$id")({
	server: {
		handlers: {
			GET: ({ request, params }) =>
				appAuth.handleApi(request, async () => {
					const id = z.string().uuid().safeParse(params.id);
					if (!id.success)
						return errorResponse(404, "not_found", "no such photo");
					const photo = await storedPhoto(pool.getDb(), id.data);
					if (!photo) return errorResponse(404, "not_found", "no such photo");
					return new Response(photo.bytes, {
						headers: {
							"content-type": photo.contentType,
							"cache-control": "private, max-age=31536000, immutable",
						},
					});
				}),
		},
	},
});
