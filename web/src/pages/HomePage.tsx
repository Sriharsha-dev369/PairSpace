import { lazy, Suspense } from "react";
import { useMember } from "../auth/useMember";
import { Loading } from "../ui/FullScreen";
import { pages } from "./load";

// downloaded separately: visitors never fetch the dashboard, members never fetch the home page
const Dashboard = lazy(async () => ({ default: (await pages.dashboard()).Dashboard }));
const LandingPage = lazy(async () => ({ default: (await pages.landing()).LandingPage }));

// members see their rooms; everyone else sees what PairSpace is
export function HomePage() {
  const member = useMember();
  if (member === undefined) return <Loading />;
  return (
    <Suspense fallback={<Loading />}>
      {member ? <Dashboard member={member} /> : <LandingPage />}
    </Suspense>
  );
}
