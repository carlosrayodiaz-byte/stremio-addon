// index.js - Stremio Addon: Catálogos Curados
// Autor: Carlos (via Claudio)

const express = require("express");
const cors = require("cors");
const {
  SAGA_COLLECTIONS,
  SPECIAL_CATALOGS,
  ALL_YEAR_CATALOGS,
  CARLOS_CATALOGS,
  CARLOS_SERIES,
} = require("./catalogs");
const {
  toMeta,
  getTopIMDB,
  getTopByYear,
  getTopByDecade,
  getTopByGenre,
  getCollection,
  getMarvelChronological,
  getOscarWinners,
} = require("./tmdb");

// ──────────────────────────────────────────────
// CONFIGURACIÓN — pon aquí tu API key de TMDB
// ──────────────────────────────────────────────
// Cargar .env manualmente
const fs = require("fs");
const path = require("path");
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8").split("\n").forEach(line => {
    const [key, ...val] = line.split("=");
    if (key && val.length) process.env[key.trim()] = val.join("=").trim();
  });
}

const TMDB_API_KEY = process.env.TMDB_API_KEY || "TU_API_KEY_AQUI";
const PORT = process.env.PORT || 7000;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://127.0.0.1:${PORT}`;

// Cargar datos verificados de forma lazy (después de arrancar)
let VERIFIED = null;
const verifiedPath = path.join(__dirname, "movies_verified.json");
setTimeout(() => {
  try {
    if (fs.existsSync(verifiedPath)) {
      VERIFIED = JSON.parse(fs.readFileSync(verifiedPath, "utf8"));
      console.log("✅ Usando movies_verified.json");
    } else {
      console.log("⚠️  Sin verificar. Ejecuta verify-movies.js");
    }
  } catch (e) {
    console.log("⚠️  Error cargando movies_verified.json:", e.message);
  }
}, 100);

// ──────────────────────────────────────────────
// MANIFEST
// ──────────────────────────────────────────────
const seriesCatalogs = SPECIAL_CATALOGS
  .filter(c => c.type === "series_carlos")
  .map(c => ({
    id: c.id,
    type: "series",
    name: c.name,
    extra: [{ name: "skip", isRequired: false }],
  }));

const allCatalogs = [
  ...SPECIAL_CATALOGS.filter(c => c.type !== "series_carlos"),
  ...SAGA_COLLECTIONS,
  ...ALL_YEAR_CATALOGS,
].map((c) => ({
  id: c.id,
  type: "movie",
  name: c.name,
  extra: [{ name: "skip", isRequired: false }],
}));

const MANIFEST = {
  id: "com.carlos.curated-catalogs",
  version: "1.0.0",
  name: "🎬 Catálogos Curados",
  description:
    "103 catálogos de películas + 3 de series. Marvel MCU, sagas, geopolítica, guerra, historia, por países y mucho más.",
  resources: ["catalog", "meta"],
  types: ["movie", "series"],
  catalogs: [...allCatalogs, ...seriesCatalogs],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, adult: false },
};

// ──────────────────────────────────────────────
// APP
// ──────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// Health check — Railway lo usa para verificar que el proceso está vivo
app.get("/health", (req, res) => res.send("OK"));
app.get("/", (req, res, next) => { res.set("X-Health", "ok"); next(); });

// Manifest
app.get("/manifest.json", (req, res) => {
  res.json(MANIFEST);
});

// ──────────────────────────────────────────────
// CATALOG HANDLER — SERIES
// ──────────────────────────────────────────────
app.get("/catalog/series/:id.json", async (req, res) => {
  const { id } = req.params;
  try {
    const special = SPECIAL_CATALOGS.find(c => c.id === id && c.type === "series_carlos");
    if (!special || !CARLOS_SERIES[special.key]) return res.json({ metas: [] });

    const list = CARLOS_SERIES[special.key];
    const { tmdbFetch } = require("./tmdb");
    const results = [];
    const BATCH = 5;

    for (let i = 0; i < list.length; i += BATCH) {
      const batch = list.slice(i, i + BATCH);
      const batchResults = await Promise.all(
        batch.map(async (s) => {
          try {
            const data = await tmdbFetch(
              `/find/${s.imdb}?external_source=imdb_id`,
              TMDB_API_KEY
            );
            const found = data.tv_results?.[0];
            if (found) {
              return {
                id: s.imdb,
                type: "series",
                name: found.name || s.title,
                poster: found.poster_path
                  ? `https://image.tmdb.org/t/p/w500${found.poster_path}`
                  : null,
                background: found.backdrop_path
                  ? `https://image.tmdb.org/t/p/original${found.backdrop_path}`
                  : null,
                description: found.overview || "",
                releaseInfo: found.first_air_date
                  ? found.first_air_date.substring(0, 4)
                  : "",
                imdbRating: found.vote_average
                  ? found.vote_average.toFixed(1)
                  : null,
              };
            }
          } catch (e) {}
          return { id: s.imdb, type: "series", name: s.title, poster: null };
        })
      );
      results.push(...batchResults);
    }
    res.json({ metas: results.filter(m => m && m.poster) });
  } catch (err) {
    console.error(`[SERIES CATALOG ERROR] ${id}:`, err.message);
    res.json({ metas: [] });
  }
});

