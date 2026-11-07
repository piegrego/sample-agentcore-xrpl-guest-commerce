// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Brand } from "./Brand";
import type { PaymentBackend } from "../types";

export function Footer({ backend }: { backend: PaymentBackend }) {
  return (
    <footer>
      <Brand footer />
      <p>Agentic pay-per-view, powered by x402.</p>
      <p className="sandbox-label">
        {backend === "sandbox"
          ? "SANDBOX EXPERIENCE · NO REAL FUNDS"
          : `${backend.toUpperCase()} PAYMENT BACKEND · TEST FUNDS ONLY`}
      </p>
    </footer>
  );
}
