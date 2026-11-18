/** A file bundled with the app as its text, as the app's build reads `?raw`. */
declare module "*?raw" {
  const text: string;
  export default text;
}
