import { checkLive } from "../../../../test/live-lab.js";
import { checkLoadsLive } from "../../../../test/live-loads.js";
import { moonshot } from "../../../../test/shipped-providers.js";

checkLive(moonshot, "kimi-k2.6");
checkLoadsLive(moonshot, "kimi-k3.1-pro");
