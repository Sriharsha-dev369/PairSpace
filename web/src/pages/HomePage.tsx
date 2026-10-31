import { Loader2 } from "lucide-react";
import { Navigate } from "react-router";
import { useMember } from "../auth/useMember";
import { newRoomId } from "../room/room-id";
import { FullScreen } from "../ui/FullScreen";

// members start a fresh room; everyone else signs in first (the landing page arrives in M10)
export function HomePage() {
  const member = useMember();
  if (member === undefined) {
    return (
      <FullScreen>
        <Loader2 size={18} className="animate-spin text-muted" />
      </FullScreen>
    );
  }
  return <Navigate to={member ? `/r/${newRoomId()}` : "/sign-in"} replace />;
}
