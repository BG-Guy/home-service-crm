# Design system: modern refresh (v2)

The look and motion rules for every screen. Tokens live in `src/app/globals.css`; components in
`src/ui/components/`; motion in `src/ui/motion/` and the view-transition block of `globals.css`.
This document wins over SPEC §12 and over older styling in the code. CLAUDE.md §8 lists the
components.

**Direction:** a modern service app in the spirit of Uber, Airbnb and current iOS. Calm
surfaces, bold hierarchy, one obvious next step, soft cards, fast physical motion. It must stay
the lightest CRM we can ship. **Speed is the first design constraint.** A pretty animation that
costs a frame on tap, or a kilobyte of shell JS, is a bug.

## 1. Principles

1. **One primary action per view.** Only one filled accent button is visible at a time (the next
   step). Everything else is secondary (neutral fill), tinted (accent text on a light accent
   wash) or plain text. Destructive actions are red text; a red fill is only for the confirm step.
2. **Hierarchy from type, not boxes.** Content pages use bold sentence-case section titles
   ("Current job", "Today's route"), never small gray UPPERCASE labels. Settings and forms use a
   quieter small header (15/600, secondary color, sentence case).
3. **Calm surfaces.** Light gray canvas, white cards with a soft shadow and a large radius, no
   heavy borders. Dark mode is true black with raised gray cards and hairlines instead of shadows.
4. **The next step is a hero.** Like Uber's trip card: the current or next thing (job, lead,
   payment) gets a large card with its status, the key facts and its one primary action.
5. **Instant feedback.** Every tappable thing reacts in the same frame: a press scale and dim done
   in CSS. Buttons show an inline spinner and keep their width. Skeletons have the shape of the
   real content. Optimistic UI where an action is reversible.
6. **Motion explains, then gets out of the way.** Short spring motion on transform and opacity
   only. Sheets slide up, pop-ups grow from their trigger, pages push, and shared elements morph
   from list to detail. Nothing over 480 ms on a frequent action. Reduced motion means fades only.
7. **Glanceable status.** Soft tinted status pills, a pulsing dot only for live states (en route,
   in progress, live map), and progress rings and timelines for multi-step work.

## 2. Speed rules (hard)

- **No new dependencies. No web fonts** (system font stack only). No decorative images; use CSS
  gradients or small inline SVG.
- **CSS first.** Use `@starting-style`, `transition-behavior: allow-discrete`, keyframes and the
  View Transitions API through React `<ViewTransition>`. JS motion is allowed only in code that is
  already lazy (the sheet drag uses `src/ui/motion/spring-driver.ts`; `motion/react-m` only inside
  a lazy chunk wrapped in `MotionProvider`).
- **Animate only `transform`, `opacity`** (and `filter` or `clip-path` sparingly). Never animate
  width, height, top, left or margin, except the `grid-template-rows: 0fr → 1fr` disclosure trick.
  Add `will-change` only while animating.
- **Budgets.**
  - Shell JS must not grow. It's 149.9 KB gz against 150, so recover headroom where you can.
  - Route JS must not grow on any route you touch. Move toward ≤ 30 KB by lazy-loading sheets and
    dialogs behind first open (`src/ui/components/lazy.tsx`).
  - The CSS total stays ≤ 25 KB gz, so the redesign may add about 4 KB gz.
- **One-off values go in inline `style`.** A value a component computes per instance (a kind
  color tint, a muted avatar, a pin shadow) goes in `style` (a property or a CSS variable), not an
  arbitrary Tailwind class: every arbitrary class lands in the one global stylesheet and counts
  against its ≤ 25 KB gz budget.
- **No layout shift.** Entry animations use transform and opacity only. Skeletons reserve the
  final size.
- **Never fade first-paint content in from opacity 0.** Chrome then records no FCP or LCP; this
  happened on the old /login, and real-user metrics see the same gap. Entry motion for content
  that can be above the fold on first load is transform only (rise 8 px), or starts at
  opacity ≥ 0.5. Overlays (sheets, menus, toasts, alerts) and content inserted after load may
  fade from 0.
- Lists over about 30 rows get `content-visibility: auto` with a `contain-intrinsic-size`.
- Navigation starts on tap. Keep `<Link>` prefetch on, and no blocking work in click handlers;
  wrap state updates in `startTransition` where a render is heavy.

## 3. Tokens

All names are CSS custom properties on `:root`, mapped to Tailwind utilities in `@theme inline`.
Existing names stay (`--bg`, `--card`, `--card-2`, `--fill`, `--fill-2`, `--label`, `--label-2`,
`--label-3`, `--sep`, `--bar`, `--scrim`, `--accent`, `--accent-text`, `--on-accent`, `--sys-*`),
so the whole app picks up the new values without edits.

### Color

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f5f5f7` | `#000` | page canvas |
| `--card` | `#fff` | `#1c1c1e` | cards, sheets, grouped lists |
| `--card-2` | `#f2f2f5` | `#2c2c2e` | surfaces nested in a card, input fill |
| `--fill` | `rgb(118 118 128 / .14)` | `rgb(118 118 128 / .30)` | secondary buttons, chips, segmented track |
| `--fill-2` | `rgb(118 118 128 / .08)` | `rgb(118 118 128 / .18)` | hover, quiet fills |
| `--label` | `#111113` | `#f5f5f7` | primary text |
| `--label-2` | `#6e6e73` | `#a1a1a6` | secondary text (meets AA on cards) |
| `--label-3` | `#a1a1a6` | `#6e6e73` | placeholders, disabled, tertiary |
| `--sep` | `rgb(0 0 0 / .08)` | `rgb(255 255 255 / .10)` | separators |
| `--hairline` (new) | `rgb(0 0 0 / .06)` | `rgb(255 255 255 / .08)` | card edge (dark mode, floating bars) |
| `--field` (new) | `rgb(118 118 128 / .10)` | `rgb(118 118 128 / .20)` | input fill: equals `--card-2` on a card and stays visible on the canvas and in sheets |
| `--danger-text` (new) | `#d70015` | `#ff7c75` | red text (destructive, errors), AA; `text-danger` |
| `--bar` | `rgb(255 255 255 / .72)` | `rgb(28 28 30 / .72)` | glass bars (tab bar, nav bar, popovers) with blur |
| `--scrim` | `rgb(0 0 0 / .40)` | `rgb(0 0 0 / .60)` | sheet and modal backdrop |
| `--accent-fill` (new) | per brand (default `#0074d9`) | same | fills that carry text: primary buttons, selected chips, badges. The accent darkened just enough for white text to reach 4.5:1 (readable in sunlight); `bg-accent-fill` |
| `--danger-fill` (new) | `#df3135` | same | destructive fills with text (confirm buttons); `bg-danger-fill` |

**Rule:** a filled surface with a text label uses the fill token (`bg-accent-fill`, plus
`text-on-accent`). Icon-only fills, tints, rings and indicators use `--accent`.

The brand accent comes from Settings → Branding (`getBrandingStyle()`, contrast-safe). The accent
is for the one primary action, selected states, links and focus rings. A tinted accent surface is
`color-mix(in srgb, var(--accent) var(--tint-a), transparent)` (`--tint-a` is 12%, 16% in dark)
with `--ink-accent` (the accent text mixed 16% / 26% toward `--label`, so it stays AA on the
wash for any brand color).

