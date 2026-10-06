import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "#/lib/utils";

// RIFT buttons: primary (navy), accent (cyan), outline. Labels are set in
// Widescreen, uppercase; corners are radius-sm.
const buttonVariants = cva(
	"inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-sm border-2 border-transparent font-wide text-[13px] leading-4 font-semibold tracking-[0.04em] whitespace-nowrap uppercase transition-[background-color,color,border-color,filter,scale] active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				primary: "bg-primary text-primary-foreground hover:bg-primary/90",
				accent: "bg-cyan text-on-cyan hover:brightness-108",
				outline: "border-ink bg-transparent text-ink hover:bg-ink/10",
				ghost: "text-ink hover:bg-ink/10",
				link: "h-auto border-0 px-0 font-sans text-base font-normal tracking-normal text-link normal-case underline-offset-4 hover:underline",
			},
			size: {
				default: "h-11 px-6",
				sm: "h-9 px-4",
				lg: "h-12 px-8",
				icon: "size-11",
				"icon-sm": "size-9",
			},
		},
		defaultVariants: {
			variant: "primary",
			size: "default",
		},
	},
);

function Button({
	className,
	variant = "primary",
	size = "default",
	asChild = false,
	...props
}: React.ComponentProps<"button"> &
	VariantProps<typeof buttonVariants> & {
		asChild?: boolean;
	}) {
	const Comp = asChild ? Slot.Root : "button";

	return (
		<Comp
			data-slot="button"
			data-variant={variant}
			data-size={size}
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		/>
	);
}

export { Button, buttonVariants };
