// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { ToastMessage } from "../types";

export function ToastRegion({ toasts }: { toasts: ToastMessage[] }) {
  return (
    <div className="toast-region" aria-live="polite">
      {toasts.map((toast) => (
        <div className="toast" key={toast.id}>
          <strong>{toast.label}</strong> {toast.message}
        </div>
      ))}
    </div>
  );
}
