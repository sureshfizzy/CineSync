"""
Sonarr Naming Convention Handler

This module provides a unified interface for all Sonarr naming formats:
- Standard Episode Format
- Daily Episode Format
- Anime Episode Format
- Season Folder Format

It acts as the central coordinator for episode and folder naming based on content type.

Note: This module has been refactored to use shared utilities from sonarr_utils.py
to eliminate code duplication across format modules while maintaining the central
coordinator pattern.
"""

import os
import sys

# Add paths for imports
current_dir = os.path.dirname(__file__)
sys.path.append(os.path.join(current_dir, '..', '..'))
sys.path.append(current_dir)

from MediaHub.utils.logging_utils import log_message
from MediaHub.config.config import mediainfo_parser
from standard_episode_format import build_sonarr_episode_filename
from daily_episode_format import build_sonarr_daily_episode_filename
from anime_episode_format import build_sonarr_anime_episode_filename
from season_folder_format import build_sonarr_season_folder_name

class SonarrNamingHandler:
    """
    Central handler for all Sonarr naming conventions
    """
    
    def get_episode_filename(self, file_path, root_path, proper_show_name, show_name,
                           season_number, episode_number, episode_identifier,
                           episode_title=None, content_type="standard", **kwargs):
        """
        Get formatted episode filename based on content type
        
        Args:
            file_path: Original file path
            root_path: Root directory path
            proper_show_name: Proper show name from TMDB (may include ID)
            show_name: Clean show name
            season_number: Season number
            episode_number: Episode number
            episode_identifier: Episode identifier (S01E01)
            episode_title: Episode title from TMDB
            content_type: Type of content ("standard", "daily", "anime")
            **kwargs: Additional arguments for specific formats
        
        Returns:
            Formatted filename string
        """
        try:
            if not mediainfo_parser():
                log_message("MediaInfo parser disabled, using legacy naming", level="DEBUG")
                return self._get_legacy_filename(file_path, show_name, episode_identifier, episode_title, content_type, **kwargs)
            
            if content_type.lower() == "daily":
                return self._get_daily_episode_filename(
                    file_path, root_path, proper_show_name, show_name,
                    kwargs.get('air_date'), episode_title
                )
            elif content_type.lower() == "anime":
                return self._get_anime_episode_filename(
                    file_path, root_path, proper_show_name, show_name,
                    season_number, episode_number, episode_identifier,
                    episode_title, kwargs.get('absolute_episode')
                )
            else:  # standard
                return self._get_standard_episode_filename(
                    file_path, root_path, proper_show_name, show_name,
                    season_number, episode_number, episode_identifier,
                    episode_title
                )
                
        except Exception as e:
            log_message(f"Error in Sonarr naming handler: {str(e)}, falling back to legacy", level="ERROR")
            return self._get_legacy_filename(file_path, show_name, episode_identifier, episode_title, content_type, **kwargs)
    
    def get_season_folder_name(self, proper_show_name, show_name, season_number):
        """
        Get formatted season folder name
        
        Args:
            proper_show_name: Proper show name from TMDB (may include ID)
            show_name: Clean show name
            season_number: Season number
        
        Returns:
            Formatted season folder name
        """
        try:
            if not mediainfo_parser():
                log_message("MediaInfo parser disabled, using legacy season folder naming", level="DEBUG")
                return f"Season {str(season_number).zfill(2)}" if season_number else "Season 01"
            
            return build_sonarr_season_folder_name(proper_show_name, show_name, season_number)
            
        except Exception as e:
            log_message(f"Error in season folder naming: {str(e)}, falling back to legacy", level="ERROR")
            return f"Season {str(season_number).zfill(2)}" if season_number else "Season 01"
    
    def _get_standard_episode_filename(self, file_path, root_path, proper_show_name, show_name,
                                     season_number, episode_number, episode_identifier, episode_title):
        """Get standard episode filename"""
        return build_sonarr_episode_filename(
            file_path, root_path, proper_show_name, show_name,
            season_number, episode_number, episode_identifier, episode_title
        )
    
    def _get_daily_episode_filename(self, file_path, root_path, proper_show_name, show_name,
                                  air_date, episode_title):
        """Get daily episode filename"""
        return build_sonarr_daily_episode_filename(
            file_path, root_path, proper_show_name, show_name,
            air_date, episode_title
        )
    
    def _get_anime_episode_filename(self, file_path, root_path, proper_show_name, show_name,
                                  season_number, episode_number, episode_identifier,
                                  episode_title, absolute_episode):
        """Get anime episode filename"""
        return build_sonarr_anime_episode_filename(
            file_path, root_path, proper_show_name, show_name,
            season_number, episode_number, episode_identifier,
            episode_title, absolute_episode
        )
    
    def _get_legacy_filename(self, file_path, show_name, episode_identifier, episode_title, content_type, **kwargs):
        """Get legacy filename for fallback"""
        file_ext = os.path.splitext(file_path)[1]
        
        if content_type.lower() == "daily":
            air_date = kwargs.get('air_date')
            if episode_title:
                if air_date:
                    base_name = f"{show_name} - {air_date} - {episode_title}"
                else:
                    base_name = f"{show_name} - {episode_title}"
            else:
                if air_date:
                    base_name = f"{show_name} - {air_date}"
                else:
                    from datetime import datetime
                    base_name = f"{show_name} - {datetime.now().strftime('%Y-%m-%d')}"
        elif content_type.lower() == "anime":
            absolute_episode = kwargs.get('absolute_episode')
            if absolute_episode:
                if episode_title:
                    base_name = f"{show_name} - {str(absolute_episode).zfill(3)} - {episode_title}"
                else:
                    base_name = f"{show_name} - {str(absolute_episode).zfill(3)}"
            else:
                if episode_title:
                    base_name = f"{show_name} - {episode_identifier} - {episode_title}"
                else:
                    base_name = f"{show_name} - {episode_identifier}"
        else:  # standard
            if episode_title:
                base_name = f"{show_name} - {episode_title}".replace(' - -', ' -')
            else:
                base_name = f"{show_name} - {episode_identifier}"
        
        return f"{base_name}{file_ext}"
    
    def detect_content_type(self, show_name, file_path=None, metadata=None):
        """
        Detect content type based on show characteristics
        
        Args:
            show_name: Name of the show
            file_path: Optional file path for analysis
            metadata: Optional metadata dictionary
        
        Returns:
            Content type string ("standard", "daily", "anime")
        """
        show_name_lower = show_name.lower()
        
        # Check for daily show indicators (comprehensive list)
        daily_indicators = [
            # News shows
            'news', 'evening news', 'morning news', 'nightly news', 'world news',
            # Talk shows
            'tonight show', 'late night', 'late show', 'daily show', 'morning show', 'talk show',
            'the view', 'ellen', 'oprah', 'conan', 'kimmel', 'fallon', 'colbert',
            # Live/Daily formats
            'live', 'today', 'good morning', 'this morning', 'this week', 'sunday morning',
            # Specific daily show patterns
            'daily', 'nightly', 'weekly', 'saturday night live', 'snl',
            # International patterns
            'breakfast', 'sunrise', 'daybreak', 'morning edition'
        ]
        
        if any(indicator in show_name_lower for indicator in daily_indicators):
            return "daily"
        
        # Check metadata if available
        if metadata:
            if metadata.get('is_anime', False):
                return "anime"
            if metadata.get('is_daily', False):
                return "daily"
        
        # Default to standard
        return "standard"


