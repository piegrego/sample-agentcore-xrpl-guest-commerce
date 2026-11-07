// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";

const entryPath = process.argv[2];
if (!entryPath) {
  throw new Error("Browser bundle entry path is required.");
}

const browserWindow = new Window({
  url: "https://agentcore-xrpl.example.test/"
});
browserWindow.document.body.innerHTML = '<div id="root"></div>';

const browserGlobals = {
  window: browserWindow,
  self: browserWindow,
  document: browserWindow.document,
  navigator: browserWindow.navigator,
  location: browserWindow.location,
  Node: browserWindow.Node,
  Element: browserWindow.Element,
  HTMLElement: browserWindow.HTMLElement,
  HTMLIFrameElement: browserWindow.HTMLIFrameElement,
  Event: browserWindow.Event,
  KeyboardEvent: browserWindow.KeyboardEvent,
  MouseEvent: browserWindow.MouseEvent,
  CustomEvent: browserWindow.CustomEvent,
  MutationObserver: browserWindow.MutationObserver,
  getComputedStyle: browserWindow.getComputedStyle.bind(browserWindow),
  requestAnimationFrame:
    browserWindow.requestAnimationFrame.bind(browserWindow),
  cancelAnimationFrame:
    browserWindow.cancelAnimationFrame.bind(browserWindow)
};
Object.assign(globalThis, browserGlobals);

const catalog = {
  catalog: [
    {
      id: "afterlight",
      title: "Afterlight",
      tagline: "Some signals arrive too late.",
      year: 2026,
      rating: "PG-13",
      runtime: "1h 47m",
      genre: "Sci-fi drama",
      price: 0.65,
      currency: "XRP",
      accent: "violet",
      featured: true,
      description: "Browser smoke-test title."
    }
  ]
};
const session = {
  id: "browser-test",
  currency: "XRP",
  backend: "xrpl",
  network: "XRPL Testnet",
  authenticated: false,
  approvalModes: ["runtime"],
  limit: 2,
  spent: 0,
  remaining: 2,
  expiresInMinutes: 28,
  transactions: []
};

const fetchStub = async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith("/api/catalog") || url === "/api/catalog") {
    return Response.json(catalog);
  }
  if (url.endsWith("/api/session") || url === "/api/session") {
    return Response.json(session);
  }
  return Response.json({ error: "unexpected_test_request" }, { status: 404 });
};
Object.assign(globalThis, { fetch: fetchStub });
Object.assign(browserWindow, { fetch: fetchStub });

// Simulate a real browser rather than Bun/Node. The application bootstrap must
// install Buffer before the dynamically imported XRPL graph runs.
Reflect.deleteProperty(globalThis, "Buffer");
Reflect.deleteProperty(browserWindow, "Buffer");

const errors: unknown[][] = [];
const originalConsoleError = console.error;
console.error = (...values: unknown[]) => {
  errors.push(values);
};

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

try {
  const browserBundle = (await import(pathToFileURL(entryPath).href)) as {
    applicationReady?: Promise<unknown>;
  };
  await browserBundle.applicationReady;

  if (Reflect.get(globalThis, "Buffer") === undefined) {
    throw new Error("The browser bootstrap did not install Buffer.");
  }
  const rendered = await waitFor(
    () =>
      Boolean(
        browserWindow.document
          .querySelector("#root")
          ?.textContent?.includes("Proof of Stay")
      ),
    2_000
  );
  if (!rendered) {
    throw new Error(
      `The browser bundle did not render the Proof of Stay application. Logged errors: ${JSON.stringify(errors)}`
    );
  }
  if (errors.length > 0) {
    throw new Error(
      `The browser bundle logged console errors: ${JSON.stringify(errors)}`
    );
  }
} finally {
  console.error = originalConsoleError;
  browserWindow.close();
}
