// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

export function Brand({ footer = false }: { footer?: boolean }) {
  return (
    <a
      className={`brand${footer ? " footer-brand" : ""}`}
      href="#"
      aria-label="AWS Proof of Stay home"
    >
      <span className="aws-logo" aria-hidden="true">
        <span className="aws-wordmark">aws</span>
        <svg className="aws-smile" viewBox="0 0 48 12">
          <path d="M2 2.5c12 7.8 28 8.4 42.5 1.2" />
          <path d="m39.5 2 5.8 1.3-2.8 5.2" />
        </svg>
      </span>
      <span className="brand-name">Proof of Stay</span>
    </a>
  );
}
