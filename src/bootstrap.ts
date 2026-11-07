// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { installBrowserGlobals } from "./browserGlobals";

installBrowserGlobals();

// The application graph includes XRPL libraries that read the Node-compatible
// Buffer global during module initialization. Keep this import dynamic so the
// browser global is installed before those modules execute.
export const applicationReady = import("./main");
