import os
import sys
import json
import subprocess
import re

def get_ffprobe_info(file_path, probe_data):
    """
    Process ffprobe data and return structured media information in Radarr format
    """
    try:
        media_info = {}

        # MediaInfo Simple and Full
        media_info_simple = []
        media_info_full = []

        # Process video stream
        video_streams = [s for s in probe_data.get('streams', []) if s.get('codec_type') == 'video']
        if video_streams:
            video = video_streams[0]

            # Get video codec
            codec = video.get('codec_name', '').lower()
            if codec:
                codec_map = {
                    'h264': 'x264',
                    'h265': 'x265',
                    'hevc': 'x265',
                    'av1': 'AV1',
                    'vp9': 'VP9',
                    'mpeg2video': 'MPEG2',
                    'mpeg4': 'MPEG4'
                }
                video_codec = codec_map.get(codec, codec.upper())
                media_info['MediaInfo VideoCodec'] = video_codec
                media_info_simple.append(video_codec)

            # Get resolution
            width = video.get('width')
            height = video.get('height')
            if width and height:
                if height >= 2160:
                    resolution = "2160p"
                elif height >= 1080:
                    resolution = "1080p"
                elif height >= 720:
                    resolution = "720p"
                elif height >= 576:
                    resolution = "576p"
                elif height >= 480:
                    resolution = "480p"
                else:
                    resolution = f"{height}p"

                # Quality tags
                if "proper" in file_path.lower():
                    media_info['Quality Full'] = f"{resolution} Proper"
                    media_info['Quality Title'] = resolution
                else:
                    media_info['Quality Full'] = resolution
                    media_info['Quality Title'] = resolution

            # Get format profile for HDR information
            has_dolby_vision = False
            has_hdr10_plus = False
            has_hdr10 = False
            has_hlg = False

            # Check format profile (if available)
            format_profile = video.get('profile', '').lower()

            # Check tags from video stream
            tags = video.get('tags', {})

            # Check HDR format string - most reliable source
            hdr_format_tag = tags.get('HDR_FORMAT') or tags.get('HDR format')
            if isinstance(hdr_format_tag, str):
                hdr_format = hdr_format_tag.lower()
                if 'dolby vision' in hdr_format:
                    has_dolby_vision = True
                if 'hdr10+' in hdr_format or 'hdr10 plus' in hdr_format or 'smpte st 2094' in hdr_format:
                    has_hdr10_plus = True
                if 'hdr10' in hdr_format or 'smpte st 2084' in hdr_format:
                    has_hdr10 = True
                if 'hlg' in hdr_format or 'hybrid log' in hdr_format or 'arib std b67' in hdr_format:
                    has_hlg = True

            # Check comments for HDR information
            comment = tags.get('COMMENT') or tags.get('comment')
            if isinstance(comment, str) and ('hdr10+' in comment.lower() or 'hdr10 plus' in comment.lower()):
                has_hdr10_plus = True

            # Check color characteristics
            color_space = video.get('color_space', '').lower()
            color_transfer = video.get('color_transfer', '').lower()
            color_primaries = video.get('color_primaries', '').lower()

            if 'bt2020' in color_space or 'bt2020' in color_primaries:
                if 'smpte2084' in color_transfer or 'pq' in color_transfer:
                    has_hdr10 = True
                elif 'arib-std-b67' in color_transfer or 'hlg' in color_transfer:
                    has_hlg = True

            # Check ffprobe mastering display metadata
            if 'side_data_list' in video:
                for side_data in video.get('side_data_list', []):
                    if side_data.get('side_data_type') == 'Mastering display metadata':
                        has_hdr10 = True
                        break

            # Set dynamic range tags
            if has_dolby_vision or has_hdr10_plus or has_hdr10 or has_hlg:
                media_info['MediaInfo VideoDynamicRange'] = 'HDR'
                media_info_simple.append('HDR')

                # Determine the specific HDR format type
                if has_dolby_vision:
                    if has_hdr10_plus:
                        media_info['MediaInfo VideoDynamicRangeType'] = 'DV HDR10+'
                    elif has_hdr10:
                        media_info['MediaInfo VideoDynamicRangeType'] = 'DV HDR10'
                    else:
                        media_info['MediaInfo VideoDynamicRangeType'] = 'DV'
                elif has_hdr10_plus:
                    media_info['MediaInfo VideoDynamicRangeType'] = 'HDR10+'
                elif has_hdr10:
                    media_info['MediaInfo VideoDynamicRangeType'] = 'HDR10'
                elif has_hlg:
                    media_info['MediaInfo VideoDynamicRangeType'] = 'HLG'

            # Check for bit depth
            bit_depth = video.get('bits_per_raw_sample') or video.get('bits_per_sample')
            if bit_depth:
                media_info['MediaInfo VideoBitDepth'] = bit_depth

            if not bit_depth:
                profile = video.get('profile', '').lower()
                if 'main 10' in profile or '10 bit' in profile or 'main10' in profile:
                    media_info['MediaInfo VideoBitDepth'] = '10'
                elif 'main 8' in profile or '8 bit' in profile or 'main8' in profile:
                    media_info['MediaInfo VideoBitDepth'] = '8'

            # Check for 3D
            if '3d' in file_path.lower() or 'sbs' in file_path.lower() or 'hsbs' in file_path.lower():
                media_info['MediaInfo 3D'] = '3D'
                media_info_simple.append('3D')

        # Process audio streams
        audio_streams = [s for s in probe_data.get('streams', []) if s.get('codec_type') == 'audio']
        if audio_streams:
            audio = audio_streams[0]
            codec = audio.get('codec_name', '').upper()
            codec_tag = audio.get('codec_tag_string', '').upper()
            profile = audio.get('profile', '').upper() if audio.get('profile') else ''
            tags = audio.get('tags', {})

            # Get title tag which often contains format details
            title = tags.get('title', '').upper() if tags else ''

            # Enhanced audio codec detection
            audio_codec = None

            # DTS variants detection
            if codec == 'DTS':
                if 'DTS:X' in title or 'DTS-X' in title or 'DTS X' in title:
                    audio_codec = 'DTS-X'
                elif 'DTS-HD MA' in title or 'DTS HD MA' in title or 'DTS-HD MASTER' in title:
                    audio_codec = 'DTS-HD MA'
                elif 'DTS-HD HRA' in title or 'DTS HD HRA' in title or 'DTS-HD HIGH' in title:
                    audio_codec = 'DTS-HD HRA'
                elif 'DTS EXPRESS' in title:
                    audio_codec = 'DTS Express'
                elif 'DTS-ES' in title or 'DTS ES' in title:
                    audio_codec = 'DTS-ES'
                else:
                    audio_codec = 'DTS'

                # Also check profile if title checking failed
                if not audio_codec or audio_codec == 'DTS':
                    if 'MA' in profile or 'MASTER' in profile:
                        audio_codec = 'DTS-HD MA'
                    elif 'HRA' in profile or 'HIGH' in profile:
                        audio_codec = 'DTS-HD HRA'
                    elif 'EXPRESS' in profile:
                        audio_codec = 'DTS Express'
                    elif 'ES' in profile:
                        audio_codec = 'DTS-ES'

            # Dolby variants detection
            elif codec == 'AC3' or codec == 'EAC3':
                if 'ATMOS' in title:
                    if codec == 'AC3':
                        audio_codec = 'AC3 Atmos'
                    else:
                        audio_codec = 'EAC3 Atmos'
                else:
                    audio_codec = codec

            # TrueHD variants (including Atmos)
            elif codec == 'TRUEHD':
                if 'ATMOS' in title:
                    audio_codec = 'TrueHD Atmos'
                else:
                    audio_codec = 'TrueHD'

            else:
                codec_map = {
                    'AAC': 'AAC',
                    'AC3': 'AC3',
                    'EAC3': 'EAC3',
                    'DTS': 'DTS',
                    'TRUEHD': 'TrueHD',
                    'FLAC': 'FLAC',
                    'MP3': 'MP3',
                    'OPUS': 'OPUS',
                    'VORBIS': 'Vorbis',
                    'PCM': 'PCM',
                    'ADPCM': 'ADPCM',
                    'ALAC': 'ALAC'
                }
                audio_codec = codec_map.get(codec, codec)

            # Add the audio codec to info
            if audio_codec:
                media_info['MediaInfo AudioCodec'] = audio_codec
                media_info_simple.append(audio_codec)

            # Get audio channels
            channels = audio.get('channels')
            if channels:
                if channels == 1:
                    audio_channels = '1.0'
                elif channels == 2:
                    audio_channels = '2.0'
                elif channels == 6:
                    audio_channels = '5.1'
                elif channels == 8:
                    audio_channels = '7.1'
                else:
                    audio_channels = f"{channels-1}.1" if channels > 1 else f"{channels}.0"

                media_info['MediaInfo AudioChannels'] = audio_channels
                media_info_simple.append(audio_channels)

            # Check for Atmos if not already detected in the codec name
            has_atmos = False
            if 'Atmos' not in (audio_codec or ''):
                for audio_stream in audio_streams:
                    stream_tags = audio_stream.get('tags', {})
                    stream_title = stream_tags.get('title', '').lower() if stream_tags else ''
                    stream_profile = audio_stream.get('profile', '').lower()

                    if 'atmos' in stream_title or 'atmos' in stream_profile:
                        has_atmos = True
                        media_info_simple.append('Atmos')
                        break

            # Add Atmos to dynamic range if applicable
            if has_atmos and 'MediaInfo VideoDynamicRangeType' in media_info:
                media_info['MediaInfo VideoDynamicRangeType'] = f"{media_info['MediaInfo VideoDynamicRangeType']} Atmos"
            elif has_atmos:
                media_info['MediaInfo VideoDynamicRangeType'] = 'Atmos'

        # Get audio languages
        audio_languages = []
        for stream in [s for s in probe_data.get('streams', []) if s.get('codec_type') == 'audio']:
            lang = stream.get('tags', {}).get('language')
            if lang and lang not in audio_languages:
                audio_languages.append(lang.upper())

        if audio_languages:
            media_info['MediaInfo AudioLanguages'] = '[' + '+'.join(audio_languages) + ']'
            media_info['MediaInfo AudioLanguagesAll'] = '[' + '+'.join(audio_languages) + ']'

        # Get subtitle languages
        subtitle_languages = []
        subtitle_streams = [s for s in probe_data.get('streams', []) if s.get('codec_type') == 'subtitle']
        for sub in subtitle_streams:
            lang = sub.get('tags', {}).get('language')
            if lang and lang not in subtitle_languages:
                subtitle_languages.append(lang.upper())

        if subtitle_languages:
            media_info['MediaInfo SubtitleLanguages'] = '[' + '+'.join(subtitle_languages) + ']'

        # Combine all info for MediaInfo Simple and Full
        if media_info_simple:
            media_info['MediaInfo Simple'] = ' '.join(media_info_simple)

        # Build MediaInfo Full in Radarr format (including languages)
        if 'MediaInfo VideoCodec' in media_info and 'MediaInfo AudioCodec' in media_info:
            full_parts = [media_info['MediaInfo VideoCodec']]

            if 'MediaInfo AudioCodec' in media_info:
                full_parts.append(media_info['MediaInfo AudioCodec'])

            if audio_languages:
                full_parts.append('[' + '+'.join(audio_languages) + ']')

            media_info['MediaInfo Full'] = ' '.join(full_parts)

        return media_info

    except Exception as e:
        return {"error": str(e)}

