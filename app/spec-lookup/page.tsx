import { redirect } from "next/navigation";
import { pageUser } from "../lib/auth/server-session.ts";
import { SpecLookupView } from "./spec-lookup-view";

export default async function SpecLookupPage() {
  const user = await pageUser();
  if (!user) redirect("/login");

  return <SpecLookupView userEmail={user.email} isAdmin={user.role === "admin"} />;
}
