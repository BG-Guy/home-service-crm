import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "../_components/AuthCard";
import { ResetRequestForm } from "./ResetRequestForm";

export const metadata: Metadata = { title: "Reset password" };

export default function ResetRequestPage() {
  return (
    <AuthCard
      title="Reset password"
      subtitle="Enter your email and we'll send you a link to set a new password."
      footer={
        <Link href="/login" className="text-accent-text">
          Back to sign in
        </Link>
      }
    >
      <ResetRequestForm />
    </AuthCard>
  );
}