def extract_movie_info_from_path(file_path, probe_data=None):
    """
    Extract movie information from the file path to supplement ffprobe data
    This can help identify edition tags and release groups that ffprobe can't detect
    """
    filename = os.path.basename(file_path)
    info = {}

    edition_patterns = [
        r'(?i)(IMAX)',
        r'(?i)(Extended|Extended Cut)',
        r'(?i)(Director\'?s Cut)',
        r'(?i)(Unrated)',
        r'(?i)(Theatrical)',
        r'(?i)(Special Edition)',
        r'(?i)(Ultimate Edition)',
        r'(?i)(Final Cut)',
        r'(?i)(Remastered)'
    ]

    edition_tags = []
    for pattern in edition_patterns:
        match = re.search(pattern, filename)
        if match:
            edition_tags.append(match.group(1))

    if edition_tags:
        info['Edition Tags'] = ' '.join(edition_tags)

    # Look for release group
    release_group_match = re.search(r'-([A-Za-z0-9]+)$', os.path.splitext(filename)[0])
    if release_group_match:
        info['Release Group'] = release_group_match.group(1)

    # Look for custom formats
    custom_formats = []
    source_detected = False

    # Check for explicit source indicators in filename
    if 'remux' in filename.lower():
        custom_formats.append('Remux')
        source_detected = True
    if 'bluray' in filename.lower() or 'blu-ray' in filename.lower():
        custom_formats.append('Bluray')
        source_detected = True
    if 'webdl' in filename.lower() or 'web-dl' in filename.lower():
        custom_formats.append('WEBDL')
        source_detected = True
    if 'webrip' in filename.lower():
        custom_formats.append('WEBRip')
        source_detected = True
    if 'hdtv' in filename.lower():
        custom_formats.append('HDTV')
        source_detected = True

    # Fallback: If no source detected in filename, analyze using the provided probe data
    if not source_detected and probe_data:
        try:
            # Extract bitrate and codec information from the provided probe data
            video_bitrate = None
            codec_name = None

            # Find the video stream
            video_streams = [s for s in probe_data.get('streams', []) if s.get('codec_type') == 'video']
            if video_streams:
                video_stream = video_streams[0]

                # Get bitrate from stream if available
                video_bitrate = video_stream.get('bit_rate')
                if not video_bitrate and 'format' in probe_data:
                    video_bitrate = probe_data['format'].get('bit_rate')

                # Convert bitrate to int if it exists
                if video_bitrate:
                    try:
                        video_bitrate = int(video_bitrate)
                    except ValueError:
                        video_bitrate = None

                # Get codec information
                codec_name = video_stream.get('codec_name', '').lower()

            # Determine source based on bitrate and codec
            if video_bitrate:
                # Very high bitrate with h264/h265 likely indicates remux/bluray
                if video_bitrate > 25000000:  # >25 Mbps
                    custom_formats.append('Bluray')
                    if 'remux' in filename.lower():
                        custom_formats.append('Remux')
                # High bitrate
                elif video_bitrate > 12000000:  # >12 Mbps
                    if codec_name in ['hevc', 'h265']:
                        custom_formats.append('Bluray')  # Encoded Bluray
                    else:
                        custom_formats.append('WEBDL')  # High-quality web
                # Medium-high bitrate
                elif video_bitrate > 7000000:  # >7 Mbps
                    custom_formats.append('WEBDL')
                # Medium bitrate
                elif video_bitrate > 3000000:  # >3 Mbps
                    if 'avc' in codec_name or 'h264' in codec_name:
                        custom_formats.append('WEBDL')
                    else:
                        custom_formats.append('WEBRip')
                # Lower bitrate
                else:
                    custom_formats.append('HDTV')  # Assume HDTV for lower bitrates
            else:
                # If bitrate couldn't be determined, make a guess based on codec
                if codec_name in ['hevc', 'h265']:
                    custom_formats.append('WEBDL')  # Most h265 content is WebDL these days
                else:
                    custom_formats.append('WEBRip')  # Safe default

        except Exception as e:
            custom_formats.append('Unknown')

    if custom_formats:
        info['Custom Formats'] = ' '.join(custom_formats)

    hdr_info = {}

    if re.search(r'(?i)\b(dovi|dolby\s*vision|dv)\b', filename):
        hdr_info['has_dv'] = True
    if re.search(r'(?i)\b(hdr10\+|hdr10plus|hdr\+|hdrplus)\b', filename):
        hdr_info['has_hdr10_plus'] = True
    elif re.search(r'(?i)\b(hdr10|hdr)\b', filename):
        hdr_info['has_hdr10'] = True
    if 'has_dv' in hdr_info and 'has_hdr10_plus' in hdr_info:
        info['Filename HDR'] = 'DV HDR10+'
    elif 'has_dv' in hdr_info and 'has_hdr10' in hdr_info:
        info['Filename HDR'] = 'DV HDR10'
    elif 'has_dv' in hdr_info:
        info['Filename HDR'] = 'DV'
    elif 'has_hdr10_plus' in hdr_info:
        info['Filename HDR'] = 'HDR10+'
    elif 'has_hdr10' in hdr_info:
        info['Filename HDR'] = 'HDR10'

    if re.search(r'(?i)\b(dts[-\s]?x)\b', filename):
        info['Filename AudioCodec'] = 'DTS-X'
    elif re.search(r'(?i)\b(dts[-\s]?hd[-\s]?ma|dts[-\s]?hd[-\s]?master[-\s]?audio)\b', filename):
        info['Filename AudioCodec'] = 'DTS-HD MA'
    elif re.search(r'(?i)\b(dts[-\s]?hd[-\s]?hra|dts[-\s]?hd[-\s]?high[-\s]?resolution)\b', filename):
        info['Filename AudioCodec'] = 'DTS-HD HRA'
    elif re.search(r'(?i)\b(truehd[-\s]?atmos)\b', filename):
        info['Filename AudioCodec'] = 'TrueHD Atmos'
    elif re.search(r'(?i)\b(truehd)\b', filename):
        info['Filename AudioCodec'] = 'TrueHD'
    elif re.search(r'(?i)\b(eac3[-\s]?atmos|dd\+[-\s]?atmos)\b', filename):
        info['Filename AudioCodec'] = 'EAC3 Atmos'

    return info

