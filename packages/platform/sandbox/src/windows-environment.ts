/**
 * The variables a program Zhiyin confines is given from Zhiyin's own
 * environment, by name, whatever their case: what Windows programs expect to
 * find, and the certificates this computer trusts. Nothing else passes, so a
 * variable left by a terminal cannot point a program at another environment,
 * package index or startup script, and a credential kept in a variable does
 * not reach a script the model wrote. No proxy passes either: a confined
 * program reaches the network only through Zhiyin's, which goes out the way
 * this computer does.
 */
const passed = new Set(
  [
    "ALLUSERSPROFILE",
    "APPDATA",
    "COMMONPROGRAMFILES",
    "COMMONPROGRAMFILES(X86)",
    "COMMONPROGRAMW6432",
    "COMPUTERNAME",
    "COMSPEC",
    "HOMEDRIVE",
    "HOMEPATH",
    "LOCALAPPDATA",
    "NUMBER_OF_PROCESSORS",
    "OS",
    "PATH",
    "PATHEXT",
    "PROCESSOR_ARCHITECTURE",
    "PROCESSOR_IDENTIFIER",
    "PROCESSOR_LEVEL",
    "PROCESSOR_REVISION",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROGRAMW6432",
    "PUBLIC",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "USERDOMAIN",
    "USERNAME",
    "USERPROFILE",
    "WINDIR",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "REQUESTS_CA_BUNDLE",
  ].map((name) => name.toUpperCase()),
);

/** The variables of `given` a confined program may have, and no others. */
export function windowsEnvironment(
  given: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(given).filter(([name]) => passed.has(name.toUpperCase())),
  );
}
