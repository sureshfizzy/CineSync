import React, { useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, Grid, TextField, Chip, Stack, IconButton, useTheme, alpha } from '@mui/material';
import { Close, ContentCopy } from '@mui/icons-material';

interface TokenCategory {
  name: string;
  tokens: TokenInfo[];
}

interface TokenInfo {
  token: string;
  description: string;
  example: string;
  hasOptions?: boolean;
  options?: string[];
}

interface SonarrTokenDialogProps {
  open: boolean;
  onClose: () => void;
  formatType: 'standard' | 'daily' | 'anime' | 'season';
  title: string;
  currentValue: string;
  onValueChange: (value: string) => void;
}

const SonarrTokenDialog: React.FC<SonarrTokenDialogProps> = ({
  open,
  onClose,
  formatType,
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

  // Define token categories based on format type
  const getTokenCategories = (): TokenCategory[] => {
    const baseCategories: TokenCategory[] = [
      {
        name: 'Series',
        tokens: [
          { token: '{Series Title}', description: 'The Series Title!', example: 'The Series Title!' },
          { token: '{Series TitleYear}', description: 'The Series Title! (2010)', example: 'The Series Title! 2010' },
          { token: '{Series TitleWithoutYear}', description: 'The Series Title!', example: 'The Series Title!' },
          { token: '{Series CleanTitle}', description: 'Series Titles! The', example: 'Series Titles! The' },
          { token: '{Series CleanTitleYear}', description: 'Series Titles! The 2010', example: 'Series Titles! The 2010' },
          { token: '{Series CleanTitleWithoutYear}', description: 'Series Titles! The', example: 'Series Titles! The' },
          { token: '{Series TitleThe}', description: 'Series Titles!, The', example: 'Series Titles!, The' },
          { token: '{Series CleanTitleThe}', description: 'Series Titles!, The', example: 'Series Titles!, The' },
          { token: '{Series TitleTheYear}', description: 'Series Titles!, The (2010)', example: 'Series Titles!, The 2010' },
          { token: '{Series CleanTitleTheYear}', description: 'Series Titles!, The 2010', example: 'Series Titles!, The 2010' },
          { token: '{Series TitleFirstCharacter}', description: 'S', example: 'S' },
          { token: '{Series Year}', description: '2010', example: '2010' },
        ],
      },
      {
        name: 'Series ID',
        tokens: [
          { token: '{ImdbId}', description: 'tt1234567', example: 'tt1234567' },
          { token: '{TmdbId}', description: '12345', example: '12345' },
          { token: '{TvdbId}', description: '54321', example: '54321' },
        ],
      },
    ];

    // Add season tokens for all formats
    baseCategories.push({
      name: 'Season',
      tokens: [
        { token: '{season:0}', description: '1', example: '1' },
        { token: '{season:00}', description: '01', example: '01' },
      ],
    });

    // Add episode tokens only for episode formats
    if (formatType !== 'season') {
      baseCategories.push({
        name: 'Episode',
        tokens: [
          { token: '{episode:0}', description: '1', example: '1' },
          { token: '{episode:00}', description: '01', example: '01' },
          { token: '{Episode Title}', description: 'Episode Title (1)', example: 'Episode Title (1)' },
          { token: '{Episode CleanTitle}', description: 'Episode Title 1', example: 'Episode Title 1' },
        ],
      });
    }

    // Add format-specific tokens
    if (formatType === 'daily') {
      baseCategories.push({
        name: 'Air Date',
        tokens: [
          { token: '{Air-Date}', description: '2013-10-30', example: '2013-10-30' },
          { token: '{Air Date}', description: '2013 10 30', example: '2013 10 30' },
        ],
      });
    }

    if (formatType === 'anime') {
      baseCategories.push({
        name: 'Release',
        tokens: [
          { token: '{Release Group}', description: 'Rls Grp', example: 'Rls Grp' },
          { token: '{Release Hash}', description: 'ABCD1234', example: 'ABCD1234' },
        ],
      });
    }

    // Quality tokens for all episode formats
    if (formatType !== 'season') {
      baseCategories.push({
        name: 'Quality',
        tokens: [
          { token: '{Quality Full}', description: 'HDTV-720p Proper', example: 'HDTV-720p Proper' },
          { token: '{Quality Title}', description: 'HDTV-720p', example: 'HDTV-720p' },
        ],
      });

      baseCategories.push({
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
      });

      baseCategories.push({
        name: 'Custom',
        tokens: [
          { token: '{Custom Formats}', description: 'iNTERNAL', example: 'iNTERNAL' },
          { token: '{Custom Format-FormatName}', description: 'Format Name', example: 'Format Name' },
          { token: '{Release Group}', description: 'Rls Grp', example: 'Rls Grp' },
          { token: '{Original Title}', description: 'Original.Title', example: 'Original.Title' },
          { token: '{Original Filename}', description: 'Original.Filename.mkv', example: 'Original.Filename.mkv' },
        ],
      });
    }

    return baseCategories;
  };

  const tokenCategories = getTokenCategories();

  // Filter tokens based on search term
  const filteredCategories = tokenCategories.map(category => ({
    ...category,
    tokens: category.tokens.filter(token =>
      token.token.toLowerCase().includes(searchTerm.toLowerCase()) ||
      token.description.toLowerCase().includes(searchTerm.toLowerCase())
    ),
  })).filter(category => category.tokens.length > 0);

  const handleTokenClick = (token: string) => {
    const newValue = currentValue + token;
    onValueChange(newValue);
  };

  const handleCopyToken = (token: string, event: React.MouseEvent) => {
    event.stopPropagation();
    navigator.clipboard.writeText(token);
  };

  const getPlaceholderText = (): string => {
    switch (formatType) {
      case 'standard':
        return 'e.g., The Series Title - S01E01 - Episode Title HDTV-720p Proper';
      case 'daily':
        return 'e.g., The Series Title - 2013-10-30 - Episode Title HDTV-720p Proper';
      case 'anime':
        return 'e.g., The Series Title - S01E01 - Episode Title HDTV-720p Proper';
      case 'season':
        return 'e.g., Season 01';
      default:
        return '';
    }
  };

  const getPreviewText = (format: string): string => {
    if (!format) return '';

    let preview = format;
    const replacements: { [key: string]: string } = {
      '{Series Title}': 'The Series Title!',
      '{Series TitleYear}': 'The Series Title! (2010)',
      '{Series CleanTitle}': 'The Series Title!',
      '{season:0}': '1',
      '{season:00}': '01',
      '{season}': '1',
      '{episode:0}': '1',
      '{episode:00}': '01',
      '{Episode Title}': 'Episode Title (1)',
      '{Air-Date}': '2013-10-30',
      '{Quality Full}': 'HDTV-720p Proper',
      '{Quality Title}': 'HDTV-720p',
      '{MediaInfo Simple}': 'x264 DTS',
      '{Release Group}': 'Rls Grp',
      '{Custom Formats}': 'iNTERNAL',
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
          py: 2,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="h6" fontWeight="600">
            {title} - Folder Name Tokens
          </Typography>
          <IconButton onClick={onClose} size="small">
            <Close />
          </IconButton>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.875rem' }}>
          Click tokens below to build your format, or edit directly in the text field at the bottom
        </Typography>
      </DialogTitle>

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
            <TextField
              fullWidth
              size="small"
              placeholder="Search tokens..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              sx={{ mb: 2 }}
            />
            
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

export default SonarrTokenDialog;