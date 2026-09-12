# Rolin AI Lab Design System

Fuel-inspired editorial maker portfolio: portrait-led opening, oversized identity, white archives, black lab band and footer. Content remains real; reference structure does not justify fabricated testimonials or metrics.

## Tokens

Source of truth: `src/styles/global.css`.

| System | Values |
| --- | --- |
| Color | Paper #ffffff; ink #151515; muted #727272; line #e1e1e1; accent #e54722; dark band #121212 |
| Font | Helvetica Neue / PingFang SC / Microsoft YaHei / sans-serif; Arial Black for wordmarks |
| Display / H1 | Brand wordmark 180 px desktop / 68 px mobile, with explicit breakpoint overrides |
| H2 | Editorial copy 62 px desktop / 30–36 px mobile; compact headings use smaller sizes |
| H3 | Content-specific 18–40 px; archive names 18–20 px / 17 px mobile |
| Body | Default 16 px, line-height 1.5; dense descriptions 13–14 px |
| Small / Metadata | 10–12 px; letter spacing always zero |
| Spacing | 8, 16, 24, 40, 72, 112 px; mobile section spacing 48 / 72 px |
| Radius / Shadow | 4 px; 0 16px 60px #0002 for raised tools only |
| Container / Grid | 1600 px max; 36 px desktop gutters, 20 px mobile; three-column selected area, structured archive rows, mobile single-column works |
| Motion | fast 160 ms; normal 280 ms; slow 560 ms; cubic-bezier(.22,1,.36,1) |

## Components

- Project family shares data and actions. Type metadata and composition distinguish entries; large selected covers differ from compact archive rows.
- Actions use underlined text-and-arrow links. Tool controls have accessible names and visible focus.
- Filters use underline tabs and `aria-pressed`; search updates an announced result count.
- Unknown state is omitted, not misclassified as Idea. Versions and dates require confirmed values.
- Native dialogs provide modal focus behavior; closing restores focus and synchronizes the URL.

## Motion

Entrance uses slow once. Hover, filtering and detail transitions use normal; closing uses fast.
The ticker takes 30 seconds per traversal and pauses offscreen or on hover. Liquid and scrolling respond to live input, not independent decorative loops.
Global pause and `prefers-reduced-motion` stop automatic effects. Touch devices omit liquid distortion; mobile cards use ordinary flow.

## Maintenance

The local Studio uses a separate operational surface: compact system typography, white/gray unframed panels, restrained vermilion accents, 4 px controls and 160 ms feedback. Do not bring the public homepage's oversized headings or motion into the editor. Public content lives in `src/data/content.json`; local downloads live outside the build in `.studio/`.

Add real works to the existing data file. Avoid new dependencies or components for each entry. Preserve fixed media ratios, accessible controls and factual content. Validate long names and replacement images at desktop, tablet and mobile widths.
