// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { Movie } from "../types";

interface MovieCardProps {
  movie: Movie;
  index: number;
  onPlay: (titleId: string) => void;
  onTrailer: (movie: Movie) => void;
  reason?: string;
}

export function MovieCard({
  movie,
  index,
  onPlay,
  onTrailer,
  reason
}: MovieCardProps) {
  return (
    <article className="movie-card">
      <div className={`movie-poster ${movie.accent}`}>
        <span className="poster-index">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="poster-type">
          <small>{movie.genre.toUpperCase()}</small>
          <strong>{movie.title}</strong>
        </div>
      </div>
      {reason && <p className="recommendation-reason">{reason}</p>}
      <div className="card-info">
        <div>
          <h3>{movie.title}</h3>
          <p>
            {movie.year} · {movie.rating} · {movie.runtime}
          </p>
          {(movie.language || movie.moods?.[0]) && (
            <p className="movie-preferences">
              {[movie.language, movie.moods?.[0]].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        <div className="card-actions">
          <button type="button" onClick={() => onTrailer(movie)}>
            Trailer
          </button>
          <button type="button" onClick={() => onPlay(movie.id)}>
            Rent · {movie.price.toFixed(2)} {movie.currency}
          </button>
        </div>
      </div>
    </article>
  );
}
