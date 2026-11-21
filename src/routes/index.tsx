import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";

import { app } from "#/app.config";
import { IdeaCard } from "#/components/idea-card";
import { longDate, pounds, Section, Shell } from "#/components/shell";
import { Button } from "#/components/ui/button";
import { homeKeys } from "#/lib/query-keys";
import { getAccessStatus } from "#/server/access.functions";
import { getHome, makeWeekNow, rateDate, runJob } from "#/server/app.functions";
import type { DateView } from "#/server/dates.server";

/**
 * The home page. Signed-out visitors see a landing page with a sign-in link;
 * people waiting for approval go to /pending; the Owner sees next week.
 */
export const Route = createFileRoute("/")({
	loader: async () => {
		const status = await getAccessStatus({ data: { returnTo: "/" } });
		if (status.signedIn && !status.member) throw redirect({ to: "/pending" });
		return status;
	},
	component: Home,
});

function Home() {
	const status = Route.useLoaderData();
	if (!status.signedIn)
		return (
			<main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 p-6">
				<h1 className="font-serif text-3xl font-semibold text-primary">
					{app.displayName}
				</h1>
				<p className="text-muted-foreground">One new London date a week.</p>
				<Button asChild className="self-start">
					<a href={status.signInUrl}>Sign in</a>
				</Button>
			</main>
		);
	return (
		<Shell
			signOutUrl={status.signOutUrl}
			username={status.username}
			admin={status.admin}
		>
			<Week />
		</Shell>
	);
}

const SKIP_TEXT: Record<string, string> = {
	travel: "No date next week: you are travelling.",
	busy: "No date next week: every evening is taken.",
};

