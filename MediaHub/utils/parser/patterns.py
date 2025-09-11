import re
import os
import json
from typing import Dict, List

def _load_mediainfo_data():
    """Load mediainfo.json data for enhanced pattern generation."""
    try:
        mediainfo_path = os.path.join(os.path.dirname(__file__), '..', 'mediainfo.json')
        with open(mediainfo_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}

_MEDIAINFO_DATA = _load_mediainfo_data()

# Resolution patterns (enhanced with mediainfo.json data)
RESOLUTION_PATTERNS = {
    'standard': re.compile(r'\b(\d{3,4}p)\b', re.IGNORECASE),
    'dimensions': re.compile(r'\b(\d{3,4}x\d{3,4})\b', re.IGNORECASE),
    'custom_dimensions': re.compile(r'\b(\d{4}x\d{4})\b', re.IGNORECASE),  # Support for 4K+ resolutions like 3840x2160
    'uhd': re.compile(r'\b(4K|UHD|2160p|Ultra\.?HD)\b', re.IGNORECASE),
    'hd': re.compile(r'\b(1080p|720p|480p|1080i|720i)\b', re.IGNORECASE),
    'sd': re.compile(r'\b(480p|360p|240p|SD)\b', re.IGNORECASE),
}

# Year patterns
YEAR_PATTERNS = {
    'parentheses': re.compile(r'\((\d{4})(?:\s|[^\d]|$)'),
    'brackets': re.compile(r'\[(\d{4})(?:\s|[^\d]|$|\])'),
    'dots': re.compile(r'\.(\d{4})\.'),
    'spaces': re.compile(r'\s(\d{4})(?:\s|$)'),
    'end': re.compile(r'(\d{4})$'),
}

# Sports patterns
SPORTS_PATTERNS = {
    'formula1': re.compile(r'\b(Formula[_\s]*1?|F1)\.?(\d{4})\.?(?:(?:Round|R)(\d+)\.?([^.]+)|([^.]+?)\.?(?:grand[._\s]*prix|gp))', re.IGNORECASE),
    'motogp': re.compile(r'\b(MotoGP)\.?(\d{4})\.?(?:Round|R)?(\d+)?\.?([^.]*)', re.IGNORECASE),
    'nascar': re.compile(r'\b(NASCAR)\.?(\d{4})\.?(?:Round|R|Race)?(\d+)?\.?([^.]*)', re.IGNORECASE),
    'indycar': re.compile(r'\b(IndyCar|Indy[_\s]*Car)\.?(\d{4})\.?(?:Round|R|Race)?(\d+)?\.?([^.]*)', re.IGNORECASE),
    'wrc': re.compile(r'\b(WRC|World[_\s]*Rally[_\s]*Championship)\.?.*?(\d{4})\.?([^.]+?)\.?(?:SS|Stage|Special[_\s]*Stage)?(\d+)?\.?([^.]*)', re.IGNORECASE),
    'premier_league': re.compile(r'\b(Premier[_\s]*League)\.?(\d{4})\.?(?:Week|Round|Matchday)?(\d+)?\.?([^.]*)', re.IGNORECASE),
    'champions_league': re.compile(r'\b(Champions[_\s]*League|UCL)\.?(\d{4})\.?(?:Round|R|Matchday)?(\d+)?\.?([^.]*)', re.IGNORECASE),
    'world_cup': re.compile(r'\b(World[_\s]*Cup|FIFA[_\s]*World[_\s]*Cup)\.?(\d{4})\.?(?:Round|R|Group|Match)?(\d+)?\.?([^.]*)', re.IGNORECASE),
    'olympics': re.compile(r'\b(Olympics?|Olympic[_\s]*Games)\.?(\d{4})\.?(?:Day)?(\d+)?\.?([^.]*)', re.IGNORECASE),
    'super_bowl': re.compile(r'\b(Super[_\s]*Bowl)\.?(\d{4}|[IVXLCDM]+)\.?([^.]*)', re.IGNORECASE),
    'nba': re.compile(r'\b(NBA)\.?(\d{4})\.?(?:Game|Round|Playoffs)?(\d+)?\.?([^.]*)', re.IGNORECASE),
    'nfl': re.compile(r'\b(NFL)\.?(\d{4})\.?(?:Week|Game)?(\d+)?\.?([^.]*)', re.IGNORECASE),
    'mlb': re.compile(r'\b(MLB)\.?(\d{4})\.?(?:Game)?(\d+)?\.?([^.]*)', re.IGNORECASE),
    'nhl': re.compile(r'\b(NHL)\.?(\d{4})\.?(?:Game)?(\d+)?\.?([^.]*)', re.IGNORECASE),
    'ufc': re.compile(r'\b(UFC)\.?(\d+)\.?([^.]*)', re.IGNORECASE),
    'boxing': re.compile(r'\b(Boxing)\.?(\d{4})\.?([^.]*)', re.IGNORECASE),
    'tennis': re.compile(r'\b(Tennis|Wimbledon|US[_\s]*Open|French[_\s]*Open|Australian[_\s]*Open)\.?(\d{4})\.?([^.]*)', re.IGNORECASE),
    'golf': re.compile(r'\b(Golf|PGA|Masters|US[_\s]*Open[_\s]*Golf)\.?(\d{4})\.?([^.]*)', re.IGNORECASE),
    'cycling': re.compile(r'\b(cycling|uci)\.?.*?(\d{4})\.?(.*?)\.?(?:stage|etape)[_\s\.]*(\d+)\.?([^.]*)', re.IGNORECASE),
    'cycling_general': re.compile(r'\b(Cycling|UCI)\.?.*?(\d{4})\.?([^.]*)', re.IGNORECASE),
    'wrestling': re.compile(r'\b(WWE|AEW|TNA|ROH|NJPW|WCW|ECW|WWF)[\s\._-].*?(\d{4})[\s\._-](\d{2})[\s\._-](\d{2})[\s\._-]([^.]*)', re.IGNORECASE),
    'wrestling_ppv': re.compile(r'\b(WWE|AEW|TNA|ROH|NJPW)[\s\._-]([^.]*?)[\s\._-](\d{4})[\s\._-]([^.]*)', re.IGNORECASE),
    'generic_sports': re.compile(r'\b(?:Round|R)(\d+)\.?([^.]+)\.?(\d{4})', re.IGNORECASE),
    'grand_prix': re.compile(r'\b(Grand[_\s]*Prix|GP)\.?(\d{4})\.?(?:Round|R)?(\d+)?\.?([^.]*)', re.IGNORECASE)
}

