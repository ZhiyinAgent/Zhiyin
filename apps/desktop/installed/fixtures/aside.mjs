/**
 * Loaded into the app's main process before its own code when a test run sets
 * ZHIYIN_TEST_WINDOWS=aside: every window opens on a screen other than the
 * main one, and is shown without taking focus, so a run never pulls the
 * person away from what they are doing. With one screen, windows open where
 * they would and still take no focus.
 */

import { app, screen } from "electron";

app.on("browser-window-created", (_event, window) => {
  window.show = () => {
    const main = screen.getPrimaryDisplay();
    const other = screen.getAllDisplays().find((one) => one.id !== main.id);
    if (other) {
      const area = other.workArea;
      const [width, height] = window.getSize();
      window.setBounds({
        x: area.x + Math.max(0, Math.round((area.width - width) / 2)),
        y: area.y + Math.max(0, Math.round((area.height - height) / 2)),
        width: Math.min(width, area.width),
        height: Math.min(height, area.height),
      });
    }
    window.showInactive();
  };
});
