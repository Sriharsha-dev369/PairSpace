import { Loader2 } from "lucide-react";
import { useMember } from "../auth/useMember";
import { Dashboard } from "../dashboard/Dashboard";
import { FullScreen } from "../ui/FullScreen";
import { LandingPage } from "./LandingPage";

// members see their rooms; everyone else sees what PairSpace is
export function HomePage() {
  const member = useMember();
  if (member === undefined) {
    return (
      <FullScreen>
        <Loader2 size={18} className="animate-spin text-muted" />
      </FullScreen>
    );
  }
  return member ? <Dashboard member={member} /> : <LandingPage />;
}
