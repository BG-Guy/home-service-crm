// Loaded lazily by <MotionProvider> so Motion's animation features stay out of the
// shell's initial JS (SPEC §12.2: LazyMotion + domAnimation; never full `motion`).
import { domAnimation } from "motion/react";

export default domAnimation;
