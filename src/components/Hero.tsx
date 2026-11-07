// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { Movie } from "../types";

interface HeroProps {
  movie: Movie;
  onPlay: (titleId: string) => void;
  onTrailer: (movie: Movie) => void;
}

export function Hero({ movie, onPlay, onTrailer }: HeroProps) {
  const [firstWord, ...rest] = movie.title.split(" ");
  const displayTail = rest.length ? rest.join(" ") : firstWord.slice(5);
  const displayHead = rest.length ? firstWord : firstWord.slice(0, 5);

  return (
    <section className="hero" id="featured" aria-labelledby="hero-title">
      <div className="orb orb-one" />
      <div className="orb orb-two" />
      <div className="hero-grid" />
      <div className="hero-copy">
        <p className="eyebrow">
          <span>LEDGER LODGE ORIGINAL</span>
          <span>NEW RELEASE</span>
        </p>
        <h1 id="hero-title">
          {displayHead}
          <span>{displayTail}</span>
        </h1>
        <p className="hero-meta">
          {movie.year} · {movie.rating} · {movie.runtime} · {movie.genre}
        </p>
        <p className="hero-description">{movie.description}</p>
        <div className="hero-actions">
          <button className="trailer-action" onClick={() => onTrailer(movie)}>
            <span className="trailer-play-icon">▶</span>
            Watch trailer
          </button>
          <button className="primary-action" onClick={() => onPlay(movie.id)}>
            Rent for {movie.price.toFixed(2)} {movie.currency}
          </button>
          <button className="icon-action" aria-label={`Add ${movie.title} to watchlist`}>
            ＋
          </button>
        </div>
        <p className="access-note">One payment · 48-hour access · No subscription</p>
      </div>
      <div className="hero-art">
        <div className="planet" />
        <div className="astronaut">
          <div className="helmet">
            <div className="visor" />
          </div>
          <div className="body" />
        </div>
        <p className="poster-credit">
          A FILM BY
          <br />
          MARA VOSS
        </p>
        <button
          className="hero-trailer-launch"
          onClick={() => onTrailer(movie)}
          aria-label={`Watch the trailer for ${movie.title}`}
        >
          <span>▶</span>
          <strong>Watch trailer</strong>
          <small>{movie.runtime} feature</small>
        </button>
      </div>
      <div className="scroll-cue">
        <span />EXPLORE THE COLLECTION
      </div>
    </section>
  );
}
