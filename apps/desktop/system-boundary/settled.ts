import type { Page } from "playwright-core";

/**
 * Waits for a page to hold still before a test measures it: every animation
 * that ends has ended, then two frames in a row pass with the window's size
 * and every scroll position unchanged. A change the test caused has to have
 * begun first, so a test that resized or scrolled waits for that before this.
 * Nothing here asks a clock; a page that never settles ends at the test's
 * own timeout.
 */
export async function settled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const ending = () =>
      document.getAnimations().filter((animation) => {
        const end = animation.effect?.getComputedTiming().endTime;
        return (
          animation.playState === "running" &&
          typeof end === "number" &&
          Number.isFinite(end)
        );
      });
    for (let running = ending(); running.length; running = ending())
      // One cancelled on the way has ended too.
      await Promise.all(
        running.map((animation) => animation.finished.catch(() => {})),
      );
    const shape = () => {
      const scrolled: number[] = [];
      for (const element of document.querySelectorAll("*"))
        if (element.scrollTop || element.scrollLeft)
          scrolled.push(element.scrollTop, element.scrollLeft);
      return JSON.stringify([innerWidth, innerHeight, scrolled]);
    };
    const frame = () =>
      new Promise((resolve) => requestAnimationFrame(resolve));
    let last = shape();
    for (let still = 0; still < 2;) {
      await frame();
      const now = shape();
      still = now === last ? still + 1 : 0;
      last = now;
    }
  });
}
