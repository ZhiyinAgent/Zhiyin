import { checkLive } from "../../../../test/live-lab.js";
import { checkLoadsLive } from "../../../../test/live-loads.js";
import { openAi } from "../../../../test/shipped-providers.js";

checkLive(openAi, "gpt-6-luna");
checkLoadsLive(openAi, "gpt-6-luna");
