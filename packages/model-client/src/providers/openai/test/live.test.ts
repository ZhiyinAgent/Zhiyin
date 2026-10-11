import { checkLive } from "../../../../test/live-lab.js";
import { openAi } from "../provider.js";

checkLive(openAi, "gpt-6-luna");
