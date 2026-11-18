import { checkLive } from "../../../../test/live-lab.js";
import { mistral } from "../../../../test/shipped-providers.js";

checkLive(mistral, "mistral-large-4");
