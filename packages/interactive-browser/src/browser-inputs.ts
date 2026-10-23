/**
 * Inputs that name a place on disk. A picture is kept with the conversation
 * under an id the session store generates, so a filename the model chose has
 * nothing to select and everything to leak: it is removed from the schema the
 * model is shown, and from the arguments if one arrives regardless.
 */
const pathInputs = new Set(["filename"]);

/**
 * Inputs Zhiyin answers for the model. The page is drawn at the screen's
 * density so the person watching sees it sharp; a picture the model is shown
 * stays at the page's own size, which is all it needs and a quarter of the
 * cost of one at 200%.
 */
export const decidedInputs: Readonly<
  Record<string, Readonly<Record<string, unknown>>>
> = { browser_take_screenshot: { scale: "css" } };

/** Inputs the browser never receives from the model, so no approval shows them. */
export const hiddenInputs: ReadonlySet<string> = new Set([
  ...pathInputs,
  ...Object.values(decidedInputs).flatMap((inputs) => Object.keys(inputs)),
]);
