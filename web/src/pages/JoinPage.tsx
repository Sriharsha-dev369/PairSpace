import { useQuery } from "@tanstack/react-query";
import { Link2Off, Loader2 } from "lucide-react";
import { Navigate, useParams } from "react-router";
import { api } from "../api";
import { useMember } from "../auth/useMember";
import { FullScreen } from "../ui/FullScreen";
import { Notice } from "../ui/Notice";

// a share link: find its room, then open it with the link's code (which is what lets you in)
export function JoinPage() {
  const { code = "" } = useParams();
  const member = useMember();
  const link = useQuery({
    queryKey: ["link", code],
    queryFn: () => api<{ roomId: string }>("GET", `/api/links/${encodeURIComponent(code)}`),
    retry: false,
  });

  if (link.data) {
    return <Navigate to={`/r/${link.data.roomId}?link=${encodeURIComponent(code)}`} replace />;
  }
  if (link.isError) {
    return (
      <Notice
        icon={Link2Off}
        title="This link doesn't work"
        body="It may be mistyped, or its owner stopped sharing it. Ask them for a new one."
        isMember={member !== null && member !== undefined}
      />
    );
  }
  return (
    <FullScreen>
      <Loader2 size={18} className="animate-spin text-muted" />
    </FullScreen>
  );
}
