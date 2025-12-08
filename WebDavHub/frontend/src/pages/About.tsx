import { Fragment, useEffect, useState } from 'react';
import { Box, Grid, Paper, Typography, Stack, Chip, Divider, AvatarGroup, Avatar, Button, LinearProgress, useTheme, alpha } from '@mui/material';
import RocketLaunchRoundedIcon from '@mui/icons-material/RocketLaunchRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded';
import TimelineRoundedIcon from '@mui/icons-material/TimelineRounded';
import EmojiEventsRoundedIcon from '@mui/icons-material/EmojiEventsRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import CodeRoundedIcon from '@mui/icons-material/CodeRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import FavoriteRoundedIcon from '@mui/icons-material/FavoriteRounded';
import VolunteerActivismRoundedIcon from '@mui/icons-material/VolunteerActivismRounded';
import LocalCafeRoundedIcon from '@mui/icons-material/LocalCafeRounded';
import PaidRoundedIcon from '@mui/icons-material/PaidRounded';
import CloudDoneRoundedIcon from '@mui/icons-material/CloudDoneRounded';
import LibraryBooksRoundedIcon from '@mui/icons-material/LibraryBooksRounded';
import { Link as RouterLink } from 'react-router-dom';
import logoImage from '../assets/logo.png';

type GitHubStats = {
  stars: number | null;
  forks: number | null;
  openIssues: number | null;
  releaseCount: number | null;
  latestRelease: string | null;
};

const formatNumber = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en', { notation: 'compact' }).format(value);
};

type TechItem = { name: string; bytes?: number };
type Contributor = { login: string; avatarUrl: string; htmlUrl: string };
type SponsorLink = { label: string; href: string; icon: React.ReactNode; color: string };

const sponsorLinks: SponsorLink[] = [
  { label: 'GitHub Sponsors', href: 'https://github.com/sponsors/sureshfizzy', icon: <VolunteerActivismRoundedIcon />, color: '#9333ea' },
  { label: 'Patreon', href: 'https://www.patreon.com/c/sureshs/membership', icon: <FavoriteRoundedIcon />, color: '#ff424d' },
  { label: 'Buy Me a Coffee', href: 'https://www.buymeacoffee.com/Sureshfizzy', icon: <LocalCafeRoundedIcon />, color: '#ffdd00' },
  { label: 'PayPal', href: 'https://www.paypal.me/sureshfizzy', icon: <PaidRoundedIcon />, color: '#1e3a8a' },
];

const featureCards = [
  {
    title: 'Automation First',
    description: 'File orchestration and metadata workflows in concert—so your library stays tidy without babysitting.',
    icon: <AutoAwesomeRoundedIcon />,
    color: '#8b5cf6',
  },
  {
    title: 'Built for Scale',
    description: 'A Go-powered backend with SSE updates, resilient jobs, and a responsive React UI that handles heavy libraries.',
    icon: <RocketLaunchRoundedIcon />,
    color: '#3b82f6',
  },
  {
    title: 'Secure by Design',
    description: 'Auth guards, scoped actions, and observability baked in. You get clarity and control, not guesswork.',
    icon: <ShieldRoundedIcon />,
    color: '#22c55e',
  },
];

