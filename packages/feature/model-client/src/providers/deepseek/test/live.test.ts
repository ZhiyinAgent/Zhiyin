import { checkLive } from "../../../../test/live-lab.js";
import { deepSeek } from "../../../../test/shipped-providers.js";

checkLive(deepSeek, "deepseek-flash");
