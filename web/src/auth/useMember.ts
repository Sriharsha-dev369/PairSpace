import { useMemo, useRef } from "react";
import { authClient } from "./client";

export interface Member {
  id: string;
  name: string;
}

// the signed-in member, null for a guest, undefined until the first answer. Steady afterwards:
// Better Auth briefly reports a guest as "pending" again while it refetches in the background,
// which would otherwise unmount (and reconnect) whatever waits on it
export function useMember(): Member | null | undefined {
  const { data, isPending } = authClient.useSession();
  const answered = useRef(false);
  if (!isPending) answered.current = true;
  const id = data?.user.id;
  const name = data?.user.name;
  const member = useMemo(
    () => (id === undefined || name === undefined ? null : { id, name }),
    [id, name],
  );
  return answered.current ? member : undefined;
}
