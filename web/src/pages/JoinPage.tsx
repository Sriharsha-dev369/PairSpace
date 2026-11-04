import { useQuery } from "@tanstack/react-query";
import { Link2Off, WifiOff } from "lucide-react";
import { Navigate, useParams } from "react-router";
import { ApiError, api } from "../api";
import { useMember } from "../auth/useMember";
import { Loading } from "../ui/FullScreen";
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
  // the server answered "no such link"; anything else (offline, server down) may pass
  if (link.isError && !(link.error instanceof ApiError && link.error.status === 404)) {
    return (
      <Notice
        icon={WifiOff}
        title="Couldn't check this invite"
        body="PairSpace couldn't be reached to open this link. Check your connection, then try again."
        isMember={false}
        way={{ onClick: () => link.refetch(), label: "Try again" }}
      />
    );
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
  return <Loading />;
}
