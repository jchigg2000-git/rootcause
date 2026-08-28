import { redirect } from "next/navigation";
import { DiagnosticApp } from "./diagnostic-app";
import { pageUser } from "./lib/auth/server-session.ts";

export default async function Home() {
  const user = await pageUser();
  if (!user) redirect("/login");

  return <DiagnosticApp userEmail={user.email} isAdmin={user.role === "admin"} />;
}
