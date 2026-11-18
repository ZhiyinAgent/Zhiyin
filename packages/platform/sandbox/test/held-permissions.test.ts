/**
 * The permissions a held path is given, as text: every entry for an app
 * container limited, every other entry kept, and nothing taken from the
 * folder any more.
 */

import { describe, expect, it } from "vitest";
import { asWritten, heldPermissions } from "../src/held-permissions.js";

const person = "S-1-5-21-1-2-3-1001";
const capability = "S-1-15-3-1024-1-2-3";

describe("the permissions of a held path", () => {
  it("let app containers only read a file held read-only, and keep the person's entries as the file's own", () => {
    const original = `D:AI(A;ID;FA;;;${person})(A;ID;0x1301bf;;;${capability})`;

    expect(heldPermissions(original, "read-only", false)).toBe(
      `D:PAI(A;;FA;;;${person})(A;;0x1200a9;;;${capability})`,
    );
  });

  it("keep a folder handing on to what it holds what it handed on before", () => {
    const original = `D:AI(A;OICIID;FA;;;${person})(A;OICIID;0x1301bf;;;${capability})`;

    expect(heldPermissions(original, "read-only", true)).toBe(
      `D:PAI(A;OICI;FA;;;${person})(A;;0x1200a9;;;${capability})(A;OICIIO;0x1301bf;;;${capability})`,
    );
  });

  it("take away only deleting from a path held in place", () => {
    const original = `D:AI(A;OICIID;0x1301bf;;;${capability})`;

    expect(heldPermissions(original, "in-place", true)).toBe(
      `D:PAI(A;;0x1201bf;;;${capability})(A;OICIIO;0x1301bf;;;${capability})`,
    );
  });

  it("carry the grant of the folder the path is in, even before the grant reached it", () => {
    const original = `D:AI(A;ID;FA;;;${person})`;

    expect(heldPermissions(original, "read-only", false, [capability])).toBe(
      `D:PAI(A;;FA;;;${person})(A;;0x1200a9;;;${capability})`,
    );
  });

  it("are refused for an app container entry they cannot limit, such as a conditional one", () => {
    const original = `D:AI(XA;ID;FA;;;${capability};(WIN://SYSAPPID Contains "x"))`;

    expect(heldPermissions(original, "read-only", false)).toBeUndefined();
  });

  it("are refused when there is no list to limit", () => {
    expect(heldPermissions("D:NO_ACCESS_CONTROL", "read-only", false)).toBe(
      undefined,
    );
  });

  it("are set marked to keep what the text says of taking from the folder", () => {
    expect(asWritten(`D:AI(A;ID;FA;;;${person})`)).toBe(
      `D:ARAI(A;ID;FA;;;${person})`,
    );
    expect(asWritten(`D:PAI(A;;FA;;;${person})`)).toBe(
      `D:PARAI(A;;FA;;;${person})`,
    );
  });
});
