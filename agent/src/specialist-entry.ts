// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { handleSpecialistRequest } from "./specialist-runtime";

const port = Number(process.env.PORT || 8080);

if (import.meta.main) {
  const server = Bun.serve({
    port,
    hostname: "0.0.0.0",
    fetch: handleSpecialistRequest
  });
  console.log(`Demo specialist is listening on ${server.url}`);
}
