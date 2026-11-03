import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { useRouteError } from "react-router";
import { Notice } from "../ui/Notice";

// any page that failed: its code didn't load (e.g. a new version was deployed meanwhile) or it
// threw while showing. Reloading fetches everything afresh
export function CrashPage() {
  const error = useRouteError();
  useEffect(() => console.error(error), [error]);
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  return (
    <Notice
      icon={TriangleAlert}
      title="Something went wrong"
      body={
        offline
          ? "You're offline, so this page couldn't be downloaded. Reload once you're back online."
          : "This page stopped because of an error. Reloading it usually fixes that."
      }
      isMember={false}
      way={{ onClick: () => window.location.reload(), label: "Reload" }}
    />
  );
}