function Week() {
	const queryClient = useQueryClient();
	const home = useQuery({
		queryKey: homeKeys.all,
		queryFn: () => getHome(),
		// While a job runs, look again every 10 s for its outcome.
		refetchInterval: (q) =>
			q.state.data?.runs.some((r) => r.outcome === "running") ? 10_000 : false,
	});
	const refresh = () =>
		queryClient.invalidateQueries({ queryKey: homeKeys.all });
	const make = useMutation({
		mutationFn: () => makeWeekNow(),
		onSuccess: refresh,
	});
	const job = useMutation({
		mutationFn: (name: "scout" | "history") => runJob({ data: { name } }),
		onSettled: refresh,
	});

	if (home.isPending)
		return <p className="text-muted-foreground">Loading...</p>;
	if (home.isError) return <p role="alert">Could not load this week.</p>;
	const { week, nextWeekStart, upcoming, toRate, openIdeas, runs, setup } =
		home.data;

	return (
		<main className="flex flex-col gap-8" data-testid="home">
			{toRate.length > 0 ? (
				<Section title="How was it?">
					{toRate.map((d) => (
						<RateCard key={d.id} date={d} onDone={refresh} />
					))}
				</Section>
			) : null}

			{upcoming.length > 0 ? (
				<Section title="Booked">
					{upcoming.map((d) => (
						<div
							key={d.id}
							className="rounded-lg border border-primary/30 bg-accent/60 p-4"
							data-testid="booked"
						>
							<p className="font-serif text-lg font-semibold">{d.venue}</p>
							<p className="text-sm text-muted-foreground">
								{longDate(d.on)}
								{d.startsAt
									? ` at ${new Date(d.startsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}`
									: ""}
								{d.bookingRef ? ` · ref ${d.bookingRef}` : ""} ·{" "}
								{pounds(d.priceGbp)}
							</p>
							{d.calendar === "failed" ? (
								<p className="mt-1 text-sm text-destructive">
									Calendar: {d.calendarError}
								</p>
							) : null}
						</div>
					))}
				</Section>
			) : null}

			<Section title={`Week of ${longDate(nextWeekStart)}`}>
				{!week ? (
					<div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-5">
						<p>
							The shortlist for this week comes on Monday morning, after
							Sunday's scout run.
						</p>
						<Button
							variant="secondary"
							onClick={() => make.mutate()}
							disabled={make.isPending}
						>
							{make.isPending ? "Making it..." : "Make it now"}
						</Button>
					</div>
				) : week.status === "skipped" ? (
					<p className="rounded-lg border p-5">
						{SKIP_TEXT[week.skipReason ?? ""] ?? "No date next week."}
					</p>
				) : week.status === "exhausted" ? (
					<p className="rounded-lg border p-5">
						No ideas left for this week. The next scout run brings more.
					</p>
				) : (
					<>
						{week.evening ? (
							<p className="text-lg">
								<span className="font-serif font-semibold">
									{longDate(week.evening.date)}
								</span>
								<span className="text-muted-foreground"> from 19:00</span>
								{week.status === "booked" ? (
									<span className="text-primary"> · booked</span>
								) : null}
							</p>
						) : null}
						<div className="flex flex-col gap-3" data-testid="shortlist">
							{week.ideas.map((idea, i) => (
								<IdeaCard key={idea.id} idea={idea} index={i + 1} />
							))}
						</div>
						{week.status === "offered" ? (
							<p className="text-sm text-muted-foreground">
								Round {week.round + 1} of 3. Muse sends these on WhatsApp and
								books the one you pick.
							</p>
						) : null}
					</>
				)}
			</Section>

			<Section
				title="Behind the scenes"
				action={
					<span className="flex gap-2">
						<Button
							size="sm"
							variant="secondary"
							onClick={() => job.mutate("scout")}
							disabled={job.isPending}
						>
							Scout now
						</Button>
						<Button
							size="sm"
							variant="secondary"
							onClick={() => job.mutate("history")}
							disabled={job.isPending}
						>
							Refresh history
						</Button>
					</span>
				}
			>
				{job.data ? (
					<p className="text-sm text-muted-foreground">
						Started. A scout run takes a few minutes; its result shows below.
					</p>
				) : null}
				{job.isError ? (
					<p className="text-sm text-destructive">
						{String(job.error.message)}
					</p>
				) : null}
				<p className="text-sm">{openIdeas} open ideas to draw from.</p>
				<ul className="flex flex-wrap gap-2 text-xs">
					{Object.entries(setup).map(([name, ok]) => (
						<li
							key={name}
							className={`rounded-full px-2 py-0.5 ${ok ? "bg-muted" : "bg-destructive/10 text-destructive"}`}
						>
							{name}: {ok ? "set up" : "missing"}
						</li>
					))}
				</ul>
				{runs.length > 0 ? (
					<ul className="flex flex-col gap-1 text-sm text-muted-foreground">
						{runs.map((r) => (
							<li key={`${r.name}-${r.startedAt}`}>
								{new Date(r.startedAt).toLocaleString("en-GB", {
									dateStyle: "medium",
									timeStyle: "short",
									timeZone: "Europe/London",
								})}{" "}
								· {r.name} · {r.outcome}
								{r.detail ? ` · ${r.detail}` : ""}
							</li>
						))}
					</ul>
				) : null}
			</Section>
		</main>
	);
}

function RateCard({ date, onDone }: { date: DateView; onDone: () => void }) {
	const [note, setNote] = useState("");
	const save = useMutation({
		mutationFn: (r: { happened: boolean; rating: number | null }) =>
			rateDate({ data: { id: date.id, note, ...r } }),
		onSuccess: onDone,
	});
	return (
		<div className="flex flex-col gap-3 rounded-lg border p-4">
			<p>
				<span className="font-serif font-semibold">{date.venue}</span>
				<span className="text-muted-foreground"> · {longDate(date.on)}</span>
			</p>
			<input
				className="rounded-md border bg-transparent px-3 py-2 text-sm"
				placeholder="What did you like?"
				aria-label="What did you like?"
				value={note}
				maxLength={1000}
				onChange={(e) => setNote(e.target.value)}
			/>
			<div className="flex flex-wrap gap-2">
				{[1, 2, 3, 4, 5].map((n) => (
					<Button
						key={n}
						size="sm"
						variant="secondary"
						disabled={save.isPending}
						onClick={() => save.mutate({ happened: true, rating: n })}
					>
						{n}
					</Button>
				))}
				<Button
					size="sm"
					variant="ghost"
					disabled={save.isPending}
					onClick={() => save.mutate({ happened: false, rating: null })}
				>
					It did not happen
				</Button>
			</div>
		</div>
	);
}
