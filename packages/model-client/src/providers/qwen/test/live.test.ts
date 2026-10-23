import { checkLive } from "../../../../test/live-lab.js";
import { qwen } from "../../../../test/shipped-providers.js";

checkLive(qwen, "qwen3.8-flash");
