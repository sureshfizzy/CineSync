import re
import os
import json

def load_keywords(file_name: str, key: str = None) -> dict:
    file_path = os.path.join(os.path.dirname(__file__), file_name)
    with open(file_path, 'r') as file:
        data = json.load(file)

    if key:
        return data.get(key, {})
    return data

keywords_file = 'mediainfo.json'
keywords = load_keywords(keywords_file)

def extract_media_info(filepath: str, keywords: dict, root: str = None) -> dict:
    """
    Extracts detailed media information from a given file path (filename and parent folders)
    using dynamic patterns from a JSON file. Falls back to root folder if no info found in filename.

    Args:
        filepath: str - Path to the media file
        keywords: dict - Dictionary containing regex patterns for media information
        root: str - Optional path to the root directory containing the media file

    Returns:
        dict: Dictionary containing extracted media information
    """
    def extract_from_sources(sources: list) -> dict:
        info = {}

        # Helper function to store values under both singular and plural forms
        def store_value(base_key: str, value):
            singular = base_key.rstrip('s')
            plural = singular + 's'
            info[singular] = value
            info[plural] = value

        # Extract Video Codec
        for source in sources:
            for codec in keywords.get("VideoCodec", keywords.get("VideoCodecs", [])):
                if re.search(codec.replace('.', r'\.'), source, re.IGNORECASE):
                    store_value("VideoCodec", codec.replace('.', ''))
                    break
            if 'VideoCodec' in info:
                break

        # Extract Audio Codecs
        audio_codecs = []
        for source in sources:
            for codec in keywords.get("AudioCodec", keywords.get("AudioCodecs", [])):
                if re.search(codec.replace('.', r'\.'), source, re.IGNORECASE):
                    audio_codecs.append(codec)
        if audio_codecs:
            store_value("AudioCodec", " ".join(audio_codecs))

        # Extract Audio Channels
        for source in sources:
            channels_match = re.search(r'(5\.1|7\.1|2\.0)', source, re.IGNORECASE)
            if channels_match:
                store_value("AudioChannel", channels_match.group(0))
                break

        # Extract Languages
        valid_languages = keywords.get("ValidLanguage", keywords.get("ValidLanguages", []))
        language_map = {
            long_name.upper(): short_code
            for long_name, short_code in zip(valid_languages[::3], valid_languages[1::3])
        }
        language_map.update({
            short_code.upper(): short_code
            for short_code in valid_languages[1::3]
        })
        language_map.update({
            three_letter.upper(): short_code.upper()
            for short_code, three_letter in zip(valid_languages[1::3], valid_languages[2::3])
        })

        for source in sources:
            filtered_languages = []
            lang_pattern = r'\b(?:' + '|'.join(
                re.escape(short_code) + r'|' + re.escape(long_name.upper()) + r'|' + re.escape(three_letter)
                for long_name, short_code, three_letter in zip(valid_languages[::3], valid_languages[1::3], valid_languages[2::3])
            ) + r')\b'

            matches = re.findall(lang_pattern, source.upper())
            for match in matches:
                if match.upper() in language_map:
                    filtered_languages.append(language_map.get(match.upper(), match.upper()))

            if filtered_languages:
                store_value("Language", sorted(set(filtered_languages)))
                break

        # Extract Dynamic Range
        for source in sources:
            dv_match = re.search(r'do?vi|dolby\.?vision', source, re.IGNORECASE)
            if dv_match:
                store_value("DynamicRange", 'DV')
                break

        # Extract Movie Versions
        for source in sources:
            for version in keywords.get("MovieVersion", keywords.get("MovieVersions", [])):
                if re.search(version, source, re.IGNORECASE):
                    store_value("MovieVersion", version)
                    break
            if 'MovieVersion' in info:
                break

        # Extract Streaming Services
        for source in sources:
            for service in keywords.get("StreamingService", keywords.get("StreamingServices", [])):
                if re.search(r'\b' + re.escape(service) + r'\b', source, re.IGNORECASE):
                    store_value("StreamingService", service)
                    break
            if 'StreamingService' in info:
                break

        # Extract Resolution and Source
        for source in sources:
            for resolution in keywords.get("Resolution", keywords.get("Resolutions", [])):
                if re.search(resolution, source, re.IGNORECASE):
                    resolution_value = resolution

                    detected_source = None
                    source_mappings = {
                        r'\b(?:blu-?ray|bd|bdrip|brrip|bdremux|remux)\b': 'Bluray',
                        r'\bweb-?dl\b': 'WEBDL',
                        r'\bweb-?rip\b': 'WEBRip',
                        r'\bhdtv\b': 'HDTV',
                        r'\bsdtv\b': 'SDTV',
                        r'\b(?:dvd|dvdrip|dvdr)\b': 'DVD',
                        r'\b(?:cam|ts|tc|hdcam|telesync)\b': 'CAM',
                    }

                    for pattern, arr_source in source_mappings.items():
                        if re.search(pattern, source, re.IGNORECASE):
                            detected_source = arr_source
                            break

                    if detected_source:
                        resolution_value = f"{detected_source}-{resolution_value}"

                    store_value("Resolution", resolution_value)
                    break
            if 'Resolution' in info:
                break

        for source in sources:
            patterns = [
                r'-([A-Z0-9]+)(?:\.[a-z0-9]+)?$',
                r'\[([A-Z0-9]+)\](?:\.[a-z0-9]+)?$',
                r'\.([A-Z0-9]+)(?:\.[a-z0-9]+)?$',
            ]

            for pattern in patterns:
                match = re.search(pattern, source, re.IGNORECASE)
                if match:
                    group = match.group(1)
                    if len(group) >= 3 and group.upper() not in ['MKV', 'MP4', 'AVI', 'WMV']:
                        store_value("ReleaseGroup", group)
                        break
            if 'ReleaseGroup' in info:
                break

        return info

    def normalize_source_name(source_name: str) -> str:
        return source_name.replace('-', '').lower()

    # Extract from filename and parent folder first
    filename = os.path.basename(filepath)
    parent_folder = os.path.basename(os.path.dirname(filepath))
    primary_sources = [filename, parent_folder]
    media_info = extract_from_sources(primary_sources)

    # Fallback to root folder if needed
    if root and (not media_info or len(media_info) <= 1):
        root_folder = os.path.basename(root)
        if root_folder:
            fallback_info = extract_from_sources([root_folder])
            for key, value in fallback_info.items():
                if key not in media_info:
                    media_info[key] = value

    return media_info

def format_media_info(media_info: dict) -> str:
    """
    Formats the media information into the desired bracket format.
    """
    formatted_parts = []

    # Helper function to get value checking both singular and plural forms
    def get_value(base_key: str):
        singular = base_key.rstrip('s')
        plural = singular + 's'
        return media_info.get(singular, media_info.get(plural))

    # Handle Video Codec
    video_codec = get_value('VideoCodec')
    if video_codec:
        formatted_parts.append(f"[{video_codec}]")

    # Handle Audio information
    audio_parts = []
    if get_value('AudioAtmo'):
        audio_parts.append(get_value('AudioAtmo'))
    elif get_value('AudioCodec'):
        audio_parts.append(get_value('AudioCodec'))
    if get_value('AudioChannel'):
        audio_parts.append(get_value('AudioChannel'))
    if audio_parts:
        formatted_parts.append(f"[{' '.join(audio_parts)}]")

    # Handle Languages
    languages = get_value('Language')
    if languages:
        formatted_parts.append(f"[{'+'.join(languages)}]")

    # Handle Resolution
    resolution = get_value('Resolution')
    if resolution:
        formatted_parts.append(f"[{resolution}]")

    return "".join(formatted_parts)