// ──────────────────────────────────────────────
// CATALOG HANDLER — MOVIES
app.get("/catalog/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  const skip = parseInt(req.query.skip || "0");
  const page = Math.floor(skip / 20) + 1;

  if (type !== "movie") return res.json({ metas: [] });

  try {
    let movies = [];

    // ── Catálogos Carlos ──
    if (id.startsWith("carlos_")) {
      const special = SPECIAL_CATALOGS.find((c) => c.id === id);
      if (special && special.key) {
        // Usar datos verificados si existen — instantáneo, sin llamadas a TMDB
        if (VERIFIED?.movies?.[special.key]) {
          const metas = VERIFIED.movies[special.key]
            .filter(m => m.poster)
            .map(m => ({
              id: m.imdb, type: "movie", name: m.title,
              poster: m.poster, releaseInfo: m.year || "",
              imdbRating: m.rating || null,
            }));
          return res.json({ metas });
        }
        // Fallback en tiempo real si no hay verified
        if (CARLOS_CATALOGS[special.key]) {
          const list = CARLOS_CATALOGS[special.key];
          const { tmdbFetch } = require("./tmdb");
          const results = [];
          const BATCH = 5;
          for (let i = 0; i < list.length; i += BATCH) {
            const batch = list.slice(i, i + BATCH);
            const batchResults = await Promise.all(
              batch.map(async (m) => {
                try {
                  const data = await tmdbFetch(`/find/${m.imdb}?external_source=imdb_id`, TMDB_API_KEY);
                  const found = data.movie_results?.[0];
                  if (found) { found.imdb_id = m.imdb; return toMeta(found); }
                } catch (e) {}
                return { id: m.imdb, type: "movie", name: m.title, poster: null };
              })
            );
            results.push(...batchResults);
          }
          return res.json({ metas: results.filter(m => m && m.poster) });
        }
      }

    // ── Marvel MCU ──
    } else if (id === "catalog_marvel") {
      movies = await getMarvelChronological(TMDB_API_KEY);

    // ── Top IMDB All Time ──
    } else if (id === "catalog_top_all_time") {
      movies = await getTopIMDB(TMDB_API_KEY, page);

    // ── Oscars ──
    } else if (id === "catalog_oscars_best") {
      movies = await getOscarWinners(TMDB_API_KEY);

    // ── Top por año ──
    } else if (id.startsWith("catalog_top_") && /\d{4}$/.test(id)) {
      const year = parseInt(id.split("_").pop());
      movies = await getTopByYear(TMDB_API_KEY, year, page);

    // ── Top por década ──
    } else if (id === "catalog_top_decade_2010") {
      movies = await getTopByDecade(TMDB_API_KEY, 2010, 2019, page);
    } else if (id === "catalog_top_decade_2000") {
      movies = await getTopByDecade(TMDB_API_KEY, 2000, 2009, page);
    } else if (id === "catalog_top_decade_90") {
      movies = await getTopByDecade(TMDB_API_KEY, 1990, 1999, page);
    } else if (id === "catalog_top_decade_80") {
      movies = await getTopByDecade(TMDB_API_KEY, 1980, 1989, page);

    // ── Top por género ──
    } else if (id.endsWith("_top")) {
      const special = SPECIAL_CATALOGS.find((c) => c.id === id);
      if (special && special.genre_id) {
        movies = await getTopByGenre(TMDB_API_KEY, special.genre_id, page);
      }

    // ── Sagas (colecciones TMDB) ──
    } else {
      const saga = SAGA_COLLECTIONS.find((c) => c.id === id);
      if (saga) {
        movies = await getCollection(TMDB_API_KEY, saga.tmdb_collection);
      }
    }

    // Obtener external IDs para tener IMDB IDs cuando no los tenemos
    const metas = movies
      .map((m) => toMeta(m))
      .filter((m) => m && m.poster && m.id.startsWith("tt"));

    res.json({ metas });
  } catch (err) {
    console.error(`[CATALOG ERROR] ${id}:`, err.message);
    res.json({ metas: [] });
  }
});

