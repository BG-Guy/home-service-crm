// Contract types for B2 time clock (BUILD_PLAN §5.2, §6.2). Types only.
export type TimeEntriesSectionProps = { userId: string; days?: number };
export type ClockStatus = {
  clockedIn: boolean;
  since: Date | null;
  timeEntryId: string | null;
};
