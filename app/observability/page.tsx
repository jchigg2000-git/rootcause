import { redirect } from "next/navigation";
import { pageUser } from "../lib/auth/server-session.ts";
import { ObservabilityView } from "./observability-view";

export default async function ObservabilityPage() {
  const user = await pageUser();
  if (!user) redirect("/login");

  return <ObservabilityView userEmail={user.email} isAdmin={user.role === "admin"} />;
}
