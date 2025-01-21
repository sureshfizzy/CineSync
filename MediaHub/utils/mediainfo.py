import re
import os
import json

def load_keywords(filepath: str) -> dict:
    """
    Loads codec and pattern keywords from a JSON file.
    """
    with open(filepath, 'r') as file:
        return json.load(file)

keywords = load_keywords(os.path.join(os.getcwd(), 'MediaHub', 'utils', 'mediainfo.json'))

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
        """Helper function to extract media info from a list of sources"""
        info = {}

        # Extract Video Codec
        for source in sources:
            for codec in keywords["VideoCodecs"]:
                if re.search(codec.replace('.', r'\.'), source, re.IGNORECASE):
                    info['VideoCodec'] = codec.replace('.', '')
                    break
            if 'VideoCodec' in info:
                break

        # Extract Audio Codecs
        audio_codecs = []
        for source in sources:
            for codec in keywords["AudioCodecs"]:
                if re.search(codec.replace('.', r'\.'), source, re.IGNORECASE):
                    audio_codecs.append(codec)
        if audio_codecs:
            info['AudioCodec'] = " ".join(audio_codecs)

        # Extract Audio Channels
        for source in sources:
            channels_match = re.search(r'(5\.1|7\.1|2\.0)', source, re.IGNORECASE)
            if channels_match:
                info['AudioChannels'] = channels_match.group(0)
                break

        # Extract Languages
        valid_languages = keywords["ValidLanguages"]
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
                info['Languages'] = sorted(set(filtered_languages))
                break

        # Extract Dynamic Range
        for source in sources:
            dv_match = re.search(r'do?vi|dolby\.?vision', source, re.IGNORECASE)
            if dv_match:
                info['DynamicRange'] = 'DV'
                break

        # Extract Movie Versions
        for source in sources:
            for version in keywords["MovieVersions"]:
                if re.search(version, source, re.IGNORECASE):
                    info['MovieVersions'] = version
                    break
            if 'MovieVersions' in info:
                break

        # Extract Streaming Services
        for source in sources:
            for service in keywords["StreamingServices"]:
                if re.search(r'\b' + re.escape(service) + r'\b', source, re.IGNORECASE):
                    info['StreamingServices'] = service
                    break
            if 'StreamingServices' in info:
                break

        # Extract Resolution and Source
        def normalize_source_name(source_name: str) -> str:
            return source_name.replace('-', '').lower()

        for source in sources:
            for resolution in keywords["Resolutions"]:
                if re.search(resolution, source, re.IGNORECASE):
                    info['Resolution'] = resolution.lower()
                    for source_type in keywords.get("Sources", []):
                        normalized_source_type = normalize_source_name(source_type)
                        if normalized_source_type in normalize_source_name(source):
                            info['Resolution'] = f"{source_type}-{info['Resolution']}"
                            break
                    break
            if 'Resolution' in info:
                break

        return info

    # First try with filename and parent folder
    filename = os.path.basename(filepath)
    parent_folder = os.path.basename(os.path.dirname(filepath))
    primary_sources = [filename, parent_folder]
    media_info = extract_from_sources(primary_sources)

    # If no or minimal information found and root is provided, try with root folder name
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

    if 'VideoCodec' in media_info:
        formatted_parts.append(f"[{media_info['VideoCodec']}]")

    audio_parts = []
    if 'AudioAtmos' in media_info:
        audio_parts.append(media_info['AudioAtmos'])
    elif 'AudioCodec' in media_info:
        audio_parts.append(media_info['AudioCodec'])
    if 'AudioChannels' in media_info:
        audio_parts.append(media_info['AudioChannels'])
    if audio_parts:
        formatted_parts.append(f"[{' '.join(audio_parts)}]")

    if 'Languages' in media_info:
        formatted_parts.append(f"[{'+'.join(media_info['Languages'])}]")

    if 'Resolution' in media_info:
        resolution_part = media_info['Resolution']
        if 'Source' in media_info:
            resolution_part = f"{media_info['Source']}-{resolution_part}"
        formatted_parts.append(f"[{resolution_part}]")

    return "".join(formatted_parts)
