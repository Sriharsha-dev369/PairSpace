import { MapPinOff } from "lucide-react";
import { Notice } from "../ui/Notice";

// an address that doesn't lead anywhere: a typo, or an old link to a page that moved
export function NotFoundPage() {
  return (
    <Notice
      icon={MapPinOff}
      title="There's nothing here"
      body="This address doesn't lead to a page. Check it for a typo, or start again from the home page."
      isMember={false}
      way={{ to: "/", label: "Go to the home page" }}
      pageTitle="Page not found"
    />
  );
}
