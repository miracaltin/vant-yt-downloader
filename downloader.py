import os
import yt_dlp
import imageio_ffmpeg
import threading
import shutil

# Get FFMPEG executable path from imageio-ffmpeg
FFMPEG_PATH = imageio_ffmpeg.get_ffmpeg_exe()

# Find Node.js executable path to solve YouTube signature cipher challenges
NODE_PATH = shutil.which('node')

# Track active downloads that have been cancelled by the user
cancelled_downloads = set()

def format_bytes(b):
    if not b or b <= 0:
        return "0 B"
    if b < 1024:
        return f"{b} B"
    elif b < 1024 * 1024:
        return f"{b / 1024:.1f} KB"
    elif b < 1024 * 1024 * 1024:
        return f"{b / (1024 * 1024):.1f} MB"
    else:
        return f"{b / (1024 * 1024 * 1024):.2f} GB"

def cancel_download(download_id):
    """Marks a download ID as cancelled."""
    cancelled_downloads.add(download_id)

def extract_info(url):
    """
    Extracts metadata from a YouTube link (video or playlist).
    """
    ydl_opts = {
        'extract_flat': 'in_playlist',  # Fast extraction for playlists
        'skip_download': True,
        'ffmpeg_location': FFMPEG_PATH,
        'rm_cache_dir': True,
        'nokeepalive': True,
        'extractor_args': {
            'youtube': {
                'player_client': ['mediaconnect'],
            }
        },
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-us,en;q=0.5',
            'Sec-Fetch-Mode': 'navigate',
        }
    }
    
    if NODE_PATH:
        ydl_opts['js_runtimes'] = {'node': {}}
        
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            info = ydl.extract_info(url, download=False)
            if not info:
                return {"error": "Video bilgileri alınamadı."}
            
            # Check if it's a playlist
            is_playlist = 'entries' in info and info.get('_type') == 'playlist'
            
            if is_playlist:
                entries = []
                for entry in info.get('entries', []):
                    if entry:
                        video_id = entry.get('id')
                        entry_url = f"https://www.youtube.com/watch?v={video_id}" if video_id else entry.get('url')
                        entry_thumbnail = f"https://img.youtube.com/vi/{video_id}/mqdefault.jpg" if video_id else None
                        entries.append({
                            'id': video_id,
                            'title': entry.get('title'),
                            'url': entry_url,
                            'duration': entry.get('duration'),
                            'thumbnail': entry_thumbnail
                        })
                return {
                    'type': 'playlist',
                    'title': info.get('title', 'Oynatma Listesi'),
                    'thumbnail': info.get('thumbnails', [{}])[-1].get('url') if info.get('thumbnails') else None,
                    'entries_count': len(entries),
                    'entries': entries,
                    'url': url
                }
            else:
                # Get available resolutions
                formats = info.get('formats', [])
                resolutions = set()
                for f in formats:
                    height = f.get('height')
                    if height and f.get('vcodec') != 'none': # has video track
                        # standard heights: 144, 240, 360, 480, 720, 1080, 1440, 2160 (4K)
                        resolutions.add(f"{height}p")
                
                # Sort resolutions descending
                sorted_resolutions = sorted(
                    list(resolutions),
                    key=lambda x: int(x.replace('p', '')) if x.replace('p', '').isdigit() else 0,
                    reverse=True
                )
                
                # Filter out uncommon resolutions if necessary, or just keep them
                return {
                    'type': 'video',
                    'title': info.get('title', 'Video'),
                    'thumbnail': info.get('thumbnail') or (info.get('thumbnails')[-1].get('url') if info.get('thumbnails') else None),
                    'duration': info.get('duration', 0),
                    'author': info.get('uploader', 'Bilinmeyen Kanal'),
                    'resolutions': sorted_resolutions,
                    'url': url
                }
        except Exception as e:
            return {"error": str(e)}

