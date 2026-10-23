/**
 * Before any test of the installed app: the built app opens to its welcome
 * page. A build that cannot would fail every test in turn, each after its full
 * wait, so the suite stops here with one failure instead.
 */

import { closeEverything, launch, shows } from "./launch.js";

export default async function builtAppOpens(): Promise<void> {
  try {
    const { window } = await launch();
    await shows(window.getByText(/WELCOME TO ZHIYIN/), "its welcome page");
  } finally {
    await closeEverything();
  }
}
