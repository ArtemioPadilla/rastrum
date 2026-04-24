# 🌿 Rastrum

> Species identification system for plants, animals, fungi, and ecological evidence (tracks, scat, burrows, calls).

Rastrum is an open-source biodiversity observation platform that combines computer vision, audio analysis, and expert curation to identify species from photos, videos, audio, and indirect evidence.

## Features

- 📸 Photo identification (plants, animals, fungi, tracks, scat, burrows)
- 🎵 Audio identification (bird calls, frog calls, insect sounds)
- 🎥 Video analysis (frame extraction + audio pipeline)
- 🗺️ GPS-tagged observations with map view
- 👩‍🔬 Expert curation and validation system
- 🧠 Ensemble AI pipeline: PlantNet + BirdNET + Claude Vision
- 📊 Growing dataset for future regional model training

## Stack

- **Frontend:** Astro PWA + GitHub Pages
- **Backend:** Supabase (DB + Storage + Edge Functions)
- **ID Pipeline:** PlantNet API + BirdNET + Claude Vision
- **Auth:** Supabase Auth

## Status

🚧 Early development — designing architecture and spec.

## License

MIT
