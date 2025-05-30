import React, { useRef, useEffect, useState } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Slider,
  Fade,
  CircularProgress,
  useTheme,
  alpha,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import CloseIcon from '@mui/icons-material/Close';
import { useAuth } from '../../contexts/AuthContext';

interface VideoPlayerProps {
  url: string;
  mimeType?: string;
  title?: string;
  onClose?: () => void;
  isInDialog?: boolean;
}

const CONTROLS_HIDE_MS = 2500;

const VideoPlayer: React.FC<VideoPlayerProps> = ({ url, title, onClose, isInDialog = false }) => {
  const theme = useTheme();
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
  const [isBuffering, setIsBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buffered, setBuffered] = useState<TimeRanges | null>(null);
  const [brightness] = useState(1);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const { authEnabled } = useAuth();

  // Utility: detect mobile
  const isMobile = /Mobi|Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

  // Auto-enter landscape mode on mobile when video starts playing
  useEffect(() => {
    if (isMobile && isPlaying) {
      lockLandscape();
    }
  }, [isMobile, isPlaying]);

  // Handle fullscreen changes
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
  }, [isMobile]);

  // Utility: lock orientation
  const lockLandscape = async () => {
    if (isMobile && screen.orientation && (screen.orientation as any).lock) {
      try {
        await (screen.orientation as any).lock('landscape');
      } catch (e) {
        console.warn('Failed to lock orientation:', e);
      }
    }
  };

  const unlockOrientation = async () => {
    if (isMobile && screen.orientation && (screen.orientation as any).unlock) {
      try {
        await (screen.orientation as any).unlock();
      } catch (e) {
        console.warn('Failed to unlock orientation:', e);
      }
    }
  };

  // Track buffering
  useEffect(() => {
    const handleProgress = () => {
      if (videoRef.current) {
        setBuffered(videoRef.current.buffered);
      }
    };

    const video = videoRef.current;
    if (video) {
      video.addEventListener('progress', handleProgress);
      return () => video.removeEventListener('progress', handleProgress);
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    const token = localStorage.getItem('cineSyncJWT');
    if (authEnabled) {
      if (!token) {
        setError('Authentication required. Please log in.');
        setIsLoading(false);
        return;
      }
      setVideoUrl(`${url}?token=${encodeURIComponent(token)}`);
    } else {
      setVideoUrl(url);
    }
  }, [url, authEnabled]);

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
      if (isMobile) {
        lockLandscape();
      }
      videoRef.current.play().catch(err => {
        console.error("Play error:", err);
        setError('Failed to play video. Check console for details.');
      });
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
    setIsBuffering(false);
    if (isMobile) {
      lockLandscape();
    }
  };
  const onPause = () => {
    setIsPlaying(false);
    setIsBuffering(false);
  };
  const onWaiting = () => {
    // Only show buffering if we're actually playing, not when paused
    if (isPlaying) {
      setIsBuffering(true);
    }
  };
  const onCanPlay = () => {
    setIsLoading(false);
    setIsBuffering(false);
  };
  const onError = () => setError('Failed to load video.');

  // Show controls on mouse move/tap
  const handleMouseMove = () => {
    showAndAutoHideControls();
  };
  const handleMouseLeave = () => {
    if (isPlaying && !isMobile) setShowControls(false); // Don't hide on mobile leave, rely on tap/timeout
  };

  const getBufferedEnd = () => {
    if (!buffered || !buffered.length) return 0;
    const currentBufferIndex = findCurrentBufferIndex();
    if (currentBufferIndex === -1) return 0;
    return (buffered.end(currentBufferIndex) / duration) * 100;
  };

  const findCurrentBufferIndex = () => {
    if (!buffered || !buffered.length) return -1;
    for (let i = 0; i < buffered.length; i++) {
      if (currentTime >= buffered.start(i) && currentTime <= buffered.end(i)) {
        return i;
      }
    }
    return -1;
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
        paddingBottom: 'env(safe-area-inset-bottom)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onMouseMove={!isMobile ? handleMouseMove : undefined}
      onMouseLeave={!isMobile ? handleMouseLeave : undefined}
      onClick={isMobile ? () => setShowControls(prev => !prev) : undefined}
    >
      {/* Video Container for zoom/pan */}
      <Box
        sx={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            width: '100%',
            height: '100%',
          }}
        >
          <video
            ref={videoRef}
            src={videoUrl}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              background: 'black',
              filter: `brightness(${brightness})`,
            }}
            onLoadedMetadata={onLoadedMetadata}
            onTimeUpdate={onTimeUpdate}
            onPlay={onPlay}
            onPause={onPause}
            onWaiting={onWaiting}
            onCanPlay={onCanPlay}
            onError={onError}
            playsInline
            tabIndex={-1}
            autoPlay
          />
        </Box>
      </Box>

      {/* Title Bar - Always show header with title and close button */}
      <Fade in={showControls || isLoading || isBuffering || !!error} timeout={200}>
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 30,
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.5) 60%, transparent 100%)',
            padding: { xs: 1.5, sm: 2 },
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            pt: isInDialog ? (isMobile ? 7 : 1) : 0, // Add padding at top when in dialog
          }}
        >
          <Typography
            variant="h6"
            sx={{
              color: 'white',
              fontSize: { xs: 16, sm: 20 },
              fontWeight: 500,
              textOverflow: 'ellipsis',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              maxWidth: 'calc(100% - 60px)', // Leave space for close button
            }}
          >
            {title || 'Video Player'}
          </Typography>
          {onClose && (
            <IconButton
              onClick={onClose}
              size={isMobile ? 'small' : 'medium'}
              sx={{
                color: 'white',
                '&:hover': {
                  background: alpha(theme.palette.primary.main, 0.12),
                },
              }}
            >
              <CloseIcon sx={{ fontSize: { xs: 24, sm: 28 } }} />
            </IconButton>
          )}
        </Box>
      </Fade>

      {/* Loading Spinner */}
      <Fade in={(isLoading || isBuffering) && !error}>
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 25,
          }}
        >
          <CircularProgress size={60} thickness={4} sx={{ color: theme.palette.primary.main }} />
        </Box>
      </Fade>

      {/* Error Display */}
      {error && (
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 30,
            maxWidth: '80%',
            background: alpha(theme.palette.error.dark, 0.9),
            padding: 3,
            borderRadius: 2,
            textAlign: 'center',
          }}
        >
          <Typography variant="h6" color="error.contrastText">
            {error}
          </Typography>
        </Box>
      )}

      {/* Controls Overlay (Bottom controls) */}
      <Fade in={showControls || isLoading || isBuffering || !!error} timeout={200}>
        <Box
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 20,
            background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.6) 60%, transparent 100%)',
            paddingX: { xs: 2, sm: 3 },
            paddingTop: 4,
            paddingBottom: 'calc(env(safe-area-inset-bottom, 16px) + 16px)',
            display: 'flex',
            flexDirection: 'column',
            gap: 1.5,
          }}
        >
          {/* Progress and Buffer Bar */}
          <Box sx={{ position: 'relative', width: '100%', height: 4, mb: 1 }}>
            {/* Buffer Progress */}
            <Box
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                height: '100%',
                width: `${getBufferedEnd()}%`,
                bgcolor: alpha(theme.palette.primary.main, 0.3),
                borderRadius: 1,
              }}
            />
            {/* Seek Bar */}
            <Slider
              value={currentTime}
              min={0}
              max={duration}
              step={0.1}
              onChange={handleSeek}
              sx={{
                position: 'absolute',
                top: -3,
                padding: '13px 0',
                color: theme.palette.primary.main,
                '& .MuiSlider-thumb': {
                  width: 16,
                  height: 16,
                  transition: '0.2s all',
                  '&:hover, &.Mui-focusVisible': {
                    boxShadow: `0px 0px 0px 8px ${alpha(theme.palette.primary.main, 0.16)}`,
                  },
                  '&.Mui-active': {
                    width: 20,
                    height: 20,
                  },
                },
                '& .MuiSlider-rail': {
                  opacity: 0.28,
                },
              }}
            />
          </Box>

          {/* Controls Row */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 2 } }}>
            {/* Play/Pause */}
            <IconButton
              onClick={handlePlayPause}
              sx={{
                color: 'white',
                '&:hover': {
                  background: alpha(theme.palette.primary.main, 0.08),
                },
              }}
            >
              {isPlaying ? (
                <PauseIcon sx={{ fontSize: { xs: 32, sm: 40 } }} />
              ) : (
                <PlayArrowIcon sx={{ fontSize: { xs: 32, sm: 40 } }} />
              )}
            </IconButton>

            {/* Volume Control */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: { xs: 120, sm: 150 } }}>
              <IconButton
                onClick={handleMute}
                sx={{
                  color: 'white',
                  '&:hover': {
                    background: alpha(theme.palette.primary.main, 0.08),
                  },
                }}
              >
                {isMuted || volume === 0 ? (
                  <VolumeOffIcon sx={{ fontSize: { xs: 24, sm: 28 } }} />
                ) : (
                  <VolumeUpIcon sx={{ fontSize: { xs: 24, sm: 28 } }} />
                )}
              </IconButton>
              <Slider
                value={isMuted ? 0 : volume}
                min={0}
                max={1}
                step={0.01}
                onChange={handleVolumeChange}
                sx={{
                  color: 'white',
                  '& .MuiSlider-thumb': {
                    width: 14,
                    height: 14,
                  },
                }}
              />
            </Box>

            {/* Time Display */}
            <Typography
              variant="body2"
              sx={{
                color: 'white',
                minWidth: 90,
                textAlign: 'center',
                fontVariantNumeric: 'tabular-nums',
                fontSize: { xs: 14, sm: 16 },
              }}
            >
              {formatTime(currentTime)} / {formatTime(duration)}
            </Typography>

            <Box sx={{ flex: 1 }} />

            {/* Fullscreen */}
            <IconButton
              onClick={handleFullscreen}
              sx={{
                color: 'white',
                '&:hover': {
                  background: alpha(theme.palette.primary.main, 0.08),
                },
              }}
            >
              {isFullscreen ? (
                <FullscreenExitIcon sx={{ fontSize: { xs: 24, sm: 28 } }} />
              ) : (
                <FullscreenIcon sx={{ fontSize: { xs: 24, sm: 28 } }} />
              )}
            </IconButton>
          </Box>
        </Box>
      </Fade>
    </Box>
  );
};

export default VideoPlayer;