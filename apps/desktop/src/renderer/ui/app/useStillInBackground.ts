import { useEffect } from "react";

/**
 * While the window is in the background, the root carries `data-window-away`
 * and the ground's slow motion - the drifting mist, light over the water -
 * holds still. Kept moving, it has the window drawn sixty times a second for
 * nobody watching it.
 */
export function useStillInBackground(): void {
  useEffect(() => {
    const root = document.documentElement;
    const away = () => root.setAttribute("data-window-away", "");
    const back = () => root.removeAttribute("data-window-away");
    if (!document.hasFocus()) away();
    window.addEventListener("blur", away);
    window.addEventListener("focus", back);
    return () => {
      window.removeEventListener("blur", away);
      window.removeEventListener("focus", back);
      back();
    };
  }, []);
}
