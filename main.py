import os
import sys
import json
import subprocess
from PyQt6.QtCore import QObject, pyqtSlot, QUrl, pyqtSignal
from PyQt6.QtWidgets import QApplication, QMainWindow, QFileDialog
from PyQt6.QtWebEngineWidgets import QWebEngineView
from PyQt6.QtWebEngineCore import QWebEngineSettings
from PyQt6.QtWebChannel import QWebChannel

import database
import downloader
import importlib
import importlib.metadata
import urllib.request
try:
    from packaging import version as pkg_version
except ImportError:
    pkg_version = None

CORE_LIBRARIES = [
    {
        "name": "yt-dlp",
        "display_name": "yt-dlp",
        "description": "YouTube video ve ses indirme motoru (Hata ve kısıtlamaları aşmak için en kritik bileşen)."
    },
    {
        "name": "imageio-ffmpeg",
        "display_name": "imageio-ffmpeg",
        "description": "FFmpeg medya dönüştürme ve MP3/M4A ses birleştirme araçları."
    },
    {
        "name": "PyQt6",
        "display_name": "PyQt6",
        "description": "Masaüstü pencere ve modern sistem arayüz çatısı."
    },
    {
        "name": "PyQt6-WebEngine",
        "display_name": "PyQt6-WebEngine",
        "description": "Arayüzün Chromium tabanlı web motoru ile görüntülenmesini sağlar."
    },
    {
        "name": "pywebview",
        "display_name": "pywebview",
        "description": "Webview bileşeni ve arayüz API köprüsü."
    }
]

class DownloadSignaler(QObject):
    progress = pyqtSignal(int, dict)
    completed = pyqtSignal(int, bool, str)

