import { Suspense } from "react";
import { Invitation } from "@/components/invitation";
export default function Page() {
  return (
    <Suspense fallback={<p>Loading invitation…</p>}>
      <Invitation />
    </Suspense>
  );
}
