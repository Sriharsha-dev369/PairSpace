import { Loader2 } from "lucide-react";
import { Navigate } from "react-router";
import { useMember } from "../auth/useMember";
import { Dashboard } from "../dashboard/Dashboard";
import { FullScreen } from "../ui/FullScreen";

// members see their rooms; everyone else signs in first (the landing page arrives in M10)
export function HomePage() {
  const member = useMember();
  if (member === undefined) {
    return (
      <FullScreen>
        <Loader2 size={18} className="animate-spin text-muted" />
      </FullScreen>
    );
  }
  return member ? <Dashboard member={member} /> : <Navigate to="/sign-in" replace />;
}
