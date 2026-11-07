// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { invoiceIdToInvoiceIdField } from "@x402/xrpl";
import { Wallet } from "xrpl";
import { installBrowserGlobals } from "../src/browserGlobals";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("browser bootstrap", () => {
  test("installs a browser-compatible Buffer global", () => {
    const target = {} as typeof globalThis;

    installBrowserGlobals(target);

    const BrowserBuffer = Reflect.get(target, "Buffer") as {
      from(value: string): { toString(encoding: string): string };
    };
    expect(BrowserBuffer.from("XRP").toString("hex")).toBe("585250");
  });

  test(
    "the browser-target bundle starts without Node globals",
    async () => {
      const outputDirectory = await mkdtemp(
        path.join(tmpdir(), "agentcore-xrpl-browser-smoke-")
      );
      temporaryDirectories.push(outputDirectory);

      const build = await Bun.build({
        entrypoints: [path.resolve(import.meta.dir, "../src/bootstrap.ts")],
        outdir: outputDirectory,
        target: "browser",
        format: "esm",
        splitting: true,
        minify: true,
        naming: {
          entry: "[name]-[hash].[ext]",
          chunk: "[name]-[hash].[ext]"
        }
      });
      expect(build.success).toBe(true);

      const entry = build.outputs.find(
        (output) => output.kind === "entry-point"
      );
      expect(entry).toBeDefined();

      const process = Bun.spawn(
        [
          Bun.which("bun") || "bun",
          path.join(import.meta.dir, "browser-runtime-runner.ts"),
          entry!.path
        ],
        {
          stdout: "pipe",
          stderr: "pipe"
        }
      );
      const [exitCode, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text()
      ]);

      expect(
        exitCode,
        `Browser smoke test failed.\nstdout:\n${stdout}\nstderr:\n${stderr}`
      ).toBe(0);
    },
    30_000
  );

  test(
    "the minified browser payment bundle calculates the signed XRPL hash",
    async () => {
      const outputDirectory = await mkdtemp(
        path.join(tmpdir(), "agentcore-xrpl-browser-payment-")
      );
      temporaryDirectories.push(outputDirectory);
      const wallet = Wallet.generate();
      const invoiceId = "ledger-lodge:v1:browser-regression:afterlight";
      const signed = wallet.sign({
        TransactionType: "Payment",
        Account: wallet.classicAddress,
        Destination: Wallet.generate().classicAddress,
        Amount: "200000",
        Fee: "10",
        Sequence: 1,
        LastLedgerSequence: 100
      });

      const build = await Bun.build({
        entrypoints: [
          path.resolve(import.meta.dir, "browser-payment-entry.ts")
        ],
        outdir: outputDirectory,
        target: "browser",
        format: "esm",
        splitting: true,
        minify: true,
        naming: {
          entry: "[name]-[hash].[ext]",
          chunk: "[name]-[hash].[ext]"
        }
      });
      expect(build.success).toBe(true);

      const entry = build.outputs.find(
        (output) => output.kind === "entry-point"
      );
      expect(entry).toBeDefined();

      const process = Bun.spawn(
        [
          Bun.which("bun") || "bun",
          path.join(import.meta.dir, "browser-payment-runtime-runner.ts"),
          entry!.path,
          signed.tx_blob,
          signed.hash,
          invoiceId,
          invoiceIdToInvoiceIdField(invoiceId)
        ],
        {
          stdout: "pipe",
          stderr: "pipe"
        }
      );
      const [exitCode, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text()
      ]);

      expect(
        exitCode,
        `Browser payment regression test failed.\nstdout:\n${stdout}\nstderr:\n${stderr}`
      ).toBe(0);
    },
    30_000
  );
});
