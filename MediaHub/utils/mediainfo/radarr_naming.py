import re
import os
import sys
from datetime import datetime

# Add paths for imports
current_dir = os.path.dirname(__file__)
sys.path.append(os.path.join(current_dir, '..', '..'))

from MediaHub.utils.logging_utils import log_message
from MediaHub.config.config import get_mediainfo_radarr_tags, mediainfo_parser
from MediaHub.utils.meta_extraction_engine import get_ffprobe_media_info
from MediaHub.utils.mediainfo import extract_media_info, keywords

def get_radarr_movie_filename(movie_name, year, file_path, root_path, media_info=None):
    """
    Generate Radarr-compatible movie filename using MediaInfo tags
    Args:
        movie_name: str - The movie name
        year: str - The movie year
        file_path: str - Path to the media file
        root_path: str - Root path of the media file
        media_info: dict - Optional pre-extracted media info
    Returns:
        Formatted filename according to Radarr schema if MEDIAINFO_PARSER enabled, else legacy format
    """
    try:
        if mediainfo_parser():
            if media_info is None:
                media_info = get_ffprobe_media_info(os.path.join(root_path, file_path))

            # Get Radarr tags to use
            tags_to_use = get_mediainfo_radarr_tags()

            if not tags_to_use:
                return f"{movie_name} ({year})"

            # Build filename with Radarr tags
            for tag in tags_to_use:
                clean_tag = tag.strip()
                field_name = clean_tag
                if field_name.startswith('[') and field_name.endswith(']'):
                    field_name = field_name[1:-1]  # Remove [ ]
                elif field_name.startswith('{') and field_name.endswith('}'):
                    field_name = field_name[1:-1]  # Remove { }
                elif field_name.startswith('-'):
                    field_name = field_name[1:]     # Remove leading -

                if field_name in ['Movie CleanTitle', 'Movie Title', 'Release Year', '(Release Year)']:
                    continue

                # Handle Edition Tags with proper formatting
                if field_name == 'Edition Tags' and 'Edition Tags' in media_info:
                    value = media_info['Edition Tags']
                    if value:
                        filename_parts.append(f"{{edition-{value}}}")

                # Handle MediaInfo 3D
                elif field_name == 'MediaInfo 3D' and 'MediaInfo 3D' in media_info:
                    value = media_info['MediaInfo 3D']
                    if value:
                        filename_parts.append(value)

                # Handle Custom Formats - only if Quality Full doesn't already contain source info
                elif field_name == 'Custom Formats' and 'Custom Formats' in media_info:
                    value = media_info['Custom Formats']
                    quality_full = media_info.get('Quality Full', '')

                    # Check if Quality Full already contains the source information
                    if not (quality_full and any(source in quality_full.upper() for source in ['WEBDL', 'WEBRIP', 'BLURAY', 'HDTV', 'REMUX'])):
                        if value:
                            filename_parts.append(value)

                # Handle Quality Full with proper formatting - keep original format
                elif field_name == 'Quality Full' and 'Quality Full' in media_info:
                    value = media_info['Quality Full']
                    if value:
                        filename_parts.append(value)

                # Handle MediaInfo AudioCodec (handle both case variations)
                elif field_name in ['MediaInfo AudioCodec', 'Mediainfo AudioCodec'] and 'MediaInfo AudioCodec' in media_info:
                    value = media_info['MediaInfo AudioCodec']
                    if value:
                        filename_parts.append(value)

                # Handle MediaInfo AudioChannels
                elif field_name in ['MediaInfo AudioChannels', 'Mediainfo AudioChannels'] and 'MediaInfo AudioChannels' in media_info:
                    value = media_info['MediaInfo AudioChannels']
                    if value:
                        filename_parts.append(value)

                # Handle MediaInfo VideoDynamicRangeType
                elif field_name == 'MediaInfo VideoDynamicRangeType' and 'MediaInfo VideoDynamicRangeType' in media_info:
                    value = media_info['MediaInfo VideoDynamicRangeType']
                    if value:
                        filename_parts.append(value)

                # Handle MediaInfo VideoCodec (handle both case variations)
                elif field_name in ['MediaInfo VideoCodec', 'Mediainfo VideoCodec'] and 'MediaInfo VideoCodec' in media_info:
                    value = media_info['MediaInfo VideoCodec']
                    if value:
                        filename_parts.append(value)

                # Handle Release Group
                elif field_name == 'Release Group' and 'Release Group' in media_info:
                    value = media_info['Release Group']
                    if value:
                        filename_parts.append(f"-{value}")

                # Generic handler for other tags
                elif field_name in media_info:
                    value = media_info[field_name]
                    if value:
                        if isinstance(value, list):
                            formatted_value = '+'.join([str(item).upper() for item in value])
                            filename_parts.append(formatted_value)
                        else:
                            filename_parts.append(str(value))

            result = ' '.join(filename_parts)
            return result

        else:
            return f"{movie_name} ({year})"

    except Exception as e:
        log_message(f"Error generating Radarr movie filename: {str(e)}", level="ERROR")
        return f"{movie_name} ({year})"


