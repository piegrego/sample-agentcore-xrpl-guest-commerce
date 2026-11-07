// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Buffer } from "buffer";

export function installBrowserGlobals(target: typeof globalThis = globalThis) {
  if (Reflect.get(target, "Buffer") === undefined) {
    Object.defineProperty(target, "Buffer", {
      configurable: true,
      writable: true,
      value: Buffer
    });
  }
}