Status tones (`src/ui/status.ts`, `src/ui/tone.ts`): the pill background is the hue at
`--tint-a`; the text is the tone's `--ink-<tone>` token, a darker shade of the hue in light mode
and a lighter one in dark (AA ≥ 4.5 on the tint; the plain hue fails AA on dark tints).
`toneStyle()` sets `--tone` and `--tone-ink`; a custom color (tag) mixes 50% toward `--label`.
`text-success`, `text-warning` and `text-danger` use the same AA inks; the vivid hues stay in
`--sys-*` for fills and dots.

### Type (system font, `font-feature-settings: "tnum"` on money, times and counts)

| Role | Size / line | Weight | Tracking |
|---|---|---|---|
| Large title (phone page title) | 34 / 40 | 700 | -0.024em |
| Page title (desktop) | 30 / 36 | 700 | -0.02em |
| Title 1 | 28 / 34 | 700 | -0.02em |
| Title 2 (hero card title) | 22 / 28 | 700 | -0.016em |
| Section title (content pages) | 20 / 26 | 700 | -0.012em |
| Headline | 17 / 22 | 600 | -0.01em |
| Body | 17 / 24 | 400 | 0 |
| Callout | 16 / 22 | 400 | 0 |
| Subhead (small section header, meta) | 15 / 20 | 400–600 | 0 |
| Footnote | 13 / 18 | 400 | 0 |
| Caption | 12 / 16 | 500 | 0.01em |

### Shape, space, elevation

- **Radii:** `--radius-control` 12 (inputs, small tiles), `--radius-tile` 16, `--radius-card` 20,
  `--radius-modal` 24 (new, desktop modal), `--radius-sheet` 28 (phone sheet top), `--radius-pill`.
  Buttons and chips are pills.
- **Space:** 4-pt grid. Page gutter 16 (phone) / 24 (≥ 768) / 32 (≥ 1200). Card padding 16 / 20.
  Section gap 28. Row min-height 52 (44 for dense settings rows).
- **Shadows (light):**
  - `--shadow-card`: `0 1px 2px rgb(0 0 0/.04), 0 2px 12px rgb(0 0 0/.04)`
  - `--shadow-raised` (new; hover, dragged, sticky bars): `0 2px 6px rgb(0 0 0/.05), 0 12px 32px rgb(0 0 0/.08)`
  - `--shadow-float` (sheets, popovers, toasts): `0 12px 40px rgb(0 0 0/.16), 0 2px 10px rgb(0 0 0/.06)`

  In dark mode cards use `--hairline` instead of a shadow (`--shadow-card: 0 0 0 1px
  var(--hairline)`; raised adds `0 8px 24px rgb(0 0 0/.5)`), and floats use a deep black shadow
  (`0 16px 48px rgb(0 0 0/.6), 0 2px 10px rgb(0 0 0/.4)`).
- **Glass:** `background: var(--bar)` with `backdrop-filter: saturate(180%) blur(24px)` plus a
  hairline. Fall back to a solid `--card` when `backdrop-filter` isn't supported. Content must
  never show through a bar legibly. Raise opacity or blur rather than accept it.

### Motion tokens

| Token | Value | Use |
|---|---|---|
| `--dur-press` | 120 ms | press-in (scale .97, dim) |
| `--dur-quick` | 220 ms | release, chips, toggles, tab indicator, badge |
| `--dur-snappy` | 320 ms | sheets, popovers, menus, toasts out |
| `--dur-push` | 400 ms | page push / pop, shared-element morph (was 675) |
| `--dur-bouncy` | 480 ms | playful pops: success check, toast in, rating star |
| `--ease-spring` | `linear()` critically damped | pages, sheets |
| `--ease-spring-snappy` | `linear()` stiffer | popovers, chips, indicator |
| `--ease-spring-bouncy` | `linear()` with a small overshoot | pops, toasts, badges |
| `--ease-out` (new) | `cubic-bezier(.2,.8,.2,1)` | fades |

`linear()` curves are sampled springs. `springLinear(bounce)` in `src/ui/motion/easing.ts` samples
the JS driver's own solution (`solveSpring`) over `SETTLE` (1.2) × the spring's Apple duration,
when it is ≥ 99.5 % settled, so one curve fits every `--dur-*`: bounce 0 → `--ease-spring`, 0.15 →
`--ease-spring-snappy`, 0.3 → `--ease-spring-bouncy`. `springs.ts` mirrors them as `EASE` and `DUR`;
`forDuration(ms, bounce)` gives the JS spring of a CSS duration (`spring.sheet` = 320 ms, bounce .05).
`tests/ui/motion-tokens.test.ts` fails when globals.css, `EASE`, `DUR` and the generator disagree.

## 4. Motion catalog

Every named motion has a reduced-motion version (opacity ≤ 150 ms, no transform, no loops).

| Id | What | Spec |
|---|---|---|
| M1 | Page push / pop | 400 ms `--ease-spring`. Incoming page from 100% with a soft left-edge shadow; outgoing page moves -25% and dims to .92. Pop mirrors it. The tab bar stays still. |
| M2 | Tab switch (root pages) | Cross-fade 160 ms, plus new content rising 6 px. No horizontal slide. |
| M3 | Shared-element morph | The list card's title, avatar or status morphs into the detail hero through `<ViewTransition name>`, 400 ms spring. Names must be unique on a page. |
| M4 | Bottom sheet (phone) | Slides up 320 ms spring and the scrim fades in. At the large detent the page behind scales to .94 with rounded top corners and dims (iOS card stack). Drag to dismiss uses velocity. |
| M4d | Modal / drawer (desktop) | Centered modal: scale .96 → 1 plus fade, 220 ms. The `drawer` presentation slides in from the right, 320 ms. |
| M5 | Pop-up menu (context menu, AddMenu, action sheet on desktop) | Grows from the trigger (transform-origin at the trigger): scale .92 → 1 plus fade, 220 ms snappy. Items stagger 12 ms. Glass material. |
| M6 | Alert | Scale 1.08 → 1 plus fade, 220 ms; the scrim fades in. |
| M7 | Toast | Phone: an "island" pill drops from the top (420 ms bouncy) and grows to its width; swipe up to dismiss. Desktop: slides in at the bottom right. Out: rise and fade, 200 ms. |
| M8 | List / card entry | Fade up 8 px, 280 ms, stagger 30 ms (first 10 items only), on top-level pages after a tab switch or first load. Not on pushed pages (M1 already moves them). `.enter-stagger` on the container (children get `--i` 0–9 by position; an inline `--i` wins). It replays when a pop returns to the page (the page remounts), so keep it to tab roots. Not on the LCP element. |
| M9 | Press | `:active` scale .97 plus opacity .9 in 120 ms; spring back in 220 ms. One shared `.pressable` utility. |
| M10 | Success | Checkmark stroke draw 400 ms plus a pop of 1 → 1.12 → 1. |
| M11 | Badge or count change | Pop 1 → 1.25 → 1, 220 ms bouncy, keyed on the value. |
| M12 | Live dot | A pulsing ring, 1.6 s loop, only for live states, at most two per screen. |
| M13 | Skeleton | Shimmer sweep, 1.2 s linear loop, matching content shapes. |
| M14 | Segmented / tab indicator | The thumb slides 220 ms snappy (transform only). |
| M15 | Disclosure | `grid-template-rows: 0fr → 1fr` 280 ms (or `interpolate-size` where supported). |
| M16 | Hover lift (pointer devices only) | Card `translateY(-1px)` plus `--shadow-raised`, 160 ms. |
| M17 | Large title collapse | Existing scroll-driven reveal; keep it. |
| M18 | Field error | Shake ±4 px three times, 240 ms; the error text fades in. |
| M19 | Fullscreen hub | The region grows from its on-screen rect to the viewport (FLIP on `transform`, 320 ms `--ease-spring`) and shrinks back on close. Reduced motion: a 150 ms fade. |

