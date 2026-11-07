// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, test } from "bun:test";
import { validateBunVersionPins } from "../scripts/verify";

const pins = {
  packageManager: "bun@1.4.4",
  engines: { bun: "1.4.4" }
};

describe("combined verification runner", () => {
  test("accepts matching Bun version pins", () => {
    expect(validateBunVersionPins("1.4.4", "1.4.4\n", pins)).toBe(
      "1.4.4"
    );
  });

  test("rejects execution with another Bun version", () => {
    expect(() =>
      validateBunVersionPins("1.4.2", "1.4.4", pins)
    ).toThrow("requires Bun 1.4.4");
  });

  test("rejects drift between project version pins", () => {
    expect(() =>
      validateBunVersionPins("1.4.4", "1.4.4", {
        ...pins,
        engines: { bun: "1.4.2" }
      })
    ).toThrow("must match");
  });
});
