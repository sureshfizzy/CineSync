import React from 'react';
import { Box, Card, CardContent, Typography, Alert, Stack, useTheme, alpha, Collapse } from '@mui/material';
import { Storage, CheckCircle, Error, Science, Download, Code, PlayArrow, Description } from '@mui/icons-material';

interface RcloneConfig {
  mountPath: string;
  vfsCacheMode: string;
  vfsCacheMaxSize: string;
  vfsReadAhead: string;
  bufferSize: string;
  CachePath?: string;
  logLevel?: string;
  logFile?: string;
}

interface CineSyncMountGuideProps {
  config: RcloneConfig;
  serverOS: string;
  showGuide: boolean;
}

const CineSyncMountGuide: React.FC<CineSyncMountGuideProps> = ({
  config,
  serverOS,
  showGuide,
}) => {
  const theme = useTheme();
  const isWindows = serverOS === 'windows';

  const configFilePath = isWindows
    ? '%APPDATA%\\rclone\\cinesync.conf'
    : '~/.config/rclone/cinesync.conf';

  const configFileExample = `[CineSync]
type = webdav
url = http://localhost:8082/api/realdebrid/webdav/
user = admin
pass = ENCRYPTED_PASSWORD_HERE
vendor = other`;

  const createConfigCommand = isWindows
    ? `rclone config create CineSync webdav \\
  url http://localhost:8082/api/realdebrid/webdav/ \\
  user admin \\
  pass YOUR_PASSWORD \\
  vendor other`
    : `rclone config create CineSync webdav \\
  url http://localhost:8082/api/realdebrid/webdav/ \\
  user admin \\
  pass YOUR_PASSWORD \\
  vendor other`;

  const exampleMountPath = isWindows ? 'Z:\\' : '/mnt/realdebrid';
  const exampleCachePath = isWindows ? 'C:\\temp\\rclone-cache' : '/tmp/rclone-cache';
  const exampleLogPath = isWindows ? 'C:\\temp\\rclone.log' : '/tmp/rclone.log';

  return (
    <Collapse in={showGuide}>
      <Stack spacing={{ xs: 1.5, md: 2.5 }}>
        <Alert
          severity="info"
          icon={<Storage fontSize="small" />}
          sx={{
            borderRadius: 2,
            bgcolor: alpha(theme.palette.info.main, 0.08),
            border: `1px solid ${alpha(theme.palette.info.main, 0.2)}`,
          }}
        >
          <Typography variant="body2">
            <strong>Manual Mount Guide:</strong> This guide is only needed if you want to manually mount CineSync using rclone. <strong>Not necessary when using the inbuilt mount feature</strong> - the backend automatically manages the rclone config with remote <strong>CineSync</strong>.
          </Typography>
        </Alert>

        {/* Step 1: Install rclone */}
        <Card
          variant="outlined"
          sx={{
            bgcolor: alpha(theme.palette.primary.main, 0.03),
            borderColor: alpha(theme.palette.primary.main, 0.1),
            borderRadius: 2,
          }}
        >
          <CardContent sx={{ p: { xs: 1.5, md: 2 } }}>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: { xs: 1, md: 1.5 } }}>
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: 1.5,
                  bgcolor: alpha(theme.palette.primary.main, 0.1),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'primary.main',
                }}
              >
                <Download sx={{ fontSize: 18 }} />
              </Box>
              <Typography variant="subtitle2" fontWeight="700" color="primary.main">
                1. Install Rclone & FUSE
              </Typography>
            </Stack>
            <Stack spacing={1}>
              {isWindows ? (
                <>
                  <Typography variant="body2" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <CheckCircle sx={{ fontSize: 16, color: 'success.main', mt: 0.25, flexShrink: 0 }} />
                    <span>
                      Download from{' '}
                      <a
                        href="https://rclone.org/downloads/"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: theme.palette.primary.main, textDecoration: 'none' }}
                      >
                        rclone.org
                      </a>{' '}
                      or{' '}
                      <code
                        style={{
                          background: alpha(theme.palette.primary.main, 0.1),
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '0.85rem',
                        }}
                      >
                        choco install rclone
                      </code>
                    </span>
                  </Typography>
                  <Typography variant="body2" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <CheckCircle sx={{ fontSize: 16, color: 'success.main', mt: 0.25, flexShrink: 0 }} />
                    <span>
                      Install <strong>WinFsp</strong> from{' '}
                      <a
                        href="https://github.com/winfsp/winfsp/releases"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: theme.palette.primary.main, textDecoration: 'none' }}
                      >
                        GitHub
                      </a>{' '}
                      for FUSE support
                    </span>
                  </Typography>
                </>
              ) : (
                <>
                  <Typography variant="body2" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <CheckCircle sx={{ fontSize: 16, color: 'success.main', mt: 0.25, flexShrink: 0 }} />
                    <span>
                      <strong>Debian/Ubuntu:</strong>{' '}
                      <code
                        style={{
                          background: alpha(theme.palette.primary.main, 0.1),
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '0.85rem',
                        }}
                      >
                        sudo apt update && sudo apt install rclone fuse
                      </code>
                    </span>
                  </Typography>
                  <Typography variant="body2" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <CheckCircle sx={{ fontSize: 16, color: 'success.main', mt: 0.25, flexShrink: 0 }} />
                    <span>
                      <strong>RHEL/CentOS/Fedora:</strong>{' '}
                      <code
                        style={{
                          background: alpha(theme.palette.primary.main, 0.1),
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '0.85rem',
                        }}
                      >
                        sudo dnf install rclone fuse
                      </code>{' '}
                      or{' '}
                      <code
                        style={{
                          background: alpha(theme.palette.primary.main, 0.1),
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '0.85rem',
                        }}
                      >
                        sudo yum install rclone fuse
                      </code>
                    </span>
                  </Typography>
                  <Typography variant="body2" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <CheckCircle sx={{ fontSize: 16, color: 'success.main', mt: 0.25, flexShrink: 0 }} />
                    <span>
                      <strong>Arch Linux:</strong>{' '}
                      <code
                        style={{
                          background: alpha(theme.palette.primary.main, 0.1),
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '0.85rem',
                        }}
                      >
                        sudo pacman -S rclone fuse2
                      </code>
                    </span>
                  </Typography>
                  <Typography variant="body2" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <CheckCircle sx={{ fontSize: 16, color: 'success.main', mt: 0.25, flexShrink: 0 }} />
                    <span>
                      <strong>macOS:</strong>{' '}
                      <code
                        style={{
                          background: alpha(theme.palette.primary.main, 0.1),
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '0.85rem',
                        }}
                      >
                        brew install rclone macfuse
                      </code>
                    </span>
                  </Typography>
                  <Typography variant="body2" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <CheckCircle sx={{ fontSize: 16, color: 'success.main', mt: 0.25, flexShrink: 0 }} />
                    <span>
                      Verify:{' '}
                      <code
                        style={{
                          background: alpha(theme.palette.primary.main, 0.1),
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '0.85rem',
                        }}
                      >
                        rclone version
                      </code>{' '}
                      and{' '}
                      <code
                        style={{
                          background: alpha(theme.palette.primary.main, 0.1),
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '0.85rem',
                        }}
                      >
                        fusermount --version
                      </code>
                    </span>
                  </Typography>
                </>
              )}
            </Stack>
          </CardContent>
        </Card>

        {/* Step 2: Config File Example */}
        <Card
          variant="outlined"
          sx={{
            bgcolor: alpha(theme.palette.warning.main, 0.03),
            borderColor: alpha(theme.palette.warning.main, 0.1),
            borderRadius: 2,
          }}
        >
          <CardContent sx={{ p: { xs: 1.5, md: 2 } }}>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: { xs: 1, md: 1.5 } }}>
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: 1.5,
                  bgcolor: alpha(theme.palette.warning.main, 0.1),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'warning.main',
                }}
              >
                <Description sx={{ fontSize: 18 }} />
              </Box>
              <Typography variant="subtitle2" fontWeight="700" color="warning.main">
                2. Config File Example
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: { xs: 1, md: 1.5 }, fontSize: '0.875rem' }}>
              The config file contains the CineSync remote configuration:
            </Typography>
            <Box
              sx={{
                bgcolor: alpha(theme.palette.grey[900], 0.05),
                border: `1px solid ${alpha(theme.palette.grey[500], 0.2)}`,
                borderRadius: 1.5,
                p: 2,
                fontFamily: 'Roboto Mono, monospace',
                fontSize: '0.8rem',
                lineHeight: 1.8,
                overflowX: 'auto',
                maxWidth: '100%',
                wordBreak: 'break-word',
              }}
            >
              <Typography
                component="div"
                variant="body2"
                sx={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: 'text.primary',
                }}
              >
                {configFileExample}
              </Typography>
            </Box>
            <Alert severity="info" sx={{ mt: { xs: 1, md: 1.5 }, borderRadius: 1.5 }} icon={<Science fontSize="small" />}>
              <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>
                <strong>Note:</strong> Use your CineSync WebDAV login credentials (set via <code style={{ background: alpha(theme.palette.info.main, 0.1), padding: '1px 4px', borderRadius: '3px', fontSize: '0.8rem' }}>CINESYNC_USERNAME</code> and <code style={{ background: alpha(theme.palette.info.main, 0.1), padding: '1px 4px', borderRadius: '3px', fontSize: '0.8rem' }}>CINESYNC_PASSWORD</code> environment variables).
              </Typography>
            </Alert>
          </CardContent>
        </Card>

        {/* Step 3.5: Create Config File */}
        <Card
          variant="outlined"
          sx={{
            bgcolor: alpha(theme.palette.secondary.main, 0.03),
            borderColor: alpha(theme.palette.secondary.main, 0.1),
            borderRadius: 2,
          }}
        >
          <CardContent sx={{ p: { xs: 1.5, md: 2 } }}>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: { xs: 1, md: 1.5 } }}>
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: 1.5,
                  bgcolor: alpha(theme.palette.secondary.main, 0.1),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'secondary.main',
                }}
              >
                <Code sx={{ fontSize: 18 }} />
              </Box>
              <Typography variant="subtitle2" fontWeight="700" color="secondary.main">
                3. Create Config File (Optional)
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: { xs: 1, md: 1.5 }, fontSize: '0.875rem' }}>
              To manually create the config file, run this command (replace <code style={{ background: alpha(theme.palette.secondary.main, 0.1), padding: '1px 4px', borderRadius: '3px', fontSize: '0.8rem' }}>YOUR_PASSWORD</code> with your CineSync WebDAV password):
            </Typography>
            {isWindows && (
              <Alert severity="info" sx={{ mb: 1.5, borderRadius: 1.5, fontSize: '0.875rem' }} icon={<Science fontSize="small" />}>
                <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>
                  <strong>Windows:</strong> If rclone is not in PATH, use the full path: <code style={{ background: alpha(theme.palette.info.main, 0.1), padding: '1px 4px', borderRadius: '3px', fontSize: '0.8rem' }}>"C:\\Program Files\\rclone\\rclone.exe" config create...</code>
                </Typography>
              </Alert>
            )}
            <Box
              sx={{
                bgcolor: alpha(theme.palette.grey[900], 0.05),
                border: `1px solid ${alpha(theme.palette.grey[500], 0.2)}`,
                borderRadius: 1.5,
                p: 2,
                fontFamily: 'Roboto Mono, monospace',
                fontSize: '0.8rem',
                lineHeight: 1.8,
                overflowX: 'auto',
                maxWidth: '100%',
                wordBreak: 'break-word',
              }}
            >
              <Typography
                component="div"
                variant="body2"
                sx={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: 'text.primary',
                }}
              >
                {createConfigCommand}
              </Typography>
            </Box>
            <Alert severity="warning" sx={{ mt: 1.5, borderRadius: 1.5 }} icon={<Science fontSize="small" />}>
              <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>
                <strong>Note:</strong> This creates the config in rclone's default location. To use a custom config file, add <code style={{ background: alpha(theme.palette.warning.main, 0.1), padding: '1px 4px', borderRadius: '3px', fontSize: '0.8rem' }}>--config "{configFilePath}"</code> flag. The backend automatically creates and manages the config at <code style={{ background: alpha(theme.palette.warning.main, 0.1), padding: '1px 4px', borderRadius: '3px', fontSize: '0.8rem' }}>{configFilePath}</code> - manual creation is optional.
              </Typography>
            </Alert>
          </CardContent>
        </Card>

        {/* Step 4: Mount Command */}
        <Card
          variant="outlined"
          sx={{
            bgcolor: alpha(theme.palette.secondary.main, 0.03),
            borderColor: alpha(theme.palette.secondary.main, 0.1),
            borderRadius: 2,
          }}
        >
          <CardContent sx={{ p: { xs: 1.5, md: 2 } }}>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: { xs: 1, md: 1.5 } }}>
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: 1.5,
                  bgcolor: alpha(theme.palette.secondary.main, 0.1),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'secondary.main',
                }}
              >
                <Code sx={{ fontSize: 18 }} />
              </Box>
              <Typography variant="subtitle2" fontWeight="700" color="secondary.main">
                4. Mount Command
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: { xs: 1, md: 1.5 }, fontSize: '0.875rem' }}>
              Run from your server shell (add additional flags as needed):
            </Typography>
            {isWindows && (
              <Alert severity="info" sx={{ mb: 1.5, borderRadius: 1.5, fontSize: '0.875rem' }} icon={<Science fontSize="small" />}>
                <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>
                  <strong>Windows:</strong> If rclone is not in PATH, replace <code style={{ background: alpha(theme.palette.info.main, 0.1), padding: '1px 4px', borderRadius: '3px', fontSize: '0.8rem' }}>rclone</code> with the full path: <code style={{ background: alpha(theme.palette.info.main, 0.1), padding: '1px 4px', borderRadius: '3px', fontSize: '0.8rem' }}>"C:\\Program Files\\rclone\\rclone.exe"</code>
                </Typography>
              </Alert>
            )}
            <Box
              sx={{
                bgcolor: alpha(theme.palette.grey[900], 0.05),
                border: `1px solid ${alpha(theme.palette.grey[500], 0.2)}`,
                borderRadius: 1.5,
                p: 2,
                fontFamily: 'Roboto Mono, monospace',
                fontSize: '0.8rem',
                lineHeight: 1.8,
                overflowX: 'auto',
                maxWidth: '100%',
                position: 'relative',
              }}
            >
              <Typography
                component="div"
                variant="body2"
                sx={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: 'text.primary',
                }}
              >
                {isWindows ? (
                  `rclone mount CineSync: ${exampleMountPath} \\
  --config "${configFilePath}" \\
  --vfs-cache-mode ${config.vfsCacheMode || 'full'} \\
  --cache-dir "${exampleCachePath}" \\
  --vfs-cache-max-size ${config.vfsCacheMaxSize || '100G'} \\
  --vfs-read-ahead ${config.vfsReadAhead || '128M'} \\
  --buffer-size ${config.bufferSize || '16M'} \\
  --log-file "${exampleLogPath}"`
                ) : (
                  `rclone mount CineSync: ${exampleMountPath} \\
  --config ${configFilePath} \\
  --vfs-cache-mode ${config.vfsCacheMode || 'full'} \\
  --cache-dir "${exampleCachePath}" \\
  --vfs-cache-max-size ${config.vfsCacheMaxSize || '100G'} \\
  --vfs-read-ahead ${config.vfsReadAhead || '128M'} \\
  --buffer-size ${config.bufferSize || '16M'} \\
  --allow-other \\
  --allow-non-empty \\
  --log-file "${exampleLogPath}"`
                )}
              </Typography>
            </Box>
            {!isWindows && (
              <Alert
                severity="info"
                sx={{ mt: 1.5, borderRadius: 1.5, fontSize: '0.875rem' }}
                icon={<Science fontSize="small" />}
              >
                <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>
                  <strong>Linux Permissions:</strong> For multi-user access, add{' '}
                  <code
                    style={{
                      background: alpha(theme.palette.info.main, 0.1),
                      padding: '1px 4px',
                      borderRadius: '3px',
                      fontSize: '0.8rem',
                    }}
                  >
                    --allow-other
                  </code>{' '}
                  and enable it in{' '}
                  <code
                    style={{
                      background: alpha(theme.palette.info.main, 0.1),
                      padding: '1px 4px',
                      borderRadius: '3px',
                      fontSize: '0.8rem',
                    }}
                  >
                    /etc/fuse.conf
                  </code>{' '}
                  by uncommenting{' '}
                  <code
                    style={{
                      background: alpha(theme.palette.info.main, 0.1),
                      padding: '1px 4px',
                      borderRadius: '3px',
                      fontSize: '0.8rem',
                    }}
                  >
                    user_allow_other
                  </code>
                </Typography>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Step 5: Verify */}
        <Card
          variant="outlined"
          sx={{
            bgcolor: alpha(theme.palette.success.main, 0.03),
            borderColor: alpha(theme.palette.success.main, 0.1),
            borderRadius: 2,
          }}
        >
          <CardContent sx={{ p: { xs: 1.5, md: 2 } }}>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: { xs: 1, md: 1.5 } }}>
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: 1.5,
                  bgcolor: alpha(theme.palette.success.main, 0.1),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'success.main',
                }}
              >
                <PlayArrow sx={{ fontSize: 18 }} />
              </Box>
              <Typography variant="subtitle2" fontWeight="700" color="success.main">
                5. Verify & Unmount
              </Typography>
            </Stack>
            <Stack spacing={1}>
              {isWindows ? (
                <>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <CheckCircle sx={{ fontSize: 16, color: 'success.main', mt: 0.25, flexShrink: 0 }} />
                    <Box>
                      <Typography variant="body2" component="span">
                        Check:{' '}
                      </Typography>
                      <code
                        style={{
                          background: alpha(theme.palette.primary.main, 0.1),
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '0.85rem',
                        }}
                      >
                        dir {config.mountPath || (isWindows ? 'Z:' : '/mnt/realdebrid')}
                      </code>
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <Error sx={{ fontSize: 16, color: 'error.main', mt: 0.25, flexShrink: 0 }} />
                    <Box>
                      <Typography variant="body2" component="span">
                        Unmount:{' '}
                      </Typography>
                      <code
                        style={{
                          background: alpha(theme.palette.error.main, 0.1),
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '0.85rem',
                        }}
                      >
                        taskkill /F /IM rclone.exe
                      </code>
                    </Box>
                  </Box>
                </>
              ) : (
                <>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <CheckCircle sx={{ fontSize: 16, color: 'success.main', mt: 0.25, flexShrink: 0 }} />
                    <Box>
                      <Typography variant="body2" component="span">
                        Check:{' '}
                      </Typography>
                      <code
                        style={{
                          background: alpha(theme.palette.primary.main, 0.1),
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '0.85rem',
                        }}
                      >
                        ls {config.mountPath || '/mnt/realdebrid'}
                      </code>
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <CheckCircle sx={{ fontSize: 16, color: 'success.main', mt: 0.25, flexShrink: 0 }} />
                    <Box>
                      <Typography variant="body2" component="span">
                        Verify mount:{' '}
                      </Typography>
                      <code
                        style={{
                          background: alpha(theme.palette.primary.main, 0.1),
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '0.85rem',
                        }}
                      >
                        mount | grep rclone
                      </code>
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <Error sx={{ fontSize: 16, color: 'error.main', mt: 0.25, flexShrink: 0 }} />
                    <Box>
                      <Typography variant="body2" component="span">
                        Unmount:{' '}
                      </Typography>
                      <code
                        style={{
                          background: alpha(theme.palette.error.main, 0.1),
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '0.85rem',
                        }}
                      >
                        fusermount -u "{config.mountPath || '/mnt/realdebrid'}"
                      </code>
                    </Box>
                  </Box>
                </>
              )}
            </Stack>
          </CardContent>
        </Card>

        <Alert
          severity="success"
          icon={<CheckCircle fontSize="small" />}
          sx={{
            borderRadius: 2,
            bgcolor: alpha(theme.palette.success.main, 0.08),
            border: `1px solid ${alpha(theme.palette.success.main, 0.2)}`,
          }}
        >
          <Typography variant="body2">
            <strong>Pro Tip:</strong> For automatic mounting, enable "Auto-mount on application start" above or use the Mount button for one-click setup.
          </Typography>
        </Alert>
      </Stack>
    </Collapse>
  );
};

export default CineSyncMountGuide;

