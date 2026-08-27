import os
import sys
import shutil
import tempfile
import subprocess

def build():
    print('=' * 60)
    print('🚀 VANT YT Downloader - Standalone EXE Builder')
    print('=' * 60)
    
    # Target output: User's Downloads directory (outside project)
    downloads_dir = os.path.join(os.path.expanduser('~'), 'Downloads')
    os.makedirs(downloads_dir, exist_ok=True)
    
    # Temporary build cache outside repository (in system TEMP)
    temp_dir = tempfile.gettempdir()
    work_dir = os.path.join(temp_dir, 'vant_build_work')
    spec_dir = os.path.join(temp_dir, 'vant_build_spec')
    
    # Base project directory
    project_dir = os.path.dirname(os.path.abspath(__file__))
    main_py = os.path.join(project_dir, 'main.py')
    app_data = os.path.join(project_dir, 'app')
    
    # PyInstaller command with external output paths
    cmd = [
        sys.executable, '-m', 'PyInstaller',
        '--noconsole',
        '--onefile',
        '--name', 'VANT-YT-Downloader',
        '--distpath', downloads_dir,
        '--workpath', work_dir,
        '--specpath', spec_dir,
        '--add-data', f'{app_data};app',
        '--collect-all', 'yt_dlp',
        '--collect-all', 'imageio_ffmpeg',
        '--collect-all', 'PyQt6',
        main_py
    ]
    
    print(f'📂 Target EXE location: {downloads_dir}')
    print(f'🧹 Temp cache folder:   {work_dir}\n')
    print('🔨 Compiling standalone executable, please wait...')
    
    result = subprocess.run(cmd)
    
    # Auto-clean temporary build cache
    if os.path.exists(work_dir):
        shutil.rmtree(work_dir, ignore_errors=True)
    if os.path.exists(spec_dir):
        shutil.rmtree(spec_dir, ignore_errors=True)
        
    if result.returncode == 0:
        exe_path = os.path.join(downloads_dir, 'VANT-YT-Downloader.exe')
        print('\n' + '=' * 60)
        print('✅ BUILD SUCCESSFUL!')
        print(f'🎉 Your executable is ready at: {exe_path}')
        print('📁 Project directory remained 100% clean!')
        print('=' * 60)
    else:
        print('\n❌ Build failed with exit code:', result.returncode)

if __name__ == '__main__':
    build()
