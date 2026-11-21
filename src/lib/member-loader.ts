import { redirect } from "@tanstack/react-router";

import { getAccessStatus } from "#/server/access.functions";

/** A page for members only: signed-out visitors go home to sign in, waiting ones to /pending. */
export async function memberOnly(returnTo: string) {
	const status = await getAccessStatus({ data: { returnTo } });
	if (!status.signedIn) throw redirect({ to: "/" });
	if (!status.member) throw redirect({ to: "/pending" });
	return status;
}
