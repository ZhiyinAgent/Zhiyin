import { checkLive } from "../../../../test/live-lab.js";
import { anthropic } from "../../../../test/shipped-providers.js";

checkLive(anthropic, "claude-haiku-5-5");
