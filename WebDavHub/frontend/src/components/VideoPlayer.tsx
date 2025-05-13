import React, { useRef, useEffect, useState } from 'react';
import { Box, Typography, IconButton, Slider, Fade } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import CloseIcon from '@mui/icons-material/Close';

interface VideoPlayerProps {
  url: string;
  mimeType?: string;
  title?: string;
  onClose?: () => void;
}

const CONTROLS_HIDE_MS = 2500;

const VideoPlayer: React.FC<VideoPlayerProps> = ({ url, mimeType, title, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');

  // Utility: detect mobile
  const isMobile = /Mobi|Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

  // Utility: lock orientation
  const lockLandscape = async () => {
    if (isMobile && screen.orientation && screen.orientation.lock) {
      try {
        await screen.orientation.lock('landscape');
      } catch (e) { /* ignore */ }
    }
  };
  const unlockOrientation = async () => {
    if (isMobile && screen.orientation && screen.orientation.unlock) {
      try {
        await screen.orientation.unlock();
      } catch (e) { /* ignore */ }
    }
  };

  // Track if we've already locked on initial play
  const lockedOnPlayRef = useRef(false);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    const token = localStorage.getItem('cineSyncJWT');
    if (!token) {
      setError('Authentication required. Please log in.');
      setIsLoading(false);
      return;
    }
    setVideoUrl(`${url}?token=${encodeURIComponent(token)}`);
  }, [url]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
      if (isMobile) {
        if (document.fullscreenElement) {
          lockLandscape();
        } else {
          unlockOrientation();
        }
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Auto-hide controls
  const showAndAutoHideControls = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => setShowControls(false), CONTROLS_HIDE_MS);
  };

  useEffect(() => {
    if (isPlaying) showAndAutoHideControls();
    // eslint-disable-next-line
  }, [isPlaying]);

  const handlePlayPause = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play().catch(err => setError('Failed to play video.'));
    }
  };

  const handleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const handleVolumeChange = (_: Event, value: number | number[]) => {
    const v = value as number;
    setVolume(v);
    if (videoRef.current) videoRef.current.volume = v;
    if (v === 0 && !isMuted) setIsMuted(true);
    if (v > 0 && isMuted) setIsMuted(false);
  };

  const handleSeek = (_: Event, value: number | number[]) => {
    const t = value as number;
    if (videoRef.current) videoRef.current.currentTime = t;
    setCurrentTime(t);
  };

  const handleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  const formatTime = (s: number) => {
    if (!isFinite(s)) return '0:00';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // Video event handlers
  const onLoadedMetadata = () => {
    if (videoRef.current) setDuration(videoRef.current.duration);
    setIsLoading(false);
  };
  const onTimeUpdate = () => {
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
  };
  const onPlay = () => {
    setIsPlaying(true);
    if (isMobile && !lockedOnPlayRef.current) {
      lockLandscape();
      lockedOnPlayRef.current = true;
    }
  };
  const onPause = () => setIsPlaying(false);
  const onWaiting = () => setIsLoading(true);
  const onCanPlay = () => setIsLoading(false);
  const onError = () => setError('Failed to load video.');

  // Show controls on mouse move/tap
  const handleMouseMove = () => {
    showAndAutoHideControls();
  };
  const handleMouseLeave = () => {
    if (isPlaying) setShowControls(false);
  };

  return (
    <Box
      ref={containerRef}
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        bgcolor: 'black',
        overflow: 'hidden',
        userSelect: 'none',
      }}
      onMouseMove={handleMouseMove}
      onClick={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Header Bar (always visible) */}
      <Box sx={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        px: 3,
        py: 1.5,
        zIndex: 30,
        color: 'white',
        fontWeight: 600,
        fontSize: { xs: '1.1rem', md: '1.3rem' },
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.95) 90%, rgba(0,0,0,0.0) 100%)',
        boxShadow: '0 2px 12px 0 rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        pointerEvents: 'auto',
      }}>
        {onClose && (
          <IconButton onClick={onClose} sx={{ color: 'white', ml: 2, '&:hover': { color: 'error.main', background: 'rgba(255,255,255,0.08)' } }}>
            <CloseIcon fontSize="large" />
          </IconButton>
        )}
      </Box>
      {/* Video */}
      <video
        ref={videoRef}
        src={videoUrl}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          background: 'black',
        }}
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        onPlay={onPlay}
        onPause={onPause}
        onWaiting={onWaiting}
        onCanPlay={onCanPlay}
        onError={onError}
        onClick={handlePlayPause}
        tabIndex={-1}
        autoPlay
      />
      {/* Controls Overlay */}
      <Fade in={showControls || isLoading || !!error} timeout={200}>
        <Box
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 20,
            px: { xs: 1, md: 3 },
            pb: { xs: 1, md: 2 },
            pt: 2,
            background: 'linear-gradient(to top, rgba(0,0,0,0.85) 80%, rgba(0,0,0,0.0) 100%)',
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            alignItems: 'stretch',
          }}
        >
          {/* Seek Bar */}
          <Slider
            value={currentTime}
            min={0}
            max={duration}
            step={0.1}
            onChange={handleSeek}
            sx={{
              color: 'primary.main',
              height: 6,
              '& .MuiSlider-thumb': {
                width: 22,
                height: 22,
                background: 'white',
                border: '2px solid #2196f3',
                boxShadow: '0 2px 8px 0 rgba(33,150,243,0.25)',
                transition: '0.2s all',
                '&:hover, &.Mui-focusVisible': {
                  boxShadow: '0px 0px 0px 12px rgba(33, 150, 243, 0.16)',
                },
                '&.Mui-active': {
                  width: 28,
                  height: 28,
                },
              },
              '& .MuiSlider-rail': {
                opacity: 0.28,
              },
            }}
          />
          {/* Controls Row */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, width: '100%' }}>
            {/* Play/Pause */}
            <IconButton onClick={handlePlayPause} sx={{ color: 'white', fontSize: 40, mx: 1, '&:hover': { color: 'primary.main', background: 'rgba(33,150,243,0.08)' } }}>
              {isPlaying ? <PauseIcon fontSize="inherit" /> : <PlayArrowIcon fontSize="inherit" />}
            </IconButton>
            {/* Mute/Volume */}
            <IconButton onClick={handleMute} sx={{ color: 'white', fontSize: 32, mx: 1, '&:hover': { color: 'primary.main', background: 'rgba(33,150,243,0.08)' } }}>
              {isMuted || volume === 0 ? <VolumeOffIcon fontSize="inherit" /> : <VolumeUpIcon fontSize="inherit" />}
            </IconButton>
            <Slider
              value={isMuted ? 0 : volume}
              min={0}
              max={1}
              step={0.01}
              onChange={handleVolumeChange}
              sx={{ width: 100, color: 'white', mx: 1 }}
            />
            {/* Time */}
            <Typography variant="body2" sx={{ color: 'white', minWidth: 90, textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontWeight: 500, fontSize: 18 }}>
              {formatTime(currentTime)} / {formatTime(duration)}
            </Typography>
            <Box sx={{ flex: 1 }} />
            {/* Fullscreen */}
            <IconButton onClick={handleFullscreen} sx={{ color: 'white', fontSize: 32, mx: 1, '&:hover': { color: 'primary.main', background: 'rgba(33,150,243,0.08)' } }}>
              {isFullscreen ? <FullscreenExitIcon fontSize="inherit" /> : <FullscreenIcon fontSize="inherit" />}
            </IconButton>
          </Box>
        </Box>
      </Fade>
      {/* Loading/Error Overlay */}
      {(isLoading || error) && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            bgcolor: 'rgba(0,0,0,0.35)',
            zIndex: 30,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          {isLoading && (
            <Box sx={{ color: 'white', fontSize: 24 }}>Loading...</Box>
          )}
          {error && (
            <Typography variant="h6" color="error" sx={{ textAlign: 'center', bgcolor: 'rgba(0,0,0,0.7)', p: 2, borderRadius: 2 }}>
              {error}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
};

export default VideoPlayer; 