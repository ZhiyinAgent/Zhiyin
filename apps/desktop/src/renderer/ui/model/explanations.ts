/**
 * What each part of choosing a model is, as its info button says it, the same
 * on the Model page and in setting one up. None recommends a choice.
 */
export const explanations = {
  provider:
    "The company whose account you use and pay. OpenRouter is one account for models from many labs; a lab’s own platform offers that lab’s models.",
  key: "A key is a password that lets Zhiyin use your account. Zhiyin keeps it in Windows Credential Manager and sends it only to the provider.",
  model:
    "The AI that reads and writes. Prices are per million tokens, about 750,000 words: “in” for what it reads, “out” for what it writes. The context window is how much it can read at once.",
  whoRunsIt:
    "On OpenRouter several companies may run the same model, at different prices and speeds. Leave it on Any provider and OpenRouter chooses for each request.",
} as const;
