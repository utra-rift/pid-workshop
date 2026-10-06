// The files around the student's controller.py. Shared by the runtime,
// the language server and the editor.

/** The helpers students import with `from robot import plot, clamp`. */
export const ROBOT_PY = `"""Helpers for your controller."""

import _robot_bridge


def plot(name: str, value: float) -> None:
    """Adds a line called \`name\` to the response graph."""
    _robot_bridge.plot(str(name), float(value))


def clamp(x: float, lo: float, hi: float) -> float:
    """Returns x limited to the range lo..hi."""
    return max(lo, min(hi, x))
`;

/** Type stubs for the language server. Same API as ROBOT_PY. */
export const ROBOT_PYI = `"""Helpers for your controller."""

def plot(name: str, value: float) -> None:
    """Adds a line called \`name\` to the response graph."""

def clamp(x: float, lo: float, hi: float) -> float:
    """Returns x limited to the range lo..hi."""
`;
