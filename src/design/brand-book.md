RIFT is the University of Toronto Robotics Association (UTRA) team competing in the ARC Championships: robots that fire paintball-style projectiles at each other in an arena. The identity is a torn four-point spark on navy and ice, wide geometric capitals, and hard edges. It should feel like an arena at night: dark ground, one bright shape, very few words.

## Content fundamentals

- **Say less, in capitals.** Headlines are one to three words in `display-xl` or `display-lg`, always uppercase: `RIFT`, `KICKOFF`. Event details stack underneath in `display-sm`, one fact per line: `BA1130`, `OCT 2 | 7-8 PM`.
- **Use a pipe, not a dash, to join facts** on one line (`OCT 2 | 7-8 PM`). Times use a plain hyphen for ranges.
- **Taglines are blunt and concrete.** "PAINTBALL FOR ROBOTS" beats any description of "competitive robotics". Set them in `label`.
- **Body copy is plain and direct.** Sentence case in `body`, second person ("You'll drive the robot you build"). No emoji, no exclamation marks in headlines.
- **Names:** the team is `RIFT` (always caps). The competition is the `ARC Championships`. The parent club is `UTRA`. The social handle is `@utra_rift`, set in `data`.
- Room codes, specs and handles go in `data` (mono): `BA1130`, `24V`, `@utra_rift`.

## Visual foundations

**Colour.** Four brand colours, used in this order of weight:

1. `navy` is the identity. Headlines and body text in light (`ink`), big panels (`surface-brand`), the primary button.
2. `ice` is the light ground (`surface` in light). White (`surface-raised`) is only for cards on top of it.
3. `cyan` is the accent for fills: the accent button, highlight blocks, the first chart series. Never set small cyan type on light grounds; use `cyan-text`.
4. `violet` is the rare second accent: focus rings (`focus`), one graphic shape, a `violet` tag. Keep it under 10% of any layout. Small violet text uses `violet-text`.

Text pairs: `ink` or `ink-muted` on `surface` / `surface-raised`; `on-navy` on `surface-brand`; `on-cyan` on `cyan`. `on-violet` (white) on `violet` is only 4.2:1, so a violet fill carries only large or bold 19px+ text.

**Arena (dark) theme.** Posters and screens at events run dark. `surface` becomes a navy-black (`#07101F`), `ink` becomes ice, and cyan works as text. Prefer this theme for anything projected, printed as a poster, or posted to social.

**Type.** `display` is Lexend Giga, a wide geometric sans that stands in for the poster headline face; always uppercase, weight 500 to 600. `sans` (Lexend) carries everything else. `mono` (JetBrains Mono) is for data. Do not mix in other faces.

**Shape.** Sharp by default: `radius-none` for panels and bands, `radius-sm` for buttons, `radius-md` for cards, `radius-pill` for tags only. No soft, bubbly corners.

**Spacing.** A 4px base: `space-1` to `space-16`. Cards pad `space-6`; sections sit `space-12` apart; posters keep `space-16` margins.

**Depth.** Flat. Cards use `shadow-card` in light and just `surface-raised` in dark. The one effect is `glow-spark`, a soft halo behind the mark or a hero object on dark grounds, borrowed from the logo artboard. Once per view.

**Focus.** Every interactive element gets a 2px solid `focus` ring with 2px offset.

**Imagery.** Real hardware on dark: rendered parts (motors, boards, omni wheels) floating around the spark, or arena photography with red and blue LEDs. Keep backgrounds near-black so the mark and the LEDs carry the colour. No stock photos, no illustrations of people.

## Logos

- `rift-mark.svg` (black) and `rift-mark-white.svg` (white) are the spark alone. Use the white mark on `navy`, `surface-brand` or dark photos; the black mark on `ice` or white.
- `rift-mark-on-navy.svg` is the square lockup with the navy field and white glow, for avatars and app icons.
- `rift-wordmark.svg` / `rift-wordmark-white.svg` spell RIFT with the spark as the I. Use it when the name must read; use the mark alone at 48px and below.
- Keep clear space of at least the height of the wordmark's letters on every side. Never recolour the mark into cyan or violet, stretch it, or add effects beyond `glow-spark`.

## Iconography

There is no icon set yet. Use simple 1.5px-stroke line icons in `ink` or `on-navy` when needed, and keep them rare. The spark itself is not an icon; do not shrink it into UI chrome.

## Components

`Button` (primary, accent, outline), `Tag` (neutral, cyan, violet) and `Card` (eyebrow, title, body, meta). Namespace `Rift`.
