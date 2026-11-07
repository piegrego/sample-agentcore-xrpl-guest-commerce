// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  existsSync,
  readdirSync,
  readFileSync
} from "node:fs";
import {
  dirname,
  join,
  resolve
} from "node:path";
import { describe, expect, test } from "bun:test";

const projectRoot = resolve(import.meta.dir, "..");

function markdownFiles() {
  const files = [
    join(projectRoot, "README.md"),
    join(projectRoot, "XRPL_IMPLEMENTATION_REPORT.md")
  ];

  for (const name of readdirSync(join(projectRoot, "docs"))) {
    if (name.endsWith(".md")) {
      files.push(join(projectRoot, "docs", name));
    }
  }

  for (const packageName of readdirSync(join(projectRoot, "packages"))) {
    const readme = join(
      projectRoot,
      "packages",
      packageName,
      "README.md"
    );
    if (existsSync(readme)) files.push(readme);
  }

  return files;
}

function contents(path: string) {
  return readFileSync(path, "utf8");
}

describe("documentation alignment", () => {
  test("describes the implemented payment boundaries", () => {
    const rootReadme = contents(join(projectRoot, "README.md"));
    const architectureGuide = contents(
      join(projectRoot, "docs", "NEXT_STEPS_XRPL_AGENTCORE.md")
    );
    const apiGuide = contents(
      join(projectRoot, "docs", "PAYMENT_BACKENDS_API_GUIDE.md")
    );
    const mppGuide = contents(
      join(projectRoot, "docs", "AGENTCORE_MPP_AND_XRPL.md")
    );
    const xrplReadme = contents(
      join(
        projectRoot,
        "packages",
        "agentcore-xrpl-settlement",
        "README.md"
      )
    );
    const managedXrplDecision = contents(
      join(projectRoot, "docs", "RUNTIME_MANAGED_XRPL.md")
    );

    for (const guide of [
      rootReadme,
      architectureGuide,
      apiGuide,
      mppGuide,
      xrplReadme
    ]) {
      expect(guide).toContain("@agentcore-xrpl-demo/x402-payments");
    }

    expect(rootReadme).toContain("Choice --> Facade");
    expect(rootReadme).toContain("Sandbox resolver");
    expect(rootReadme).toContain(
      "consumer wallet restoration guide"
    );
    expect(
      contents(
        join(
          projectRoot,
          "docs",
          "CONSUMER_WALLET_RESTORATION.md"
        )
      )
    ).toContain("The public sample does not bundle a browser-wallet SDK");
    expect(architectureGuide).toContain(
      "The browser-wallet path does not use the Runtime payer facade"
    );
    expect(managedXrplDecision).toContain(
      "The payer and beneficiary are different identities"
    );
    expect(managedXrplDecision).toContain(
      "`xrplRuntimePayerAddress`"
    );
    expect(rootReadme).toContain("xrplRuntimePayerAddress");
    expect(apiGuide).toContain(
      "The Runtime uses the same application call for both live payer backends"
    );
    expect(apiGuide).toContain(
      "`PROOF_GENERATED` and `VALIDATED` are different milestones"
    );
    expect(rootReadme).toContain(
      "./docs/AGENTCORE_MPP_AND_XRPL.md"
    );
    expect(mppGuide).toContain(
      "support does not replace the sample's XRP Ledger"
    );
    expect(mppGuide).toContain(
      "Amazon Bedrock AgentCore Payments still limits MPP payment methods to `evm`,"
    );
    expect(mppGuide).toContain(
      "https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-process-payment.html"
    );
    expect(mppGuide).toContain(
      "https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-troubleshooting.html"
    );
  });

  test("does not restore superseded implementation guidance", () => {
    const allGuides = markdownFiles()
      .map(contents)
      .join("\n");
    const supersededStatements = [
      "The next engineering step is therefore extraction",
      "Extract the settlement module and build something else",
      "Payment invocation scaffold",
      "Automated tests: 62 passed",
      "with 181 expectations",
      "The storefront keeps demo budgets, entitlements, proofs, and its transaction list in memory",
      "The host validates the authenticated payer, configured merchant",
      "Wallet identity -> AgentCore task -> HTTP 402"
    ];

    for (const statement of supersededStatements) {
      expect(allGuides).not.toContain(statement);
    }

    expect(allGuides).not.toMatch(/\n\s*bun test\s*\n/);
  });

  test("keeps relative Markdown links resolvable", () => {
    const linkPattern = /!?\[[^\]]*]\(([^)]+)\)/g;

    for (const file of markdownFiles()) {
      const markdown = contents(file);
      for (const match of markdown.matchAll(linkPattern)) {
        const rawTarget = match[1]?.trim();
        if (
          !rawTarget ||
          rawTarget.startsWith("#") ||
          /^[a-z][a-z0-9+.-]*:/i.test(rawTarget)
        ) {
          continue;
        }

        const target = rawTarget
          .replace(/^<|>$/g, "")
          .split("#", 1)[0]!;
        const resolved = resolve(dirname(file), decodeURIComponent(target));
        expect(existsSync(resolved), `${file} links to ${target}`).toBe(true);
      }
    }
  });
});
