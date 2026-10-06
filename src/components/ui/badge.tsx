import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "#/lib/utils";

// The brand calls this a Tag: neutral, cyan or violet, pill-shaped.
const badgeVariants = cva(
	"inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-pill border border-transparent px-2.5 py-1 font-wide text-xs leading-4 font-semibold tracking-[0.04em] whitespace-nowrap uppercase transition-colors [&>svg]:pointer-events-none [&>svg]:size-3",
	{
		variants: {
			variant: {
				neutral: "border-line bg-surface-raised text-ink",
				cyan: "bg-cyan-soft text-cyan-text",
				violet: "bg-violet-soft text-violet-text",
			},
		},
		defaultVariants: {
			variant: "neutral",
		},
	},
);

function Badge({
	className,
	variant = "neutral",
	asChild = false,
	...props
}: React.ComponentProps<"span"> &
	VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
	const Comp = asChild ? Slot.Root : "span";

	return (
		<Comp
			data-slot="badge"
			data-variant={variant}
			className={cn(badgeVariants({ variant }), className)}
			{...props}
		/>
	);
}

export { Badge, badgeVariants };
