import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { ownedProject, projectStep } from "@/lib/projects";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const p = await ownedProject(user.id, id);
  redirect(`/app/projets/${p.id}/${projectStep(p)}`);
}
