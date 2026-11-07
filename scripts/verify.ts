// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import path from "node:path";
import process from "node:process";

interface PackageVersionPins {
  readonly packageManager?: string;
  readonly engines?: {
    readonly bun?: string;
  };
}

export function validateBunVersionPins(
  actualVersion: string,
  bunVersionFile: string,
  packageJson: PackageVersionPins
) {
  const expectedVersion = bunVersionFile.trim();
  const packageManagerVersion = packageJson.packageManager?.replace(
    /^bun@/,
    ""
  );
  const engineVersion = packageJson.engines?.bun;
  const configuredVersions = [
    expectedVersion,
    packageManagerVersion,
    engineVersion
  ];
  if (
    !expectedVersion ||
    configuredVersions.some(
      (version) => version !== expectedVersion
    )
  ) {
    throw new Error(
      "The Bun version pins in .bun-version, packageManager, and engines.bun must match."
    );
  }
  if (actualVersion !== expectedVersion) {
    throw new Error(
      `Verification requires Bun ${expectedVersion}; received Bun ${actualVersion}.`
    );
  }
  return expectedVersion;
}

async function runStep(label: string, args: string[]) {
  console.log(`\n[verify] ${label}`);
  const child = Bun.spawn([process.execPath, ...args], {
    cwd: path.resolve(import.meta.dir, ".."),
    env: Bun.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit"
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${exitCode}.`);
  }
}

export async function verify() {
  const projectRoot = path.resolve(import.meta.dir, "..");
  const [bunVersionFile, packageJson] = await Promise.all([
    Bun.file(path.join(projectRoot, ".bun-version")).text(),
    Bun.file(path.join(projectRoot, "package.json")).json()
  ]);
  const version = validateBunVersionPins(
    Bun.version,
    bunVersionFile,
    packageJson as PackageVersionPins
  );
  console.log(`[verify] Bun ${version}`);

  await runStep("TypeScript typecheck", ["x", "tsc", "--noEmit"]);
  await runStep("Test suite", [
    "test",
    "--path-ignore-patterns=cdk.out/**",
    "test/"
  ]);
  await runStep("Offline CDK synth and cdk-nag", [
    "run",
    "infra/cdk/bin/verify-synth.ts"
  ]);
}

if (import.meta.main) {
  try {
    await verify();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Verification failed."
    );
    process.exit(1);
  }
}
