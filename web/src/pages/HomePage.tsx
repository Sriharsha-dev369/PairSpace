import { useMember } from "../auth/useMember";
import { Dashboard } from "../dashboard/Dashboard";
import { Loading } from "../ui/FullScreen";
import { LandingPage } from "./LandingPage";

// members see their rooms; everyone else sees what PairSpace is
export function HomePage() {
  const member = useMember();
  if (member === undefined) return <Loading />;
  return member ? <Dashboard member={member} /> : <LandingPage />;
}
