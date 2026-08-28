import { redirect } from "next/navigation";
import { pageUser } from "../lib/auth/server-session.ts";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await pageUser()) redirect("/");
  return <LoginForm />;
}