def apply_radarr_movie_tags(movie_name, year, media_info, tags_to_use):
    """
    Apply Radarr-specific tags to movie naming
    
    Args:
        movie_name: str - The movie name
        year: str - The movie year
        media_info: dict - Media information dictionary
        tags_to_use: list - List of tags to apply
        
    Returns:
        str - Formatted movie name with tags
    """
    try:
        filename_parts = [f"{movie_name} ({year})"]
        other_tags = []
        quality_info = None
        custom_formats = None
        
        for tag in tags_to_use:
            clean_tag = tag.strip()
            
            # Handle Radarr-specific Quality tags
            if clean_tag == 'Quality Full' and 'Quality Full' in media_info:
                quality_info = media_info['Quality Full']
            elif clean_tag == 'Quality Title' and 'Quality Title' in media_info:
                quality_info = media_info['Quality Title']
            elif clean_tag == 'Custom Formats' and 'Custom Formats' in media_info:
                custom_formats = media_info['Custom Formats']
            elif clean_tag in media_info:
                value = media_info[clean_tag]
                if isinstance(value, list):
                    formatted_value = '+'.join([str(item).upper() for item in value])
                    other_tags.append(formatted_value)
                else:
                    other_tags.append(str(value))
            else:
                parts = clean_tag.split()
                if len(parts) > 1:
                    compound_key = clean_tag
                    value = media_info.get(compound_key, '')
                    if value:
                        other_tags.append(str(value))

        if other_tags:
            filename_parts.append(f"[{' '.join(other_tags)}]")
        
        if quality_info:
            filename_parts.append(f"[{quality_info}]")
        
        if custom_formats:
            filename_parts.append(f"[{custom_formats}]")
        
        return ' '.join(filename_parts)
        
    except Exception as e:
        log_message(f"Error applying Radarr movie tags: {str(e)}", level="ERROR")
        return f"{movie_name} ({year})"

def get_radarr_movie_folder_name(movie_name, year, media_info=None, tags_to_use=None):
    """
    Generate Radarr-compatible movie folder name
    
    Args:
        movie_name: str - The movie name
        year: str - The movie year
        media_info: dict - Optional media information
        tags_to_use: list - Optional list of tags to use
        
    Returns:
        str - Formatted folder name for Radarr
    """
    try:
        if mediainfo_parser() and media_info and tags_to_use:
            return apply_radarr_movie_tags(movie_name, year, media_info, tags_to_use)
        else:
            return f"{movie_name} ({year})"
            
    except Exception as e:
        log_message(f"Error generating Radarr movie folder name: {str(e)}", level="ERROR")
        return f"{movie_name} ({year})"