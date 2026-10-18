// Contract types for B5 reviews (BUILD_PLAN §5.2, §6.5). Types only.
export type RequestReviewButtonProps = {
  jobId?: string;
  customerId?: string /* → latest completed job */;
};
export type ReviewStats = {
  sent: number;
  clicked: number;
  ratings: number;
  avgRating: number | null;
};
