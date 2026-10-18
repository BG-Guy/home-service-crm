import { createContext, use } from "react";
import type { NavTitle } from "./nav-titles";

// Screen titles from the nav manifests (provided once by AppShell). Its own module
// so client components (skeleton headers, breadcrumbs) share it without importing
// each other. Client components only.

export const NavTitlesContext = createContext<readonly NavTitle[]>([]);

export const useNavTitles = (): readonly NavTitle[] => use(NavTitlesContext);
