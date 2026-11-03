// Each page's code, downloaded the first time it's needed (App's router), so a page never waits
// for another page's code.
export const pages = {
  home: () => import("./HomePage"),
  dashboard: () => import("../dashboard/Dashboard"),
  landing: () => import("./LandingPage"),
  auth: () => import("./AuthPage"),
  room: () => import("./RoomPage"),
  replay: () => import("./ReplayPage"),
  join: () => import("./JoinPage"),
  notFound: () => import("./NotFoundPage"),
};

// fetches the pages someone is likely to go to next, once the browser is idle: the next click is
// then instant, and still works if the network has gone meanwhile (leaving a room offline)
export function warm(...next: (keyof typeof pages)[]) {
  const fetchThem = () => {
    for (const page of next) pages[page]().catch(() => {}); // a failure here is retried on use
  };
  if ("requestIdleCallback" in window) requestIdleCallback(fetchThem);
  else setTimeout(fetchThem, 200); // Safari
}