# Sports session types (for Formula 1, MotoGP, etc.)
SPORTS_SESSION_PATTERNS = {
    'f1_sessions': re.compile(r'\b(FP[1-3]|Free[_\s]*Practice[_\s]*[1-3]|Practice[._\s]*(?:One|Two|Three|1|2|3)|Qualifying|Q[1-3]|Race|Sprint|Formation[_\s]*Lap|Weekend[._\s]*Warm[._\s]*Up|Warm[._\s]*Up)', re.IGNORECASE),
    'motogp_sessions': re.compile(r'\b(FP[1-4]|Free[_\s]*Practice[_\s]*[1-4]|Qualifying|Q[1-2]|Race|Sprint|Warm[_\s]*Up)', re.IGNORECASE),
    'general_sessions': re.compile(r'\b(Practice|Qualifying|Race|Final|Semi[_\s]*Final|Quarter[_\s]*Final)', re.IGNORECASE)
}

def _build_quality_patterns():
    """Build quality patterns data."""
    patterns = {
        'bluray': re.compile(r'\b(BluRay|BD|BDRip|BRRip|BDrip)\b', re.IGNORECASE),
        'webdl': re.compile(r'\b(WEB-DL|WEBDL|WEB\.DL)\b', re.IGNORECASE),
        'webrip': re.compile(r'\b(WEBRip|WEB-Rip|WEB\.Rip)\b', re.IGNORECASE),
        'hdtv': re.compile(r'\b(HDTV|HDTVRIP)\b', re.IGNORECASE),
        'dvd': re.compile(r'\b(DVD|DVDRip|DVDR)\b', re.IGNORECASE),
        'cam': re.compile(r'\b(CAM|TS|TC|HDCAM)\b', re.IGNORECASE),
        'remux': re.compile(r'\b(REMUX|Remux|BD\s+Remux|BD\s*Remux)\b', re.IGNORECASE),
    }

    sources = _MEDIAINFO_DATA.get('Sources', [])
    if sources:
        source_terms = '|'.join(re.escape(source) for source in sources)
        patterns['mediainfo_sources'] = re.compile(rf'\b({source_terms})\b', re.IGNORECASE)

    streaming_services = _MEDIAINFO_DATA.get('StreamingServices', [])
    if streaming_services:
        streaming_terms = '|'.join(re.escape(service) for service in streaming_services)
        patterns['mediainfo_streaming'] = re.compile(rf'\b({streaming_terms})\b', re.IGNORECASE)

    return patterns

