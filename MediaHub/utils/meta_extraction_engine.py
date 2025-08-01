import subprocess
import json
import os
import platform
from MediaHub.utils.ffprobe_parser import *
from MediaHub.utils.logging_utils import log_message
from MediaHub.utils.mediainfo import extract_media_info, keywords

def get_ffprobe_path():
    """
    Get the appropriate ffprobe path based on the operating system

    Returns:
        str: Path to ffprobe executable
    """
    if platform.system() == 'Windows':
        local_ffprobe = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mediainfo', 'ffprobe.exe')
        if os.path.exists(local_ffprobe):
            return local_ffprobe
        else:
            return 'ffprobe.exe'
    else:
        return 'ffprobe'

# Get the ffprobe path
FFPROBE_PATH = get_ffprobe_path()

def get_ffprobe_media_info(file_path):
    """
    Use ffprobe to extract media information from the file
    This function directly parses ffprobe output for detailed media information
    """

    try:
        # Check if file exists first
        if not os.path.exists(file_path):
            log_message(f"File not found: {file_path}", level="ERROR")
            raise FileNotFoundError(f"File not found: {file_path}")

        # Check if ffprobe exists
        if platform.system() == 'Windows' and not os.path.exists(FFPROBE_PATH):
            log_message(f"ffprobe not found at: {FFPROBE_PATH}", level="ERROR")
            raise FileNotFoundError(f"ffprobe not found at: {FFPROBE_PATH}")

        # Try with optimized parameters first
        cmd = [
            FFPROBE_PATH,
            '-v', 'quiet',
            '-probesize', '50M',
            '-analyzeduration', '3M',
            '-print_format', 'json',
            '-show_format',
            '-show_streams',
            file_path
        ]

        # Increase timeout for larger files and add better error handling
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

        # If the optimized command fails, try a simpler approach
        if result.returncode != 0:
            log_message(f"Optimized ffprobe failed, trying basic command", level="DEBUG")
            cmd_simple = [
                FFPROBE_PATH,
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_format',
                '-show_streams',
                file_path
            ]
            result = subprocess.run(cmd_simple, capture_output=True, text=True, timeout=30)

        # Check if the command was successful
        if result.returncode != 0:
            log_message(f"ffprobe command failed with return code {result.returncode}", level="ERROR")
            log_message(f"ffprobe stderr: {result.stderr}", level="ERROR")
            log_message(f"ffprobe stdout: {result.stdout}", level="DEBUG")
            raise subprocess.CalledProcessError(result.returncode, cmd, result.stdout, result.stderr)

        # Check if we got valid JSON output
        if not result.stdout.strip():
            log_message(f"ffprobe returned empty output for file: {file_path}", level="ERROR")
            raise ValueError("ffprobe returned empty output")

        try:
            probe_data = json.loads(result.stdout)
        except json.JSONDecodeError as e:
            log_message(f"Failed to parse ffprobe JSON output: {str(e)}", level="ERROR")
            log_message(f"ffprobe output: {result.stdout[:500]}...", level="DEBUG")
            raise

        # Process the probe data
        ffprobe_info = get_ffprobe_info(file_path, probe_data)
        path_info = extract_movie_info_from_path(file_path, probe_data)

        # Merge results
        media_result = {**path_info, **ffprobe_info}

        # Final cleanup: ensure consistent data from filename if not detected otherwise
        if 'Filename HDR' in media_result and 'MediaInfo VideoDynamicRangeType' not in media_result:
            media_result['MediaInfo VideoDynamicRangeType'] = media_result['Filename HDR']
            if 'MediaInfo VideoDynamicRange' not in media_result:
                media_result['MediaInfo VideoDynamicRange'] = 'HDR'

        if 'Filename AudioCodec' in media_result and 'MediaInfo AudioCodec' not in media_result:
            media_result['MediaInfo AudioCodec'] = media_result['Filename AudioCodec']

        # Clean up temporary keys
        for key in ['Filename HDR', 'Filename AudioCodec']:
            if key in media_result:
                del media_result[key]

        # Add Atmos to DV tags if both are present
        if 'MediaInfo VideoDynamicRangeType' in media_result and 'Atmos' in media_result.get('MediaInfo AudioCodec', ''):
            if 'Atmos' not in media_result['MediaInfo VideoDynamicRangeType']:
                media_result['MediaInfo VideoDynamicRangeType'] = f"{media_result['MediaInfo VideoDynamicRangeType']} Atmos"

        log_message(f"Successfully extracted media info for: {os.path.basename(file_path)}", level="DEBUG")
        return media_result

    except subprocess.TimeoutExpired:
        log_message(f"ffprobe timeout for file: {file_path}", level="ERROR")
        return extract_media_info(os.path.basename(file_path), keywords)
    except subprocess.CalledProcessError as e:
        log_message(f"ffprobe command failed: {str(e)}", level="ERROR")
        if e.stderr:
            log_message(f"ffprobe error details: {e.stderr}", level="ERROR")
        return extract_media_info(os.path.basename(file_path), keywords)
    except (FileNotFoundError, ValueError, json.JSONDecodeError) as e:
        log_message(f"ffprobe error: {str(e)}", level="ERROR")
        return extract_media_info(os.path.basename(file_path), keywords)
    except Exception as e:
        log_message(f"Unexpected error using ffprobe: {str(e)}", level="ERROR")
        return extract_media_info(os.path.basename(file_path), keywords)