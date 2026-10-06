import { useCallback, useEffect, useRef, useState } from "react";

/** A real-time clock for replaying a finished run. */
export function usePlayback(durationS: number) {
	const [t, setT] = useState(0);
	const [playing, setPlaying] = useState(false);
	const frame = useRef<number | undefined>(undefined);
	const startedAt = useRef(0);
	const offset = useRef(0);

	const stop = useCallback(() => {
		if (frame.current !== undefined) cancelAnimationFrame(frame.current);
		frame.current = undefined;
		setPlaying(false);
	}, []);

	const play = useCallback(
		(from = 0) => {
			stop();
			offset.current = from;
			startedAt.current = performance.now();
			setPlaying(true);
			const tick = (now: number) => {
				const next = offset.current + (now - startedAt.current) / 1000;
				if (next >= durationS) {
					setT(durationS);
					stop();
					return;
				}
				setT(next);
				frame.current = requestAnimationFrame(tick);
			};
			frame.current = requestAnimationFrame(tick);
		},
		[durationS, stop],
	);

	const skip = useCallback(() => {
		stop();
		setT(durationS);
	}, [durationS, stop]);

	const reset = useCallback(() => {
		stop();
		setT(0);
	}, [stop]);

	useEffect(() => stop, [stop]);

	return { t, playing, play, skip, reset };
}
