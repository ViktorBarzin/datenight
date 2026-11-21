import { useState } from "react";

/**
 * An Idea's photos: one large, the rest as a row of thumbnails to tap. Outside
 * images load without a referrer, which most image hosts allow; a photo that
 * fails to load drops out.
 */
export function Gallery({
	photos,
	title,
}: {
	photos: string[];
	title: string;
}) {
	const [broken, setBroken] = useState<Set<string>>(new Set());
	const [chosen, setChosen] = useState(0);
	const shown = photos.filter((p) => !broken.has(p));
	if (shown.length === 0) return null;
	const main = shown[Math.min(chosen, shown.length - 1)] ?? shown[0];
	const drop = (p: string) => setBroken((prev) => new Set(prev).add(p));
	return (
		<div
			className="-mx-4 -mt-4 mb-1 flex flex-col gap-1.5"
			data-testid="gallery"
		>
			<img
				src={main}
				alt={title}
				loading="lazy"
				referrerPolicy="no-referrer"
				onError={() => main && drop(main)}
				className="aspect-[16/10] w-full rounded-t-lg bg-muted object-cover"
			/>
			{shown.length > 1 ? (
				<div className="flex gap-1.5 overflow-x-auto px-4 pb-1">
					{shown.map((p, i) => (
						<button
							key={p}
							type="button"
							aria-label={`Photo ${i + 1} of ${shown.length}`}
							onClick={() => setChosen(i)}
							className={`shrink-0 overflow-hidden rounded-md ring-2 ${p === main ? "ring-primary" : "ring-transparent"}`}
						>
							<img
								src={p}
								alt=""
								loading="lazy"
								referrerPolicy="no-referrer"
								onError={() => drop(p)}
								className="h-14 w-20 bg-muted object-cover"
							/>
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}
