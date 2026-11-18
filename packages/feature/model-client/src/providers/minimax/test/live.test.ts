import { checkLive } from "../../../../test/live-lab.js";
import { miniMax } from "../../../../test/shipped-providers.js";

checkLive(miniMax, "MiniMax-M3");
checkLive(miniMax, "MiniMax-M3.1-Flash");