QUALITY_PATTERNS = _build_quality_patterns()

# Video codec patterns
def _build_video_codec_patterns():
    """Build video codec pattern data."""
    patterns = {
        'h264': re.compile(r'\b(x264|h264|H\.264|AVC)\b', re.IGNORECASE),
        'h265': re.compile(r'\b(x265|h265|H\.265|HEVC)\b', re.IGNORECASE),
        'av1': re.compile(r'\b(AV1)\b', re.IGNORECASE),
        'xvid': re.compile(r'\b(XviD|XVID)\b', re.IGNORECASE),
        'divx': re.compile(r'\b(DivX|DIVX)\b', re.IGNORECASE),
    }

    # Add patterns
    video_codecs = _MEDIAINFO_DATA.get('VideoCodecs', [])
    if video_codecs:
        codec_terms = '|'.join(re.escape(codec) for codec in video_codecs)
        patterns['mediainfo_codecs'] = re.compile(rf'\b({codec_terms})\b', re.IGNORECASE)

    return patterns

VIDEO_CODEC_PATTERNS = _build_video_codec_patterns()

# Audio codec patterns
def _build_audio_codec_patterns():
    """Build audio codec patterns data."""
    patterns = {
        'aac': re.compile(r'\b(AAC|AAC2\.0|AAC5\.1|AAC7\.1)\b', re.IGNORECASE),
        'ac3': re.compile(r'\b(AC3|AC-3|DD|DD5\.1|DD7\.1)\b', re.IGNORECASE),
        'eac3': re.compile(r'\b(EAC3|E-AC3|EAC-3)\b', re.IGNORECASE),
        'dts': re.compile(r'\b(DTS|DTS-HD|DTS-MA|DTS-X)\b', re.IGNORECASE),
        'flac': re.compile(r'\b(FLAC(?:\d+)?(?:\.\d+)?)\b', re.IGNORECASE),
        'mp3': re.compile(r'\b(MP3)\b', re.IGNORECASE),
        'pcm': re.compile(r'\b(PCM|LPCM)\b', re.IGNORECASE),
        'atmos': re.compile(r'\b(Atmos|ATMOS)\b', re.IGNORECASE),
        'ddp': re.compile(r'\b(DDP|DD\+|DDP5\.1|DDP7\.1)\b', re.IGNORECASE),
    }

    # Add patterns
    audio_codecs = _MEDIAINFO_DATA.get('AudioCodecs', [])
    if audio_codecs:
        codec_terms = '|'.join(re.escape(codec) for codec in audio_codecs)
        patterns['mediainfo_audio'] = re.compile(rf'\b({codec_terms})\b', re.IGNORECASE)

    # Add Atmos-specific patterns
    atmos_terms = _MEDIAINFO_DATA.get('AudioAtmos', [])
    if atmos_terms:
        atmos_pattern = '|'.join(re.escape(term) for term in atmos_terms)
        patterns['mediainfo_atmos'] = re.compile(rf'\b({atmos_pattern})\b', re.IGNORECASE)

    return patterns

AUDIO_CODEC_PATTERNS = _build_audio_codec_patterns()

# Audio channel patterns
CHANNEL_PATTERNS = {
    'mono': re.compile(r'\b(1\.0|Mono)\b', re.IGNORECASE),
    'stereo': re.compile(r'\b(2\.0|Stereo)\b', re.IGNORECASE),
    'surround': re.compile(r'\b(5\.1|7\.1|6\.1)\b', re.IGNORECASE),
}

