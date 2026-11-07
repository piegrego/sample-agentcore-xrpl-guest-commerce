// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { ProcessPaymentCommand } from "@aws-sdk/client-bedrock-agentcore";
import type { x402HTTPClient } from "@x402/core/http";
import { Wallet } from "xrpl";
import {
  createAgentCorePaymentBackend,
  createPaymentClient,
  createXrplPaymentBackend,
  PaymentClientError,
  readPaymentChallenge,
  readPaymentRequirements,
  type PaidResourceRequest,
  type PaymentBackend,
  type PaymentRequirementView
} from "../packages/x402-payments/src";

function identifier(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function positiveAmount() {
  return String(randomInt(1, 1_000_000));
}

function evmAsset() {
  return `0x${randomBytes(20).toString("hex")}`;
}

function resourceUrl() {
  return `https://${randomUUID()}.example.test/resources/${randomUUID()}`;
}

function requirement(
  changes: Partial<PaymentRequirementView> = {}
): PaymentRequirementView {
  return {
    scheme: "exact",
    network: `xrpl:${randomInt(3, 10_000)}`,
    asset: "XRP",
    amount: positiveAmount(),
    payTo: Wallet.generate().classicAddress,
    ...changes
  };
}

function paymentRequiredBody(
  accepted: PaymentRequirementView[] = [requirement()]
) {
  return {
    challenge: {
      x402Version: 2,
      accepts: accepted,
      resource: {
        url: resourceUrl(),
        description: identifier("resource"),
        mimeType: "application/json"
      }
    }
  };
}

function paidResourceRequest(
  body: unknown,
  changes: Partial<PaidResourceRequest> = {}
): PaidResourceRequest {
  return {
    principalId: identifier("principal"),
    resourceUrl: resourceUrl(),
    firstResponse: new Response(null, { status: 402 }),
    paymentRequiredBody: body,
    approved: true,
    idempotencyKey: randomUUID(),
    ...changes
  };
}

function fakeBackend(
  name: PaymentBackend["name"],
  options: {
    supports?: boolean;
    responseStatus?: number;
    body?: unknown;
    execute?: (request: PaidResourceRequest) => Promise<never>;
  } = {}
): PaymentBackend {
  const body = options.body ?? { grant: identifier("grant") };
  return {
    name,
    supports: () => options.supports ?? true,
    async execute(request) {
      if (options.execute) return options.execute(request);
      return {
        response: Response.json(body, {
          status: options.responseStatus ?? 200
        }),
        body,
        providerId: identifier("provider"),
        stage: "merchant_accepted"
      };
    }
  };
}

function xrplHttpClient(transaction: string) {
  return {
    getPaymentRequiredResponse: (
      _getHeader: (name: string) => string | null,
      body: unknown
    ) => readPaymentChallenge(body),
    async createPaymentPayload() {
      return { payload: { signedTxBlob: randomBytes(32).toString("hex") } };
    },
    encodePaymentSignatureHeader() {
      return { "payment-signature": identifier("xrpl-proof") };
    },
    getPaymentSettleResponse() {
      return {
        success: true,
        transaction,
        network: `xrpl:${randomInt(3, 10_000)}`
      };
    }
  } as unknown as x402HTTPClient;
}

function agentCoreContext() {
  const region = identifier("region");
  const account = String(
    randomInt(100_000_000_000, 999_999_999_999)
  );
  return {
    paymentManagerArn: `arn:aws:bedrock-agentcore:${region}:${account}:payment-manager/${identifier("manager")}`,
    paymentSessionId: identifier("payment-session"),
    paymentInstrumentId: identifier("payment-instrument"),
    agentName: identifier("agent")
  };
}

describe("x402 payment facade", () => {
  test("generates isolated fixture values for every payment attempt", () => {
    const first = paidResourceRequest(paymentRequiredBody());
    const second = paidResourceRequest(paymentRequiredBody());

    expect(first.principalId).not.toBe(second.principalId);
    expect(first.resourceUrl).not.toBe(second.resourceUrl);
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
    expect(first.paymentRequiredBody).not.toEqual(
      second.paymentRequiredBody
    );
  });

  test("reads direct and wrapped x402 requirements", () => {
    const accepted = requirement();
    const direct = {
      x402Version: 2,
      accepts: [accepted]
    };

    expect(readPaymentChallenge(direct)).toEqual(direct);
    expect(readPaymentRequirements(direct)).toEqual([accepted]);
    expect(readPaymentRequirements({ challenge: direct })).toEqual([
      accepted
    ]);
    expect(readPaymentRequirements({ accepts: [null, {}] })).toEqual([]);
  });

  test("requires at least one uniquely named backend", () => {
    expect(() => createPaymentClient({ backends: [] })).toThrow(
      PaymentClientError
    );
    expect(() =>
      createPaymentClient({
        backends: [fakeBackend("xrpl"), fakeBackend("xrpl")]
      })
    ).toThrow("must be unique");
  });

  test("rejects an unapproved request before executing a backend", async () => {
    let executed = false;
    const backend = fakeBackend("xrpl", {
      async execute() {
        executed = true;
        throw new Error("Backend must not execute.");
      }
    });
    const body = paymentRequiredBody();
    const client = createPaymentClient({ backends: [backend] });

    await expect(
      client.payResource(
        paidResourceRequest(body, { approved: false })
      )
    ).rejects.toMatchObject({ code: "approval_required" });
    expect(executed).toBe(false);
  });

  test("validates the common paid-resource request", async () => {
    const body = paymentRequiredBody();
    const client = createPaymentClient({
      backends: [fakeBackend("xrpl")]
    });

    await expect(
      client.payResource(
        paidResourceRequest(body, { principalId: " " })
      )
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      client.payResource(
        paidResourceRequest(body, { idempotencyKey: " " })
      )
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      client.payResource(
        paidResourceRequest(body, { resourceUrl: identifier("invalid-url") })
      )
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      client.payResource(
        paidResourceRequest(body, {
          firstResponse: Response.json(body, { status: 200 })
        })
      )
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  test("selects the requested compatible backend", async () => {
    const body = paymentRequiredBody();
    const xrpl = fakeBackend("xrpl");
    const agentcore = fakeBackend("agentcore");
    const client = createPaymentClient({
      backends: [xrpl, agentcore]
    });

    const result = await client.payResource(
      paidResourceRequest(body, { preferredBackend: "agentcore" })
    );

    expect(result.status).toBe("resource_granted");
    expect(result.receipt.backend).toBe("agentcore");
  });

  test("rejects an incompatible preferred backend", async () => {
    const body = paymentRequiredBody();
    const client = createPaymentClient({
      backends: [fakeBackend("xrpl", { supports: false })]
    });

    await expect(
      client.payResource(
        paidResourceRequest(body, { preferredBackend: "xrpl" })
      )
    ).rejects.toMatchObject({ code: "unsupported_challenge" });
  });

  test("normalizes a rejected merchant retry without hiding its body", async () => {
    const body = paymentRequiredBody();
    const rejection = { error: identifier("merchant-rejection") };
    const client = createPaymentClient({
      backends: [
        fakeBackend("xrpl", {
          responseStatus: randomInt(400, 500),
          body: rejection
        })
      ]
    });

    const result = await client.payResource(paidResourceRequest(body));

    expect(result.status).toBe("merchant_retry_failed");
    expect(result.body).toEqual(rejection);
  });

  test("wraps an unexpected backend failure with a stable error code", async () => {
    const body = paymentRequiredBody();
    const failure = new Error(identifier("provider-failure"));
    const client = createPaymentClient({
      backends: [
        fakeBackend("xrpl", {
          async execute() {
            throw failure;
          }
        })
      ]
    });

    try {
      await client.payResource(paidResourceRequest(body));
      throw new Error("Expected payment execution to fail.");
    } catch (error) {
      expect(error).toMatchObject({ code: "backend_failed" });
      expect((error as Error).cause).toBe(failure);
    }
  });
});

describe("XRPL payment adapter", () => {
  test("supports only exact native-XRP requirements", () => {
    const backend = createXrplPaymentBackend({
      client: xrplHttpClient(identifier("transaction"))
    });

    expect(backend.supports(paymentRequiredBody())).toBe(true);
    expect(
      backend.supports(
        paymentRequiredBody([
          requirement({ scheme: identifier("scheme") })
        ])
      )
    ).toBe(false);
    expect(
      backend.supports(
        paymentRequiredBody([
          requirement({ asset: identifier("asset") })
        ])
      )
    ).toBe(false);
    expect(
      backend.supports(
        paymentRequiredBody([
          requirement({ network: `eip155:${randomInt(1, 10_000)}` })
        ])
      )
    ).toBe(false);
  });

  test("pays the resource and returns the XRPL transaction reference", async () => {
    const transaction = identifier("transaction");
    const body = paymentRequiredBody();
    const merchantBody = { access: identifier("access") };
    let sentHeaders: Headers | undefined;
    const backend = createXrplPaymentBackend({
      client: xrplHttpClient(transaction)
    });
    const client = createPaymentClient({ backends: [backend] });

    const result = await client.payResource(
      paidResourceRequest(body, {
        headers: {
          authorization: identifier("authorization"),
          "payment-signature": identifier("untrusted-proof")
        },
        fetch: async (_input, init) => {
          sentHeaders = new Headers(init?.headers);
          return Response.json(merchantBody, {
            headers: {
              "payment-response": identifier("settlement-header")
            }
          });
        }
      })
    );

    expect(result.status).toBe("resource_granted");
    expect(result.body).toEqual(merchantBody);
    expect(result.receipt).toMatchObject({
      backend: "xrpl",
      providerId: transaction,
      stage: "settled"
    });
    expect(sentHeaders?.get("authorization")).not.toBeNull();
    expect(sentHeaders?.get("payment-signature")).not.toContain(
      "untrusted-proof"
    );
  });

  test("shares custom resource parsing with the AgentCore adapter", async () => {
    const body = paymentRequiredBody();
    const raw = randomBytes(randomInt(8, 64));
    const backend = createXrplPaymentBackend({
      client: xrplHttpClient(identifier("transaction"))
    });
    const client = createPaymentClient({ backends: [backend] });

    const result = await client.payResource(
      paidResourceRequest(body, {
        fetch: async () => new Response(raw),
        responseParser: async (response) =>
          Buffer.from(await response.arrayBuffer())
      })
    );

    expect(result.body).toEqual(raw);
  });

  test("rejects unsupported challenges when called without the facade", async () => {
    const backend = createXrplPaymentBackend({
      client: xrplHttpClient(identifier("transaction"))
    });
    const body = paymentRequiredBody([
      requirement({
        network: `eip155:${randomInt(1, 10_000)}`,
        asset: evmAsset()
      })
    ]);

    await expect(
      backend.execute(paidResourceRequest(body))
    ).rejects.toMatchObject({
      code: "unsupported_challenge"
    });
  });

  test("does not allow direct adapter execution to bypass approval", async () => {
    const backend = createXrplPaymentBackend({
      client: xrplHttpClient(identifier("transaction"))
    });
    const body = paymentRequiredBody();

    await expect(
      backend.execute(
        paidResourceRequest(body, { approved: false })
      )
    ).rejects.toMatchObject({
      code: "approval_required"
    });
  });
});

describe("AgentCore Payments adapter", () => {
  test("matches only configured networks, assets, and schemes", () => {
    const network = `eip155:${randomInt(1, 10_000)}`;
    const asset = evmAsset();
    const backend = createAgentCorePaymentBackend({
      client: {
        async send() {
          throw new Error("The matching test must not process a payment.");
        }
      },
      context: agentCoreContext(),
      supportedNetworks: [network],
      supportedAssets: [asset]
    });

    expect(
      backend.supports(
        paymentRequiredBody([
          requirement({ network, asset, scheme: "exact" })
        ])
      )
    ).toBe(true);
    expect(
      backend.supports(
        paymentRequiredBody([
          requirement({
            network: `eip155:${randomInt(10_001, 20_000)}`,
            asset
          })
        ])
      )
    ).toBe(false);
    expect(
      backend.supports(
        paymentRequiredBody([
          requirement({ network, asset: evmAsset() })
        ])
      )
    ).toBe(false);
  });

  test("requires an explicit compatibility configuration", () => {
    expect(() =>
      createAgentCorePaymentBackend({
        client: {
          async send() {
            throw new Error("The configuration test must not execute.");
          }
        },
        context: agentCoreContext()
      })
    ).toThrow("supportedNetworks or supportsRequirement");
  });

  test("requires a non-empty unique proof-header configuration", () => {
    const options = {
      client: {
        async send() {
          throw new Error("The configuration test must not execute.");
        }
      },
      context: agentCoreContext(),
      supportsRequirement: () => true
    };

    expect(() =>
      createAgentCorePaymentBackend({
        ...options,
        proofHeaderNames: []
      })
    ).toThrow("proofHeaderNames");
    expect(() =>
      createAgentCorePaymentBackend({
        ...options,
        proofHeaderNames: ["x-payment", "x-payment"]
      })
    ).toThrow("proofHeaderNames");
  });

  test("does not let a dynamic matcher bypass the scheme allowlist", () => {
    const backend = createAgentCorePaymentBackend({
      client: {
        async send() {
          throw new Error("The matching test must not process a payment.");
        }
      },
      context: agentCoreContext(),
      supportsRequirement: () => true
    });
    const body = paymentRequiredBody([
      requirement({
        network: `eip155:${randomInt(1, 10_000)}`,
        asset: evmAsset(),
        scheme: identifier("unsupported-scheme")
      })
    ]);

    expect(backend.supports(body)).toBe(false);
  });

  test("processes proof and retries through the same facade contract", async () => {
    const network = `eip155:${randomInt(1, 10_000)}`;
    const asset = evmAsset();
    const accepted = requirement({ network, asset });
    const body = paymentRequiredBody([accepted]);
    const context = agentCoreContext();
    const proof = { signature: identifier("proof") };
    const processPaymentId = identifier("process-payment");
    const merchantBody = { access: identifier("access") };
    let commandInput: ProcessPaymentCommand["input"] | undefined;
    let sentHeaders: Headers | undefined;
    const backend = createAgentCorePaymentBackend({
      client: {
        async send(command) {
          commandInput = command.input;
          return {
            processPaymentId,
            paymentManagerArn: context.paymentManagerArn,
            paymentSessionId: context.paymentSessionId,
            paymentInstrumentId: context.paymentInstrumentId,
            paymentType: "CRYPTO_X402",
            status: "PROOF_GENERATED",
            paymentOutput: {
              cryptoX402: {
                version: String(body.challenge.x402Version),
                payload: proof
              }
            },
            createdAt: new Date(),
            updatedAt: new Date(),
            $metadata: {}
          };
        }
      },
      context: async (request) => {
        expect(request.principalId).not.toBe("");
        return context;
      },
      supportedNetworks: [network],
      supportedAssets: [asset]
    });
    const client = createPaymentClient({ backends: [backend] });
    const request = paidResourceRequest(body, {
      preferredBackend: "agentcore",
      headers: {
        authorization: identifier("authorization"),
        "x-payment": identifier("untrusted-proof")
      },
      fetch: async (_input, init) => {
        sentHeaders = new Headers(init?.headers);
        return Response.json(merchantBody);
      }
    });

    const result = await client.payResource(request);

    expect(commandInput).toMatchObject({
      userId: request.principalId,
      agentName: context.agentName,
      paymentManagerArn: context.paymentManagerArn,
      paymentSessionId: context.paymentSessionId,
      paymentInstrumentId: context.paymentInstrumentId,
      paymentType: "CRYPTO_X402",
      clientToken: request.idempotencyKey,
      paymentInput: {
        cryptoX402: {
          version: String(body.challenge.x402Version),
          payload: body.challenge
        }
      }
    });
    expect(result).toMatchObject({
      status: "resource_granted",
      body: merchantBody,
      receipt: {
        backend: "agentcore",
        providerId: processPaymentId,
        stage: "merchant_accepted"
      }
    });
    expect(sentHeaders?.get("authorization")).not.toBeNull();
    expect(sentHeaders?.get("x-payment")).toBe(JSON.stringify(proof));
    expect(sentHeaders?.get("payment-signature")).toBe(
      JSON.stringify(proof)
    );
  });

  test("validates the AgentCore idempotency token length", async () => {
    const network = `eip155:${randomInt(1, 10_000)}`;
    const asset = evmAsset();
    const body = paymentRequiredBody([
      requirement({ network, asset })
    ]);
    const backend = createAgentCorePaymentBackend({
      client: {
        async send() {
          throw new Error("An invalid token must not reach AgentCore.");
        }
      },
      context: agentCoreContext(),
      supportedNetworks: [network],
      supportedAssets: [asset]
    });
    const client = createPaymentClient({ backends: [backend] });

    await expect(
      client.payResource(
        paidResourceRequest(body, {
          idempotencyKey: randomBytes(randomInt(1, 16))
            .toString("hex")
        })
      )
    ).rejects.toMatchObject({
      code: "invalid_request"
    });
  });

  test("preserves the provider response when proof generation fails", async () => {
    const network = `eip155:${randomInt(1, 10_000)}`;
    const body = paymentRequiredBody([
      requirement({ network, asset: evmAsset() })
    ]);
    const providerResponse = {
      processPaymentId: identifier("process-payment"),
      status: identifier("provider-status"),
      $metadata: {}
    };
    const backend = createAgentCorePaymentBackend({
      client: {
        async send() {
          return providerResponse as never;
        }
      },
      context: agentCoreContext(),
      supportedNetworks: [network]
    });
    const client = createPaymentClient({ backends: [backend] });

    await expect(
      client.payResource(paidResourceRequest(body))
    ).rejects.toMatchObject({
      code: "backend_failed",
      details: providerResponse
    });
  });

  test("validates resolved AgentCore payment context", async () => {
    const network = `eip155:${randomInt(1, 10_000)}`;
    const body = paymentRequiredBody([
      requirement({ network, asset: evmAsset() })
    ]);
    const context = agentCoreContext();
    const backend = createAgentCorePaymentBackend({
      client: {
        async send() {
          throw new Error("Invalid context must not reach AgentCore.");
        }
      },
      context: {
        ...context,
        paymentSessionId: " "
      },
      supportedNetworks: [network]
    });
    const client = createPaymentClient({ backends: [backend] });

    await expect(
      client.payResource(paidResourceRequest(body))
    ).rejects.toMatchObject({
      code: "invalid_request"
    });
  });

  test("rejects a challenge that is not JSON-compatible", async () => {
    const network = `eip155:${randomInt(1, 10_000)}`;
    const body = paymentRequiredBody([
      requirement({ network, asset: evmAsset() })
    ]);
    const challenge = body.challenge as Record<string, unknown>;
    challenge.circular = challenge;
    const backend = createAgentCorePaymentBackend({
      client: {
        async send() {
          throw new Error("Invalid JSON must not reach AgentCore.");
        }
      },
      context: agentCoreContext(),
      supportedNetworks: [network]
    });
    const client = createPaymentClient({ backends: [backend] });

    await expect(
      client.payResource(paidResourceRequest(body))
    ).rejects.toMatchObject({
      code: "invalid_request"
    });
  });

  test("reports proof generation when the merchant rejects the retry", async () => {
    const network = `eip155:${randomInt(1, 10_000)}`;
    const body = paymentRequiredBody([
      requirement({ network, asset: evmAsset() })
    ]);
    const backend = createAgentCorePaymentBackend({
      client: {
        async send() {
          return {
            processPaymentId: identifier("process-payment"),
            status: "PROOF_GENERATED",
            paymentOutput: {
              cryptoX402: {
                version: String(body.challenge.x402Version),
                payload: identifier("proof")
              }
            },
            $metadata: {}
          } as never;
        }
      },
      context: agentCoreContext(),
      supportedNetworks: [network]
    });
    const client = createPaymentClient({ backends: [backend] });

    const result = await client.payResource(
      paidResourceRequest(body, {
        fetch: async () =>
          Response.json(
            { error: identifier("merchant-rejection") },
            { status: randomInt(400, 500) }
          )
      })
    );

    expect(result.status).toBe("merchant_retry_failed");
    expect(result.receipt.stage).toBe("proof_generated");
  });

  test("parses non-JSON merchant resources as text", async () => {
    const network = `eip155:${randomInt(1, 10_000)}`;
    const body = paymentRequiredBody([
      requirement({ network, asset: evmAsset() })
    ]);
    const text = identifier("paid-text");
    const backend = createAgentCorePaymentBackend({
      client: {
        async send() {
          return {
            processPaymentId: identifier("process-payment"),
            status: "PROOF_GENERATED",
            paymentOutput: {
              cryptoX402: {
                version: String(body.challenge.x402Version),
                payload: identifier("proof")
              }
            },
            $metadata: {}
          } as never;
        }
      },
      context: agentCoreContext(),
      supportedNetworks: [network]
    });
    const client = createPaymentClient({ backends: [backend] });

    const result = await client.payResource(
      paidResourceRequest(body, {
        fetch: async () =>
          new Response(text, {
            headers: { "content-type": "text/plain" }
          })
      })
    );

    expect(result.body).toBe(text);
  });
});
