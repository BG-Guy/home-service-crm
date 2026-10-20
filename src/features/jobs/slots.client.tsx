"use client";

// B2 client slots (BUILD_PLAN §5.1 S8, S9). Each lives in its own module so a
// page pulls only the one it renders; import those paths directly when you can.
export { AssignJobButton } from "./components/AssignJobButton";
export { PortalJobActions } from "./components/portal/PortalJobActions";
