import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";

import { CATEGORY_TINT, longDate, Section, Shell } from "#/components/shell";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import {
	CATEGORIES,
	CATEGORY_LABELS,
	type Category,
	isCategory,
} from "#/domain/types";
import { memberOnly } from "#/lib/member-loader";
import { historyKeys } from "#/lib/query-keys";
import {
	confirmPastDate,
	dismissCandidate,
	getHistory,
} from "#/server/app.functions";

export const Route = createFileRoute("/history")({
	loader: () => memberOnly("/history"),
	component: HistoryPage,
});

function HistoryPage() {
	const status = Route.useLoaderData();
	const history = useQuery({
		queryKey: historyKeys.all,
		queryFn: () => getHistory(),
	});
	const [showAll, setShowAll] = useState(false);

	return (
		<Shell
			signOutUrl={status.signOutUrl}
			username={status.username}
			admin={status.admin}
		>
			<main className="flex flex-col gap-8">
				{history.isPending ? (
					<p className="text-muted-foreground">Loading...</p>
				) : history.isError ? (
					<p role="alert">Could not load history.</p>
				) : (
					<>
						<Section
							title={`Were these dates? (${history.data.candidates.length})`}
						>
							<p className="text-sm text-muted-foreground">
								Found in your calendar, bank and photos. Confirm the dates so
								they never come back as ideas.
							</p>
							{history.data.candidates.length === 0 ? (
								<p className="text-muted-foreground">
									Nothing to check. "Refresh history" on This week looks again.
								</p>
							) : (
								(showAll
									? history.data.candidates
									: history.data.candidates.slice(0, 15)
								).map((c) => (
									<Candidate
										key={c.on}
										on={c.on}
										venueGuess={c.venueGuess}
										evidence={c.evidence}
									/>
								))
							)}
							{!showAll && history.data.candidates.length > 15 ? (
								<Button
									variant="ghost"
									className="self-start"
									onClick={() => setShowAll(true)}
								>
									Show all {history.data.candidates.length}
								</Button>
							) : null}
						</Section>

						<Section title="Add a past date">
							<PastDateForm on="" venue="" submitLabel="Add" />
						</Section>

						<Section title={`Past dates (${history.data.past.length})`}>
							{history.data.past.length === 0 ? (
								<p className="text-muted-foreground">None yet.</p>
							) : (
								<ul className="flex flex-col divide-y rounded-lg border">
									{history.data.past.map((d) => (
										<li
											key={d.id}
											className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-3 text-sm"
										>
											<span className="w-28 shrink-0 text-muted-foreground">
												{d.on}
											</span>
											<span className="font-medium">{d.venue}</span>
											<span
												className={`rounded-full px-2 py-0.5 text-xs ${CATEGORY_TINT[d.category] ?? "bg-muted"}`}
											>
												{d.activityKind}
											</span>
											{d.rating !== null ? (
												<span className="text-primary">
													{"★".repeat(d.rating)}
												</span>
											) : null}
											{d.status === "booked" ? (
												<span className="text-primary">booked</span>
											) : null}
											{d.ratingNote ? (
												<span className="basis-full text-muted-foreground">
													{d.ratingNote}
												</span>
											) : null}
										</li>
									))}
								</ul>
							)}
						</Section>
					</>
				)}
			</main>
		</Shell>
	);
}