class Api(QObject):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.view = None
        
        # Load saved download directory from database, or fallback to user's Downloads folder
        saved_dir = database.get_setting('download_dir')
        if saved_dir and os.path.isdir(saved_dir):
            self.download_dir = os.path.normpath(saved_dir)
        else:
            self.download_dir = os.path.join(os.path.expanduser('~'), 'Downloads')
        
        # Thread-safe signaler for cross-thread GUI/JavaScript updates
        self.signaler = DownloadSignaler()
        self.signaler.progress.connect(self._handle_progress_signal)
        self.signaler.completed.connect(self._handle_completed_signal)
        
    def _handle_progress_signal(self, dl_id, progress_data):
        if self.view:
            js_code = f"window.updateDownloadProgress({dl_id}, {json.dumps(progress_data)})"
            self.view.page().runJavaScript(js_code)

    def _handle_completed_signal(self, dl_id, success, path_or_error):
        status = 'completed' if success else 'failed'
        
        # Compute file size if download was successful
        file_size = 0
        final_path = path_or_error if success else None
        if success and path_or_error and os.path.isfile(path_or_error):
            file_size = os.path.getsize(path_or_error)
        
        database.update_download_status(
            download_id=dl_id,
            status=status,
            progress=100.0 if success else 0.0,
            path=final_path,
            file_size=file_size
        )
        
        if self.view:
            js_code = f"window.downloadCompleted({dl_id}, {json.dumps(success)}, {json.dumps(path_or_error)}, {file_size})"
            self.view.page().runJavaScript(js_code)
        
    def set_view(self, view):
        self.view = view

    @pyqtSlot(result='QVariant')
    def get_default_download_dir(self):
        """Returns the active downloads folder."""
        saved_dir = database.get_setting('download_dir')
        if saved_dir and os.path.isdir(saved_dir):
            self.download_dir = os.path.normpath(saved_dir)
        return self.download_dir

    @pyqtSlot(result='QVariant')
    def get_clipboard(self):
        """Returns the current clipboard text content."""
        clipboard = QApplication.clipboard()
        text = clipboard.text()
        return text if text else ''

    @pyqtSlot(result='QVariant')
    def select_download_dir(self):
        """Opens a folder selection dialog and returns the path."""
        selected_path = QFileDialog.getExistingDirectory(
            None,
            "Kayıt Klasörünü Seç",
            self.download_dir
        )
        
        if selected_path:
            selected_path = os.path.normpath(selected_path)
            self.download_dir = selected_path
            database.set_setting('download_dir', selected_path)
            return selected_path
        return None

    @pyqtSlot(str, result='QVariant')
    def analyze_link(self, url):
        """Extracts title, thumbnail, duration, resolutions or playlist entries."""
        return downloader.extract_info(url)

    @pyqtSlot(str, str, str, result='QVariant')
    def add_to_library(self, url, title, item_type):
        """Adds a URL to the SQLite library database."""
        info = downloader.extract_info(url)
        thumbnail = ''
        if info and "error" not in info:
            if not title:
                title = info.get('title', 'Başlıksız Bağlantı')
            thumbnail = info.get('thumbnail') or ''
            if not thumbnail and info.get('id'):
                thumbnail = f"https://img.youtube.com/vi/{info.get('id')}/mqdefault.jpg"
        else:
            if not title:
                title = "YouTube Bağlantısı"
                
        return database.add_to_library(url, title, item_type, thumbnail)

    @pyqtSlot(result='QVariant')
    def get_library(self):
        """Returns all items in the library."""
        return database.get_library()

    @pyqtSlot(int, result='QVariant')
    def remove_from_library(self, item_id):
        """Removes an item from the library."""
        return database.remove_from_library(item_id)

    @pyqtSlot(int, result='QVariant')
    def delete_download(self, download_id):
        """Removes a download from the history database."""
        return database.delete_download(download_id)

    @pyqtSlot(int, result='QVariant')
    def cancel_download(self, download_id):
        """Cancels an active download."""
        downloader.cancel_download(download_id)
        return True

    @pyqtSlot(str, str, str, str, result='QVariant')
    @pyqtSlot(str, str, str, result='QVariant')
    def start_download(self, url, media_format, resolution, subfolder=''):
        """Starts downloading a video/playlist and registers callbacks."""
        if not self.view:
            return None
            
        # 1. Fetch info to get Title and Thumbnail
        info = downloader.extract_info(url)
        thumbnail = ''
        if info and "error" not in info:
            title = info.get('title', 'İndirilen Dosya')
            thumbnail = info.get('thumbnail') or ''
            if not thumbnail and info.get('id'):
                thumbnail = f"https://img.youtube.com/vi/{info.get('id')}/mqdefault.jpg"
        else:
            title = "YouTube Videosu"

        # Determine target download directory (support playlist subfolder)
        target_dir = self.download_dir
        if subfolder:
            import re
            clean_subfolder = re.sub(r'[\\/*?:"<>|]', '', subfolder).strip('. ')
            if clean_subfolder:
                target_dir = os.path.join(self.download_dir, clean_subfolder)
                os.makedirs(target_dir, exist_ok=True)

        # 2. Register download in SQLite db
        download_id = database.add_download(
            url=url,
            title=title,
            file_format=media_format,
            resolution=resolution,
            path=target_dir,
            thumbnail=thumbnail
        )

        if not download_id:
            return None

        # Progress Callback (called by downloader thread)
        def on_progress(dl_id, progress_data):
            self.signaler.progress.emit(dl_id, progress_data)

        # Completion Callback (called by downloader thread)
        def on_complete(dl_id, success, path_or_error):
            self.signaler.completed.emit(dl_id, success, path_or_error)

        # Get CPU threads setting from database (default: '2' to prevent laptop overheating)
        threads_setting = database.get_setting('cpu_threads', '2')
        try:
            cpu_threads = int(threads_setting)
        except (ValueError, TypeError):
            cpu_threads = 2

        # 3. Trigger download thread
        downloader.download_media(
            url=url,
            media_format=media_format,
            resolution=resolution,
            download_dir=target_dir,
            download_id=download_id,
            progress_callback=on_progress,
            completion_callback=on_complete,
            threads=cpu_threads
        )

        return download_id

    @pyqtSlot(str, result='QVariant')
    def get_setting(self, key):
        """Fetches a setting value by key."""
        return database.get_setting(key, None)

    @pyqtSlot(str, str, result='QVariant')
    def set_setting(self, key, value):
        """Saves a setting key/value pair."""
        if key == 'download_dir' and value and os.path.isdir(value):
            self.download_dir = os.path.normpath(value)
        return database.set_setting(key, value)

    @pyqtSlot(result='QVariant')
    def check_library_updates(self):
        """Checks installed and latest versions from PyPI for core dependencies."""
        results = []
        has_any_update = False
        
        for lib in CORE_LIBRARIES:
            pkg_name = lib["name"]
            # 1. Get installed version
            installed_ver = None
            try:
                installed_ver = importlib.metadata.version(pkg_name)
            except Exception:
                installed_ver = None
            
            # 2. Get latest version from PyPI
            latest_ver = None
            has_update = False
            error_msg = None
            try:
                url = f"https://pypi.org/pypi/{pkg_name}/json"
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=6) as response:
                    data = json.loads(response.read().decode('utf-8'))
                    latest_ver = data.get('info', {}).get('version')
            except Exception as e:
                error_msg = str(e)
            
            if installed_ver and latest_ver:
                try:
                    if pkg_version:
                        has_update = pkg_version.parse(latest_ver) > pkg_version.parse(installed_ver)
                    else:
                        has_update = latest_ver != installed_ver
                except Exception:
                    has_update = latest_ver != installed_ver
            
            if has_update:
                has_any_update = True
                
            results.append({
                "name": pkg_name,
                "display_name": lib["display_name"],
                "description": lib["description"],
                "installed_version": installed_ver or "Yüklü Değil",
                "latest_version": latest_ver or (f"Hata: {error_msg}" if error_msg else "Bilinmiyor"),
                "has_update": has_update
            })
            
        return {
            "success": True,
            "has_any_update": has_any_update,
            "packages": results
        }

    @pyqtSlot(str, result='QVariant')
    def update_library(self, package_name):
        """Upgrades a specific package via pip."""
        valid_names = {lib["name"] for lib in CORE_LIBRARIES}
        if package_name not in valid_names:
            return {"success": False, "error": "Geçersiz kütüphane adı."}
        
        try:
            cmd = [sys.executable, "-m", "pip", "install", "--upgrade", package_name]
            creation_flags = 0
            if sys.platform == 'win32':
                creation_flags = subprocess.CREATE_NO_WINDOW
                
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=180,
                creationflags=creation_flags
            )
            
            if proc.returncode == 0:
                # Reload metadata
                new_ver = None
                try:
                    new_ver = importlib.metadata.version(package_name)
                except Exception:
                    pass
                
                # If yt-dlp was updated, reload module
                if package_name == 'yt-dlp':
                    try:
                        import yt_dlp
                        importlib.reload(yt_dlp)
                        import downloader
                        importlib.reload(downloader)
                    except Exception as e:
                        print(f"Module reload error: {e}")
                        
                return {
                    "success": True,
                    "name": package_name,
                    "new_version": new_ver or "Güncel",
                    "message": f"{package_name} başarıyla güncellendi."
                }
            else:
                err_msg = proc.stderr.strip() or proc.stdout.strip() or "Bilinmeyen pip hatası"
                return {
                    "success": False,
                    "name": package_name,
                    "error": err_msg
                }
        except Exception as e:
            return {
                "success": False,
                "name": package_name,
                "error": str(e)
            }

    @pyqtSlot(result='QVariant')
    def update_all_libraries(self):
        """Upgrades all core libraries via pip."""
        pkg_names = [lib["name"] for lib in CORE_LIBRARIES]
        try:
            cmd = [sys.executable, "-m", "pip", "install", "--upgrade"] + pkg_names
            creation_flags = 0
            if sys.platform == 'win32':
                creation_flags = subprocess.CREATE_NO_WINDOW
                
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300,
                creationflags=creation_flags
            )
            
            # Reload yt-dlp & downloader
            try:
                import yt_dlp
                importlib.reload(yt_dlp)
                import downloader
                importlib.reload(downloader)
            except Exception:
                pass
                
            if proc.returncode == 0:
                return {
                    "success": True,
                    "message": "Tüm kütüphaneler başarıyla güncellendi."
                }
            else:
                return {
                    "success": False,
                    "error": proc.stderr.strip() or proc.stdout.strip()
                }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }


    @pyqtSlot(result='QVariant')
    def get_downloads_history(self):
        """Returns all completed or failed downloads."""
        return database.get_downloads()

    @pyqtSlot(result='QVariant')
    def clear_downloads_history(self):
        """Deletes all finished/failed downloads from database."""
        return database.clear_downloads_history()

    @pyqtSlot(str, result='QVariant')
    def open_folder(self, file_path):
        """Opens Windows Explorer and highlights the downloaded file."""
        if not file_path or not os.path.exists(file_path):
            if file_path and os.path.isdir(file_path):
                os.startfile(file_path)
            return False
            
        try:
            if os.name == 'nt':
                subprocess.run(['explorer', '/select,', os.path.normpath(file_path)])
            else:
                os.startfile(os.path.dirname(file_path))
            return True
        except Exception as e:
            print(f"Error opening folder: {e}")
            return False

    @pyqtSlot(str, result='QVariant')
    def open_file(self, file_path):
        """Opens a file using the system default media player/file opener."""
        if not file_path or not os.path.isfile(file_path):
            return False
        try:
            os.startfile(file_path)
            return True
        except Exception as e:
            print(f"Error opening file: {e}")
            return False

    @pyqtSlot(str, result='QVariant')
    def open_link(self, url):
        """Opens a YouTube/web link in the system default web browser."""
        if not url:
            return False
        try:
            import webbrowser
            webbrowser.open(url)
            return True
        except Exception as e:
            print(f"Error opening URL: {e}")
            return False

    @pyqtSlot(result='QVariant')
    def clear_all_data(self):
        """Clears all user data (library, downloads history, settings) and resets download_dir."""
        success = database.clear_all_data()
        if success:
            self.download_dir = os.path.join(os.path.expanduser('~'), 'Downloads')
        return success