export default function About() {
  const theme = useTheme();
  const [ghStats, setGhStats] = useState<GitHubStats>({
    stars: null,
    forks: null,
    openIssues: null,
    releaseCount: null,
    latestRelease: null,
  });
  const [techStack, setTechStack] = useState<TechItem[]>([]);
  const [contributors, setContributors] = useState<Contributor[]>([]);

  useEffect(() => {
    let cancelled = false;

    const fetchStats = async () => {
      try {
        const [repoRes, releasesRes, langsRes, contribRes] = await Promise.all([
          fetch('https://api.github.com/repos/sureshfizzy/CineSync'),
          fetch('https://api.github.com/repos/sureshfizzy/CineSync/releases?per_page=1'),
          fetch('https://api.github.com/repos/sureshfizzy/CineSync/languages'),
          fetch('https://api.github.com/repos/sureshfizzy/CineSync/contributors?per_page=8'),
        ]);

        if (!repoRes.ok) throw new Error('Failed to load repo stats');

        const repoData = await repoRes.json();
        let releaseCount: number | null = null;
        let latestRelease: string | null = null;

        if (releasesRes.ok) {
          const releases = await releasesRes.json();
          latestRelease = Array.isArray(releases) && releases.length > 0 ? releases[0].tag_name || releases[0].name : null;

          const link = releasesRes.headers.get('link');
          if (link && link.includes('rel="last"')) {
            const lastPageMatch = link.match(/&?page=(\d+)>; rel="last"/);
            releaseCount = lastPageMatch ? Number(lastPageMatch[1]) : null;
          } else if (Array.isArray(releases)) {
            releaseCount = releases.length;
          }
        }

        let languages: TechItem[] = [];
        if (langsRes.ok) {
          const langsData = await langsRes.json();
          languages = Object.entries(langsData)
            .map(([name, bytes]) => ({ name, bytes: Number(bytes) }))
            .sort((a, b) => (b.bytes || 0) - (a.bytes || 0))
            .slice(0, 8);
        }

        let contribs: Contributor[] = [];
        if (contribRes.ok) {
          const data = await contribRes.json();
          if (Array.isArray(data)) {
            contribs = data.slice(0, 8).map((c: any) => ({
              login: c.login,
              avatarUrl: c.avatar_url,
              htmlUrl: c.html_url,
            }));
          }
        }

        if (!cancelled) {
          setGhStats({
            stars: repoData.stargazers_count ?? null,
            forks: repoData.forks_count ?? null,
            openIssues: repoData.open_issues_count ?? null,
            releaseCount,
            latestRelease,
          });
          setTechStack(languages);
          setContributors(contribs);
        }
      } catch (error) {
        console.error('Failed to fetch GitHub stats', error);
        if (!cancelled) {
          setGhStats((prev) => ({ ...prev }));
          setTechStack((prev) => prev);
          setContributors((prev) => prev);
        }
      }
    };

    fetchStats();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Box sx={{ py: { xs: 2, sm: 3 }, px: { xs: 1, sm: 2 } }}>
      {/* Hero */}
      <Paper
        sx={{
          p: { xs: 3, sm: 4, md: 5 },
          mb: 3,
          borderRadius: 3,
          overflow: 'hidden',
          background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.12)} 0%, ${alpha(
            theme.palette.primary.dark,
            0.14
          )} 100%)`,
          border: `1px solid ${alpha(theme.palette.primary.main, 0.18)}`,
          position: 'relative',
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            background: `radial-gradient(circle at 20% 20%, ${alpha(theme.palette.primary.light, 0.12)} 0, transparent 35%),
                         radial-gradient(circle at 80% 0%, ${alpha(theme.palette.secondary.main, 0.14)} 0, transparent 30%)`,
            pointerEvents: 'none',
          }}
        />

        <Stack spacing={2} sx={{ position: 'relative' }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box
              sx={{
                width: 48,
                height: 48,
                borderRadius: 2,
                overflow: 'hidden',
                boxShadow: `0 10px 35px ${alpha(theme.palette.primary.main, 0.25)}`,
              }}
            >
              <img src={logoImage} alt="CineSync" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </Box>
            <Chip
              label="About CineSync"
              color="primary"
              variant="outlined"
              icon={<EmojiEventsRoundedIcon fontSize="small" />}
              sx={{ fontWeight: 700 }}
            />
          </Stack>

          <Typography
            variant="h3"
            sx={{
              fontWeight: 700,
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
              maxWidth: 760,
            }}
          >
            Built for collectors, tuned for automation, ready for every watch.
          </Typography>

          <Typography
            variant="body1"
            color="text.secondary"
            sx={{ maxWidth: 760, fontSize: { xs: '1rem', md: '1.05rem' }, lineHeight: 1.7 }}
          >
            CineSync keeps your media organized—indexing, cleaning, and serving your library across WebDAV with a responsive, straightforward UI.
          </Typography>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <Button
              variant="contained"
              size="large"
              startIcon={<RocketLaunchRoundedIcon />}
              component={RouterLink}
              to="/dashboard"
              sx={{ borderRadius: 2 }}
            >
              Open Dashboard
            </Button>
            <Button
              variant="outlined"
              size="large"
              startIcon={<SettingsRoundedIcon />}
              component={RouterLink}
              to="/settings"
              sx={{ borderRadius: 2 }}
            >
              Configure Services
            </Button>
            <Button
              variant="outlined"
              size="large"
              startIcon={<LibraryBooksRoundedIcon />}
              component="a"
              href="https://github.com/sureshfizzy/CineSync/wiki"
              target="_blank"
              rel="noreferrer"
              sx={{ borderRadius: 2 }}
            >
              View Wiki
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {/* Stats */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {[
          { label: 'GitHub Stars', value: formatNumber(ghStats.stars), icon: <EmojiEventsRoundedIcon /> },
          { label: 'GitHub Forks', value: formatNumber(ghStats.forks), icon: <GroupsRoundedIcon /> },
          { label: 'Open Issues', value: formatNumber(ghStats.openIssues), icon: <BoltRoundedIcon /> },
          { label: 'Releases', value: ghStats.releaseCount !== null ? formatNumber(ghStats.releaseCount) : '—', icon: <AutoAwesomeRoundedIcon /> },
        ].map((card) => (
          <Grid key={card.label} size={{ xs: 6, sm: 6, md: 3 }} sx={{ display: { xs: 'flex', sm: 'block' } }}>
            <Paper
              sx={{
                p: 2.5,
                borderRadius: 2.5,
                border: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
                bgcolor: alpha(theme.palette.background.paper, 0.9),
                height: { xs: '100%', sm: 'auto' },
                display: { xs: 'flex', sm: 'block' },
                alignItems: { xs: 'center', sm: 'stretch' },
                width: '100%',
                minWidth: 0,
              }}
            >
              <Stack direction="row" alignItems="center" spacing={2} sx={{ width: '100%' }}>
                <Box
                  sx={{
                    width: 42,
                    height: 42,
                    borderRadius: 1.5,
                    bgcolor: alpha(theme.palette.primary.main, 0.12),
                    color: theme.palette.primary.main,
                    display: 'grid',
                    placeItems: 'center',
                    boxShadow: `0 10px 28px ${alpha(theme.palette.primary.main, 0.18)}`,
                    flexShrink: 0,
                  }}
                >
                  {card.icon}
                </Box>
                <Box>
                  <Typography variant="h5" fontWeight={700} sx={{ lineHeight: 1 }}>
                    {card.value}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {card.label}
                  </Typography>
                </Box>
              </Stack>
            </Paper>
          </Grid>
        ))}
      </Grid>

      {ghStats.latestRelease && (
        <Box sx={{ mb: 3 }}>
          <Chip
            label={`Latest Release: ${ghStats.latestRelease}`}
            color="secondary"
            variant="outlined"
            icon={<CodeRoundedIcon />}
            sx={{ fontWeight: 700, borderRadius: 2 }}
          />
        </Box>
      )}

      {/* ElfHosted */}
      <Paper
        sx={{
          mt: 1.5,
          mb: 3,
          p: { xs: 3, sm: 3.5 },
          borderRadius: 3,
          border: `1px solid ${alpha(theme.palette.success.main, 0.25)}`,
          background: `linear-gradient(135deg, ${alpha(theme.palette.success.light, 0.18)} 0%, ${alpha(theme.palette.success.main, 0.12)} 100%)`,
          boxShadow: `0 12px 32px ${alpha(theme.palette.success.main, 0.15)}`,
        }}
      >
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} alignItems="center">
            <CloudDoneRoundedIcon sx={{ color: theme.palette.success.dark }} />
            <Typography variant="h6" fontWeight={700}>
              ElfHosted “Easy Mode”
            </Typography>
            <Chip
              label="Sponsored"
              size="small"
              sx={{
                ml: 1,
                borderRadius: 999,
                px: 1.4,
                height: 24,
                fontSize: '0.65rem',
                fontWeight: 800,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: theme.palette.warning.dark,
                background: alpha(theme.palette.warning.light, 0.18),
                border: `1px solid ${alpha(theme.palette.warning.dark, 0.35)}`,
                boxShadow: `0 6px 18px ${alpha(theme.palette.warning.dark, 0.18)}`,
                backdropFilter: 'blur(8px)',
                position: 'relative',
                overflow: 'hidden',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                '&:hover': {
                  transform: 'translateY(-1px)',
                  boxShadow: `0 10px 24px ${alpha(theme.palette.warning.dark, 0.28)}`,
                },
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  top: 0,
                  left: '-60%',
                  width: '55%',
                  height: '100%',
                  background: 'linear-gradient(120deg, rgba(255,255,255,0.35), rgba(255,255,255,0))',
                  transform: 'skewX(-18deg)',
                  animation: 'shine-modern 4.2s ease-in-out infinite',
                },
                '@keyframes shine-modern': {
                  '0%': { left: '-50%', opacity: 0 },
                  '15%': { opacity: 1 },
                  '45%': { left: '115%', opacity: 1 },
                  '100%': { left: '115%', opacity: 0 },
                },
              }}
            />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            ElfHosted runs CineSync for you—managed hosting, updates, and support so you can just use the app. It’s the “easy mode” highlighted in the README.
          </Typography>
          <Stack direction="row" flexWrap="wrap" gap={1}>
            <Chip
              label="7-day trial for $1"
              size="small"
              sx={{
                borderRadius: 2,
                bgcolor: alpha(theme.palette.success.dark, 0.16),
                color: theme.palette.success.dark,
                fontWeight: 700,
              }}
            />
            <Chip
              label="100+ self-hosted apps"
              size="small"
              sx={{
                borderRadius: 2,
                bgcolor: alpha(theme.palette.success.dark, 0.16),
                color: theme.palette.success.dark,
                fontWeight: 700,
              }}
            />
            <Chip
              label="Excellent ★★★★★ on TrustPilot"
              size="small"
              sx={{
                borderRadius: 2,
                bgcolor: alpha(theme.palette.success.dark, 0.16),
                color: theme.palette.success.dark,
                fontWeight: 700,
              }}
            />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <Button
              variant="contained"
              color="success"
              startIcon={<CloudDoneRoundedIcon />}
              component="a"
              href="https://store.elfhosted.com/product/cinesync/"
              target="_blank"
              rel="noreferrer"
              sx={{ borderRadius: 2 }}
            >
              View CineSync on ElfHosted
            </Button>
            <Button
              variant="outlined"
              color="success"
              component="a"
              href="https://docs.elfhosted.com"
              target="_blank"
              rel="noreferrer"
              sx={{ borderRadius: 2 }}
            >
              Read ElfHosted Docs
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {/* Features */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {featureCards.map((feature) => (
          <Grid key={feature.title} size={{ xs: 12, md: 4 }}>
            <Paper
              sx={{
                p: 3,
                height: '100%',
                borderRadius: 3,
                border: `1px solid ${alpha(feature.color, 0.3)}`,
                bgcolor: alpha(feature.color, theme.palette.mode === 'dark' ? 0.08 : 0.06),
                display: 'flex',
                flexDirection: 'column',
                gap: 1.5,
              }}
            >
              <Box
                sx={{
                  width: 44,
                  height: 44,
                  borderRadius: 2,
                  bgcolor: alpha(feature.color, 0.2),
                  display: 'grid',
                  placeItems: 'center',
                  color: feature.color,
                  boxShadow: `0 12px 32px ${alpha(feature.color, 0.25)}`,
                }}
              >
                {feature.icon}
              </Box>
              <Typography variant="h6" fontWeight={700} sx={{ letterSpacing: '-0.01em' }}>
                {feature.title}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                {feature.description}
              </Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>

      {/* Story + Stack */}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Paper
            sx={{
              p: { xs: 3, sm: 3.5 },
              borderRadius: 3,
              border: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
              mb: { xs: 2, md: 0 },
            }}
          >
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'flex-start', sm: 'center' }} spacing={1} justifyContent="space-between">
                <Stack direction="row" alignItems="center" spacing={1}>
                  <TimelineRoundedIcon sx={{ color: 'primary.main' }} />
                  <Typography variant="subtitle1" fontWeight={700}>
                    Our Story
                  </Typography>
                </Stack>
                <Button
                  size="small"
                  variant="outlined"
                  color="primary"
                  startIcon={<AutoAwesomeRoundedIcon fontSize="small" />}
                  component="a"
                  href="https://github.com/users/sureshfizzy/projects/1"
                  target="_blank"
                  rel="noreferrer"
                  sx={{ borderRadius: 2, textTransform: 'none' }}
                >
                  View Roadmap
                </Button>
              </Stack>
              <Typography variant="body1" color="text.secondary" sx={{ lineHeight: 1.7 }}>
                CineSync focuses on simplifying media pipelines with automation, observability, and a clean interface,
                so you spend more time watching and less time managing.
              </Typography>
              <Divider />
              <Stack spacing={1}>
                <Typography variant="subtitle2" color="text.secondary" fontWeight={600}>
                  Releases in motion
                </Typography>
                <Stack spacing={1}>
                  {[
                    { label: 'UI polish & accessibility', progress: 82 },
                    { label: 'Deeper Arr automation', progress: 65 },
                    { label: 'Observability + alerts', progress: 54 },
                  ].map((item) => (
                    <Fragment key={item.label}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography variant="body2" fontWeight={600}>
                          {item.label}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {item.progress}%
                        </Typography>
                      </Stack>
                      <LinearProgress
                        variant="determinate"
                        value={item.progress}
                        sx={{
                          height: 8,
                          borderRadius: 999,
                          bgcolor: alpha(theme.palette.primary.main, 0.08),
                        }}
                      />
                    </Fragment>
                  ))}
                </Stack>
              </Stack>
            </Stack>
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <Paper
            sx={{
              p: { xs: 3, sm: 3.5 },
              borderRadius: 3,
              border: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
              height: '100%',
            }}
          >
            <Stack spacing={2.5}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <CodeRoundedIcon sx={{ color: 'secondary.main' }} />
                <Typography variant="subtitle1" fontWeight={700}>
                  Stack & Integrations
                </Typography>
              </Stack>
              <Stack direction="row" flexWrap="wrap" gap={1}>
                {(techStack.length ? techStack.map((item) => item.name) : ['React', 'TypeScript', 'Go', 'Python']).map((item) => (
                  <Chip
                    key={item}
                    label={item}
                    size="small"
                    sx={{
                      borderRadius: 999,
                      bgcolor: alpha(theme.palette.text.primary, 0.05),
                      border: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
                      fontWeight: 600,
                    }}
                  />
                ))}
              </Stack>
              <Divider />
              <Stack spacing={1}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <GroupsRoundedIcon sx={{ color: 'text.secondary' }} />
                  <Typography variant="subtitle2" color="text.secondary" fontWeight={700}>
                    Contributors
                  </Typography>
                </Stack>
                <AvatarGroup
                  max={6}
                  sx={{
                    justifyContent: 'flex-start',
                    alignItems: 'flex-start',
                    alignSelf: 'flex-start',
                    ml: 0,
                    pl: 0,
                    '& .MuiAvatarGroup-avatar': {
                      marginLeft: 0.5,
                      mr: 0,
                    },
                  }}
                >
                  {(contributors.length ? contributors : []).map((c) => (
                    <Avatar
                      key={c.login}
                      alt={c.login}
                      src={c.avatarUrl}
                      component="a"
                      href={c.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      sx={{ bgcolor: alpha(theme.palette.primary.main, 0.8), fontWeight: 700 }}
                    >
                      {c.login?.charAt(0).toUpperCase()}
                    </Avatar>
                  ))}
                </AvatarGroup>
                {!contributors.length && (
                  <Typography variant="body2" color="text.secondary">
                    A distributed crew of media tinkerers, devs, and ops folks who love smooth libraries and crisp UX.
                  </Typography>
                )}
              </Stack>
            </Stack>
          </Paper>
        </Grid>
      </Grid>

      {/* Sponsors */}
      <Paper
        sx={{
          mt: 3,
          p: { xs: 3, sm: 3.5 },
          borderRadius: 3,
          border: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
          background: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.08 : 0.06),
        }}
      >
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} alignItems="center">
            <VolunteerActivismRoundedIcon sx={{ color: theme.palette.primary.main }} />
            <Typography variant="h6" fontWeight={700}>
              Sponsor CineSync
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Support ongoing development and hosting.
          </Typography>
          <Grid container spacing={1.5}>
            {sponsorLinks.map((link) => (
              <Grid key={link.href} size={{ xs: 12, sm: 6, md: 3 }}>
                <Button
                  fullWidth
                  variant="contained"
                  color="inherit"
                  component="a"
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  startIcon={link.icon}
                  sx={{
                    borderRadius: 2,
                    justifyContent: 'flex-start',
                    gap: 1,
                    color: theme.palette.getContrastText(link.color),
                    background: link.color,
                    boxShadow: `0 8px 18px ${alpha(link.color, 0.35)}`,
                    '&:hover': {
                      background: link.color,
                      filter: 'brightness(0.95)',
                    },
                  }}
                >
                  {link.label}
                </Button>
              </Grid>
            ))}
          </Grid>
        </Stack>
      </Paper>
    </Box>
  );
}









