import { LogOutIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/server/actions/auth";

/** Sign-out is a server action (POST with built-in origin checks), never a GET link. */
export function SignOutButton({ variant = "outline" }: { variant?: "outline" | "ghost" }) {
  return (
    <form action={signOut}>
      <Button type="submit" variant={variant} className="min-h-11">
        <LogOutIcon aria-hidden="true" /> Sign out
      </Button>
    </form>
  );
}
