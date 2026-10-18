// Shared (server + client) time formatting for the time module.

/** 135 → "2 h 15 m"; 45 → "45 m". */
export function formatMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h ? `${h} h ${mm.toString().padStart(2, "0")} m` : `${mm} m`;
}
