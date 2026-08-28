import { currentUser, jsonError, jsonResponse } from "../../../lib/auth/current-user.ts";

/** Session-resolution endpoint for the client auth context. */
export async function GET(request: Request) {
  const user = await currentUser(request);
  return user ? jsonResponse({ user }) : jsonError("Not signed in.", 401);
}
