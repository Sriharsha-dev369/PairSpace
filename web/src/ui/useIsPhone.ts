import { useSyncExternalStore } from "react";

// narrower than Tailwind's md breakpoint (768px): the room's side panels slide in instead
const PHONE = "(max-width: 767px)";

const subscribe = (onChange: () => void) => {
  const query = matchMedia(PHONE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

// whether the screen is phone-sized, following it as it turns or resizes
export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, () => matchMedia(PHONE).matches);
}
