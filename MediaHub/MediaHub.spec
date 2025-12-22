# -*- mode: python ; coding: utf-8 -*-

import os
import sys
from pathlib import Path

block_cipher = None

mediahub_dir = Path(SPECPATH)
parent_dir = mediahub_dir.parent
def collect_data_files(base_path):
    data_files = []
    base = Path(base_path)
    
    include_dirs = ['api', 'config', 'monitor', 'processors', 'utils']
    
    for dir_name in include_dirs:
        dir_path = base / dir_name
        if dir_path.exists():
            for file_path in dir_path.rglob('*'):
                if file_path.is_file():
                    if file_path.suffix.lower() in ['.json', '.yaml', '.yml', '.txt', '.md', '.toml', '.ini', '.conf']:
                        rel_path = file_path.relative_to(base.parent)
                        dest_dir = str(rel_path.parent)
                        data_files.append((str(file_path), dest_dir))
    
    return data_files

def collect_mediahub_modules():
    modules = []
    base = Path(SPECPATH)
    
    for py_file in base.rglob('*.py'):
        if py_file.name != 'main.py' and not py_file.name.startswith('__'):
            rel_path = py_file.relative_to(base.parent)
            module_name = str(rel_path.with_suffix('')).replace(os.sep, '.')
            modules.append(module_name)
    
    for subdir in base.rglob('*'):
        if subdir.is_dir() and not subdir.name.startswith('__') and not subdir.name.startswith('.'):
            if 'mediainfo' in str(subdir) and subdir.parent.name == 'utils':
                continue
            rel_path = subdir.relative_to(base.parent)
            package_name = str(rel_path).replace(os.sep, '.')
            if package_name.startswith('MediaHub.'):
                modules.append(package_name)
    
    return modules

a = Analysis(
    ['main.py'],
    pathex=[
        str(parent_dir),
        str(mediahub_dir / 'utils' / 'mediainfo'),
    ],
    binaries=[],
    datas=collect_data_files(mediahub_dir),
    hiddenimports=[
        *collect_mediahub_modules(),
        'beautifulsoup4',
        'bs4',
        'dotenv',
        'requests',
        'psutil',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter',
        'matplotlib',
        'numpy',
        'pandas',
        'scipy',
        'pytest',
        'IPython',
        'jupyter',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='MediaHub',
    debug=False,
    bootloader_ignore_signals=False,
    strip=True if sys.platform != 'win32' else False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(parent_dir / 'WebDavHub' / 'frontend' / 'src' / 'assets' / 'logo.ico'),
)

import shutil

binary_name = 'MediaHub.exe' if sys.platform == 'win32' else 'MediaHub'
source_path = os.path.join(DISTPATH, binary_name)
target_path = os.path.join(SPECPATH, binary_name)

if os.path.exists(source_path):
    if os.path.exists(target_path):
        os.remove(target_path)
    shutil.move(source_path, target_path)
    if sys.platform != 'win32':
        os.chmod(target_path, 0o755)
    print(f"\n✅ MediaHub binary created at: {target_path}")