// Sample records for the shell gallery (/dev/ui/shell): list → detail with M3 morphs.

export interface DemoJob {
  id: string;
  number: string;
  title: string;
  customer: string;
  status: "scheduled" | "confirmed" | "en_route" | "in_progress" | "completed";
  window: string;
  address: string;
  amountCents: number;
}

export const DEMO_JOBS: readonly DemoJob[] = [
  {
    id: "1042",
    number: "J-1042",
    title: "Rekey front and back doors",
    customer: "Daniel Johnson",
    status: "en_route",
    window: "11:00 AM – 1:00 PM",
    address: "8071 E Riverside Dr, Austin",
    amountCents: 33454,
  },
  {
    id: "1043",
    number: "J-1043",
    title: "Garage door spring replacement",
    customer: "Maria Ortega",
    status: "scheduled",
    window: "2:00 PM – 4:00 PM",
    address: "112 Barton Hills Dr, Austin",
    amountCents: 41800,
  },
  {
    id: "1044",
    number: "J-1044",
    title: "Smart lock install",
    customer: "Priya Shah",
    status: "confirmed",
    window: "4:30 PM – 5:30 PM",
    address: "2400 Lake Austin Blvd, Austin",
    amountCents: 27900,
  },
  {
    id: "1045",
    number: "J-1045",
    title: "Patch and texture drywall",
    customer: "Sofia Taylor",
    status: "in_progress",
    window: "9:00 AM – 11:00 AM",
    address: "77 Avenue F, Austin",
    amountCents: 18500,
  },
  {
    id: "1046",
    number: "J-1046",
    title: "Replace rotted deck boards",
    customer: "Marcus Lee",
    status: "completed",
    window: "Yesterday",
    address: "5 Shoal Creek Blvd, Austin",
    amountCents: 96000,
  },
  {
    id: "1047",
    number: "J-1047",
    title: "Chimney sweep and inspection",
    customer: "Ana Ruiz",
    status: "scheduled",
    window: "Tomorrow 10:00 AM",
    address: "901 W 6th St, Austin",
    amountCents: 22900,
  },
];

export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
