import { redirect } from "next/navigation";
import { pageUser } from "../lib/auth/server-session.ts";
import { LibraryView } from "./library-view";

export default async function LibraryPage() {
  const user = await pageUser();
  if (!user) redirect("/login");

  return <LibraryView userEmail={user.email} isAdmin={user.role === "admin"} />;
}
