import { redirect } from "next/navigation";
import { pageUser } from "../lib/auth/server-session.ts";
import { PartsLookupView } from "./parts-lookup-view.tsx";

export default async function PartsLookupPage() {
  const user = await pageUser();
  if (!user) redirect("/login");

  return <PartsLookupView userEmail={user.email} isAdmin={user.role === "admin"} />;
}
