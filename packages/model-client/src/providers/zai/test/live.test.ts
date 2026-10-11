import { checkLive } from "../../../../test/live-lab.js";
import { zai } from "../provider.js";

// Checked live 2026-10-09: Z.ai and BigModel each answer the other's keys.
checkLive(zai, "glm-5.3-flash", { sharedKeys: true });
