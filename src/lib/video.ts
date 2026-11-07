// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { MovieVideoSource } from "../types";

export interface ResolvedMovieVideo {
  kind: "embed" | "direct";
  url: string;
  title: string;
}

function youtubeId(url: URL) {
  if (url.hostname === "youtu.be") {
    return url.pathname.split("/").filter(Boolean)[0];
  }
  if (
    url.hostname === "youtube.com" ||
    url.hostname === "www.youtube.com" ||
    url.hostname === "m.youtube.com" ||
    url.hostname === "youtube-nocookie.com" ||
    url.hostname === "www.youtube-nocookie.com"
  ) {
    if (url.pathname === "/watch") return url.searchParams.get("v") || undefined;
    const [kind, id] = url.pathname.split("/").filter(Boolean);
    if (kind === "embed" || kind === "shorts" || kind === "live") return id;
  }
  return undefined;
}

function vimeoId(url: URL) {
  if (
    url.hostname !== "vimeo.com" &&
    url.hostname !== "www.vimeo.com" &&
    url.hostname !== "player.vimeo.com"
  ) {
    return undefined;
  }
  return url.pathname
    .split("/")
    .filter(Boolean)
    .find((part) => /^\d+$/.test(part));
}

export function resolveMovieVideo(
  source: MovieVideoSource | undefined,
  fallbackTitle = "Movie"
): ResolvedMovieVideo | undefined {
  if (!source?.url.trim()) return undefined;

  let url: URL;
  try {
    url = new URL(source.url);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;

  const title = source.title?.trim() || fallbackTitle;
  if (source.provider === "youtube") {
    const id = youtubeId(url);
    return id
      ? {
          kind: "embed",
          url: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0`,
          title
        }
      : undefined;
  }
  if (source.provider === "vimeo") {
    const id = vimeoId(url);
    return id
      ? {
          kind: "embed",
          url: `https://player.vimeo.com/video/${id}`,
          title
        }
      : undefined;
  }
  return {
    kind: "direct",
    url: url.toString(),
    title
  };
}
