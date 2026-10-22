// Present mode's close rule (pure; tests/portal/present-policy.test.ts).
//
// The presentation is a FullscreenHub that asks to close on back, Esc, its
// close button, and when the browser leaves full screen. Leaving browser full
// screen also happens when a full-screen view opened inside it closes (the
// signature pad, a photo), and the customer may press Esc or swipe out of
// full screen by accident. Only back pauses the presentation, and only once no
// other full-screen view is still open; everything else keeps presenting (the
// "Full screen" control gets browser full screen back).

export function presentationCloses(a: {
  /** The URL still carries `?fs=present` (false right after back). */
  urlHasKey: boolean;
  /** Another full-screen hub is open or still closing. */
  otherHubOpen: boolean;
}): boolean {
  return !a.urlHasKey && !a.otherHubOpen;
}
