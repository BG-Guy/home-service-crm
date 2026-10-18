import { PayLoading } from "./_components/PayLoading";

// Also the boundary for /pay/* when entered from outside /pay: PayLoading picks
// the sub-route's skeleton by path (QA2 NEW-6).
export default function Loading() {
  return <PayLoading />;
}
