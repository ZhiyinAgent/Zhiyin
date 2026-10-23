import { checkLive } from "../../../../test/live-lab.js";
import { openAi } from "../../../../test/shipped-providers.js";

checkLive(openAi, "gpt-6-luna");
