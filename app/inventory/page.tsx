import { redirect } from "next/navigation";
import { pageUser } from "../lib/auth/server-session.ts";
import { InventoryView } from "./inventory-view";

export default async function InventoryPage() {
  const user = await pageUser();
  if (!user) redirect("/login");

  return <InventoryView userEmail={user.email} isAdmin={user.role === "admin"} />;
}
