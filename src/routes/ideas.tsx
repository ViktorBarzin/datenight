import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CLIENT_ID_HEADER, clientId } from "@viktorbarzin/realtime/client";
import { useRealtimeInvalidation } from "@viktorbarzin/realtime/react";
import { type FormEvent, useState } from "react";

import { app } from "#/app.config";
import { IdeaCard } from "#/components/idea-card";
import { Section, Shell } from "#/components/shell";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "#/domain/types";
import { memberOnly } from "#/lib/member-loader";
import { ideaKeys } from "#/lib/query-keys";
import { getIdeas, saveIdea, setIdea } from "#/server/app.functions";

export const Route = createFileRoute("/ideas")({
	loader: () => memberOnly("/ideas"),
	component: IdeasPage,
});

const TABS = [
	{ status: "open", label: "Open" },
	{ status: "booked", label: "Booked" },
	{ status: "dismissed", label: "Not for us" },
	{ status: "repeat", label: "Done before" },
] as const;

function IdeasPage() {
	const status = Route.useLoaderData();
	const [tab, setTab] = useState<(typeof TABS)[number]["status"]>("open");
	const queryClient = useQueryClient();
	// Writes from another tab arrive over SSE; with realtime off, the list polls.
	useRealtimeInvalidation({ queryClient, enabled: status.realtime });
	const list = useQuery({
		queryKey: ideaKeys.byStatus(tab),
		queryFn: () => getIdeas({ data: { status: tab } }),
		refetchInterval: status.realtime ? false : app.pollMs,
	});
	const change = useMutation({
		mutationFn: (v: { id: string; status: "open" | "dismissed" }) =>
			setIdea({ data: v, headers: { [CLIENT_ID_HEADER]: clientId() } }),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ideaKeys.all }),
	});

	return (
		<Shell
			signOutUrl={status.signOutUrl}
			username={status.username}
			admin={status.admin}
		>
			<main className="flex flex-col gap-8">
				<AddIdea />
				<Section title="Ideas">
					<div className="flex flex-wrap gap-2" role="tablist">
						{TABS.map((t) => (
							<Button
								key={t.status}
								size="sm"
								role="tab"
								aria-selected={tab === t.status}
								variant={tab === t.status ? "default" : "secondary"}
								onClick={() => setTab(t.status)}
							>
								{t.label}
							</Button>
						))}
					</div>
					{list.isPending ? (
						<p className="text-muted-foreground">Loading...</p>
					) : list.isError ? (
						<p role="alert">Could not load ideas.</p>
					) : (
						<div className="flex flex-col gap-3" data-testid="ideas">
							{list.data.length === 0 ? (
								<p className="text-muted-foreground" data-testid="no-ideas">
									None here.
								</p>
							) : null}
							{list.data.map((idea) => (
								<IdeaCard key={idea.id} idea={idea}>
									{tab === "open" ? (
										<button
											type="button"
											className="text-muted-foreground underline underline-offset-4"
											onClick={() =>
												change.mutate({ id: idea.id, status: "dismissed" })
											}
										>
											Not for us
										</button>
									) : tab === "dismissed" ? (
										<button
											type="button"
											className="text-muted-foreground underline underline-offset-4"
											onClick={() =>
												change.mutate({ id: idea.id, status: "open" })
											}
										>
											Bring back
										</button>
									) : null}
								</IdeaCard>
							))}
						</div>
					)}
				</Section>
			</main>
		</Shell>
	);
}

function AddIdea() {
	const queryClient = useQueryClient();
	const empty = {
		title: "",
		venue: "",
		category: "food" as Category,
		activityKind: "",
		price: "",
		area: "",
		postcode: "",
		url: "",
	};
	const [form, setForm] = useState(empty);
	const [open, setOpen] = useState(false);
	const save = useMutation({
		mutationFn: () =>
			saveIdea({
				data: {
					title: form.title,
					venue: form.venue,
					category: form.category,
					activityKind: form.activityKind,
					priceGbp:
						form.price.trim() === "" ? null : Number.parseInt(form.price, 10),
					area: form.area,
					postcode: form.postcode,
					url: form.url,
				},
				headers: { [CLIENT_ID_HEADER]: clientId() },
			}),
		onSuccess: () => {
			setForm(empty);
			setOpen(false);
			void queryClient.invalidateQueries({ queryKey: ideaKeys.all });
		},
	});
	const field = (
		key: keyof typeof form,
		label: string,
		extra: Record<string, string> = {},
	) => (
		<Input
			aria-label={label}
			placeholder={label}
			value={form[key]}
			onChange={(e) => setForm({ ...form, [key]: e.target.value })}
			{...extra}
		/>
	);
	function submit(e: FormEvent) {
		e.preventDefault();
		if (form.title.trim() && form.venue.trim() && form.activityKind.trim())
			save.mutate();
	}
	if (!open)
		return (
			<Button
				variant="secondary"
				className="self-start"
				onClick={() => setOpen(true)}
			>
				Save an idea
			</Button>
		);
	return (
		<form
			className="flex flex-col gap-2 rounded-lg border p-4"
			onSubmit={submit}
		>
			<p className="text-sm text-muted-foreground">
				Or forward the link to Muse on WhatsApp.
			</p>
			{field("title", "What it is")}
			{field("venue", "Venue")}
			<select
				aria-label="Category"
				className="h-9 rounded-md border bg-transparent px-3 text-sm"
				value={form.category}
				onChange={(e) =>
					setForm({ ...form, category: e.target.value as Category })
				}
			>
				{CATEGORIES.map((c) => (
					<option key={c} value={c}>
						{CATEGORY_LABELS[c]}
					</option>
				))}
			</select>
			{field("activityKind", "Kind of activity, such as pottery class")}
			<div className="grid grid-cols-3 gap-2">
				{field("price", "£ for two", { inputMode: "numeric" })}
				{field("area", "Area")}
				{field("postcode", "Postcode")}
			</div>
			{field("url", "Link")}
			<div className="flex gap-2">
				<Button type="submit" disabled={save.isPending}>
					Save
				</Button>
				<Button type="button" variant="ghost" onClick={() => setOpen(false)}>
					Cancel
				</Button>
			</div>
			{save.data ? (
				<p className="text-sm">
					{save.data.repeats > 0
						? "You did that before; it stays out of the shortlist."
						: "Saved."}
				</p>
			) : null}
			{save.isError ? (
				<p className="text-sm text-destructive">Could not save it.</p>
			) : null}
		</form>
	);
}
