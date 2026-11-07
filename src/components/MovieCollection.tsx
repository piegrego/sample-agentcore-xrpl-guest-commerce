// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useMemo, useState } from "react";
import type { Movie, MovieCuration } from "../types";
import {
  catalogFilterOptions,
  emptyCatalogFilters,
  filterCatalog,
  type CatalogFilters
} from "../lib/catalogFilters";
import { MovieCard } from "./MovieCard";

interface MovieCollectionProps {
  movies: Movie[];
  curation: MovieCuration | null;
  onPlay: (titleId: string) => void;
  onTrailer: (movie: Movie) => void;
}

const PAGE_SIZE = 8;

export function MovieCollection({
  movies,
  curation,
  onPlay,
  onTrailer
}: MovieCollectionProps) {
  const [filters, setFilters] =
    useState<CatalogFilters>(emptyCatalogFilters);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"for-you" | "library">("library");
  const options = useMemo(() => catalogFilterOptions(movies), [movies]);
  const curatedMovies = useMemo(
    () => curation?.recommendations.map(({ movie }) => movie) || [],
    [curation]
  );
  const forYou = view === "for-you" && Boolean(curation);
  const filteredMovies = useMemo(
    () => (forYou ? curatedMovies : filterCatalog(movies, filters)),
    [curatedMovies, filters, forYou, movies]
  );
  const pageCount = Math.max(1, Math.ceil(filteredMovies.length / PAGE_SIZE));
  const pageMovies = filteredMovies.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );
  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  useEffect(() => setPage(1), [filters]);
  useEffect(() => {
    if (curation) {
      setView("for-you");
      setPage(1);
    }
  }, [curation?.createdAt]);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const updateFilter = (name: keyof CatalogFilters, value: string) => {
    setFilters((current) => ({ ...current, [name]: value }));
  };

  return (
    <section className="collection" id="collection" aria-labelledby="collection-title">
      <div className="section-header">
        <div>
          <p className="section-kicker">
            {forYou ? "CURATED FOR TONIGHT" : "THE MEDIA LIBRARY"}
          </p>
          <h2 id="collection-title">
            {forYou
              ? `${curatedMovies.length} picks matched to you.`
              : `${movies.length} stories worth paying attention to.`}
          </h2>
        </div>
        <p>
          {forYou
            ? curation?.summary
            : "Browse every title by genre, language, mood, pace, rating, or accessibility."}
        </p>
      </div>
      <div className="catalog-view-tabs" role="tablist" aria-label="Movie collection view">
        <button
          type="button"
          role="tab"
          aria-selected={forYou}
          disabled={!curation}
          onClick={() => setView("for-you")}
        >
          For You
          {curation && <span>{curatedMovies.length}</span>}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!forYou}
          onClick={() => setView("library")}
        >
          All Movies <span>{movies.length}</span>
        </button>
      </div>
      {!forYou && <div className="catalog-toolbar" aria-label="Catalog filters">
        <label className="catalog-search">
          <span>Search</span>
          <input
            type="search"
            value={filters.query}
            placeholder="Title, theme, or keyword"
            onChange={(event) => updateFilter("query", event.target.value)}
          />
        </label>
        {[
          ["genre", "Genre", options.genres],
          ["language", "Language", options.languages],
          ["mood", "Mood", options.moods],
          ["pace", "Pace", options.paces],
          ["rating", "Rating", options.ratings]
        ].map(([name, label, values]) => (
          <label key={String(name)}>
            <span>{String(label)}</span>
            <select
              value={filters[name as keyof CatalogFilters]}
              onChange={(event) =>
                updateFilter(
                  name as keyof CatalogFilters,
                  event.target.value
                )
              }
            >
              <option value="">All</option>
              {(values as string[]).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label>
          <span>Accessibility</span>
          <select
            value={filters.accessibility}
            onChange={(event) =>
              updateFilter("accessibility", event.target.value)
            }
          >
            <option value="">All</option>
            <option value="captions">Captions</option>
            <option value="audio-description">Audio description</option>
          </select>
        </label>
      </div>}
      <div className="catalog-results">
        <p>
          {forYou
            ? `${filteredMovies.length} recommendations based on ${curation?.memoryInfluenced ? "your request and recalled preferences" : "your current request"}`
            : `Showing ${filteredMovies.length} of ${movies.length} titles`}
          {!forYou && activeFilterCount
            ? ` across ${activeFilterCount} active filter${activeFilterCount === 1 ? "" : "s"}`
            : ""}
          .
        </p>
        {!forYou && activeFilterCount > 0 && (
          <button
            type="button"
            onClick={() => setFilters(emptyCatalogFilters)}
          >
            Clear filters
          </button>
        )}
      </div>
      <div className="movie-grid">
        {pageMovies.map((movie, index) => (
          <MovieCard
            key={movie.id}
            movie={movie}
            index={(page - 1) * PAGE_SIZE + index}
            onPlay={onPlay}
            onTrailer={onTrailer}
            reason={
              forYou
                ? curation?.recommendations.find(
                    (recommendation) => recommendation.movie.id === movie.id
                  )?.reason
                : undefined
            }
          />
        ))}
      </div>
      {!pageMovies.length && (
        <div className="catalog-empty">
          <strong>No titles match those preferences.</strong>
          <p>Clear a filter or try a broader search.</p>
        </div>
      )}
      {!forYou && pageCount > 1 && (
        <nav className="catalog-pagination" aria-label="Catalog pages">
          <button
            type="button"
            disabled={page === 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Previous
          </button>
          {Array.from({ length: pageCount }, (_, index) => index + 1).map(
            (pageNumber) => (
              <button
                key={pageNumber}
                className={pageNumber === page ? "active" : ""}
                type="button"
                aria-current={pageNumber === page ? "page" : undefined}
                onClick={() => setPage(pageNumber)}
              >
                {pageNumber}
              </button>
            )
          )}
          <button
            type="button"
            disabled={page === pageCount}
            onClick={() =>
              setPage((current) => Math.min(pageCount, current + 1))
            }
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}