### How the motions are wired

- **M1 / M2:** `<PageTransition>` on every page; links pass `transitionTypes`: `PushLink` /
  `NAV_FORWARD` (push), `BackLink` / `NAV_BACK` (pop), `TabLink` / `NAV_TAB` (tab bar and sidebar
  already do). The entering page gets `push-in` / `pop-in` / `tab-in`, the leaving one `*-out`;
  CSS is the view-transition block of globals.css. Untyped navigations (browser back) don't animate.
- **M3 `<Morph name>`** (`src/ui/motion/Morph.tsx`): wrap the same element on both screens.
  ```tsx
  // list row                                   // detail hero
  <Morph name={`job-${id}-title`}>              <Morph name={`job-${id}-title`}>
    <span className="inline-block">{title}</span>  <h1 className="inline-block">{title}</h1>
  </Morph>                                      </Morph>
  ```
  - One element child; names unique per page (`<kind>-<id>-<part>`).
  - The named element flies on its own layer (z-index above both pages) while the pages slide.
  - It pairs only when the destination renders in the navigation's commit: a router-cache hit
    (pops back to a list, revisits within 30 s), a route without `loading.tsx`, or a link with
    `prefetch`. If the destination shows its skeleton first, nothing pairs and nothing breaks.
- **M4 / M4d:** `Sheet` (below). **M5:** `MenuPopover` (`placeMenu`, shared by AddMenu, the desktop
  ActionSheet and ContextMenu). **M6:** `Alert` / `useConfirm`. **M7:** `toast()`. All CSS except
  the sheet's drag spring (`spring-driver.ts`, already in the sheet's chunk).

## 5. Components (what each looks like)

- **Button:**
  - Variants:
    - `primary`: accent fill with on-accent text, flat or a very subtle 6% vertical gradient
    - `secondary`: `--fill` with `--label`
    - `tinted`: accent wash with accent text
    - `plain`: accent text
    - `destructive`: red text, or a red fill only inside confirms
  - Sizes: sm 34, md 44, lg 52. All pills. Icon gap 8.
  - Press uses M9. Loading shows a spinner and keeps the width. `block` makes it full width.
  - Keep existing props working; new variants are additive.
  - API: `variant="destructive"` is the red fill (the confirm step). Red text elsewhere is the
    `destructive` role prop on any variant (`variant="plain" destructive`, `variant="secondary"
    destructive`). Legacy `filled` = `primary`, `gray` = `secondary`. `loadingText` shows text
    next to the spinner (`SubmitButton pendingLabel`).
- **IconButton:** a 36–44 circle with a `--fill` background or transparent, and `hit-44`.
- **Card surface (`Card`):** `--card`, `--radius-card`, `--shadow-card` (hairline in dark),
  padding 16/20. Tappable cards (`href`, `onClick`) get `.pressable`, plus `.hover-lift` on desktop.
- **List / ListSection / ListRow:**
  - Inset grouped cards with radius 20.
  - Rows have min-height 52. Leading icon is a 30–32 rounded-square tinted tile or an avatar.
    Separators are inset to the text. The chevron uses `--label-3`.
  - `ListSection` gains a header `variant`:
    - `title`: 20/700 sentence case with an optional trailing action link ("See all"); for content pages
    - `caption` (default): 15/600 `--label-2`, sentence case; for settings and forms
  - UPPERCASE headers go away everywhere.
- **Section header (`SectionHeader` in `List.tsx`):** the same as the `title` variant, usable
  without a list.
- **StatusPill:** soft tint, 13/600, leading 6 px dot. Live states use the M12 pulse.
- **Badge (count):** red or accent pill, 12/700, M11 pop on change (`pop`; use it on counts
  that persist across navigations, since every mount pops).
- **Chip and filter row:** pill chips 34 high. Unselected: `--card` with a hairline. Selected:
  `--label` fill with `--bg`-colored text (Uber/Airbnb). A row of chips scrolls horizontally with
  scroll-snap and edge-fade masks; it can be sticky under the nav bar (`ChipRow sticky`).
- **SegmentedControl:** a `--fill` track with a white (dark: `#636366`) thumb that slides with M14.
- **SearchField:** a pill 44 high, `--card-2` (on cards) or `--card` (on canvas), leading
  magnifier. On list pages it's sticky with `--shadow-raised` once scrolled.
- **Fields:** height 48, radius 12, `--field` fill (= `--card-2` on a card) with no border. The label sits above (13/600
  `--label-2`). Focus shows a 2 px accent ring with a soft glow. Errors show red text and the M18
  shake.
- **StatCard:**
  - Label 13/500 `--label-2`; value 28 (`size="sm"` 22) bold tabular.
  - An optional delta chip (green/red tint) and sparkline. Card radius 20.
  - Money never truncates.
- **EmptyState:** a 56 px icon in a soft accent-tinted circle, a 20/700 title, `--label-2` body,
  and one primary or secondary button.
- **Skeleton:** M13 shimmer; it mirrors the real layout.
- **Avatar:** initials on a soft two-stop gradient of the person's color, an optional presence
  ring (clocked in or live).
- **TechCard:** Uber driver card. Avatar 48, name, vehicle, status, ETA, and call/text icon
  buttons.
- **Timeline:** Uber trip progress (`TripTimeline` in `Timeline.tsx`; `Timeline` stays the
  activity feed). A vertical line with dots: done (filled), current (accent with M12), upcoming
  (hollow), with times on the left.
- **TabBar (phone):**
  - A floating glass capsule with a hairline and `--shadow-float`.
  - The active tab gets an accent icon and label on a pill highlight that slides between tabs (M14).
  - The icon does a small bounce on tap.
  - Content underneath must not be legible through it.
- **NavBar / large title:** glass when scrolled, with a hairline once content passes under it.
  Large title collapses (M17).
- **Sidebar (desktop):**
  - 256 wide, sits on `--bg`. Items 36 high, radius 10.
  - Active item: `--card` with `--shadow-card`, accent icon, `--label` text. No solid accent bar.
  - Section labels 12/600 `--label-3`. Count badges right-aligned.
- **Sheet:** M4 / M4d. Grabber, a title row with Cancel/Done, a sticky footer for the primary
  action. Desktop default is a centered modal; `presentation="drawer"` is for long forms.
  - New props: `presentation?: "modal" | "drawer"` (desktop = ≥ 768 px or a fine pointer;
    `desktop="panel"` still works and means `drawer`), `footer?: ReactNode` (sticky, above the safe
    area and keyboard; put the one primary `Button block` there). Every other prop is unchanged.
  - Phone, large detent: `<html data-sheet-stack>` scales `.shell-stage` (banner + main) to .94.
    Fixed elements inside a page move with that layer while it's scaled, so pages use `BottomBar`
    (sticky), not `position: fixed`, for their docks.
