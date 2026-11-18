import type { LookId, LookStrength } from "@zhiyin/contract";

/**
 * Each look as a person is offered it. Every listed look must have its words,
 * and says whether it draws pictures a strength could change.
 */
export const lookWords: Readonly<
  Record<
    LookId,
    {
      readonly name: string;
      readonly description: string;
      readonly pictures: boolean;
    }
  >
> = {
  neutral: {
    name: "Neutral",
    description: "The grained ground alone, with nothing drawn on it.",
    pictures: false,
  },
  ink: {
    name: "Ink",
    description:
      "A landscape in ink: mountains and drifting mist, water, far ranges and clouds.",
    pictures: true,
  },
  dots: {
    name: "Dots",
    description:
      "Karst peaks over a river and bamboo, in fine dots, with soft panels and no outlines.",
    pictures: true,
  },
};

export const strengthNames: Readonly<Record<LookStrength, string>> = {
  subtle: "Subtle",
  default: "Default",
  vivid: "Vivid",
};
