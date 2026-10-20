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
| M5 | Pop-up menu (context menu, + menu, action sheet on desktop) | Grows from the trigger (transform-origin at the trigger): scale .92 → 1 plus fade, 220 ms snappy. Items stagger 12 ms. Glass material. |
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
- **ActionSheet, ContextMenu, AddMenu:** M5 glass pop-ups. The "+" menu pops from its button on
  phones too (iOS pull-down menu); the ActionSheet pops from whatever opened it on desktop (no
  anchor prop needed) and stays a bottom sheet on phone. APIs unchanged.
- **Alert:** M6. 300 wide, radius 20, glass, pill buttons: cancel neutral, the preferred action
  `--accent-fill`, destructive `--danger-fill` (only in confirms).
- **Toast:** M7, with icon and text; an action link is optional. Phone: black island at the top;
  desktop: glass card bottom right. `toast()` API unchanged.
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

- **Phone header:** large title (greeting on Today), date or subtitle in `--label-2`, and trailing
  icon buttons (search, +, bell) in the nav bar.
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
   - Leads show an SLA ring.
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
