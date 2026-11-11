import type { Metadata } from "next";
import { LegalView } from "@/components/LegalView";
import { legalPage } from "@/lib/legal";

const page = legalPage("mentions-legales")!;
export const metadata: Metadata = { title: page.title };

export default function Page() {
  return <LegalView page={page} />;
}