# Global instance (created after class definition)
sonarr_naming = SonarrNamingHandler()


def get_sonarr_episode_filename(file_path, root_path, proper_show_name, show_name,
                               season_number, episode_number, episode_identifier,
                               episode_title=None, content_type=None, **kwargs):
    """
    Convenience function to get episode filename using Sonarr naming conventions
    
    Args:
        file_path: Original file path
        root_path: Root directory path
        proper_show_name: Proper show name from TMDB (may include ID)
        show_name: Clean show name
        season_number: Season number
        episode_number: Episode number
        episode_identifier: Episode identifier (S01E01)
        episode_title: Episode title from TMDB
        content_type: Type of content ("standard", "daily", "anime") - auto-detected if None
        **kwargs: Additional arguments (air_date, absolute_episode, etc.)
    
    Returns:
        Formatted filename string
    """
    if content_type is None:
        content_type = sonarr_naming.detect_content_type(show_name)
    
    return sonarr_naming.get_episode_filename(
        file_path, root_path, proper_show_name, show_name,
        season_number, episode_number, episode_identifier,
        episode_title, content_type, **kwargs
    )

def get_sonarr_season_folder_name(proper_show_name, show_name, season_number):
    """
    Convenience function to get season folder name using Sonarr naming conventions
    
    Args:
        proper_show_name: Proper show name from TMDB (may include ID)
        show_name: Clean show name
        season_number: Season number
    
    Returns:
        Formatted season folder name
    """
    return sonarr_naming.get_season_folder_name(proper_show_name, show_name, season_number)