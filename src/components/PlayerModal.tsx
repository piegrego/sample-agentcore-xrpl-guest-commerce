// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { Accent, Movie, PlaybackResponse } from "../types";
import { resolveMovieVideo } from "../lib/video";

type PlayerModalProps = {
  onClose: () => void;
} & (
  | {
      mode: "playback";
      playback: PlaybackResponse;
    }
  | {
      mode: "trailer";
      trailer: Movie;
    }
);

const sceneColors: Record<Accent, [string, string]> = {
  violet: ["#7e4fc8", "#282039"],
  amber: ["#bf6a31", "#332015"],
  green: ["#328b68", "#102a24"],
  red: ["#a92f39", "#35151a"]
};

export function PlayerModal(props: PlayerModalProps) {
  const { onClose } = props;
  const trailerMode = props.mode === "trailer";
  const movie = trailerMode ? props.trailer : props.playback.title;
  const [glow, base] = sceneColors[movie.accent];
  const video = resolveMovieVideo(
    trailerMode ? movie.trailer : movie.video,
    trailerMode ? `${movie.title} — Trailer` : movie.title
  );
  const playerLabel = trailerMode ? "Trailer player" : "Movie player";

  return (
    <div
      className="player-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="player" role="dialog" aria-modal="true" aria-label={playerLabel}>
        <button className="player-close" onClick={onClose} aria-label="Close player">
          ×
        </button>
        <p className="player-mode-label">
          {trailerMode ? "TRAILER" : "NOW PLAYING"}
        </p>
        <div
          className="player-scene"
          style={{
            background: `radial-gradient(circle at 60% 40%, ${glow}, transparent 18%), radial-gradient(circle at 50% 50%, ${base}, #080a10 65%)`
          }}
        >
          {video ? (
            <div className="player-media">
              {video.kind === "embed" ? (
                <iframe
                  className="player-embed"
                  src={video.url}
                  title={video.title}
                  allow="accelerometer; autoplay; encrypted-media; fullscreen; picture-in-picture"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              ) : (
                <video
                  className="player-video"
                  src={video.url}
                  title={video.title}
                  controls
                  autoPlay
                  playsInline
                />
              )}
            </div>
          ) : (
            <>
              <div className="player-stars" />
              <div className="player-center">
                <div className="playing-pulse">▶</div>
                <p>{trailerMode ? "TRAILER LINK PENDING" : "SOURCE LINK PENDING"}</p>
                <h2>{movie.title}</h2>
                <span>
                  {trailerMode
                    ? "ADD A YOUTUBE, VIMEO, OR HTTPS SOURCE"
                    : `${props.playback.playback.message.toUpperCase()} · 48H ACCESS`}
                </span>
              </div>
              <div className="player-controls">
                <span>▶</span>
                <div className="player-track">
                  <i />
                </div>
                <span>00:00 / {trailerMode ? "TRAILER" : movie.runtime}</span>
                <span>⌗</span>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