def download_media(url, media_format, resolution, download_dir, download_id, progress_callback, completion_callback, threads=2):
    """
    Downloads a video or playlist. Runs inside a background thread.
    """
    
    # Custom logger to capture logs or messages from yt-dlp
    class MyLogger:
        def debug(self, msg):
            pass
        def warning(self, msg):
            print(f"WARNING: {msg}")
        def error(self, msg):
            print(f"ERROR: {msg}")

    # Progress Hook
    def progress_hook(d):
        if download_id in cancelled_downloads:
            raise ValueError("İptal edildi")
            
        if d['status'] == 'downloading':
            total_bytes = d.get('total_bytes') or d.get('total_bytes_estimate') or 0
            downloaded_bytes = d.get('downloaded_bytes', 0)
            percent = (downloaded_bytes / total_bytes) * 100 if total_bytes > 0 else 0
            
            if total_bytes > 0:
                size_str = f"{format_bytes(downloaded_bytes)} / {format_bytes(total_bytes)}"
            elif downloaded_bytes > 0:
                size_str = format_bytes(downloaded_bytes)
            else:
                size_str = ""
            
            speed = d.get('speed') # bytes/s
            eta = d.get('eta') # seconds
            
            # Format speed and ETA to be human-readable
            speed_str = ""
            if speed:
                if speed > 1024 * 1024:
                    speed_str = f"{speed / (1024 * 1024):.1f} MB/s"
                else:
                    speed_str = f"{speed / 1024:.1f} KB/s"
            
            eta_str = ""
            if eta:
                mins, secs = divmod(eta, 60)
                if mins > 0:
                    eta_str = f"{int(mins)}d {int(secs)}sn"
                else:
                    eta_str = f"{int(secs)}sn"
                    
            progress_callback(download_id, {
                'status': 'downloading',
                'percent': round(percent, 1),
                'size': size_str,
                'speed': speed_str,
                'eta': eta_str
            })
            
        elif d['status'] == 'finished':
            total_bytes = d.get('total_bytes') or d.get('downloaded_bytes') or 0
            size_str = format_bytes(total_bytes) if total_bytes > 0 else ""
            progress_callback(download_id, {
                'status': 'converting',
                'percent': 100.0,
                'size': size_str,
                'speed': 'İşleniyor...',
                'eta': 'Bekleyin...'
            })

    # Prepare Options based on Format
    os.makedirs(download_dir, exist_ok=True)
    
    # Ensure threads is valid integer
    try:
        threads_count = int(threads)
        if threads_count <= 0:
            threads_count = 2
    except (ValueError, TypeError):
        threads_count = 2

    ydl_opts = {
        'ffmpeg_location': FFMPEG_PATH,
        'logger': MyLogger(),
        'progress_hooks': [progress_hook],
        'outtmpl': os.path.join(download_dir, '%(title)s.%(ext)s'),
        'continuedl': True,
        'nopart': False,
        'overwrites': False,
        'writethumbnail': True,
        'concurrent_fragment_downloads': threads_count,
        'retries': 10,
        'fragment_retries': 10,
        'extractor_args': {
            'youtube': {
                'player_client': ['mediaconnect'],
            }
        },
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-us,en;q=0.5',
            'Sec-Fetch-Mode': 'navigate',
        }
    }
    
    if NODE_PATH:
        ydl_opts['js_runtimes'] = {'node': {}}

    if media_format == 'm4a':
        ydl_opts.update({
            'format': 'bestaudio[ext=m4a]/bestaudio/best',
            'postprocessors': [
                {
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'm4a',
                },
                {
                    'key': 'EmbedThumbnail',
                    'already_have_thumbnail': False,
                }
            ],
            'postprocessor_args': {
                'ExtractAudio': ['-threads', str(threads_count)]
            }
        })
    elif media_format == 'mp3':
        quality = '192'
        if resolution:
            quality = resolution.replace('kbps', '')
        ydl_opts.update({
            'format': 'bestaudio/best',
            'postprocessors': [
                {
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': quality,
                },
                {
                    'key': 'EmbedThumbnail',
                    'already_have_thumbnail': False,
                }
            ],
            'postprocessor_args': {
                'ExtractAudio': ['-threads', str(threads_count)]
            }
        })
    else:  # mp4
        height = resolution.replace('p', '') if resolution else '1080'
        ydl_opts.update({
            'format': f'bestvideo[height<={height}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<={height}]+bestaudio[ext=m4a]/bestvideo[height<={height}]+bestaudio/best',
            'merge_output_format': 'mp4',
            'postprocessors': [
                {
                    'key': 'EmbedThumbnail',
                    'already_have_thumbnail': False,
                }
            ],
            'postprocessor_args': {
                'merger': ['-c', 'copy', '-threads', str(threads_count)]
            },
        })

    def run():
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                ext = media_format if media_format in ['mp3', 'm4a'] else 'mp4'
                
                # Check if it was a playlist
                is_playlist = 'entries' in info and info.get('_type') == 'playlist'
                
                if is_playlist:
                    final_path = download_dir
                else:
                    filename = ydl.prepare_filename(info)
                    filename_no_ext, _ = os.path.splitext(filename)
                    final_path = f"{filename_no_ext}.{ext}"
                
                completion_callback(download_id, True, final_path)
        except Exception as e:
            if download_id in cancelled_downloads:
                completion_callback(download_id, False, "İptal edildi")
                try:
                    cancelled_downloads.remove(download_id)
                except KeyError:
                    pass
            else:
                print(f"Download failed for {url}: {e}")
                completion_callback(download_id, False, str(e))

    # Run in background thread so pywebview doesn't freeze
    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    return thread

