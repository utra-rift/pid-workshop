import { Switch as SwitchPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "#/lib/utils";

function Switch({
	className,
	...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			className={cn(
				"peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-pill border border-line bg-surface transition-colors disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-cyan data-[state=checked]:bg-cyan",
				className,
			)}
			{...props}
		>
			<SwitchPrimitive.Thumb
				data-slot="switch-thumb"
				className="pointer-events-none block size-3.5 rounded-pill bg-ink transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-on-cyan data-[state=unchecked]:translate-x-0.5"
			/>
		</SwitchPrimitive.Root>
	);
}

export { Switch };
