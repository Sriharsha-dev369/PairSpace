import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { useNavigate } from "react-router";
import { authClient } from "./client";

export function SignOutButton({ className }: { className: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function signOut() {
    await authClient.signOut();
    queryClient.clear(); // the next person on this browser must not see this one's rooms
    navigate("/sign-in", { replace: true });
  }

  return (
    <button type="button" onClick={signOut} className={className}>
      <LogOut size={14} />
      Sign out
    </button>
  );
}
