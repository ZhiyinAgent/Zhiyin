import { checkLive } from "../../../../test/live-lab.js";
import { anthropic } from "../provider.js";

checkLive(anthropic, "claude-haiku-5-5");
