import { checkLive } from "../../../../test/live-lab.js";
import { mistral } from "../provider.js";

checkLive(mistral, "mistral-large-4");
