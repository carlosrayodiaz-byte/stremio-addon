// tmdb.js - Funciones para interactuar con la API de TMDB

const fetch = require("node-fetch");
const { MARVEL_CHRONOLOGICAL } = require("./catalogs");

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE  = "https://image.tmdb.org/t/p/w500";

// Cache simple en memoria (evita llamadas repetidas)
const cache = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1 hora

async function tmdbFetch(path, apiKey) {
  const url = `${TMDB_BASE}${path}${path.includes("?") ? "&" : "?"}api_key=${apiKey}&language=es-ES`;

  if (cache.has(url)) {
    const { data, ts } = cache.get(url);
    if (Date.now() - ts < CACHE_TTL) return data;
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB error: ${res.status} for ${path}`);
  const data = await res.json();
  cache.set(url, { data, ts: Date.now() });
  return data;
}

// Convierte un resultado de TMDB al formato meta de Stremio
function toMeta(movie) {
  if (!movie) return null;
  const imdb = movie.imdb_id || movie.external_ids?.imdb_id || null;
  return {
    id: imdb || `tmdb:${movie.id}`,
    type: "movie",
    name: movie.title || movie.name || "Sin título",
    poster: movie.poster_path ? `${IMG_BASE}${movie.poster_path}` : null,
    background: movie.backdrop_path ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}` : null,
    description: movie.overview || "",
    releaseInfo: movie.release_date ? movie.release_date.substring(0, 4) : "",
    imdbRating: movie.vote_average ? movie.vote_average.toFixed(1) : null,
    genres: movie.genres ? movie.genres.map(g => g.name) : [],
    runtime: movie.runtime ? `${movie.runtime} min` : null,
  };
}

// Top IMDB All Time (discover ordenado por vote_average con mínimo de votos)
async function getTopIMDB(apiKey, page = 1) {
  const data = await tmdbFetch(
    `/discover/movie?sort_by=vote_average.desc&vote_count.gte=5000&page=${page}`,
    apiKey
  );
  return data.results || [];
}

// Top por año
async function getTopByYear(apiKey, year, page = 1) {
  const data = await tmdbFetch(
    `/discover/movie?sort_by=vote_average.desc&vote_count.gte=500&primary_release_year=${year}&page=${page}`,
    apiKey
  );
  return data.results || [];
}

// Top por década
async function getTopByDecade(apiKey, startYear, endYear, page = 1) {
  const data = await tmdbFetch(
    `/discover/movie?sort_by=vote_average.desc&vote_count.gte=1000&primary_release_date.gte=${startYear}-01-01&primary_release_date.lte=${endYear}-12-31&page=${page}`,
    apiKey
  );
  return data.results || [];
}

// Top por género
async function getTopByGenre(apiKey, genreId, page = 1) {
  const data = await tmdbFetch(
    `/discover/movie?sort_by=vote_average.desc&vote_count.gte=1000&with_genres=${genreId}&page=${page}`,
    apiKey
  );
  return data.results || [];
}

// Saga completa desde colección TMDB
async function getCollection(apiKey, collectionId) {
  const data = await tmdbFetch(`/collection/${collectionId}`, apiKey);
  const parts = (data.parts || []).sort((a, b) => {
    const da = a.release_date || "0";
    const db = b.release_date || "0";
    return da.localeCompare(db);
  });
  return parts;
}

// Marvel MCU en orden cronológico (usando los IMDB IDs hardcodeados)
async function getMarvelChronological(apiKey) {
  const results = [];
  for (const movie of MARVEL_CHRONOLOGICAL) {
    try {
      const data = await tmdbFetch(`/find/${movie.imdb}?external_source=imdb_id`, apiKey);
      const found = data.movie_results?.[0];
      if (found) {
        found.imdb_id = movie.imdb;
        results.push(found);
      }
    } catch (e) {
      console.error(`Error fetching ${movie.title}:`, e.message);
    }
  }
  return results;
}

// Ganadores Oscar Mejor Película (IDs TMDB hardcodeados - más estables)
const OSCAR_WINNERS_TMDB = [
  550, 424, 19404, 278, 238, 240, 389, 372058, 244786, 194,
  769, 680, 637, 98, 745, 497, 311, 264644, 274, 901,
  562, 293660, 259693, 381288, 296524, 399055, 337167,
  399579, 490132, 520763, 581734, 603692
];

async function getOscarWinners(apiKey) {
  const results = [];
  for (const id of OSCAR_WINNERS_TMDB.slice(0, 20)) {
    try {
      const data = await tmdbFetch(`/movie/${id}?append_to_response=external_ids`, apiKey);
      if (data) results.push(data);
    } catch (e) {
      console.error(`Oscar winner TMDB ${id} error:`, e.message);
    }
  }
  return results;
}

module.exports = {
  tmdbFetch,
  toMeta,
  getTopIMDB,
  getTopByYear,
  getTopByDecade,
  getTopByGenre,
  getCollection,
  getMarvelChronological,
  getOscarWinners,
};
