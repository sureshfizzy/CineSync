import subprocess
import json
import os
from MediaHub.utils.ffprobe_parser import *
from MediaHub.utils.logging_utils import log_message
from MediaHub.config.config import is_beta_feature_disabled

def get_ffprobe_media_info(file_path):
    """
    Use ffprobe to extract media information from the file
    This function directly parses ffprobe output for detailed media information
    """
    # Check if MediaInfo parser is disabled (beta feature)
    if is_beta_feature_disabled('MEDIAINFO_PARSER'):
        log_message("Falling back to filename-based parsing as MediaInfo Parser is disabled.", level="INFO")
        from MediaHub.utils.mediainfo import extract_media_info, keywords
        return extract_media_info(os.path.basename(file_path), keywords)

    try:
        cmd = [
            'ffprobe',
            '-v', 'quiet',
            '-probesize', '500K',
            '-analyzeduration', '500000',
            '-read_intervals', '%+#1M',
            '-fflags', 'fastseek',
            '-timeout', '2000000',
            '-print_format', 'json',
            '-show_format',
            '-show_streams',
            file_path
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=5)
        probe_data = json.loads(result.stdout)

        # Process the probe data
        ffprobe_info = get_ffprobe_info(file_path, probe_data)
        path_info = extract_movie_info_from_path(file_path, probe_data)

        # Merge results
        result = {**path_info, **ffprobe_info}

        # Final cleanup: ensure consistent data from filename if not detected otherwise
        if 'Filename HDR' in result and 'MediaInfo VideoDynamicRangeType' not in result:
            result['MediaInfo VideoDynamicRangeType'] = result['Filename HDR']
            if 'MediaInfo VideoDynamicRange' not in result:
                result['MediaInfo VideoDynamicRange'] = 'HDR'

        if 'Filename AudioCodec' in result and 'MediaInfo AudioCodec' not in result:
            result['MediaInfo AudioCodec'] = result['Filename AudioCodec']

        # Clean up temporary keys
        for key in ['Filename HDR', 'Filename AudioCodec']:
            if key in result:
                del result[key]

        # Add Atmos to DV tags if both are present
        if 'MediaInfo VideoDynamicRangeType' in result and 'Atmos' in result.get('MediaInfo AudioCodec', ''):
            if 'Atmos' not in result['MediaInfo VideoDynamicRangeType']:
                result['MediaInfo VideoDynamicRangeType'] = f"{result['MediaInfo VideoDynamicRangeType']} Atmos"

        return result

    except Exception as e:
        log_message(f"Error using ffprobe: {str(e)}", level="ERROR")
        return extract_media_info(os.path.basename(file_path), keywords)