def get_mediainfo_data(file_path):
    """
    Use mediainfo command line to get comprehensive media information
    This is more reliable for detailed audio and HDR format detection
    """
    try:
        # Process video tracks
        for track in mediainfo_data.get('media', {}).get('track', []):
            if track.get('@type') == 'Video':
                # Extract HDR format information
                hdr_format = track.get('HDR_Format') or track.get('HDR format')
                if hdr_format:
                    hdr_format = hdr_format.lower() if isinstance(hdr_format, str) else ''

                    # Detect specific HDR formats
                    has_dv = 'dolby vision' in hdr_format
                    has_hdr10_plus = 'hdr10+' in hdr_format or 'smpte st 2094' in hdr_format
                    has_hdr10 = 'hdr10' in hdr_format
                    has_hlg = 'hlg' in hdr_format

                    # Set appropriate format type
                    if has_dv and has_hdr10_plus:
                        extracted_info['MediaInfo VideoDynamicRangeType'] = 'DV HDR10+'
                    elif has_dv and has_hdr10:
                        extracted_info['MediaInfo VideoDynamicRangeType'] = 'DV HDR10'
                    elif has_dv:
                        extracted_info['MediaInfo VideoDynamicRangeType'] = 'DV'
                    elif has_hdr10_plus:
                        extracted_info['MediaInfo VideoDynamicRangeType'] = 'HDR10+'
                    elif has_hdr10:
                        extracted_info['MediaInfo VideoDynamicRangeType'] = 'HDR10'
                    elif has_hlg:
                        extracted_info['MediaInfo VideoDynamicRangeType'] = 'HLG'

                    if any([has_dv, has_hdr10_plus, has_hdr10, has_hlg]):
                        extracted_info['MediaInfo VideoDynamicRange'] = 'HDR'

            # Process audio tracks
            elif track.get('@type') == 'Audio' and not 'MediaInfo AudioCodec' in extracted_info:
                # Get format info
                format_name = track.get('Format', '').upper()
                format_profile = track.get('Format_Profile', '').upper()
                format_commercial = track.get('Format_Commercial_IfAny', '').upper()
                format_additional = track.get('Format_AdditionalFeatures', '').upper()

                # DTS variants
                if format_name == 'DTS':
                    if 'X' in format_profile or 'X' in format_commercial or 'DTS:X' in format_commercial:
                        extracted_info['MediaInfo AudioCodec'] = 'DTS-X'
                    elif 'MA' in format_profile or 'MASTER AUDIO' in format_commercial:
                        extracted_info['MediaInfo AudioCodec'] = 'DTS-HD MA'
                    elif 'HRA' in format_profile or 'HIGH RESOLUTION' in format_commercial:
                        extracted_info['MediaInfo AudioCodec'] = 'DTS-HD HRA'
                    elif 'EXPRESS' in format_profile or 'EXPRESS' in format_commercial:
                        extracted_info['MediaInfo AudioCodec'] = 'DTS Express'
                    elif 'ES' in format_profile or 'ES' in format_commercial:
                        extracted_info['MediaInfo AudioCodec'] = 'DTS-ES'
                    else:
                        extracted_info['MediaInfo AudioCodec'] = 'DTS'

                # Dolby TrueHD variants
                elif format_name == 'TRUEHD':
                    if 'ATMOS' in format_additional or 'ATMOS' in format_commercial:
                        extracted_info['MediaInfo AudioCodec'] = 'TrueHD Atmos'
                    else:
                        extracted_info['MediaInfo AudioCodec'] = 'TrueHD'

                # Dolby Digital variants
                elif format_name == 'AC-3' or format_name == 'AC3':
                    if 'ATMOS' in format_additional or 'ATMOS' in format_commercial:
                        extracted_info['MediaInfo AudioCodec'] = 'AC3 Atmos'
                    else:
                        extracted_info['MediaInfo AudioCodec'] = 'AC3'

                # Dolby Digital Plus variants
                elif format_name == 'E-AC-3' or format_name == 'EAC3':
                    if 'ATMOS' in format_additional or 'ATMOS' in format_commercial:
                        extracted_info['MediaInfo AudioCodec'] = 'EAC3 Atmos'
                    else:
                        extracted_info['MediaInfo AudioCodec'] = 'EAC3'

        return extracted_info

    except Exception:
        pass

    return None