- **ActionSheet, ContextMenu, AddMenu:** M5 glass pop-ups. AddMenu pops from its button on
  phones too (iOS pull-down menu); the ActionSheet pops from whatever opened it on desktop (no
  anchor prop needed) and stays a bottom sheet on phone. APIs unchanged. The app header no
  longer has a "+" menu: it shows named create buttons (§6), and AddMenu stays in the kit.
- **Alert:** M6. 300 wide, radius 20, glass, pill buttons: cancel neutral, the preferred action
  `--accent-fill`, destructive `--danger-fill` (only in confirms).
- **Toast:** M7, with icon and text; an action link is optional. Phone: black island at the top;
  desktop: glass card bottom right. `toast()` API unchanged. `undo` adds an Undo button and keeps
  the toast up 5 s. A toast can't show over a modal Sheet: the sheet is a `<dialog>` in the top
  layer, and the toast host joins the top layer only while a FullscreenHub is open. A change
  made inside a modal sheet shows its Undo in the sheet instead (§6 "Action groups and Undo").
- **Bottom action bar ("booking bar", Airbnb):** sticky at the bottom on phone. A summary on the
  left (amount, "3 to do"), the one primary action on the right, glass, safe-area aware. Used by
  the job dock, estimate approval, pay page and long forms. On desktop it becomes the sticky
  right-rail card. It never floats over content mid-page.
  ```tsx
  import { BarSummary, BottomBar } from "@/ui/components/BottomBar";
  <BottomBar
    summary={<BarSummary title="$334.54" subtitle="Balance due" />}  // left: title + optional line
    action={<Button size="lg">Collect</Button>}                      // right: the one primary action
    secondary={<IconButton …/>}                                      // optional, before the action
    edge                       // optional: full-bleed edge bar (public pages, direct child of <Page>)
    label="Job actions" />     // region name (default "Actions")
  ```
  - `position: sticky`: render it LAST in the page content (inside `<Page>`) or pass it as
    `DetailLayout bar`. In the app it floats 16 px above the tab bar; elsewhere it sits on the
    bottom edge, safe-area aware. Server Component, no JS.
  - While one is on screen the root sets `--bottombar-h` (84 px; 0 in the desktop rail) so fixed
    overlays (sync capsule, FAB, desktop toasts) lift above it.
- **Calendar** (`Calendar.tsx`, client; Airbnb-style availability picker). No screen uses it since
  the leads flow redesign (booking picks the day on a week strip, §6); it stays in the kit:
  ```tsx
  <Calendar from={today} to={addDays(today, 59)} today={today} selected={day} onSelect={setDay}
    getDay={(k) => ({ status: "best" | "open" | "limited" | "full", hint: "4 windows open" })}
    onPreview={prefetchDay} />
  <CalendarLegend />
  ```
  - Phone (< 768): every month in the range scrolls vertically under a sticky weekday header
    (`.cal-weekdays`, pinned under the nav bar). ≥ 768: two months side by side, prev/next.
  - Day cell: 44 px circle (40 on desktop). `best` = accent dot + "Best" (10/700 accent ink),
    `open` = green dot, `limited` = amber ring (a ring, so it never reads as an orange brand
    accent), `full` = `--label-3` struck through. Past days and days outside the range are
    `--label-3`. Today has a 1.5 px `--label` ring; selected is the filled `--label` circle
    with `--bg` text (Airbnb). No accent fill, so the page's one primary stays the only one.
  - A11y: `role="grid"` per month, each day a button with `role="gridcell"`, `aria-selected`,
    `aria-disabled` (still focusable). Roving tabindex: arrows, Home/End (week), PageUp/PageDown
    (month); focus crosses months and turns the desktop page.
- **DetailLayout** (`AppShell.tsx`):
  ```tsx
  import { DetailLayout, Page } from "@/ui/components/AppShell";
  <Page className="pt-4">
    <DetailLayout
      rail={<><StatusCard /><MoneyCard /><TechCard … /></>}  // desktop sticky rail cards
      bar={<BottomBar … />}       // phone: sticky bottom bar, last; desktop: first rail card
      railOnPhone="stack"         // "stack" (default): rail cards after main on phone; "hide"
      railLabel="Summary">        // <aside> name
      <Hero /><Tabs />            // main column: a flex column with --section-gap
    </DetailLayout>
  </Page>
  ```
  ≥ 1200 px: `minmax(0,1fr) 360px`, rail sticky under the nav bar (scrolls inside if taller than
  the screen). Below: one column, order main → rail cards → bar. Server Component, no JS.
  `DetailLoading rail` gives its skeleton the same two columns.

## 6. Layout patterns

- **Phone header:** large title (greeting on Today), date or subtitle in `--label-2`, and the
  trailing actions in the nav bar: the named create buttons (below), search and the bell.
- **Named create buttons** (`HeaderActions` → `CreateButtons`, `src/app/(app)/_components/`): no
  "+" menu. Every top-level page gets **New lead, New job, New customer** (each by permission and
  flag), then search and the bell.
  - **Phones (< 768 px):** small labeled icons, 44 px targets: a 20 px icon over a 10/500 label in
    the accent ink (9 px under 380 px).
  - **Tablet and desktop:** named pills (`btn-sm`). The page's main one is `primary`, the others
    are white pills (`bg-card shadow-card`). Inside a narrow list pane (`[data-pane]`, SplitView's
    360 px column at ≥ 1024 px) they fall back to the labeled icons.
  - **Order:** the page's own item first: New lead on /leads; New job on /jobs, /schedule and
    /today; New customer on /customers and customer pages. A page with a create action of its
    own passes it, and it goes before all of them: `<HeaderActions own="estimate" | "receipt" |
    "tool" | "vehicle" />`. `create={false}` leaves the buttons out.
  - **Accent pill** only on the item's own list page (`/leads`, `/jobs`, `/schedule`,
    `/customers`, an `own` page), never on Today or a detail screen, so a view keeps one primary.
  - A `?new=` link to the page you're on (Upload receipt on /parts, New tool on /tools) only sets
    the param with `history.replaceState`, so the page's sheet opens with no server round trip.
- **Hero card:** status pill (live dot), Title 2, two lines of key facts, then one primary button.
  Secondary actions are round icon buttons (call, text, navigate) in `--fill`.
- **Summary strip:** horizontally scrolling stat tiles on phone; a four-column stat row on desktop.
- **Grouped day lists:** sticky day headers ("Today", "Tomorrow", "Mon, Oct 20") over cards or
  rows.
- **List row (rich):** bold title, a meta line in `--label-2`, and on the right a status pill or
  tabular amount; avatar or icon on the left; swipe actions on phone.
- **Detail page (desktop ≥ 1200):** two columns, `minmax(0,1fr) 360px`. Main content (tabs) on the
  left; a sticky right rail with status, next action, money summary and people. On phone the rail
  content becomes the hero card plus the bottom action bar.
- **Tabs inside a page:** a sticky segmented or underline tab row with a sliding indicator (M14).
- **Empty, loading and error:** EmptyState, a Skeleton that mirrors the layout, and a Banner with
  a retry button.
