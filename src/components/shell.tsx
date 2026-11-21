import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { app } from "#/app.config";

const NAV = [
	{ to: "/", label: "This week" },
	{ to: "/ideas", label: "Ideas" },
	{ to: "/history", label: "History" },
] as const;

/** The frame every signed-in page shares: the name, the three sections, and sign-out. */
export function Shell({
	children,
	signOutUrl,
	username,
	admin = false,
}: {
	children: ReactNode;
	signOutUrl: string | null;
	username: string | null;
	admin?: boolean;
}) {
	return (
		<div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-5 py-6">
			<header className="flex flex-wrap items-baseline justify-between gap-3">
				<Link
					to="/"
					className="font-serif text-2xl font-semibold tracking-tight text-primary"
				>
					{app.displayName}
				</Link>
				<nav className="flex items-baseline gap-4 text-sm">
					{NAV.map((n) => (
						<Link
							key={n.to}
							to={n.to}
							activeOptions={{ exact: true }}
							className="text-muted-foreground hover:text-foreground"
							activeProps={{
								className:
									"font-medium text-foreground underline underline-offset-4",
							}}
						>
							{n.label}
						</Link>
					))}
					{admin ? (
						<a
							className="text-muted-foreground hover:text-foreground"
							href="/admin"
						>
							Admin
						</a>
					) : null}
					<span className="text-muted-foreground" data-testid="username">
						{username}
					</span>
					{signOutUrl ? (
						<a
							className="text-muted-foreground hover:text-foreground"
							href={signOutUrl}
						>
							Sign out
						</a>
					) : null}
				</nav>
			</header>
			{children}
		</div>
	);
}

export function Section({
	title,
	children,
	action,
}: {
	title: string;
	children: ReactNode;
	action?: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-3">
				<h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
					{title}
				</h2>
				{action}
			</div>
			{children}
		</section>
	);
}

export const CATEGORY_TINT: Record<string, string> = {
	shows: "bg-[#f3e1f0] text-[#6b2460] dark:bg-[#3a1a35] dark:text-[#f1c6ea]",
	food: "bg-[#fbe7d6] text-[#7a3b0d] dark:bg-[#3a2414] dark:text-[#f6cfac]",
	classes: "bg-[#e2efe4] text-[#285d34] dark:bg-[#18301d] dark:text-[#bfe3c6]",
	active: "bg-[#e0ebf5] text-[#21507a] dark:bg-[#15283a] dark:text-[#bcd6ef]",
};

export function pounds(price: number | null): string {
	return price === null ? "price unknown" : `£${price} for two`;
}

export function longDate(day: string): string {
	return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
		weekday: "long",
		day: "numeric",
		month: "long",
		timeZone: "UTC",
	});
}
