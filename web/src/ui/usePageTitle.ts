import { useEffect } from "react";

// the browser tab's title, "Interview prep – PairSpace", so tabs and history tell pages apart;
// null for the home page's own
export function usePageTitle(page: string | null) {
  useEffect(() => {
    document.title =
      page === null ? "PairSpace – code together in real time" : `${page} – PairSpace`;
  }, [page]);
}
