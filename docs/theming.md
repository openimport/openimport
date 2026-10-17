---
title: Theming
description: Colours, corners, dark mode and translations.
---

## Theme prop

```tsx
<Importer importer={importer} theme={{ accent: '#0ea5e9', radius: 0, colorScheme: 'auto' }} />
```

`colorScheme` is `light`, `dark` or `auto`. `radius: 0` makes everything square, including badges.

---

## CSS variables

Everything is a `--oi-*` variable on `.oi-theme`:

```css
.oi-theme {
  --oi-accent: #e11d48;
  --oi-radius: 4px;
  --oi-bg: #fffdf8;
  --oi-border: #ece6da;
}
```

All classes start with `oi-`. The stylesheet is plain CSS, with no Tailwind or CSS-in-JS.

---

## Using your shadcn/ui theme

Point the importer at your design tokens and it follows your theme, accent and dark mode:

```css title="globals.css"
.oi-theme[data-theme] {
  --oi-font: var(--font-sans);
  --oi-radius: var(--radius);
  --oi-accent: var(--primary);
  --oi-accent-fg: var(--primary-foreground);
  --oi-bg: var(--background);
  --oi-bg-muted: var(--muted);
  --oi-border: var(--border);
  --oi-text: var(--foreground);
  --oi-text-muted: var(--muted-foreground);
  --oi-danger: var(--destructive);
}
```

Load it after `@openimport/ui/styles.css`.

---

## Translations

```tsx
<Importer importer={importer} locale="de" />
<Importer importer={importer} messages={{ review: { submit: 'Create {count} customers' } }} />
```

English and German are included. Pass a full messages object as `locale` to add a language.