- **Lead box and grid** (`LeadBox`, `LeadsGrid` in `src/features/leads/components/`): the leads
  inbox is a grid of boxes, not rows.
  - **Columns:** phones show 1 or 2 columns, 2 by default. The 1 / 2 switch (kit
    `SegmentedControl` with row and grid icons) sits on the count line, phones only, and is kept
    in the `leads-cols` cookie (`components/inbox-prefs.ts`, the same pattern as
    `src/lib/theme.ts`), so the server renders the picked grid with no flash. From 768 px:
    `repeat(auto-fill, minmax(232px, 1fr))` (340 px boxes in 1-column mode). From 1024 px the
    lead map takes a sticky right column (`minmax(340px, 40%)`) beside the grid.
  - **The box:** a card surface (`--card`, radius 20, `.hover-lift`) that grows to its row. Top:
    the avatar inside the SLA ring (`SlaAvatar`: 46 px in 1 column, 38 in 2, where a new lead's
    wait shows in a tag under it), the name, then the job · status line and the street in
    `--label-2` (the 1-column box adds "Wants <day>"). Bottom: the action row.
  - **Actions by state:** open = Call (the accent circle), Text, Directions, Open card (tinted,
    Maximize2): `RoundAction`s (44 px circle + label) in 1 column, 36 px icon buttons in 2.
    Check = Looks legit and Spam; lost = Reopen; spam = Not spam; booked = Open job. A closed lead
    always keeps its way back on the box.
  - **Tap:** the whole box is one button, so a tap anywhere opens the lead card; the action
    buttons sit above it. The box's main button (the name) carries the kit utility `.box-hit`
    (globals.css): its `::after` covers the nearest positioned ancestor (radius
    `--radius-card`), and its 2 px accent focus ring follows the box. Reuse it for any card that
    is one big tap target. Selected (its card is open, or its pin
    is picked on the map) = a 2 px accent ring. Swipe left on an open lead = Lost (gray) and Spam (red), each with Undo.
  - **API:** `<LeadBox lead={LeadBoxData} layout="grid1" | "grid2" | "drawer" selected? onOpen />`.
    Use it wherever leads show as boxes (the map drawer does).
- **Lead card (sheet)** (`LeadCardProvider` / `useLeadCard()` from `components/lead-env.ts`, the
  lazy `LeadCardSheet`): opening a lead slides its card up instead of pushing a page.
  - The kit Sheet with only the large detent: a bottom sheet on phones (drag down or ✕; the page
    steps back behind it, M4), the centered modal on tablet and desktop (M4d).
  - `useLeadCard().open(id)` from a box or a pin pushes `?lead=<id>` (`history.pushState`), so
    Back closes the card, and a link or a reload with `?lead=` opens it.
    `prefetch(id)` warms it on press or after a 250 ms hover; `seed(boxes)` lets it show the box's
    TL;DR at once while `loadLeadCard` fills in the rest.
  - Layout: the TL;DR (name, status, job type, street, the arrival window or asked-for day), info
    boxes (Phone, Address with a tile mini map, Wants or Arrives, Quote & source, Last contact,
    Notes, Photos), the action groups, and the booking bar as the sheet's sticky `footer` with
    Book as the one primary. `/leads/[id]` renders the same `LeadCardBody` with a `BottomBar`.
- **Action groups and Undo** (`LeadActionGroups`; rules in `src/features/leads/rules.ts`):
  - No "…" menu. Four labeled groups of round actions (`RoundAction`: a 48 px circle with its
    label under it): Reach, Move forward, Manage, Close. Each button is paired with its way back
    (Contacted ↔ Not contacted, Qualify ↔ Unqualify, Claim ↔ Release, Lost ↔ Reopen, Spam ↔ Not
    spam). A step already taken shows its reverse drawn "on": the ink fill (`--label` with
    `--bg` text), like a selected chip.
  - Every change offers Undo. Outside a sheet it rides on the toast (`toast({ undo })`, 5 s).
  - **Inside a modal Sheet, a toast can't show** (the sheet's `<dialog>` is in the top layer, and
    the toast host joins it only while a FullscreenHub is open). So a change made in the sheet
    shows its Undo in the sheet, above its footer: a dark island bar with an Undo pill (5 s with
    Undo, 3 s without). If the sheet closes while it shows, it moves to a normal toast. Use the
    same pattern in any modal sheet that needs Undo, until the kit raises the toast host over
    sheets.
- **Job type picker** (`JobTypePicker` in `src/features/jobs/components/`; values in
  `job-type-choice.ts`, rows from `listServiceTypeOptions()`):
  - The three kinds as radio cards (Free estimate, Service call, Project): a kind tile (the icon on
    a 16% wash of the kind color), the label, a hint with the visit length, and the price on the
    right ("Free", "From $125", "Quote"). Picked = a 2 px inset accent ring, no fill, so the page's
    primary stays the only one.
  - "What's the job?" chips (kit `Chip`, ink when selected) under the picked card: the trade's jobs
    plus Other. A job with the ownership check adds a ⚖️ line, "<Job> keeps the ID and ownership
    check".
  - `variant="cards"`: phones stack full-width cards with the chips right under the picked one;
    from 640 px the cards sit three across with the chips below. `variant="tiles"`: three small
    84 px tiles across at every size (the caller form, which has to fit the first screen).
  - Used by the caller form, the booking What step and New job.
- **Booking: week strip and arrival windows** (`src/features/leads/components/booking/`):
  - Steps Who · What · When at the top (`BookingSteps`; done steps link back).
  - **Week strip** (`WeekStrip`): one row of 54 × 76 day cards from today that a thumb swipes
    (scroll-snap), with the Calendar's dot language (best = accent dot, open = green, limited =
    amber ring, full = struck through). Selected = the ink fill (`--label`, `--bg` text). The
    asked-for day carries a small "Asked" tag. Closed days are left out, except today and the
    asked-for day.
  - **Windows** (`WindowGrid`): the day's 2-hour windows as radio cards, 2 across on phones and 4
    from 640 px: "Arrives" over "8–10 AM"; the open window with the least extra driving says "Best
    · adds 2 mi" in accent ink; after-hours windows say so; full ones are struck through. A day
    with nothing open says why in plain words, with the soonest open day and "Book by hand on New
    job".
  - **Booking bar:** "Fri · arrives 8–10 AM" / "Service call · Rekey · no tech yet" + Book. Desktop:
    `DetailLayout` with the booking bar as the first rail card and a lead card (phone, address,
    asked for, Edit details) under it.
  - The focused field never hides under the sticky bars: `keep-focus-visible.ts` scrolls it clear
    of the bottom bar, tab bar and nav bar, also while the keyboard resizes the visual viewport.
