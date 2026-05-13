# 🎬 Stremio - Catálogos Curados

Addon para Stremio que añade catálogos curados: Marvel MCU cronológico, sagas completas, Top IMDB, mejores por año y género.

## Catálogos incluidos

- 🦸 **Marvel MCU** en orden cronológico (30 películas)
- 🌟 **Top 250 IMDB** All Time
- 🏆 **Ganadores Oscar** Mejor Película
- 📅 **Mejores por año** (1990–2025, uno por año)
- 📅 **Mejores por década** (80s, 90s, 2000s, 2010s)
- 😱 Top Terror · 🚀 Sci-Fi · 💥 Acción · 😂 Comedia · 🔪 Thriller · 🎞️ Documentales · 🎨 Animación
- **Sagas completas:** Star Wars, Harry Potter, LOTR, John Wick, Fast & Furious, Matrix, Batman Nolan, Indiana Jones, Alien, Terminator

## Requisitos

- [Node.js](https://nodejs.org) (v16 o superior)
- API Key gratuita de [TMDB](https://www.themoviedb.org/settings/api)
- Stremio instalado

## Instalación (Windows)

1. **Descomprime** la carpeta donde quieras
2. **Doble clic en `setup.bat`** → te pedirá tu TMDB API Key
3. **Doble clic en `start.bat`** para arrancar
4. Abre `http://localhost:7000` en el navegador
5. Pulsa el botón **"Instalar en Stremio"**

## Instalación manual

```bash
# 1. Instalar dependencias
npm install

# 2. Iniciar con tu API key
TMDB_API_KEY=tu_key_aqui node index.js

# 3. En Stremio → Community Addons → icono tuerca → pegar URL:
# http://127.0.0.1:7000/manifest.json
```

## Notas importantes

- El addon **solo provee catálogos** (qué películas existen y en qué orden).
- Para reproducir necesitas otro addon de streams: **Torrentio**, **Real-Debrid**, etc.
- El servidor tiene que estar corriendo mientras uses Stremio.
- Si cierras el terminal, el addon se desconecta (los catálogos desaparecen pero Stremio no se rompe).

## ¿Cómo añadir más sagas?

Edita `catalogs.js` y añade tu colección en `SAGA_COLLECTIONS`:

```js
{ id: "catalog_mi_saga", name: "Mi Saga", tmdb_collection: ID_DE_TMDB, type: "movie" }
```

El ID de colección lo encuentras en TMDB buscando la película y mirando la sección "Parte de".

## Puerto

Por defecto usa el **7000**. Si tienes conflicto, cambia `PORT` en `.env` o en el comando de inicio.