function Candidate({
	on,
	venueGuess,
	evidence,
}: {
	on: string;
	venueGuess: string;
	evidence: { source: string; text: string }[];
}) {
	const queryClient = useQueryClient();
	const [confirming, setConfirming] = useState(false);
	const dismiss = useMutation({
		mutationFn: () => dismissCandidate({ data: { on } }),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: historyKeys.all }),
	});
	return (
		<div
			className="flex flex-col gap-2 rounded-lg border p-4"
			data-testid="candidate"
		>
			<p className="font-medium">
				{longDate(on)}{" "}
				<span className="text-muted-foreground">{on.slice(0, 4)}</span>
			</p>
			<ul className="flex flex-col gap-1 text-sm">
				{evidence.map((e) => (
					<li key={`${e.source}-${e.text}`}>
						<span className="text-muted-foreground">{e.source}: </span>
						{e.text}
					</li>
				))}
			</ul>
			{confirming ? (
				<PastDateForm
					on={on}
					venue={venueGuess}
					submitLabel="Confirm"
					onCancel={() => setConfirming(false)}
				/>
			) : (
				<div className="flex gap-2">
					<Button size="sm" onClick={() => setConfirming(true)}>
						Yes, a date
					</Button>
					<Button
						size="sm"
						variant="secondary"
						disabled={dismiss.isPending}
						onClick={() => dismiss.mutate()}
					>
						No
					</Button>
				</div>
			)}
		</div>
	);
}

function PastDateForm({
	on,
	venue,
	submitLabel,
	onCancel,
}: {
	on: string;
	venue: string;
	submitLabel: string;
	onCancel?: () => void;
}) {
	const queryClient = useQueryClient();
	const [form, setForm] = useState({
		on,
		venue,
		activityKind: "",
		category: "food" as Category,
		rating: "",
	});
	const save = useMutation({
		mutationFn: () =>
			confirmPastDate({
				data: {
					on: form.on,
					venue: form.venue,
					activityKind:
						form.activityKind ||
						(form.category === "food" ? "dinner" : form.venue),
					category: form.category,
					rating: form.rating === "" ? null : Number.parseInt(form.rating, 10),
					note: "",
				},
			}),
		onSuccess: () => {
			setForm({
				on: "",
				venue: "",
				activityKind: "",
				category: "food",
				rating: "",
			});
			void queryClient.invalidateQueries({ queryKey: historyKeys.all });
		},
	});
	function submit(e: FormEvent) {
		e.preventDefault();
		if (form.on && form.venue.trim()) save.mutate();
	}
	return (
		<form className="flex flex-col gap-2" onSubmit={submit}>
			<div className="grid grid-cols-2 gap-2">
				<Input
					type="date"
					aria-label="Day"
					value={form.on}
					onChange={(e) => setForm({ ...form, on: e.target.value })}
				/>
				<Input
					aria-label="Venue"
					placeholder="Venue"
					value={form.venue}
					onChange={(e) => setForm({ ...form, venue: e.target.value })}
				/>
				<select
					aria-label="Category"
					className="h-9 rounded-md border bg-transparent px-3 text-sm"
					value={form.category}
					onChange={(e) =>
						setForm({
							...form,
							category: isCategory(e.target.value) ? e.target.value : "food",
						})
					}
				>
					{CATEGORIES.map((c) => (
						<option key={c} value={c}>
							{CATEGORY_LABELS[c]}
						</option>
					))}
				</select>
				<Input
					aria-label="Kind of activity"
					placeholder="Kind, such as pottery class"
					value={form.activityKind}
					onChange={(e) => setForm({ ...form, activityKind: e.target.value })}
				/>
				<select
					aria-label="Rating"
					className="h-9 rounded-md border bg-transparent px-3 text-sm"
					value={form.rating}
					onChange={(e) => setForm({ ...form, rating: e.target.value })}
				>
					<option value="">No rating</option>
					{[5, 4, 3, 2, 1].map((n) => (
						<option key={n} value={n}>
							{"★".repeat(n)}
						</option>
					))}
				</select>
			</div>
			<div className="flex gap-2">
				<Button size="sm" type="submit" disabled={save.isPending}>
					{submitLabel}
				</Button>
				{onCancel ? (
					<Button size="sm" type="button" variant="ghost" onClick={onCancel}>
						Cancel
					</Button>
				) : null}
			</div>
			{save.isError ? (
				<p className="text-sm text-destructive">Could not save it.</p>
			) : null}
		</form>
	);
}