- **Lead map** (`src/features/leads/components/map/`: `LazyLeadsMap` loads `LeadsMap` as its own
  chunk, and the Leaflet `LeadsMapCanvas` is a second one):
  - `layout="panel"`: the desktop column beside the grid (≥ 1024 px, sticky, screen height).
    `layout="phone"`: phones and tablets in Map mode. The map fills the screen under the header,
    full bleed, down under the tab bar, and the page doesn't scroll.
  - **Drawer (phone):** the count line, chips and boxes (`LeadBox layout="drawer"`) ride in a
    drawer over the map with three detents, peek / half / full (`drawer.ts`: transform only, flick
    projection, rubber band; the handle is a button: a tap cycles, arrow keys step). It opens at
    half. The Grid / Map pill rides on the drawer's top edge (at full height it sits just above
    the tab bar); in Grid mode the same dark pill floats above the tab bar.
  - **Full screen:** the kit FullscreenHub (`historyKey="leads-map"`, `chrome="minimal"`, its own
    corner button). Dragging the drawer down past peek opens it too: the drawer slides away and a
    dark "Show N leads" pill (spring) brings it back; Back, Esc or ✕ exit. A pin tapped there
    opens the lead card above the map, and Back closes the card first.
  - **Pins** (40 px): the initials inside the SLA ring (green < 5 min, amber < 15, red after;
    frozen at the first response) in the box's avatar color. The two newest unanswered leads still
    inside the 15-minute ring pulse (M12). Overlapping pins fold to 22 px dots
    (`src/lib/declutter.ts`), and below zoom 9 every pin is a dot. Pins at one address fan out
    44 px. Selected (the open card, else the last pin tapped) = 1.2× with an accent halo and a
    name tag on the first free side (`placeLabels`); hover shows the tag too.
  - **Today's jobs:** 18 px dark squares with a briefcase under the pins (live = a green dot, done
    = muted), the label in a tooltip. The map frames the leads, plus the jobs when there are fewer
    than two leads.
  - Notes on the map, in plain words: "4 of 6 leads on the map" (tap for why) and "Street map is
    off. Set it up".
