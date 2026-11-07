// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { Movie } from "../types";

export interface CatalogFilters {
  query: string;
  genre: string;
  language: string;
  mood: string;
  pace: string;
  rating: string;
  accessibility: string;
}

export const emptyCatalogFilters: CatalogFilters = {
  query: "",
  genre: "",
  language: "",
  mood: "",
  pace: "",
  rating: "",
  accessibility: ""
};

function includesNormalized(values: string[] | undefined, expected: string) {
  return values?.some(
    (value) => value.toLowerCase() === expected.toLowerCase()
  );
}

export function filterCatalog(
  movies: Movie[],
  filters: CatalogFilters
) {
  const query = filters.query.trim().toLowerCase();
  return movies.filter((movie) => {
    const searchable = [
      movie.title,
      movie.description,
      movie.genre,
      movie.language,
      ...(movie.genres || []),
      ...(movie.moods || []),
      ...(movie.themes || [])
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return (
      (!query || searchable.includes(query)) &&
      (!filters.genre || includesNormalized(movie.genres, filters.genre)) &&
      (!filters.language || movie.language === filters.language) &&
      (!filters.mood || includesNormalized(movie.moods, filters.mood)) &&
      (!filters.pace || movie.pace === filters.pace) &&
      (!filters.rating || movie.rating === filters.rating) &&
      (!filters.accessibility ||
        (filters.accessibility === "captions" &&
          movie.accessibility?.captions === true) ||
        (filters.accessibility === "audio-description" &&
          movie.accessibility?.audioDescription === true))
    );
  });
}

export function catalogFilterOptions(movies: Movie[]) {
  const unique = (values: Array<string | undefined>) =>
    [...new Set(values.filter((value): value is string => Boolean(value)))]
      .sort((left, right) => left.localeCompare(right));

  return {
    genres: unique(movies.flatMap((movie) => movie.genres || [])),
    languages: unique(movies.map((movie) => movie.language)),
    moods: unique(movies.flatMap((movie) => movie.moods || [])),
    paces: unique(movies.map((movie) => movie.pace)),
    ratings: unique(movies.map((movie) => movie.rating))
  };
}
