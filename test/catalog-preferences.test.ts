// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, test } from "bun:test";
import { catalogSize, createCatalog } from "../server/catalog";
import { resolveMovieVideo } from "../src/lib/video";

describe("preference-rich movie catalog", () => {
  test("offers enough varied titles for meaningful memory-based recommendations", () => {
    const catalog = createCatalog("XRP");
    const ids = new Set(catalog.map((movie) => movie.id));
    const genres = new Set(catalog.flatMap((movie) => movie.genres || []));
    const moods = new Set(catalog.flatMap((movie) => movie.moods || []));
    const languages = new Set(catalog.map((movie) => movie.language));

    expect(catalog).toHaveLength(34);
    expect(catalogSize).toBe(34);
    expect(ids.size).toBe(catalog.length);
    expect(genres.size).toBeGreaterThanOrEqual(20);
    expect(moods.size).toBeGreaterThanOrEqual(20);
    expect(languages.size).toBeGreaterThanOrEqual(15);
    expect(
      catalog.every(
        (movie) =>
          movie.currency === "XRP" &&
          movie.genres?.length &&
          movie.moods?.length &&
          movie.themes?.length &&
          movie.language &&
          movie.pace &&
          movie.accessibility
      )
    ).toBe(true);
    expect(
      catalog.some(
        (movie) =>
          movie.language === "Japanese" &&
          movie.pace === "gentle" &&
          movie.accessibility?.captions
      )
    ).toBe(true);
  });

  test("creates privacy-enhanced YouTube and Vimeo embeds", () => {
    expect(
      resolveMovieVideo(
        {
          provider: "youtube",
          url: "https://www.youtube.com/watch?v=abc_123-XYZ"
        },
        "Demo title"
      )
    ).toEqual({
      kind: "embed",
      url: "https://www.youtube-nocookie.com/embed/abc_123-XYZ?rel=0",
      title: "Demo title"
    });
    expect(
      resolveMovieVideo({
        provider: "vimeo",
        url: "https://vimeo.com/123456789",
        title: "Vimeo title"
      })
    ).toEqual({
      kind: "embed",
      url: "https://player.vimeo.com/video/123456789",
      title: "Vimeo title"
    });
  });

  test("allows direct HTTPS media and rejects unsafe or mismatched links", () => {
    expect(
      resolveMovieVideo({
        provider: "direct",
        url: "https://media.example.test/movie.mp4"
      })
    ).toMatchObject({
      kind: "direct",
      url: "https://media.example.test/movie.mp4"
    });
    expect(
      resolveMovieVideo({
        provider: "direct",
        url: "http://media.example.test/movie.mp4"
      })
    ).toBeUndefined();
    expect(
      resolveMovieVideo({
        provider: "youtube",
        url: "https://example.test/not-youtube"
      })
    ).toBeUndefined();
  });
});