# HDR patterns
def _build_hdr_patterns():
    """Build HDR patterns data."""
    patterns = {
        'hdr10': re.compile(r'\b(HDR10|HDR)\b', re.IGNORECASE),
        'hdr10plus': re.compile(r'\b(HDR10\+|HDR10Plus)\b', re.IGNORECASE),
        'dolby_vision': re.compile(r'\b(DV|Dolby\.Vision|DolbyVision)\b', re.IGNORECASE),
        'hlg': re.compile(r'\b(HLG)\b', re.IGNORECASE),
    }

    # Add patterns
    dynamic_range = _MEDIAINFO_DATA.get('DynamicRange', [])
    if dynamic_range:
        hdr_terms = '|'.join(re.escape(term) for term in dynamic_range)
        patterns['mediainfo_hdr'] = re.compile(rf'\b({hdr_terms})\b', re.IGNORECASE)

    return patterns

HDR_PATTERNS = _build_hdr_patterns()

# Release group patterns
RELEASE_GROUP_PATTERNS = {
    'scene': re.compile(r'-([A-Z0-9]+)$', re.IGNORECASE),
    'p2p': re.compile(r'\[([^\]]+)\]$', re.IGNORECASE),
    'anime': re.compile(r'^\[([^\]]+)\]', re.IGNORECASE),
    'hash_bracket': re.compile(r'\[([A-F0-9]{8})\]', re.IGNORECASE),  # Hash patterns like [42A97BA4]
    'group_before_hash': re.compile(r'-([A-Z0-9]+)\.\[([A-F0-9]{8})\]', re.IGNORECASE),  # Group before hash
}

# Episode/Season patterns
EPISODE_PATTERNS = {
    'standard': re.compile(r'\bS(\d{1,2})E(\d{1,3})\b', re.IGNORECASE),
    'season_only': re.compile(r'\bS(\d{1,2})\b(?!E)', re.IGNORECASE),
    'episode_only': re.compile(r'\bE(\d{1,3})\b', re.IGNORECASE),
    'season_range': re.compile(r'\bS(\d{1,2})-S(\d{1,2})\b', re.IGNORECASE),
    'season_range_compact': re.compile(r'\bS(\d{1,2})S(\d{1,2})\b', re.IGNORECASE),
    'season_range_mixed': re.compile(r'\bS(\d{1,2})-(\d{1,2})\b', re.IGNORECASE),  # S1-25, S01-25
    'season_range_plain': re.compile(r'\b(\d{1,2})-(\d{1,2})\b', re.IGNORECASE),   # 1-25, 01-25
    'episode_range': re.compile(r'\bE(\d{1,3})-E(\d{1,3})\b', re.IGNORECASE),
    'complete': re.compile(r'\b(Complete|Collection)\b', re.IGNORECASE),
    'season_ep': re.compile(r'\bS(\d{1,2})EP(\d{1,3})\b', re.IGNORECASE),
    'season_word': re.compile(r'\b(Season|Stagione)\s+(\d{1,2})\b', re.IGNORECASE),
    'ordinal_season': re.compile(r'\b(\d{1,2})(?:st|nd|rd|th)\s+Season\b', re.IGNORECASE),
    'season_word_range': re.compile(r'\bSeason\s+(\d{1,2})\s*-\s*(\d{1,2})\b', re.IGNORECASE),
    'anime_episode': re.compile(r'\b(Season\s+\d{1,2})\s*-\s*(\d{1,3})\b', re.IGNORECASE),
    'anime_bracket_episode': re.compile(r'\[(\d{1,3})\]', re.IGNORECASE),
    'season_x_episode': re.compile(r'\b(\d{1,2})x(\d{1,3})\b', re.IGNORECASE),
    'season_x_episode_range': re.compile(r'\b(\d{1,2})x(\d{1,3})-(\d{1,3})\b', re.IGNORECASE),
}

# Language patterns
def _build_language_patterns():
    """Build language patterns data."""
    patterns = {
        'dual': re.compile(r'\b(Dual|Multi)(?:\s+Audio)?\b', re.IGNORECASE),
        'dubbed': re.compile(r'\b(Dubbed|Dub)\b', re.IGNORECASE),
        'subbed': re.compile(r'\b(Subbed|Sub|Subs)\b', re.IGNORECASE),
        'multi_subs': re.compile(r'\b(Multi-Subs|MultiSubs)\b', re.IGNORECASE),
    }

    # Add patterns
    valid_languages = _MEDIAINFO_DATA.get('ValidLanguages', [])
    if valid_languages:
        lang_terms = '|'.join(re.escape(lang) for lang in valid_languages)
        patterns['mediainfo_languages'] = re.compile(rf'\b({lang_terms})\b', re.IGNORECASE)

    return patterns