// ──────────────────────────────────────────────
// META HANDLER (detalle de película individual)
// ──────────────────────────────────────────────
app.get("/meta/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  if (type !== "movie" || !id.startsWith("tt"))
    return res.json({ meta: null });

  try {
    const { tmdbFetch, toMeta } = require("./tmdb");
    const data = await tmdbFetch(
      `/find/${id}?external_source=imdb_id&append_to_response=external_ids`,
      TMDB_API_KEY
    );
    const found = data.movie_results?.[0];
    if (!found) return res.json({ meta: null });

    found.imdb_id = id;
    const meta = toMeta(found);
    res.json({ meta });
  } catch (err) {
    console.error(`[META ERROR] ${id}:`, err.message);
    res.json({ meta: null });
  }
});

// ──────────────────────────────────────────────
// PÁGINA DE INSTALACIÓN (abre en el navegador)
// ──────────────────────────────────────────────
app.get("/", (req, res) => {
  const manifestUrl = `${PUBLIC_URL}/manifest.json`;
  const stremioUrl  = `stremio://${PUBLIC_URL.replace("http://","").replace("https://","")}/manifest.json`;
  const webUrl      = `https://web.stremio.com/#/addons?addon=${encodeURIComponent(manifestUrl)}`;

  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Catálogos Curados — Stremio Addon</title>
      <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: 'Segoe UI', system-ui, sans-serif;
          background: #0a0a10;
          color: #e0e0f0;
          min-height: 100vh;
          padding: 40px 20px;
        }
        .container { max-width: 680px; margin: 0 auto; }

        h1 { font-size: 2rem; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 6px; }
        h1 span { color: #7c3aed; }
        .subtitle { color: #666; font-size: 0.95rem; margin-bottom: 32px; }

        .card {
          background: #13131f;
          border: 1px solid #1e1e35;
          border-radius: 14px;
          padding: 24px;
          margin-bottom: 20px;
        }
        .card h2 { font-size: 1rem; font-weight: 600; color: #9090bb; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px; }

        /* Botones principales */
        .btn-row { display: flex; gap: 10px; flex-wrap: wrap; }
        .btn {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 13px 22px;
          border-radius: 10px;
          font-size: 15px; font-weight: 600;
          text-decoration: none; cursor: pointer; border: none;
          transition: transform 0.15s, opacity 0.15s;
        }
        .btn:hover { transform: translateY(-1px); opacity: 0.9; }
        .btn-primary { background: #7c3aed; color: #fff; }
        .btn-secondary { background: #1e1e35; color: #c0c0e0; border: 1px solid #2e2e50; }
        .btn-copy { background: #1e1e35; color: #c0c0e0; border: 1px solid #2e2e50; font-size: 14px; padding: 10px 16px; }
        .btn-copy.copied { background: #14532d; color: #4ade80; border-color: #166534; }

        /* URL box */
        .url-box {
          display: flex; align-items: center; gap: 10px;
          background: #0a0a16;
          border: 1px solid #1e1e35;
          border-radius: 8px;
          padding: 12px 16px;
          margin-top: 16px;
        }
        .url-box code {
          flex: 1; font-size: 13px; color: #7c3aed;
          word-break: break-all; font-family: 'Consolas', monospace;
        }

        /* Steps */
        .steps { list-style: none; }
        .steps li {
          display: flex; align-items: flex-start; gap: 14px;
          padding: 10px 0;
          border-bottom: 1px solid #1a1a2e;
          font-size: 14px; color: #a0a0c0; line-height: 1.5;
        }
        .steps li:last-child { border-bottom: none; }
        .step-num {
          min-width: 26px; height: 26px;
          background: #7c3aed22; color: #7c3aed;
          border-radius: 50%; font-weight: 700; font-size: 13px;
          display: flex; align-items: center; justify-content: center;
        }

        /* Catálogos grid */
        .cat-section { margin-bottom: 12px; }
        .cat-label {
          font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px;
          color: #7c3aed; font-weight: 700; margin-bottom: 8px;
        }
        .cat-grid { display: flex; flex-wrap: wrap; gap: 6px; }
        .cat-pill {
          background: #0f0f20; border: 1px solid #1e1e35;
          border-radius: 20px; padding: 5px 12px;
          font-size: 13px; color: #c0c0e0;
        }
        .cat-pill.highlight { border-color: #7c3aed55; color: #a78bfa; background: #7c3aed11; }

        .status { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: #4ade80; }
        .dot { width: 8px; height: 8px; background: #4ade80; border-radius: 50%; animation: pulse 2s infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      </style>
    </head>
    <body>
      <div class="container">

        <h1>🎬 Catálogos <span>Curados</span></h1>
        <p class="subtitle">Stremio Addon · <span class="status"><span class="dot"></span>Servidor activo en puerto ${PORT}</span></p>

        <!-- INSTALAR -->
        <div class="card">
          <h2>⚡ Instalar</h2>
          <div class="btn-row">
            <a href="${stremioUrl}" class="btn btn-primary">Abrir en Stremio</a>
            <a href="${webUrl}" class="btn btn-secondary" target="_blank">Instalar vía Web</a>
          </div>
          <div class="url-box">
            <code id="manifest-url">${manifestUrl}</code>
            <button class="btn btn-copy" id="copy-btn" onclick="copyUrl()">📋 Copiar</button>
          </div>
        </div>

        <!-- PASOS ALTERNATIVOS -->
        <div class="card">
          <h2>🔧 Instalación manual</h2>
          <ol class="steps">
            <li><span class="step-num">1</span>Abre Stremio → icono de tuerca (⚙️) arriba a la derecha</li>
            <li><span class="step-num">2</span>Ve a <strong>Addons</strong> → <strong>Community Addons</strong> → campo de URL en la parte superior</li>
            <li><span class="step-num">3</span>Pega la URL de arriba y pulsa Enter</li>
            <li><span class="step-num">4</span>Acepta la instalación</li>
          </ol>
        </div>

        <!-- CATÁLOGOS -->
        <div class="card">
          <h2>📋 Catálogos incluidos</h2>

          <div class="cat-section">
            <div class="cat-label">🎖️ Carlos Picks — Épocas Históricas</div>
            <div class="cat-grid">
              <span class="cat-pill highlight">🎖️ Lo Mejor de Guerra</span>
              <span class="cat-pill highlight">🌍 Geopolítica & Poder</span>
              <span class="cat-pill highlight">🏛️ Historia Épica</span>
              <span class="cat-pill highlight">❄️ Guerra Fría & Espionaje</span>
              <span class="cat-pill highlight">💣 Conflictos Modernos</span>
              <span class="cat-pill highlight">⚔️ Segunda Guerra Mundial</span>
              <span class="cat-pill highlight">🪖 Primera Guerra Mundial</span>
              <span class="cat-pill highlight">🏺 Egipto & Mundo Clásico</span>
              <span class="cat-pill highlight">🪓 Vikingos</span>
              <span class="cat-pill highlight">🗡️ Edad Media</span>
              <span class="cat-pill highlight">🌿 Mesoamérica & Conquista</span>
              <span class="cat-pill highlight">🤠 Western</span>
              <span class="cat-pill highlight">🦅 Independencia & América Colonial</span>
              <span class="cat-pill highlight">🏛️ Roma & Grecia Clásica</span>
              <span class="cat-pill highlight">⛩️ Asia & Samurais</span>
              <span class="cat-pill highlight">🏹 Cruzadas & Tierra Santa</span>
              <span class="cat-pill highlight">🐉 Imperio Mongol</span>
              <span class="cat-pill highlight">☠️ Piratas & Alta Mar</span>
              <span class="cat-pill highlight">🎭 Revolución Francesa & Napoleón</span>
              <span class="cat-pill highlight">🌍 África Colonial</span>
              <span class="cat-pill highlight">🇷🇺 Rusia & Revolución</span>
              <span class="cat-pill highlight">🏯 China Imperial</span>
              <span class="cat-pill highlight">🌊 Conquista del Oeste</span>
            </div>
          </div>

          <div class="cat-section" style="margin-top:14px">
            <div class="cat-label">🔬 Ciencia, Tecnología & Futuro</div>
            <div class="cat-grid">
              <span class="cat-pill highlight">🔬 Ciencia & Tecnología</span>
              <span class="cat-pill highlight">🦠 Pandemias & Colapso</span>
              <span class="cat-pill highlight">🤖 IA & Distopía</span>
            </div>
          </div>

          <div class="cat-section" style="margin-top:14px">
            <div class="cat-label">🎬 Directores — Filmografía Completa</div>
            <div class="cat-grid">
              <span class="cat-pill highlight">🎬 Todo Kubrick</span>
              <span class="cat-pill highlight">🎬 Todo Nolan</span>
              <span class="cat-pill highlight">🎬 Todo Scorsese</span>
              <span class="cat-pill highlight">🎬 Todo Tarantino</span>
              <span class="cat-pill highlight">🎬 Todo Spielberg</span>
              <span class="cat-pill highlight">🎬 Todo Kurosawa</span>
            </div>
          </div>

          <div class="cat-section" style="margin-top:14px">
            <div class="cat-label">💰 Finanzas, Crimen & Culto</div>
            <div class="cat-grid">
              <span class="cat-pill highlight">💰 Finanzas & Codicia</span>
              <span class="cat-pill highlight">🕵️ Crimen Organizado & Mafias</span>
              <span class="cat-pill highlight">🧩 Culto & Underrated Gems</span>
              <span class="cat-pill highlight">🏆 Palma de Oro Cannes</span>
              <span class="cat-pill highlight">🎞️ Documentales Imprescindibles</span>
            </div>
          </div>

          <div class="cat-section" style="margin-top:14px">
            <div class="cat-label">🕵️ Inteligencia, Espionaje & Estado</div>
            <div class="cat-grid">
              <span class="cat-pill highlight">🕵️ Inteligencia & Espionaje Puro</span>
              <span class="cat-pill highlight">💣 Terrorismo & Yihad</span>
              <span class="cat-pill highlight">🧠 Psicología & Manipulación</span>
              <span class="cat-pill highlight">📡 Vigilancia & Estado Profundo</span>
              <span class="cat-pill highlight">⚖️ Juicios Históricos & Justicia</span>
              <span class="cat-pill highlight">🌐 Oriente Medio</span>
              <span class="cat-pill highlight">💀 Genocidios & Crímenes contra la Humanidad</span>
            </div>
          </div>

          <div class="cat-section" style="margin-top:14px">
            <div class="cat-label">🏴‍☠️ Temáticas Geopolíticas Específicas</div>
            <div class="cat-grid">
              <span class="cat-pill highlight">🏴‍☠️ Revoluciones & Guerrillas</span>
              <span class="cat-pill highlight">🛢️ Petróleo & Recursos</span>
              <span class="cat-pill highlight">🧬 Armas Nucleares & Carrera Armamentística</span>
              <span class="cat-pill highlight">🪖 Guerra de Vietnam</span>
              <span class="cat-pill highlight">🚀 Espacio & Exploración</span>
              <span class="cat-pill highlight">🎙️ Periodismo & Verdad vs Poder</span>
              <span class="cat-pill highlight">👑 Realeza & Monarquías</span>
              <span class="cat-pill highlight">⚔️ Resistencia & Ocupación</span>
            </div>
          </div>

          <div class="cat-section" style="margin-top:14px">
            <div class="cat-label">🌐 Cine del Mundo — Por País (completo)</div>
            <div class="cat-grid">
              <span class="cat-pill highlight">🌍 Mejor Cine Europeo</span>
              <span class="cat-pill highlight">🇫🇷 Cine Francés</span>
              <span class="cat-pill highlight">🇩🇪 Cine Alemán</span>
              <span class="cat-pill highlight">🇷🇺 Cine Ruso & Soviético</span>
              <span class="cat-pill highlight">🇸🇪 Cine Escandinavo</span>
              <span class="cat-pill highlight">🇹🇷 Cine Turco</span>
              <span class="cat-pill highlight">🇵🇱 Cine Polaco</span>
              <span class="cat-pill highlight">🇷🇴 Cine Rumano</span>
              <span class="cat-pill highlight">🇮🇹 Cine Italiano</span>
              <span class="cat-pill highlight">🇪🇸 Cine Español</span>
              <span class="cat-pill highlight">🇬🇧 Cine Británico</span>
              <span class="cat-pill highlight">🇬🇷 Cine Griego</span>
              <span class="cat-pill highlight">🇦🇺 Cine Australiano</span>
              <span class="cat-pill highlight">🎬 Sur de India (Tamil/Telugu)</span>
              <span class="cat-pill highlight">🇮🇱 Cine Israelí</span>
              <span class="cat-pill highlight">🌍 Cine Africano</span>
              <span class="cat-pill highlight">🌎 Cine Latinoamericano</span>
              <span class="cat-pill highlight">🇮🇳 Bollywood</span>
              <span class="cat-pill highlight">🇮🇷 Cine Iraní</span>
              <span class="cat-pill highlight">🌙 Cine Árabe</span>
              <span class="cat-pill highlight">🇨🇳 Cine Chino</span>
              <span class="cat-pill highlight">🇭🇰 Hong Kong</span>
              <span class="cat-pill highlight">🇹🇼 Cine Taiwanés</span>
              <span class="cat-pill highlight">🇰🇷 Cine Coreano</span>
              <span class="cat-pill highlight">🇯🇵 Cine Japonés</span>
              <span class="cat-pill highlight">🎭 Cine Indie & A24</span>
            </div>
          </div>

          <div class="cat-section" style="margin-top:14px">
            <div class="cat-label">🦸 Marvel & Sagas</div>
            <div class="cat-grid">
              <span class="cat-pill">Marvel MCU Cronológico</span>
              <span class="cat-pill">Star Wars</span>
              <span class="cat-pill">Harry Potter</span>
              <span class="cat-pill">LOTR</span>
              <span class="cat-pill">John Wick</span>
              <span class="cat-pill">Fast & Furious</span>
              <span class="cat-pill">Matrix</span>
              <span class="cat-pill">Batman Nolan</span>
              <span class="cat-pill">Indiana Jones</span>
              <span class="cat-pill">Alien</span>
            </div>
          </div>

          <div class="cat-section" style="margin-top:14px">
            <div class="cat-label">🌟 Rankings IMDB</div>
            <div class="cat-grid">
              <span class="cat-pill">Top 250 All Time</span>
              <span class="cat-pill">Ganadores Oscar</span>
              <span class="cat-pill">Mejores 80s / 90s / 2000s / 2010s</span>
              <span class="cat-pill">Top por año 1990–2025</span>
            </div>
          </div>

          <div class="cat-section" style="margin-top:14px">
            <div class="cat-label">🎭 Por género</div>
            <div class="cat-grid">
              <span class="cat-pill">😱 Terror</span>
              <span class="cat-pill">🚀 Sci-Fi</span>
              <span class="cat-pill">💥 Acción</span>
              <span class="cat-pill">😂 Comedia</span>
              <span class="cat-pill">🔪 Thriller</span>
              <span class="cat-pill">🎞️ Documentales</span>
              <span class="cat-pill">🎨 Animación</span>
            </div>
          </div>
        </div>

      </div>

      <script>
        function copyUrl() {
          const url = document.getElementById('manifest-url').textContent;
          const btn = document.getElementById('copy-btn');
          navigator.clipboard.writeText(url).then(() => {
            btn.textContent = '✅ Copiado';
            btn.classList.add('copied');
            setTimeout(() => {
              btn.textContent = '📋 Copiar';
              btn.classList.remove('copied');
            }, 2500);
          }).catch(() => {
            // fallback para contextos sin clipboard API
            const ta = document.createElement('textarea');
            ta.value = url;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            btn.textContent = '✅ Copiado';
            btn.classList.add('copied');
            setTimeout(() => {
              btn.textContent = '📋 Copiar';
              btn.classList.remove('copied');
            }, 2500);
          });
        }
      </script>
    </body>
    </html>
  `);
});

// ──────────────────────────────────────────────
// START
// ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎬 Stremio Addon - Catálogos Curados`);
  console.log(`✅ Corriendo en http://localhost:${PORT}`);
  console.log(`\n📋 Para instalar en Stremio:`);
  console.log(`   Abre tu navegador en: http://localhost:${PORT}`);
  console.log(`   O ve a Stremio → Addons → URL y pega:`);
  console.log(`   http://127.0.0.1:${PORT}/manifest.json\n`);

  // Keepalive — evita que Railway hiberne el contenedor
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    const keepaliveUrl = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/manifest.json`;
    setInterval(async () => {
      try {
        const fetch = require("node-fetch");
        await fetch(keepaliveUrl);
        console.log("💓 Keepalive ok");
      } catch (e) {}
    }, 4 * 60 * 1000); // cada 4 minutos
    console.log(`💓 Keepalive activo → ${keepaliveUrl}`);
  }
});
