import { redirect } from "next/navigation";
import { pageUser } from "../lib/auth/server-session.ts";
import { SettingsView } from "./settings-view";

export default async function SettingsPage() {
  const user = await pageUser();
  if (!user) redirect("/login");

  return (
    <SettingsView userEmail={user.email} isAdmin={user.role === "admin"} />
  );
}
