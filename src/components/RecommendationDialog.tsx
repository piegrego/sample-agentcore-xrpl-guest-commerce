// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { Movie, MovieCuration } from "../types";

interface RecommendationDialogProps {
  curation: MovieCuration;
  onClose: () => void;
  onPlay: (titleId: string) => void;
  onTrailer: (movie: Movie) => void;
}

export function RecommendationDialog({
  curation,
  onClose,
  onPlay,
  onTrailer
}: RecommendationDialogProps) {
  return (
    <div
      className="recommendation-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="recommendation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recommendation-dialog-title"
      >
        <button
          className="recommendation-close"
          type="button"
          onClick={onClose}
          aria-label="Close recommendations"
        >
          ×
        </button>
        <p className="section-kicker">YOUR LINEUP IS READY</p>
        <h2 id="recommendation-dialog-title">{curation.summary}</h2>
        <p className="recommendation-source">
          {curation.memoryInfluenced
            ? "Matched using this request and recalled viewing preferences."
            : "Matched using this request. No recalled preference changed these selections."}
        </p>
        <div className="recommendation-dialog-grid">
          {curation.recommendations.map(({ movie, reason }, index) => (
            <article key={movie.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <small>{movie.genre} · {movie.language}</small>
              <h3>{movie.title}</h3>
              <p>{reason}</p>
              <div>
                <button type="button" onClick={() => onTrailer(movie)}>
                  Watch trailer
                </button>
                <button type="button" onClick={() => onPlay(movie.id)}>
                  Rent · {movie.price.toFixed(2)} {movie.currency}
                </button>
              </div>
            </article>
          ))}
        </div>
        <button className="recommendation-continue" type="button" onClick={onClose}>
          Continue with For You
        </button>
      </section>
    </div>
  );
}
