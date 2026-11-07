// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { MovieVideoSource } from "../src/types";

/**
 * Add reviewable trailer and playback sources here without modifying the
 * catalog.
 *
 * Example:
 * movieTrailerSources.afterlight = {
 *   provider: "youtube",
 *   url: "https://www.youtube.com/watch?v=VIDEO_ID",
 *   title: "Afterlight — Official Trailer"
 * }
 *
 * Supported providers are YouTube, Vimeo, and direct HTTPS video files.
 */
export const movieTrailerSources: Partial<Record<string, MovieVideoSource>> = {};

export const movieVideoSources: Partial<Record<string, MovieVideoSource>> = {};
