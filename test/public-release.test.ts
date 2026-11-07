// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const projectRoot = resolve(import.meta.dir, "..");
const sourceHeader =
  "Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.";
const spdxHeader = "SPDX-License-Identifier: MIT-0";

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function isSourceFile(path: string): boolean {
  const name = basename(path);
  return (
    /\.(?:ts|tsx|mjs|css|html)$/.test(name) ||
    name === "Dockerfile" ||
    name.startsWith("Dockerfile.")
  );
}

describe("public release readiness", () => {
  test("includes the standard community and licensing files", () => {
    for (const name of [
      "LICENSE",
      "CONTRIBUTING.md",
      "CODE_OF_CONDUCT.md",
      "SECURITY.md",
      ".env.example",
      "docs/THREAT_MODEL.md",
      "docs/CONSUMER_WALLET_RESTORATION.md",
      "docs/RUNTIME_MANAGED_XRPL.md"
    ]) {
      expect(existsSync(join(projectRoot, name)), name).toBe(true);
    }

    expect(existsSync(join(projectRoot, ".gitlab-ci.yml"))).toBe(false);
    expect(
      readFileSync(join(projectRoot, "README.md"), "utf8")
    ).toContain("This is sample code for non-production use.");
  });

  test("keeps deployment-specific identifiers out of public documentation", () => {
    const documentation = [
      "README.md",
      "XRPL_IMPLEMENTATION_REPORT.md",
      "CONTRIBUTING.md",
      "CODE_OF_CONDUCT.md",
      "SECURITY.md",
      ...walk(join(projectRoot, "docs"))
        .filter((path) => path.endsWith(".md")),
      ...walk(join(projectRoot, "packages"))
        .filter((path) => path.endsWith("README.md"))
    ]
      .map((path) =>
        readFileSync(
          path.startsWith(projectRoot) ? path : join(projectRoot, path),
          "utf8"
        )
      )
      .join("\n");

    expect(documentation).not.toMatch(/gitlab\.aws\.dev/i);
    expect(documentation).not.toMatch(
      /https:\/\/[a-z0-9-]+\.cloudfront\.net/i
    );
    expect(documentation).not.toMatch(/\b\d{12}\b/);
    expect(documentation).not.toMatch(/\b[A-F0-9]{64}\b/);
    expect(documentation).not.toMatch(
      /\br[1-9A-HJ-NP-Za-km-z]{24,34}\b/
    );
  });

  test("does not bundle the restricted consumer-wallet SDK", () => {
    const manifest = JSON.parse(
      readFileSync(join(projectRoot, "package.json"), "utf8")
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const lockfile = readFileSync(join(projectRoot, "bun.lock"), "utf8");

    expect(manifest.dependencies?.["@gemwallet/api"]).toBeUndefined();
    expect(manifest.devDependencies?.["@gemwallet/api"]).toBeUndefined();
    expect(lockfile).not.toContain('"@gemwallet/api"');
    expect(
      existsSync(join(projectRoot, "src", "lib", "walletIdentity.ts"))
    ).toBe(false);
    expect(
      existsSync(join(projectRoot, "src", "lib", "xrplWallet.ts"))
    ).toBe(false);
  });

  test("uses safe placeholders for local environment configuration", () => {
    const example = readFileSync(
      join(projectRoot, ".env.example"),
      "utf8"
    );

    expect(example).not.toMatch(/AKIA[0-9A-Z]{16}/);
    expect(example).not.toMatch(/ASIA[0-9A-Z]{16}/);
    expect(example).not.toMatch(
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
    );
    expect(example).not.toMatch(/^XRPL_WALLET_SEED=/m);
    expect(example).toContain("XRPL_WALLET_SEED_SECRET_ARN=");
  });

  test("applies the MIT-0 source header to source and test files", () => {
    const roots = [
      "agent",
      "infra",
      "ops-tools",
      "packages",
      "server",
      "shared",
      "src",
      "test"
    ];
    const files = [
      join(projectRoot, "Dockerfile"),
      join(projectRoot, "server.ts"),
      ...roots.flatMap((root) => walk(join(projectRoot, root)))
    ].filter(isSourceFile);

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain(sourceHeader);
      expect(source, file).toContain(spdxHeader);
    }
  });
});