LANGUAGE_PATTERNS = _build_language_patterns()

# Special edition patterns
def _build_edition_patterns():
    """Build edition patterns data."""
    patterns = {
        'directors_cut': re.compile(r'\b(Director\'?s?\s*Cut|(?<![A-Za-z.])DC(?![\w\'.]))', re.IGNORECASE),
        'extended': re.compile(r'\b(Extended|Extended\.Cut)\b', re.IGNORECASE),
        'unrated': re.compile(r'\b(Unrated|Uncut)\b', re.IGNORECASE),
        'theatrical': re.compile(r'\b(Theatrical)\b', re.IGNORECASE),
        'imax': re.compile(r'\b(IMAX)\b', re.IGNORECASE),
        'remastered': re.compile(r'\b(Remastered|Remaster)\b', re.IGNORECASE),
        'criterion': re.compile(r'\b(Criterion)\b', re.IGNORECASE),
    }

    # Add patterns
    movie_versions = _MEDIAINFO_DATA.get('MovieVersions', [])
    if movie_versions:
        version_terms = '|'.join(re.escape(version) for version in movie_versions)
        patterns['mediainfo_versions'] = re.compile(rf'\b({version_terms})\b', re.IGNORECASE)

    return patterns

EDITION_PATTERNS = _build_edition_patterns()

# Repack/Proper patterns
REPACK_PATTERNS = {
    'repack': re.compile(r'\b(REPACK|Repack)\b', re.IGNORECASE),
    'proper': re.compile(r'\b(PROPER|Proper)\b', re.IGNORECASE),
    'real': re.compile(r'\b(REAL|Real)\b', re.IGNORECASE),
    'fix': re.compile(r'\b(FIX|Fix)\b', re.IGNORECASE),
}

WEBSITE_PATTERNS = [
    re.compile(r'^\[[\w\-\.]+\]\s*', re.IGNORECASE),
    re.compile(r'^www\.[\w\-]+\.[\w\-]+\s*[-\s]*', re.IGNORECASE),
]

# File extension patterns
FILE_EXTENSION_PATTERNS = {
    'video': re.compile(r'\.(mkv|mp4|avi|mov|wmv|flv|webm|m4v|mpg|mpeg|ts|m2ts|strm)$', re.IGNORECASE),
    'subtitle': re.compile(r'\.(srt|sub|idx|vtt|ass|ssa)$', re.IGNORECASE),
    'audio': re.compile(r'\.(mp3|flac|aac|ac3|dts|wav|ogg)$', re.IGNORECASE),
}

