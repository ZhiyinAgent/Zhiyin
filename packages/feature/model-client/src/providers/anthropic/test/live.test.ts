import { checkLive } from "../../../../test/live-lab.js";
import { checkLoadsLive } from "../../../../test/live-loads.js";
import { anthropic } from "../../../../test/shipped-providers.js";

checkLive(anthropic, "claude-haiku-5-5");
checkLoadsLive(anthropic, "claude-haiku-5-5");