- **Route map markers** (schedule map, `jobs/schedule-map/components/marker-css.ts`):
  - A stop is a **window box** in the tech's color: a card-colored box with a 2 px ring in the
    tech color and a tail to the point. Line 1 is "1 · 8–10" (stop number, compact window, 12/700
    tabular), line 2 the customer's short name ("Dana W.", 11/500 `--label-2`).
  - States: done = muted fill, `--label-2` text and a check; live (on the way, arrived, in
    progress) = the M12 ring pulse around the box or dot, at most two on screen; late (window
    passed, nobody arrived) = a `--sys-red` ring plus a small red "Late" tag (a tech color may
    itself be red); unassigned = a dashed gray box with no number. Selected = a thicker ring
    and a soft halo in the tech color; hover = a lighter halo.
  - **Declutter:** below zoom 10, or where a box would overlap another box, cover another dot
    or a home pin, or be cut by the map edge, the box folds to a numbered dot (22 px, the tech
    color, white 2 px ring). Hover, the timeline, or selection expands one box.
  - Routes: a 3.5 px line in the tech color over a 7 px `--card` casing, a chevron at every
    leg's midpoint; the focused route 6 px; others 25% while a tech is isolated. Drawn by
    the shared `map/route-draw.ts`, so the Assign hub's RouteMap matches. Home bases
    are small rounded squares with a house glyph. Colors come from `techColor` (the board's),
    painted with `style.stroke` so `var(--sys-*)` works on SVG.
  - Selecting a stop pans (never zooms) so it sits in the visible part of the map: beside a
    drawer, above a bottom sheet.
- **Timeline strip** (per-tech Gantt, `DayTimeline`): a card with a sticky label column (dot,
  avatar in the tech color, first name) and one track per tech; hour gridlines from the
  earliest to the latest window ± 1 h; each job a 22 px rounded bar over its window (18% tint
  of the tech color, 1.5 px ring) with the marker's status styles; overlapping windows stack
  in lanes; a 2 px `--sys-red` now-line with a dot on top. A bar shows "1 · 10–12" only when
  the label fits (a container query per bar, never a cut window), else the stop number; hover
  or focus shows a dark pop with the full label and customer. Fits the column on desktop;
  scrolls sideways (56 px per hour) on tablet and phone.

- **Timeline strip, full screen** (`size="lg"`): avatar + first name in a 100 px column in
  portrait (full names at 176 px in landscape); a Fit day / Zoom switch in the top bar (Zoom
  ≈ 4½ hours in view); opens with now 30% from the left. Rows hug their cards (72–88 px a
  lane) and sit together at the top. A bar is a two-line card ("1 · 10–12" / "Jacob W.", at
  most 72 px tall); while any part of a bar is visible its label is pinned beside the name
  column, clipped to the bar (`overflow: clip`) with a short fade, never outside its card.
- **Fullscreen hub (M19)** (`src/ui/components/FullscreenHub.tsx`, kit): full-screen mode for a
  hub region on phones and tablets (and on desktop with `breakpoint="all"`).
  - **How it works:** the region's subtree stays mounted. The hub element moves to the top layer
    (`popover="manual"`), so no transformed or contained ancestor (`.smap`'s
    `container-type`, the `.shell-stage` card stack) can trap it, and Leaflet keeps its
    instance. Opening pushes `?fs=<historyKey>`: back, Esc, the Close button and leaving
    browser full screen all close it, and closing pops that entry (forward reopens it). While
    open: `role="dialog"`, `aria-modal`, the rest of the app `inert` (sheets, being
    `<dialog>`s, stay usable and stack above), focus on Close (back to the trigger after),
    page scroll locked, `html[data-fullscreen]` hides the tab and nav bars. On touch devices
    it also asks for browser full screen and re-shows itself on top when the root joins the
    top layer. Toasts stay above it: the toast host is a `popover` marked `data-fs-top`,
    which the hub raises into the top layer after itself (and leaves out of the inert);
    each new toast raises it again over a sheet opened since. Closing keeps what changed
    inside: URL params written with `replaceState` while `?fs=` was kept (a `?job=` or
    `?tech=` pick) are carried over to the page's entry when the full-screen entry pops,
    by Back, Esc or Close (not when the app dropped `?fs=` on purpose, nor after a jump
    further back). Closing pops only an entry this document pushed (or, per the Navigation
    API, the page's own entry right under it); a `?fs=` that came with the page is
    stripped in place, so closing never leaves the page, and a controlled hub that is closed
    at mount drops a stale `?fs=` itself.
  - **Nested hubs** (a photo or the signature pad inside present mode): a module-level
    stack; only the top hub answers Esc and the browser leaving full screen. The page-wide
    state (`html[data-fullscreen]`, the raised toast host, browser full screen) stays until
    the last hub closes; a hub leaves browser full screen only if it is in it. Hub rules use
    `>` (bar, footer, close, tip, corner), so an outer hub's state never leaks into an inner
    one, and `[data-chrome]` inside an open hub (a BottomBar) stays visible.
  - **Look:** a glass Expand button (Maximize2, `hit-44`) in the region's corner below
    1200 px; a slim glass top bar with the title, an optional subtitle, a `controls` slot
    (wraps under the title below 700 px) and Close (Minimize2); an optional `footer` bar;
    `chrome="minimal"` keeps only a floating close button; `theme="dark"` forces a dark
    surface while open (it redefines the surface and label tokens on the hub and inverts
    Leaflet tiles inside it; the in-page region keeps the app theme); `orientationHint=
    "landscape"` shows a one-time "Rotate for a wider view" pill on phones held upright,
    16 px above the footer (dismissal kept in localStorage under `fs-hint:<historyKey>`).
  - **API:** `title`, `label?`, `subtitle?`, `controls?`, `footer?`, `chrome="bar"|"minimal"`,
    `breakpoint="touch"|"all"`, `trigger="corner"|"none"|(open) => node`, `corner`,
    `open`/`defaultOpen`/`onOpenChange` (controlled or not), `historyKey`, `orientationHint`,
    `lockScroll={true|false|"strict"}` ("strict" also stops overscroll and pull-to-refresh),
    `browserFullscreen` (default: touch devices), `theme`, `onEnter`, `onExit`, `onResize`,
    `className` (the in-page slot), `bodyClassName`, `expandLabel`, `closeLabel`.
    `openFullscreen(historyKey)` opens a mounted hub from anywhere (call it from a tap);
    the kit `FullscreenButton hub="<historyKey>"` is that button for server pages (a
    Button with children, else an IconButton named by `label`).
  - **Bar parts** (reuse them in `controls`): the kit `PeriodStepper` (‹ label ›, 36 px
    plain circles, the label announced) for a day or a week, `ParamPeriodStepper` /
    `ParamSegmented` (`jobs/components/ParamControls`) when the period or view is a search
    param (they drop `?fs=`), and `jobs/components/TechChips bare` (color dot, first name,
    job count; `all` adds "All") for technicians.
  - **Rules:** code that rewrites the URL while it's open keeps `?fs=` (use `replaceState`,
    so back still closes it in one step, and the change survives the close), or drops it on
    purpose (a new day or view: `router.replace` without it; closing then pops nothing).
    A hub whose open state comes from a URL param clears that param in
    `onOpenChange(false)`, or the carry-over keeps it. A Leaflet map inside keeps its size
    with a ResizeObserver (or `onResize`) → `map.invalidateSize()`. Import it only where
    it's used (~4.3 KB gz with its CSS), never in the shell. `.fs-slot{position:relative}`
    sits in `@layer components`, so Tailwind position utilities in `className` win. CSS
    hooks: `.fs-slot`, `.fs-hub[data-fs]`, `.fs-body`, `.fs-bar`, `.fs-ctl`, `.fs-foot`,
    `.fs-open`.
  - **In use:** the schedule map (`historyKey="map"`: day arrows and tech chips in the
    controls, a collapsible timeline strip at the bottom, the job in the kit Sheet with the
    stop kept in view), the techs timeline (`historyKey="timeline"`, `corner="top-left"`,
    `orientationHint="landscape"`, the Fit day / Zoom switch in the controls), the live
    map's wall mode, the Assign hub map and the schedule board (blocks 1, 2 and 6 below), and
    the leads map (`historyKey="leads-map"`, minimal chrome and its own corner button; the
    drawer slides away and "Show N leads" closes it; dragging the drawer below peek opens it;
    §6 "Lead map").
  - **The next six uses** (apply as written):
    1. Operations live map, wall mode (an office TV or a tablet). **Shipped** in `LiveMap`:
       the header's "Wall mode" (`FullscreenButton hub="wall"`, tablet and up) or the map's
       corner Expand (every size):
       ```tsx
       <FullscreenHub title="Live map" subtitle="3 of 3 techs on shift · 9 jobs today"
         historyKey="wall" breakpoint="all" theme="dark" browserFullscreen
         className="size-full" closeLabel="Exit wall mode"
         onOpenChange={(o) => { setWall(o); if (o) refit(); }} onExit={refit}
         controls={<><LiveClock tz={tz} /><Chip …>Show stale</Chip></>}>
         <div className="lm-wall">
           {wall && <WallLegend techs={sorted} now={now} selected={…} onPick={…} />}
           <div className="lm-map"><TechMap … wall={wall} fitKey={fitKey} /></div>
         </div>
         <Sheet …>{/* the job; in the hub's subtree, so dark over the wall */}</Sheet>
       </FullscreenHub>
       ```
       The legend is a column beside the map on a wide screen and a strip of cards under it
       on a tall one: color, avatar with the status ring, status, last ping, the current
       job; nothing needs a hover. TechMap: avatars always above job pins; in wall mode each
       tech's first name on a tag on the first free side (else hidden) and, from 1200 px,
       bigger markers; job pins declutter like the schedule map's boxes (the shared
       `src/lib/declutter.ts`: a pin's number box only where it covers no other pin, avatar
       or tag and isn't cut by the edge, else a dot that expands on zoom; a pin under its
       tech's avatar hides). The 60 s refresh keeps running. Tiles darken with the theme.
    2. Assign hub map. **Shipped** in `DispatchHub` (inside `.hub-map`):
       ```tsx
       <FullscreenHub historyKey="routes" title="Routes" subtitle="Who should take J-1042?"
         className="size-full" expandLabel="Full screen map" onOpenChange={…}
         controls={<><PeriodStepper …>Today · Oct 22</PeriodStepper>
                     <TechChips bare items={chips} value={effective} onChange={select} /></>}
         footer={job ? footers[effective] : undefined}>   {/* HubFsFooter: job · fit · Assign <name> */}
         <RouteMap … />
       </FullscreenHub>
       ```
       A pick inside (a chip or a tech's pin) replaces the entry with `?fs=` kept; a new day
       `router.replace`s without it. The footer's "Assign <name>" is the panel's
       `HubAssignButton` (`scheduleJob`); its toast shows above the hub. Routes draw like
       the schedule map's (`map/route-draw.ts`: cased line, direction chevrons, focus and
       fade) plus the dashed recommended detour and numbered stops.
    3. Signature capture (opened by code, landscape, nothing scrolls). **Shipped** as the kit
       pair `SignatureField` (the in-page "Tap to sign" box, which shows the signature once
       there is one) + `SignatureCapture` (lazy; it grows out of the box and shrinks back):
       ```tsx
       <SignatureField value={sig} onChange={setSig} title="Approve E-1042" subtitle={name} />
       // SignatureCapture, mounted over the box on the first tap:
       <FullscreenHub open={open} onOpenChange={setOpen} trigger="none" title={title}
         subtitle={subtitle} historyKey="sign" orientationHint="landscape" lockScroll="strict"
         browserFullscreen={false} onResize={() => pad.current?.resize()}
         footer={<><Button variant="secondary" onClick={() => pad.current?.clear()}>Clear</Button>
                   <Button onClick={done}>Done</Button></>}>
         <SignaturePad ref={pad} height="fill" clearButton={false} className="sigcap-pad" />
       </FullscreenHub>
       ```
       Done → `toBlob({ trim: true })` (PNG cropped to the ink) → "Signature added"
       (SuccessCheck, inline) → close. Every open starts clean; the rotate tip shows only
       until the first stroke (`SignaturePad onStart`); strokes survive a rotation. Inside a Sheet, Esc cancels signing (not the sheet). No
       browser full screen: the page root would rise over the sheet it sits in. Used by every
       signature (S15 `SignatureSheet`).
    4. Estimate present mode on a tablet (customer-facing). **Shipped** as the customer's own
       `/e/<token>?present=1` page (no copy): the staff page's "Present to customer"
       (`PresentEstimateButton` → `presentEstimate`, `mintOrReusePublicToken` purpose
       `estimate.present`) opens it, and with a staff session that may present it
       (`presentingUser`) the page is wrapped in `LazyPresentMode`:
       ```tsx
       <FullscreenHub title={`Estimate ${number}`} label="Estimate presentation"
         historyKey="present" chrome="minimal" trigger="none" open={open}
         onOpenChange={(o) => o ? resume() : presentationCloses(…) && setOpen(false)}
         browserFullscreen={false} className="present-slot">
         <div className="present-top">Exit presentation · company · Full screen</div>
         <div className="present-scroll"><div className="present-col">{page}</div></div>
         {!started && <button className="present-start">…Tap to start…</button>}
       </FullscreenHub>
       ```
       A slim 52 px top row ("Exit presentation" pill → confirm → staff page; the company;
       "Full screen" when the browser left it) has its own space: the page scrolls below it,
       so nothing renders under the controls. Until "Tap to start" (the handover tap, which
       also asks for browser full screen) the page and its Approve bar stay hidden: one
       primary. Back pauses (Resume / Exit bar); Esc, the hub's own close (hidden) and
       leaving browser full screen keep presenting; Esc closes a photo opened inside it.
       Approval goes through the public action with `present: true`: signature channel
       `in_person`, `present_mode` + `presented_by` in the audit row.
    5. Job photo viewer (swipe between photos, no before/after slider). **Shipped** as the kit
       `PhotoViewer`, mounted by `PhotoGrid` on the first tap (lazy chunk):
       ```tsx
       <PhotoGrid photos={photos} groups={JOB_PHOTO_GROUPS}
         actions={(p) => <IconButton label="Photo details" …><Info /></IconButton>} />
       // inside PhotoGrid:
       <PhotoViewer photos={flat} index={index} onIndexChange={setIndex}
         anchor={(i) => grid.current?.querySelector(`[data-pi="${i}"]`)} />
       // = <FullscreenHub open trigger="none" chrome="minimal" theme="dark" historyKey="photo"
       //     label="Photo viewer"> + a scroll-snap carousel, counter, caption, prev/next
       ```
       It grows from the tapped thumbnail and shrinks into the thumbnail of the photo on
       screen (its box is `position: fixed` over it, corrected for transformed ancestors).
       The cached thumbnail shows until the full photo loads; neighbours preload; double-tap
       zooms 2× with native panning. Used on the job photos panel (grouped), `/i`, `/j`, `/e`
       ("What we found" strip), the staff estimate, tools and vehicles.
    6. Schedule calendar board (day, 3 days, week). **Shipped** as `ScheduleBoard`: the
       in-page board from 1024 px with the corner Expand (to 1199 px); below 1024 px the page
       keeps its list and the header's `FullscreenButton hub="board"` opens the board:
       ```tsx
       <FullscreenHub historyKey="board" title="Schedule" subtitle="17 jobs · 3 unscheduled"
         orientationHint="landscape" trigger={desktop ? "corner" : "none"}
         controls={<div className="flex flex-wrap …">
           <ParamPeriodStepper value={date} step={7}>Oct 19 – 25</ParamPeriodStepper>
           <ParamSegmented param="view" className="w-52" segments={DAY_3DAYS_WEEK} /></div>}>
         {(desktop || fs) && <BoardGrid data={data} colorBy={colorBy} fill={fs} />}
       </FullscreenHub>
       ```
       `fill`: the board scrolls both ways inside its card under sticky tech / day headers
       and the time column; 3 days / week columns are the board's width over the days to
       show (about 7 on a landscape tablet, 4 upright, 3.75 on a landscape phone; days
       without jobs at half width); compact cards (two-line title, small customer line, an
       avatar-and-name chip inside); the queues rail from 1280 px. Tapping a job opens it;
       back returns to the full-screen board.

## 7. Screen briefs (for the redesign pass)

1. **Tech Today (phone):**
   - Greeting large title.
   - A slim clock status: "On the clock · 2h 14m" with a live dot, or a single "Clock in" hero
     when clocked out.
   - A current/next job hero (status, title, window, customer, address) whose one primary button
     is the next step (On my way / Arrived / Open job). Call, text and navigate are icon buttons.
   - A summary strip: jobs done, earned today, cash held (tap to hand in).
   - Today's route as a Timeline.
2. **Office / admin Today (desktop and phone):**
   - Greeting.
   - A KPI stat row: today's jobs with a ring, new leads with the oldest wait, overdue AR,
     approvals.
   - A "Needs attention" feed with quick actions.
   - A compact schedule strip by tech.
   - The setup checklist collapses into a small progress card ("Finish setting up · 9/13", with a
     Continue button).
3. **Job detail:**
   - Hero header: title, live status, customer and address, window, tech.
   - Tabs with a sliding indicator.
   - Desktop: a right rail with a trip-style status timeline, the next action, the money summary
     and the tech card, replacing the floating centered dock.
   - Phone: the dock restyled as the bottom action bar.
4. **Lists (jobs, leads, customers, estimates, invoices):**
   - A sticky search pill and filter chip row; rich rows; day grouping where dates matter.
   - Leads are a grid of boxes with the SLA ring that open the lead card sheet instead of a
     pushed page (§6 "Lead box and grid", "Lead card").
   - M3 morph into the detail hero.
5. **Schedule:**
   - A day view with tech lanes, soft job blocks with the tech-color edge, and a red now-line.
   - Day switching slides.
6. **Customer detail:**
   - Profile header: avatar, name, tags.
   - A row of round quick actions (Call, Text, Email, New job) with labels.
   - Stat tiles (lifetime, balance, jobs), properties and timeline.
7. **Documents (invoice, estimate, receipt):** a paper card (Stripe-like) with a clear totals
   block. Estimate options are selectable cards (good / better / best).
8. **Public pages (customer-facing; must stay the lightest):**
   - `/t` tracking: the Uber ETA hero "Tom is on the way" with the tech card and a progress
     timeline.
   - `/e`: option cards plus a booking bar ("Total $334.54 · Approve") and a signature sheet.
   - `/p`: a checkout summary with a large amount and pay buttons.
   - `/r`: big stars with an M10/M11 pop.
   - `/f`: a short stepped form (service chips → details → contact).
   - `/i`: a clean document.
9. **Auth:** a split layout on desktop (accent gradient brand panel plus the form); one column on
   phone. Large fields.
10. **Settings, team, messaging, map:** the new tokens and components. Messaging gets iMessage-like
    bubbles and a pill composer. The map is full-bleed with a bottom sheet of techs and jobs on
    phone.

## 8. Do and don't

- **Do:**
  - one primary per view
  - sentence case
  - bold section titles on content pages
  - neutral secondary buttons
  - soft status pills
  - tabular numbers
  - 20 px icons, stroke 1.75–2
  - `hit-44`
  - focus-visible rings (2 px accent, 2 px offset)
  - AA contrast
- **Don't:**
  - uppercase gray labels
  - several filled accent buttons on one screen
  - a border and a shadow on the same card in light mode
  - animating layout properties
  - new dependencies or web fonts
  - animations over 480 ms on frequent actions
  - infinite animations other than live dots, spinners and skeletons
  - bars or docks that cover content

## 9. QA checklist for any UI change

- Phone 390×844 at dpr 3, and desktop 1440×900, in light and dark.
- `prefers-reduced-motion: reduce` gives fades only.
- No horizontal overflow. Nothing hidden under the tab bar, dock or bottom bar; the last item can
  be scrolled into view.
- Tap targets ≥ 44. Focus visible. No console errors or hydration warnings.
- Shell JS stays the same or smaller, route JS doesn't grow, CSS stays ≤ 25 KB gz.
- `npm run typecheck`, `npm run lint` and `npm test` pass.
