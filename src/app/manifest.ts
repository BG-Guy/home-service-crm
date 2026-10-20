import type { MetadataRoute } from "next";
import { findCompany, getSettings } from "@/lib/settings";

// Web app manifest (SPEC §12.3). Dynamic so the installed name follows the company
// profile / Settings → Branding (no database access at build time).
export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const [company, settings] = await Promise.all([findCompany(), getSettings()]);
  const name = settings.branding.app_name || company?.name || "CRM";
  return {
    id: "/",
    name,
    short_name: name.length > 12 ? name.slice(0, 12).trim() : name,
    description: `${name} — jobs, customers, invoices and payments`,
    start_url: "/today",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F5F5F7",
    theme_color: "#F5F5F7",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