def main():
    # Initialize SQLite Database
    database.init_db()

    # Create PyQt6 Application
    app = QApplication(sys.argv)
    
    # Create QMainWindow
    window = QMainWindow()
    window.setWindowTitle("VANT YT Downloader")
    window.resize(1000, 700)
    window.setMinimumSize(900, 600)
    
    # Create QWebEngineView
    view = QWebEngineView()
    
    # Allow loading remote images (YouTube thumbnails) and local files from HTML
    view.settings().setAttribute(
        QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True
    )
    view.settings().setAttribute(
        QWebEngineSettings.WebAttribute.LocalContentCanAccessFileUrls, True
    )

    
    window.setCentralWidget(view)
    
    # Set up bridge and channel
    api = Api()
    api.set_view(view)
    
    channel = QWebChannel()
    channel.registerObject("api", api)
    view.page().setWebChannel(channel)
    
    # Load index.html (supports standard python and PyInstaller bundled mode)
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        base_dir = sys._MEIPASS
    else:
        base_dir = os.path.dirname(os.path.abspath(__file__))
    html_file = os.path.join(base_dir, 'app', 'index.html')
    view.load(QUrl.fromLocalFile(html_file))

    window.show()
    
    # Start Qt Event loop
    sys.exit(app.exec())

if __name__ == "__main__":
    main()