# Anime-specific patterns
ANIME_PATTERNS = {
    # Pattern to detect anime release groups in brackets at the start of filename
    'release_group_bracket': re.compile(r'^\[([^\]]+)\]', re.IGNORECASE),

    # Pattern to detect anime release groups in parentheses at the start of filename
    'release_group_paren': re.compile(r'^\(([^)]+)\)', re.IGNORECASE),

    # Patterns to exclude from being considered anime release groups
    'non_anime_group_patterns': [
        re.compile(r'^\d{4}$'),  # Years (e.g., [2023])
        re.compile(r'^\d{3,4}p$', re.IGNORECASE),  # Resolutions (e.g., [1080p])
        re.compile(r'^(BD|BLURAY|WEB-DL|WEBDL|WEBRIP|HDTV|DVDRIP|REMUX|REPACK|PROPER|RAW)$', re.IGNORECASE),  # Quality terms
        re.compile(r'^(H264|H265|X264|X265|HEVC|AVC|AAC|AC3|DTS|FLAC|MP3)$', re.IGNORECASE),  # Codec terms
        re.compile(r'^(DUAL|MULTI|ENG|JAP|JPN|SUB|DUB)$', re.IGNORECASE),  # Language terms
        re.compile(r'^(10BIT|8BIT|HDR|SDR|ATMOS)$', re.IGNORECASE),  # Technical terms
        re.compile(r'^[A-F0-9]{8}$', re.IGNORECASE),  # Hash patterns like [42A97BA4]
        # Website prefixes that should not be considered anime release groups
        re.compile(r'^WWW\.[A-Z0-9.-]+\.COM$', re.IGNORECASE),  # Website patterns like WWW.TORRENTDOSFILMES.COM
        re.compile(r'^[A-Z0-9.-]+\.COM$', re.IGNORECASE),  # Domain patterns like TORRENTDOSFILMES.COM
        re.compile(r'^WWW\.[A-Z0-9.-]+\.(NET|ORG|INFO)$', re.IGNORECASE),  # Other website patterns
    ],

    # Anime-specific episode numbering patterns
    'episode_number': re.compile(r'\s-?\s?(\d{2,4})(?:\s|\.mkv|\.mp4|\.avi|$)', re.IGNORECASE),

    # Anime episode indicators that suggest anime content
    'anime_episode_indicators': [
        re.compile(r'\s+\d{1,4}\s*\[', re.IGNORECASE),  # Episode number followed by bracket
        re.compile(r'\s+\d{1,4}\s*$', re.IGNORECASE),   # Episode number at end
        re.compile(r'\s+\d{1,4}\s*\(', re.IGNORECASE),  # Episode number followed by parenthesis
        re.compile(r'\s+S\d{1,2}\s*\[', re.IGNORECASE), # Season followed by bracket
        re.compile(r'\s+OVA\s*\[', re.IGNORECASE),      # OVA indicator
        re.compile(r'\s+SP\s*\[', re.IGNORECASE),       # Special episode indicator
        re.compile(r'\s+Episode\s+\d+', re.IGNORECASE), # Explicit episode numbering
        re.compile(r'\s+EP\d+', re.IGNORECASE),         # EP numbering
    ],

    # Batch/collection patterns
    'batch': re.compile(r'\b(Batch|Complete|Collection)\b', re.IGNORECASE),

    # Raw anime patterns
    'raw': re.compile(r'\b(RAW|Raw)\b', re.IGNORECASE),
}

# Technical quality indicators
TECHNICAL_PATTERNS = {
    '10bit': re.compile(r'\b(10bit|Hi10P|10-bit)\b', re.IGNORECASE),
    '8bit': re.compile(r'\b(8bit|8-bit)\b', re.IGNORECASE),
    'hdr': re.compile(r'\b(HDR|HDR10|HDR10\+|DV|Dolby\.Vision)\b', re.IGNORECASE),
    'sdr': re.compile(r'\b(SDR)\b', re.IGNORECASE),
    'video_profile': re.compile(r'\b(Hi10P|10bit|8bit|HDR10?\+?|DV)\b', re.IGNORECASE),
}

# Generic patterns for detecting when years should be included in titles
TITLE_YEAR_INCLUSION_PATTERNS = {
    # Pattern: Very short titles (1-2 words) are more likely to include years
    'short_title': re.compile(r'^\w{1,10}(?:\s+\w{1,10})?$', re.IGNORECASE),
    # Pattern: Titles ending with common reboot/sequel indicators
    'reboot_sequel': re.compile(r'\b(?:reboot|remake|returns?|revival|new|origins?|begins?|rises?)\b', re.IGNORECASE),
    # Pattern: Titles with ordinal numbers (suggesting sequels/reboots)
    'ordinal_sequel': re.compile(r'\b(?:\d+(?:st|nd|rd|th)|ii+|iii+|iv+|v+)\b', re.IGNORECASE),
    # Pattern: Single word titles are more likely to need year disambiguation
    'single_word': re.compile(r'^\w+$', re.IGNORECASE),
}

def get_all_patterns() -> Dict[str, Dict[str, re.Pattern]]:
    """Return all pattern dictionaries for easy access."""
    return {
        'resolution': RESOLUTION_PATTERNS,
        'year': YEAR_PATTERNS,
        'quality': QUALITY_PATTERNS,
        'video_codec': VIDEO_CODEC_PATTERNS,
        'audio_codec': AUDIO_CODEC_PATTERNS,
        'channels': CHANNEL_PATTERNS,
        'hdr': HDR_PATTERNS,
        'release_group': RELEASE_GROUP_PATTERNS,
        'episode': EPISODE_PATTERNS,
        'language': LANGUAGE_PATTERNS,
        'edition': EDITION_PATTERNS,
        'repack': REPACK_PATTERNS,
        'technical': TECHNICAL_PATTERNS,
        'title_year_inclusion': TITLE_YEAR_INCLUSION_PATTERNS,
    }
