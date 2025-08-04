import React, { useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box, Grid, Stack, Chip, IconButton, TextField, useTheme, alpha } from '@mui/material';
import { Close, ContentCopy, Search } from '@mui/icons-material';

interface TokenInfo {
  token: string;
  description: string;
  example: string;
}

interface TokenCategory {
  name: string;
  tokens: TokenInfo[];
}

interface RadarrTokenDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  currentValue: string;
  onValueChange: (value: string) => void;
}

const RadarrTokenDialog: React.FC<RadarrTokenDialogProps> = ({
  open,
  onClose,
  title,
  currentValue,
  onValueChange,
}) => {
  const theme = useTheme();
  const [selectedCategory, setSelectedCategory] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [isMobile, setIsMobile] = useState(false);

  React.useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Reset state when dialog opens
  React.useEffect(() => {
    if (open) {
      setSelectedCategory(0);
      setSearchTerm('');
    }
  }, [open]);

  // Radarr token categories for movies
  const getTokenCategories = (): TokenCategory[] => {
    const categories: TokenCategory[] = [
      {
        name: 'Movie',
        tokens: [
          { token: '{Movie Title}', description: 'The Movie Title!', example: 'The Movie Title!' },
          { token: '{Movie TitleYear}', description: 'The Movie Title! (2010)', example: 'The Movie Title! 2010' },
          { token: '{Movie TitleThe}', description: 'Movie Title!, The', example: 'Movie Title!, The' },
          { token: '{Movie CleanTitle}', description: 'Movie Title! The', example: 'Movie Title! The' },
          { token: '{Movie CleanTitleYear}', description: 'Movie Title! The 2010', example: 'Movie Title! The 2010' },
          { token: '{Movie CleanTitleThe}', description: 'Movie Title!, The', example: 'Movie Title!, The' },
          { token: '{Movie CleanTitleTheYear}', description: 'Movie Title!, The 2010', example: 'Movie Title!, The 2010' },
          { token: '{Movie TitleFirstCharacter}', description: 'M', example: 'M' },
          { token: '{Movie Year}', description: '2010', example: '2010' },
        ],
      },
      {
        name: 'Movie ID',
        tokens: [
          { token: '{ImdbId}', description: 'tt1234567', example: 'tt1234567' },
          { token: '{TmdbId}', description: '12345', example: '12345' },
        ],
      },
      {
        name: 'Quality',
        tokens: [
          { token: '{Quality Full}', description: 'Bluray-1080p Proper', example: 'Bluray-1080p Proper' },
          { token: '{Quality Title}', description: 'Bluray-1080p', example: 'Bluray-1080p' },
        ],
      },
      {
        name: 'MediaInfo',
        tokens: [
          { token: '{MediaInfo Simple}', description: 'x264 DTS', example: 'x264 DTS' },
          { token: '{MediaInfo Full}', description: 'x264 DTS [EN+DE]', example: 'x264 DTS [EN+DE]' },
          { token: '{MediaInfo AudioCodec}', description: 'DTS', example: 'DTS' },
          { token: '{MediaInfo AudioChannels}', description: '5.1', example: '5.1' },
          { token: '{MediaInfo AudioLanguages}', description: '[EN+DE]', example: '[EN+DE]' },
          { token: '{MediaInfo SubtitleLanguages}', description: '[EN]', example: '[EN]' },
          { token: '{MediaInfo VideoCodec}', description: 'x264', example: 'x264' },
          { token: '{MediaInfo VideoBitDepth}', description: '10bit', example: '10bit' },
          { token: '{MediaInfo VideoDynamicRange}', description: 'HDR', example: 'HDR' },
          { token: '{MediaInfo VideoDynamicRangeType}', description: 'DV HDR10', example: 'DV HDR10' },
        ],
      },
      {
        name: 'Custom',
        tokens: [
          { token: '{Custom Formats}', description: 'iNTERNAL', example: 'iNTERNAL' },
          { token: '{Release Group}', description: 'Rls Grp', example: 'Rls Grp' },
          { token: '{Original Title}', description: 'Original.Title', example: 'Original.Title' },
          { token: '{Original Filename}', description: 'Original.Filename.mkv', example: 'Original.Filename.mkv' },
          { token: '{Edition Tags}', description: 'IMAX', example: 'IMAX' },
        ],
      },
    ];

    return categories;
  };

  const tokenCategories = getTokenCategories();

  // Filter categories based on search term
  const filteredCategories = tokenCategories.map(category => ({
    ...category,
    tokens: category.tokens.filter(token =>
      token.token.toLowerCase().includes(searchTerm.toLowerCase()) ||
      token.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      token.example.toLowerCase().includes(searchTerm.toLowerCase())
    ),
  })).filter(category => category.tokens.length > 0);

  const handleTokenClick = (token: string) => {
    // Append token to the current value in the dialog
    const newValue = currentValue + token;
    onValueChange(newValue);
  };

  const handleCopyToken = (token: string, event: React.MouseEvent) => {
    event.stopPropagation();
    navigator.clipboard.writeText(token);
  };

  const getPlaceholderText = (): string => {
    return 'e.g., The Movie Title (2010) Bluray-1080p Proper';
  };

  const getPreviewText = (format: string): string => {
    if (!format) return '';
    
    // Simple token replacement for preview
    let preview = format;
    const replacements: { [key: string]: string } = {
      '{Movie Title}': 'The Movie Title!',
      '{Movie TitleYear}': 'The Movie Title! (2010)',
      '{Movie CleanTitle}': 'The Movie Title!',
      '{Movie Year}': '2010',
      '{Quality Full}': 'Bluray-1080p Proper',
      '{Quality Title}': 'Bluray-1080p',
      '{MediaInfo Simple}': 'x264 DTS',
      '{MediaInfo VideoCodec}': 'x264',
      '{MediaInfo AudioCodec}': 'DTS',
      '{Custom Formats}': 'iNTERNAL',
      '{Release Group}': 'Rls Grp',
      '{Edition Tags}': 'IMAX',
    };

    Object.entries(replacements).forEach(([token, replacement]) => {
      preview = preview.replace(new RegExp(token.replace(/[{}]/g, '\\$&'), 'g'), replacement);
    });

    return preview;
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      fullScreen={isMobile}
      PaperProps={{
        sx: {
          bgcolor: 'background.default',
          backgroundImage: 'none',
          minHeight: { xs: '100vh', md: '70vh' },
          maxHeight: { xs: '100vh', md: '90vh' },
        },
      }}
    >
      <DialogTitle
        sx={{
          bgcolor: 'background.paper',
          borderBottom: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          py: 2,
        }}
      >
        <Typography variant="h6" fontWeight="600">
          {title} - Movie Name Tokens
        </Typography>
        <IconButton onClick={onClose} size="small">
          <Close />
        </IconButton>
      </DialogTitle>

      {/* Search Bar */}
      <Box sx={{ p: 2, bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider' }}>
        <TextField
          fullWidth
          size="small"
          placeholder="Search tokens..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          InputProps={{
            startAdornment: <Search sx={{ mr: 1, color: 'text.secondary' }} />,
          }}
        />
      </Box>

      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ 
          display: 'flex', 
          height: { xs: 'calc(100vh - 200px)', md: '50vh' },
          flexDirection: { xs: 'column', md: 'row' }
        }}>
          {/* Category Selector */}
          <Box
            sx={{
              width: { xs: '100%', md: 200 },
              minHeight: { xs: 'auto', md: '100%' },
              bgcolor: 'background.paper',
              borderRight: { xs: 'none', md: '1px solid' },
              borderBottom: { xs: '1px solid', md: 'none' },
              borderColor: 'divider',
              p: 2,
              maxHeight: { xs: '200px', md: 'none' },
              overflowY: { xs: 'auto', md: 'visible' },
            }}
          >
            <Typography variant="subtitle2" fontWeight="600" sx={{ mb: 2 }}>
              Categories
            </Typography>
            <Stack spacing={0.5}>
              {filteredCategories.map((category, index) => {
                const isSelected = selectedCategory === index;
                return (
                  <Button
                    key={category.name}
                    variant={isSelected ? 'contained' : 'text'}
                    onClick={() => setSelectedCategory(index)}
                    sx={{
                      justifyContent: 'flex-start',
                      textTransform: 'none',
                      fontWeight: isSelected ? 600 : 400,
                      bgcolor: isSelected ? 'primary.main' : 'transparent',
                      color: isSelected ? 'primary.contrastText' : 'text.primary',
                      '&:hover': {
                        bgcolor: isSelected ? 'primary.dark' : 'action.hover',
                      },
                      borderRadius: 1,
                      py: 1,
                    }}
                  >
                    {category.name}
                  </Button>
                );
              })}
            </Stack>
          </Box>

          {/* Token Grid */}
          <Box sx={{ flex: 1, p: 3, overflow: 'auto' }}>
            {filteredCategories[selectedCategory] && (
              <>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
                  <Typography variant="h6" fontWeight="600">
                    {filteredCategories[selectedCategory].name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Click a token to insert it
                  </Typography>
                </Box>
                
                <Grid container spacing={2}>
                  {filteredCategories[selectedCategory].tokens.map((tokenInfo, index) => (
                    <Grid size={{ xs: 12, sm: 6, md: 6 }} key={index}>
                      <Box
                        onClick={() => handleTokenClick(tokenInfo.token)}
                        sx={{
                          p: 2.5,
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: 2,
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          bgcolor: 'background.paper',
                          '&:hover': {
                            borderColor: 'primary.main',
                            bgcolor: alpha(theme.palette.primary.main, 0.05),
                            transform: 'translateY(-1px)',
                            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                          },
                        }}
                      >
                        <Stack spacing={1.5}>
                          <Stack direction="row" alignItems="center" spacing={1}>
                            <Chip
                              label={tokenInfo.token}
                              size="small"
                              sx={{
                                fontFamily: 'monospace',
                                bgcolor: 'primary.main',
                                color: 'primary.contrastText',
                                fontWeight: 600,
                                fontSize: '0.75rem',
                                maxWidth: '100%',
                                '& .MuiChip-label': {
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                },
                              }}
                            />
                            <IconButton
                              size="small"
                              onClick={(e) => handleCopyToken(tokenInfo.token, e)}
                              sx={{ 
                                ml: 'auto',
                                color: 'text.secondary',
                                '&:hover': {
                                  color: 'primary.main',
                                  bgcolor: alpha(theme.palette.primary.main, 0.1),
                                }
                              }}
                            >
                              <ContentCopy fontSize="small" />
                            </IconButton>
                          </Stack>
                          <Box>
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{ 
                                fontFamily: 'monospace', 
                                fontSize: '0.875rem',
                                fontWeight: 500,
                                mb: 0.5,
                              }}
                            >
                              Example: {tokenInfo.example}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ 
                                fontSize: '0.75rem',
                                lineHeight: 1.3,
                              }}
                            >
                              {tokenInfo.description}
                            </Typography>
                          </Box>
                        </Stack>
                      </Box>
                    </Grid>
                  ))}
                </Grid>
              </>
            )}
          </Box>
        </Box>
      </DialogContent>

      {/* Current Format Display */}
      <Box
        sx={{
          p: 2,
          bgcolor: 'background.paper',
          borderTop: '1px solid',
          borderColor: 'divider',
        }}
      >
        <TextField
          fullWidth
          value={currentValue}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder={getPlaceholderText()}
          variant="outlined"
          sx={{
            '& .MuiOutlinedInput-root': {
              fontFamily: 'monospace',
              fontSize: '0.875rem',
              bgcolor: 'background.default',
              height: '40px',
            },
            '& .MuiOutlinedInput-input': {
              py: 1,
            },
          }}
        />

        {/* Preview Section */}
        {currentValue && (
          <Box sx={{ mt: 1.5 }}>
            <Typography
              variant="caption"
              fontWeight="600"
              sx={{ mb: 0.5, color: 'text.secondary', display: 'block' }}
            >
              Preview:
            </Typography>
            <Box
              sx={{
                p: 1.5,
                bgcolor: alpha(theme.palette.success.main, 0.1),
                border: '1px solid',
                borderColor: alpha(theme.palette.success.main, 0.3),
                borderRadius: 1,
                fontFamily: 'monospace',
                fontSize: '0.8rem',
                color: 'success.main',
                fontWeight: 500,
                wordBreak: 'break-all',
              }}
            >
              {getPreviewText(currentValue) || 'Invalid format'}
            </Box>
          </Box>
        )}
      </Box>

      <DialogActions
        sx={{
          bgcolor: 'background.paper',
          borderTop: '1px solid',
          borderColor: 'divider',
          px: 2,
          py: 1.5,
          flexDirection: { xs: 'column', sm: 'row' },
          gap: { xs: 1.5, sm: 0 },
        }}
      >
        <Stack direction="row" spacing={1} sx={{ ml: 'auto' }}>
          <Button 
            onClick={onClose}
            variant="contained"
            sx={{ textTransform: 'none' }}
          >
            Close
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
};

export default RadarrTokenDialog;
