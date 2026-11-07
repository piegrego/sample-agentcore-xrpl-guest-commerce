// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { OpsCopilot } from "../src/components/OpsCopilot";

describe("Ops Copilot", () => {
  test("presents both read-only specialist agents", () => {
    const html = renderToStaticMarkup(
      <OpsCopilot busy={false} onRequest={() => {}} />
    );

    expect(html).toContain("DEVOPS AGENT");
    expect(html).toContain("SECURITY AGENT");
    expect(html).toContain("POLICY ENFORCED");
    expect(html).toContain("READ ONLY");
    expect(html).toContain("cannot");
  });
});
