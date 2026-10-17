# Design

`playground.pen` is the [pen.dev](https://pen.dev) source for the playground and the sharp importer look. Open it in the Pen app.

- **Design system:** a shadcn/ui component kit with `--radius: 0`, the zinc palette, Geist / Geist Mono and a monochrome "Mono" accent. Tokens are themed on two axes: `Mode` (Light / Dark) and `Accent`.
- **Screens:** `Playground · Light` and `Playground · Dark` come from the same tokens; only the frame's theme differs. `Landing · Dark` is a snapshot of the landing page imported from the running site (`apps/web`, 960 px wide), so the code is the source of truth for it.
- **Implementation:** `apps/web` uses the same tokens in `src/index.css` (shadcn/ui on Tailwind v4). The importer inherits them through the `--oi-*` bridge at the bottom of that file.
