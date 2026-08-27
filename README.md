# VANT YT Downloader

<p align="center">
  <strong>A modern, minimalist, and lightweight YouTube Video & Audio Downloader desktop application.</strong>
</p>

---

## ✨ Features

- **Video & Audio Downloads:** Download single videos or entire playlists in MP4, MP3, M4A, and high-definition formats (1080p, 2K, 4K, 8K).
- **Playlist Management:** Batch download or selectively choose videos from any public/unlisted YouTube playlist.
- **Link Library:** Save and organize frequently downloaded channels and playlists for quick access.
- **Download History:** Track active download progress and manage previous download history.
- **Multi-Language Support (i18n):**
  - 🇬🇧 English *(Default)*
  - 🇹🇷 Türkçe
  - 🇩🇪 Deutsch
  - 🇮🇹 Italiano
  - 🇷🇺 Русский
  - 🇪🇸 Español
- **CPU & Thermal Limiter:** Control CPU core allocation (1, 2, 4, 8 cores) to keep laptop fans quiet and prevent overheating during video conversion.
- **Built-in Package Updater:** Check and update core download engines (`yt-dlp`, `ffmpeg`, `PyQt6`) directly from PyPI inside the application with one click.
- **Secure User Data:** User preferences and database are stored safely outside the project directory in the OS Documents folder (`Documents/VANT YT Downloader`).
- **Data Privacy & Reset:** Clear all saved links and download history with a single click.

---

## 🛠️ Tech Stack

- **GUI Framework:** PyQt6 & PyQt6-WebEngine (Chromium runtime)
- **Download Engine:** yt-dlp
- **Media Processing:** FFmpeg (via `imageio-ffmpeg`)
- **Database:** SQLite3
- **Frontend Interface:** HTML5, CSS3, JavaScript (Lucide Icons, Outfit font)

---

## 🚀 Getting Started

### Prerequisites

- Python 3.10 or higher
- Git

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/vant-yt-downloader.git
   cd vant-yt-downloader
   ```

2. **Create a virtual environment (optional but recommended):**
   ```bash
   python -m venv venv
   # On Windows:
   venv\Scripts\activate
   # On macOS/Linux:
   source venv/bin/activate
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **Run the application:**
   ```bash
   python main.py
   ```

---

## 📁 Project Structure

```
yt_downloader/
├── app/
│   ├── app.js             # Frontend application logic & IPC bridge
│   ├── i18n.js            # 6-Language translation dictionaries
│   ├── index.html         # Application interface markup
│   ├── lucide.min.js      # Local Lucide icon engine
│   └── style.css          # Monochromatic minimal styling
├── database.py            # SQLite user database management
├── downloader.py          # yt-dlp downloader worker threads & hooks
├── main.py                # PyQt6 window and IPC controller
├── requirements.txt       # Python dependencies
├── .gitignore             # Git ignored files (databases, downloads, cache)
└── README.md              # Project documentation
```

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
